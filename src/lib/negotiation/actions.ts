"use server";

import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { requireSession } from "@/lib/auth/requireSession";
import { firstZodError } from "@/lib/company/validation";
import { safeErrShape } from "@/lib/actionErrors";
import { ForbiddenError } from "@/lib/auth/errors";
import { getDealForCoaching, getPartnerBidHistory, getPartnerPendingBidsOnDeal } from "@/db/negotiation";
import { computeNegotiationStats, type NegotiationStats } from "@/lib/negotiation/compute";
import { generateCoaching } from "@/lib/negotiation/coach";

/**
 * getNegotiationCoaching — the one action in this module (slice 42 spec —
 * docs/superpowers/plans/2026-07-31-negotiation-coach-slice-42.md, Task
 * 42-2). Read-only: loads a deal + one partner's bid history against the
 * owner, computes deterministic stats (src/lib/negotiation/compute.ts), and
 * garnishes them with an AI (or simulated) coaching narrative
 * (src/lib/negotiation/coach.ts).
 */

// Test seam — see test/lib/negotiation/actions.test.ts. Identical pattern to
// src/lib/drafting/actions.ts / src/lib/documents/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  // Test seam only. "use server" exports are POST-invokable; outside the
  // test runner this must do nothing so it can't poison db() in prod (review chip).
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) return;
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

const getNegotiationCoachingInput = z.object({
  dealId: z.number().int().positive(),
  bidderOrgId: z.number().int().positive(),
});
export type GetNegotiationCoachingInput = z.infer<typeof getNegotiationCoachingInput>;

export type NegotiationCoachingResult =
  | { ok: true; stats: NegotiationStats; lines: string[]; simulated: boolean }
  | { ok: false; error: string };

/**
 * getNegotiationCoaching — the ONE deliberate demo-guard deviation in this
 * module, same precedent as `draftEmail` (src/lib/drafting/actions.ts) and
 * `runCommand` (src/lib/command/actions.ts): this action does NOT run the
 * shared `isDemoMode()` short-circuit every write action in this codebase
 * uses. Justification, same shape as both precedents: (1) nothing is
 * written here — generating coaching reads data and calls the AI seam,
 * full stop; (2) unlike a blocked write, blocking this in demo would
 * silently kill the "Coach me" feature in the one place people actually see
 * it (the demo IS the product tour) — every DB read this action touches
 * (`getDealForCoaching`, `getPartnerBidHistory`, `getPartnerPendingBidsOnDeal`)
 * already demo-branches internally to the authored Mehta/AIYA seed story
 * (src/lib/demo/seed.ts), so demo mode has everything it needs to answer
 * without ever touching a real database. Session and org-scoping below
 * remain fully mandatory — only the demo short-circuit itself is skipped.
 *
 * Hand-rolled session-first sequence (copied from `draftEmail`'s shape,
 * not the shared `run()`/`runWithUser()` wrapper, for the same reason
 * `draftEmail` isn't wrapped: the demo-guard deviation above has nowhere to
 * hook into a wrapper that hardcodes it): session re-asserted FIRST
 * (missing/invalid -> "Unauthorized" before Zod ever sees the input), then
 * Zod (`firstZodError`), then the business logic below inside a single
 * try/catch whose ordering mirrors `run()`'s own layered mapping
 * (ForbiddenError -> "Forbidden", silently, no Sentry; anything else ->
 * Sentry-captured with tags only, then a generic "Server error").
 *
 * OWNER-ONLY AUTHZ — THE SECURITY CORE. `deal.orgId === session.orgId` is
 * checked and thrown as `ForbiddenError` BEFORE any history read, any
 * pending-bid read, or any AI call — a *bidder* on this deal must NEVER be
 * able to fetch coaching about the deal's OWNER (that would hand a bidder
 * the owner's own negotiation playbook against themselves, e.g. "you've
 * conceded X on average after Y rounds"). A missing dealId collapses into
 * the SAME Forbidden as a real cross-org id (house convention — never let
 * a caller distinguish "doesn't exist" from "not yours").
 *
 * After authz passes: the partner's history on the owner's OTHER deals and
 * their pending bid(s) on THIS deal run concurrently (`Promise.all`) — same
 * "independent org-scoped reads, no ordering dependency" convention as
 * `buildDraftingContext`'s four-way `Promise.all`
 * (src/lib/drafting/context.ts) — then `computeNegotiationStats` (pure) and
 * finally `generateCoaching` (the AI garnish + simulated fallback).
 *
 * Returns `{ok:true, stats, lines, simulated} | {ok:false, error}`. NO
 * audit (a read — nothing happened), NO `revalidatePath` (nothing on any
 * page changed).
 */
export async function getNegotiationCoaching(raw: unknown): Promise<NegotiationCoachingResult> {
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = getNegotiationCoachingInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  const { dealId, bidderOrgId } = parsed.data;

  try {
    const d = db();

    const deal = await getDealForCoaching(d, dealId);
    if (!deal || deal.orgId !== orgId) throw new ForbiddenError();

    const [history, pending] = await Promise.all([
      getPartnerBidHistory(d, orgId, bidderOrgId, dealId),
      getPartnerPendingBidsOnDeal(d, orgId, dealId, bidderOrgId),
    ]);

    const stats = computeNegotiationStats(
      history,
      { kind: deal.kind, askCents: deal.priceCents, partnerPendingBidsCents: pending.priceCents },
      pending.partnerLabel,
    );

    const coaching = await generateCoaching(stats, orgId);
    if (!coaching.ok) return coaching;

    return { ok: true, stats, lines: coaching.lines, simulated: coaching.simulated };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    const safe = safeErrShape(e);
    // Constant format string + structured extras — keeps the log format
    // free of caller-controlled substitution patterns (CWE-134), same
    // convention as every other action's catch block in this codebase.
    console.error("[negotiation action] error", { action: "getNegotiationCoaching", ...safe });
    // Tags only, no domain data (no dealId/bidderOrgId/partnerLabel/stats) —
    // `safe` is already PII-shaped by `safeErrShape` (name/message/code/
    // constraint of the ERROR object itself), never anything this action
    // computed. Mirrors draftEmail's identical capture shape exactly.
    Sentry.captureException(new Error("negotiation action failed"), {
      tags: { layer: "negotiation-action", action: "getNegotiationCoaching" },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}
