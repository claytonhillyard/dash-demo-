"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { draftingPrefs, customers } from "@/db/schema";
import { getCustomerById } from "@/db/customers";
import { getDraftingPrefs } from "@/db/drafting";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import { firstZodError } from "@/lib/company/validation";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import { ACTIVITY_SUMMARY_MAX_LEN } from "@/lib/activity/types";
import { safeErrShape, mapDbConstraintError } from "@/lib/actionErrors";
import { sendEmail } from "@/lib/email/sendEmail";
import type { EmailErrorCode } from "@/lib/email/types";
import { buildDraftingContext } from "./context";
import { DRAFT_INTENTS, generateDraftCore, type DraftIntent } from "./generate";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Test seam — see test/lib/drafting/actions.test.ts. Production paths read
// the live Neon/pglite via getDb(). Identical pattern to
// src/lib/payments/actions.ts / src/lib/invoices/actions.ts.
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

// ---------------------------------------------------------------------------
// Validation (spec §6) — kept file-local/unexported (only the inferred
// *types* below are exported — erased at compile time, so they don't trip
// the "use server" export-must-be-async-function rule), same convention as
// src/lib/payments/actions.ts.
// ---------------------------------------------------------------------------

const saveDraftingPrefsInput = z.object({
  tone: z.string().trim().max(500).optional(),
  signature: z.string().trim().max(200).optional(),
});
export type SaveDraftingPrefsInput = z.infer<typeof saveDraftingPrefsInput>;

const saveCustomerStyleNoteInput = z.object({
  customerId: z.number().int().positive(),
  styleNote: z.string().trim().max(300),
});
export type SaveCustomerStyleNoteInput = z.infer<typeof saveCustomerStyleNoteInput>;

const draftEmailInput = z.object({
  customerId: z.number().int().positive(),
  intent: z.enum(DRAFT_INTENTS),
  instruction: z.string().trim().max(300).optional(),
});
export type DraftEmailInput = z.infer<typeof draftEmailInput>;

const sendDraftInput = z.object({
  customerId: z.number().int().positive(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});
export type SendDraftInput = z.infer<typeof sendDraftInput>;

// ---------------------------------------------------------------------------
// Shared helpers — copied from src/lib/payments/actions.ts's run()/
// FriendlyError (which itself copies src/lib/invoices/actions.ts) — house
// convention: mirror the sibling file's scaffold rather than extract a
// shared module (that refactor is chip territory, not this slice).
// ---------------------------------------------------------------------------

/** Thrown inside a `run()` callback to surface a short, user-facing message
 *  that is neither an authz reject (`ForbiddenError` -> "Forbidden") nor an
 *  opaque, Sentry-captured failure ("Server error"). Introduced in slice
 *  37-1 unused by either action defined there — saveDraftingPrefs is a pure
 *  upsert, and saveCustomerStyleNote's only failure mode is the atomic
 *  cross-org Forbidden check — scaffolded ahead of slice 37-2's `sendDraft`
 *  (below), which throws it for "no email on file for this customer"
 *  (mirrors sendInvoice's identical guard, src/lib/invoices/actions.ts).
 *  Local to this file, not shared, same as every other action module in
 *  this codebase.
 */
class FriendlyError extends Error {}

/**
 * Shared wrapper: demo guard, session re-assert + orgId resolve, validate,
 * run the callback, revalidate, catch chain. Never throws to the UI —
 * every failure is mapped to { ok: false, error }. Copied from
 * src/lib/payments/actions.ts `run()`, with one deliberate adaptation:
 * payments/invoices hardcode an unconditional `revalidatePath("/invoices")`
 * because every action in those files concerns one shared list page. This
 * module has no such shared home — saveDraftingPrefs is org-level (no page
 * of its own yet) and saveCustomerStyleNote is per-customer — so revalidation
 * is entirely opt-in via `revalidate`, called with whatever path(s) each
 * action names (possibly none).
 *
 * Layered error mapping:
 *   ForbiddenError      → "Forbidden"   (deliberate authz reject inside fn)
 *   FriendlyError        → e.message    (thrown by sendDraft below)
 *   constraint violation → mapDbConstraintError's friendly string
 *   anything else       → "Server error" (Sentry-captured, opaque to UI)
 */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number, actor: string) => Promise<void>,
  opts: { action: string; revalidate?: (input: T) => string[] },
): Promise<ActionResult> {
  if (isDemoMode()) {
    return { ok: false, error: "Demo mode — changes are disabled" };
  }
  let orgId: number;
  let actor: string;
  try {
    const session = await requireSession();
    orgId = session.orgId;
    actor = session.user;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  try {
    await fn(parsed.data, orgId, actor);
    if (opts.revalidate) {
      for (const p of opts.revalidate(parsed.data)) revalidatePath(p);
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    if (e instanceof FriendlyError) {
      return { ok: false, error: e.message };
    }
    const friendly = mapDbConstraintError(e);
    if (friendly !== null) {
      return { ok: false, error: friendly };
    }
    const safe = safeErrShape(e);
    // Constant format string + structured extras — keeps the log format
    // free of caller-controlled substitution patterns (CWE-134).
    console.error("[drafting action] error", { action: opts.action, ...safe });
    Sentry.captureException(new Error("drafting action failed"), {
      tags: { layer: "drafting-action", action: opts.action },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}

// ---------------------------------------------------------------------------
// saveDraftingPrefs
// ---------------------------------------------------------------------------

/**
 * saveDraftingPrefs — org-level upsert (spec §6): one row per org via
 * `onConflictDoUpdate` on the `drafting_prefs_org_unique` index, so saving
 * twice updates the same row rather than erroring or duplicating (a plain
 * single-column `target` — verified against the Db union type; no
 * `.returning()` is chained, so the parameterized-overload fights seen
 * elsewhere in this codebase with `.returning({...})` never come up here).
 * Blank/omitted fields store as NULL, not empty string — a blank tone means
 * "no preference set". Audit payload is deliberately `{}`: the tone/
 * signature text is free-form voice configuration, kept out of the audit
 * log the same way invoice notes and customer notes never appear in theirs.
 */
export async function saveDraftingPrefs(raw: unknown): Promise<ActionResult> {
  return run(
    saveDraftingPrefsInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();
      const tone = input.tone || null;
      const signature = input.signature || null;

      await d
        .insert(draftingPrefs)
        .values({ orgId, tone, signature })
        .onConflictDoUpdate({
          target: draftingPrefs.orgId,
          set: { tone, signature, updatedAt: new Date() },
        });

      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "org",
          entityId: orgId,
          verb: "updated",
          summary: "Updated email drafting preferences",
          payload: {},
        },
        { action: "drafting.savePrefs" },
      );
    },
    { action: "saveDraftingPrefs" },
  );
}

// ---------------------------------------------------------------------------
// saveCustomerStyleNote
// ---------------------------------------------------------------------------

/**
 * saveCustomerStyleNote — org-scoped UPDATE on customers (spec §6). Same
 * atomic-WHERE pattern as `updateCustomer` (src/lib/customers/actions.ts):
 * zero rows updated means the id doesn't exist OR belongs to another org,
 * and the caller can't tell which — both collapse to Forbidden. Blank
 * input clears the note to NULL rather than storing `""`. Audit payload is
 * `{}` — the note itself is free-form per-customer voice text, kept out of
 * the audit trail the same way drafting prefs and invoice notes are.
 */
export async function saveCustomerStyleNote(raw: unknown): Promise<ActionResult> {
  return run(
    saveCustomerStyleNoteInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();
      const styleNote = input.styleNote || null;

      // Zero-arg returning() (RETURNING *) — the Db union type only surfaces
      // the parameterless overload (same workaround as updateCustomer /
      // deletePayment elsewhere in this codebase).
      const res = await d
        .update(customers)
        .set({ styleNote, updatedAt: new Date() })
        .where(and(eq(customers.id, input.customerId), eq(customers.orgId, orgId)))
        .returning();
      if (res.length === 0) throw new ForbiddenError();
      const updated = res[0]!;

      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "customer",
          entityId: input.customerId,
          verb: "updated",
          summary: `Updated style note for ${updated.name}`,
          payload: {},
        },
        { action: "drafting.saveCustomerStyleNote" },
      );
    },
    {
      action: "saveCustomerStyleNote",
      revalidate: (input) => [`/customers/${input.customerId}/edit`],
    },
  );
}

// ---------------------------------------------------------------------------
// draftEmail
// ---------------------------------------------------------------------------

/**
 * draftEmail — the ONE deliberate demo-guard deviation in this file (spec
 * §9): this action does NOT call `run()` and therefore skips its
 * `isDemoMode()` short-circuit. Generation is read-only — nothing is
 * written, nothing is sent — and in demo mode `generateAiText` (the seam
 * `generateDraftCore` calls) already falls back to a simulated response on
 * its own. Blocking this action in demo would silently kill the "generate a
 * draft" half of the panel while leaving the voice/style-note sections
 * looking normal; slice 36's health-insight card renders in demo for the
 * identical reason (read-only + seam-simulated). Session and org-scoping
 * remain fully mandatory below — only the demo short-circuit is skipped.
 *
 * Layering mirrors `run()`'s own order (session -> validate -> business
 * logic) even though this function doesn't call `run()` itself: a missing
 * session is "Unauthorized" before Zod ever sees the input, and a
 * missing/cross-org customerId is "Forbidden" (via `buildDraftingContext`
 * returning null) before any AI call is attempted. NO audit (nothing
 * happened yet — the draft doesn't exist until it's sent) and NO
 * `revalidatePath` (nothing on any page changed).
 */
export async function draftEmail(
  raw: unknown,
): Promise<
  | { ok: true; subject: string; body: string; simulated: boolean }
  | { ok: false; error: string }
> {
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = draftEmailInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }

  try {
    const d = db();
    const ctx = await buildDraftingContext(d, orgId, parsed.data.customerId);
    if (!ctx) return { ok: false, error: "Forbidden" };

    const prefs = await getDraftingPrefs(d, orgId);
    const intent: DraftIntent = parsed.data.intent;
    return await generateDraftCore(ctx, prefs, intent, parsed.data.instruction, orgId);
  } catch (e) {
    const safe = safeErrShape(e);
    console.error("[drafting action] error", { action: "draftEmail", ...safe });
    Sentry.captureException(new Error("drafting action failed"), {
      tags: { layer: "drafting-action", action: "draftEmail" },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}

// ---------------------------------------------------------------------------
// sendDraft
// ---------------------------------------------------------------------------

/** Short, user-facing text for every sendEmail seam failure code — never
 *  the raw code, mirrors sendInvoice's identical `EMAIL_ERROR_MESSAGES`
 *  (src/lib/invoices/actions.ts). */
const EMAIL_ERROR_MESSAGES: Record<EmailErrorCode, string> = {
  rate_limited: "Email service is rate-limited — try again shortly",
  unavailable: "Email service is temporarily unavailable — try again shortly",
  error: "Couldn't send the email — try again",
};

/**
 * sendDraft — fully guarded (demo blocked, unlike `draftEmail` above): this
 * one goes through `run()` like every other write in this file. Loads the
 * customer org-scoped via `getCustomerById` (missing/cross-org ->
 * `ForbiddenError`, same atomic-lookup convention as every other
 * per-customer action); no email on file -> `FriendlyError` (mirrors
 * sendInvoice's identical guard, src/lib/invoices/actions.ts).
 *
 * The org's signature is appended to the text that actually goes to the
 * email seam ONLY — never written back into `input.body` — so the
 * editable textarea always shows exactly what the user wrote (WYSIWYG,
 * spec §9) and a resend after an edit can never double the signature: each
 * call appends it exactly once to whatever `body` was passed in that call.
 *
 * Audit fires on success for BOTH outcomes (real or simulated), same
 * `payload: { simulated }` convention as sendInvoice — the subject is
 * deliberately NOT in the summary (it's free text the customer will read,
 * not a stable label) and the recipient address never reaches the audit
 * row or Sentry.
 */
export async function sendDraft(
  raw: unknown,
): Promise<{ ok: true; simulated?: true } | { ok: false; error: string }> {
  let simulated = false;
  const res = await run(
    sendDraftInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();

      const customer = await getCustomerById(d, orgId, input.customerId);
      if (!customer) throw new ForbiddenError();
      if (!customer.email) {
        throw new FriendlyError("No email on file for this customer");
      }

      const prefs = await getDraftingPrefs(d, orgId);
      const text = input.body + (prefs?.signature ? `\n\n${prefs.signature}` : "");

      const emailRes = await sendEmail({
        to: customer.email,
        subject: input.subject,
        text,
        feature: "drafting",
      });
      if (!emailRes.ok) {
        throw new FriendlyError(EMAIL_ERROR_MESSAGES[emailRes.error]);
      }
      simulated = emailRes.simulated;

      // Truncated to the activity cap — customer.name alone could exceed it,
      // and an over-long summary fails recordActivity's Zod, silently
      // dropping the audit row (recordActivitySafely swallows the throw) —
      // same defensive truncation as sendInvoice's identical audit call.
      const fullSummary = `Sent email to ${customer.name}`;
      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "customer",
          entityId: input.customerId,
          verb: "sent",
          summary:
            fullSummary.length > ACTIVITY_SUMMARY_MAX_LEN
              ? `${fullSummary.slice(0, ACTIVITY_SUMMARY_MAX_LEN - 1)}…`
              : fullSummary,
          payload: { simulated },
        },
        { action: "drafting.sendDraft" },
      );
    },
    {
      action: "sendDraft",
      revalidate: (input) => [`/customers/${input.customerId}/edit`],
    },
  );
  if (!res.ok) return res;
  return simulated ? { ok: true, simulated: true } : { ok: true };
}
