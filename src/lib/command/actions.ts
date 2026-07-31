"use server";

import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { requireSession } from "@/lib/auth/requireSession";
import { firstZodError } from "@/lib/company/validation";
import { safeErrShape } from "@/lib/actionErrors";
import { COMMANDS, HELP_RESULT, type CommandId, type CommandResult } from "./registry";
import { routeCommand } from "./route";
import { WRITE_COMMANDS, type WriteCommandId, type ActionResult } from "./writeRegistry";

/**
 * runCommand — the read/preview action in this module (spec §5, extended by
 * §3.1 in slice 35b-2). Routes a free-text question to a whitelisted
 * command: a READ command runs its org-scoped executor and returns its
 * result directly (unchanged 35a behavior, no audit — reads aren't audited
 * anywhere in this codebase, no `revalidatePath` — nothing on any page
 * changes). A WRITE command instead calls that command's own `preview`
 * (src/lib/command/writeRegistry.ts) — itself read-only — and returns a
 * `confirm` result (registry.ts's `CommandResult`) for the palette to
 * render; EXECUTING NOTHING. `confirmWriteCommand`, below, is the only
 * function in this file (or this whole slice) that ever mutates anything —
 * see its own doc comment for the security invariant this split exists to
 * enforce.
 */

// Test seam — see test/lib/command/actions.test.ts. Identical pattern to
// src/lib/drafting/actions.ts / src/lib/payments/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Type-guard version of the `Object.hasOwn(WRITE_COMMANDS, id)` whitelist
 *  check (route.ts's `parseRouterResponse` uses the same guard as a plain
 *  `if`, since the read/write split there only ever RETURNS a value keyed
 *  by whichever branch matched). Here, narrowing both ways matters: a
 *  routed id is `CommandId | WriteCommandId`, and `runCommand`'s read path
 *  further down indexes `COMMANDS` with whatever `routed.id` is left AFTER
 *  the write branch's early return — without a real type predicate,
 *  TypeScript can't narrow that negative branch back down to `CommandId`,
 *  since `Object.hasOwn` alone carries no type information. */
function isWriteCommandId(id: CommandId | WriteCommandId): id is WriteCommandId {
  return Object.hasOwn(WRITE_COMMANDS, id);
}

const runCommandInput = z.object({
  question: z.string().trim().min(1).max(300),
});
export type RunCommandInput = z.infer<typeof runCommandInput>;

/**
 * runCommand — the ONE deliberate demo-guard deviation in this file, same
 * precedent as `draftEmail` (src/lib/drafting/actions.ts, spec §9): this
 * action does NOT run the shared `isDemoMode()` short-circuit every other
 * action module in this codebase opens with. Two independent reasons stack
 * here (stronger than draftEmail's own single reason): (1) every command
 * executor is read-only (src/lib/command/registry.ts) — nothing is ever
 * written, so there is nothing for a demo guard to protect; (2) unlike
 * drafting (which still makes a live-or-simulated AI call either way),
 * `routeCommand`'s keyless rules matcher (`routeByRules`,
 * src/lib/command/route.ts) is fully deterministic and needs no API key at
 * all — demo mode already has everything it needs to answer a question from
 * seed data without ever reaching the AI seam's simulated branch. Blocking
 * this action in demo would silently turn the entire `/command` page into a
 * dead end in the one mode most likely to be showing it off.
 *
 * Session is still fully mandatory below — only the demo short-circuit is
 * skipped. Ordering mirrors the shared `run()` wrapper's own layering
 * (payments/invoices/drafting) even though this function is hand-rolled
 * rather than routed through it: session re-assert FIRST (a missing session
 * is "Unauthorized" before Zod ever sees the input), Zod validation second.
 */
export async function runCommand(
  raw: unknown,
): Promise<
  | { ok: true; result: CommandResult; command: CommandId | WriteCommandId | "help" }
  | { ok: false; error: string }
> {
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = runCommandInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }

  // Hoisted above the try so the catch block below can tag Sentry with
  // WHICH command was executing when an executor threw — declared outside
  // the try (rather than `const` inside it) specifically so it survives
  // into the catch block's scope.
  let commandForTag: CommandId | WriteCommandId | "help" | "unrouted" = "unrouted";
  try {
    const routed = await routeCommand(parsed.data.question, orgId);
    commandForTag = routed.id;

    if (routed.id === "help") {
      return { ok: true, result: HELP_RESULT, command: "help" };
    }

    // Slice 35b-2 (spec §3.1): a WRITE id branches off BEFORE the read path
    // below ever runs — `isWriteCommandId` (above) wraps the same
    // `Object.hasOwn`, not `in`, rationale as every other command-id
    // whitelist check in this slice (route.ts's `parseRouterResponse`): a
    // routed id can never be `"__proto__"` etc. in practice (routeCommand's
    // own two paths already whitelist it), but the guard costs nothing and
    // keeps this file's discipline uniform.
    if (isWriteCommandId(routed.id)) {
      const writeId = routed.id;
      const writeDef = WRITE_COMMANDS[writeId];
      // Defense in depth (spec §5), same idiom as the read path below:
      // re-validate whatever routeCommand handed back against THIS def's
      // own `routeParams` before ever calling `preview`. routeCommand's AI
      // path already vouches for this (route.ts's parseRouterResponse); the
      // rules path's heuristics (extractRecordPaymentParams etc.) are
      // best-effort and can legitimately come up short (e.g. "record a
      // payment" alone has no amount or invoice to extract) — unlike the
      // read path's re-validation, this one is NOT purely defensive, it's
      // a real, expected branch. Either way, a rejection here degrades to
      // the same help result a routing miss would, never a crash.
      const paramsResult = writeDef.routeParams.safeParse(routed.params);
      if (!paramsResult.success) {
        return { ok: true, result: HELP_RESULT, command: "help" };
      }

      // READ-ONLY: `preview` never calls `.insert()`/`.update()`/`.delete()`
      // (writeRegistry.ts's file-level doc comment; enforced empirically by
      // test/lib/command/writeRegistry.test.ts's table-count assertions).
      // Nothing has mutated by the time this function returns, in either
      // branch below — that's the whole point of the two-phase contract
      // (spec §1/§3): the AI routes and previews, the human's OWN Confirm
      // click is what calls `confirmWriteCommand` (execute), never this
      // function.
      const preview = await writeDef.preview(db(), orgId, paramsResult.data);
      if (!preview.ok) {
        return { ok: false, error: preview.error };
      }
      return {
        ok: true,
        result: {
          kind: "confirm",
          commandId: writeId,
          resolvedParams: preview.resolvedParams,
          summary: preview.summary,
          details: preview.details,
          warning: preview.warning,
        },
        command: writeId,
      };
    }

    const def = COMMANDS[routed.id];
    // Defense in depth (spec §5): both of routeCommand's own paths
    // (routeByRules and the AI path's parse defense) already validate
    // params against this exact schema before returning, so this should
    // never actually reject — but `def.run` must never receive params
    // neither path actually vouched for. A rejection here degrades to the
    // same help result a routing miss would, rather than a scary error, for
    // what is fundamentally a routing anomaly, not a user mistake.
    const paramsResult = def.params.safeParse(routed.params);
    if (!paramsResult.success) {
      return { ok: true, result: HELP_RESULT, command: "help" };
    }

    const result = await def.run(db(), orgId, paramsResult.data);
    return { ok: true, result, command: routed.id };
  } catch (e) {
    const safe = safeErrShape(e);
    // Constant format string + structured extras (CWE-134), same convention
    // as src/lib/drafting/actions.ts.
    console.error("[command action] error", { action: "runCommand", command: commandForTag, ...safe });
    // Tags only — feature/command id. The QUESTION is user free text and
    // must NEVER reach Sentry (spec §5/§8), unlike `safe`/`extra` above
    // which are already PII-stripped by safeErrShape and carry no question
    // content of their own.
    Sentry.captureException(new Error("command action failed"), {
      tags: { layer: "command-action", action: "runCommand", command: commandForTag },
      extra: safe,
    });
    return { ok: false, error: "Couldn't run that — try again" };
  }
}

// ---------------------------------------------------------------------------
// confirmWriteCommand — the only mutation point in the AI command layer.
// ---------------------------------------------------------------------------

const confirmWriteCommandInput = z.object({
  commandId: z.string().trim().min(1).max(100),
  // Unknown, re-validated next: the write def's OWN `execute` (really the
  // underlying guarded action it delegates to — recordPayment/sendInvoice/
  // saveCustomerStyleNote) re-parses this with ITS OWN Zod input schema.
  // This function never inspects or interprets `resolvedParams` itself —
  // see the security-invariant note below.
  resolvedParams: z.unknown(),
});
export type ConfirmWriteCommandInput = z.infer<typeof confirmWriteCommandInput>;

/**
 * confirmWriteCommand — the ONLY mutation point in the entire AI command
 * layer (spec §3.2). This is where the human's Confirm click lands: it
 * takes the EXACT `commandId`/`resolvedParams` a prior `runCommand` preview
 * handed the palette, and delegates straight to that write command's
 * `execute` (src/lib/command/writeRegistry.ts) — a thin passthrough to the
 * SAME pre-existing guarded action (recordPayment/sendInvoice/
 * saveCustomerStyleNote) the normal, non-AI UI already uses for that exact
 * mutation, with all of ITS OWN session/org-scoping/demo/Zod/status/overpay
 * guards and audit trail fully intact.
 *
 * There is deliberately NO signing or token binding this call back to the
 * `runCommand` preview that produced its `resolvedParams` (spec §3.2's
 * "why no signing" note): the underlying guarded action IS the security
 * boundary. It re-derives orgId from ITS OWN `requireSession()` call and
 * re-checks every WHERE clause against that org — so a hand-forged
 * `resolvedParams` (a cross-org id, a stale/tampered amount, anything) can
 * never make this function do more than the caller could already do
 * through the normal UI for their OWN org. This file's own session check
 * below exists purely as the Unauthorized gate for an unauthenticated
 * confirm click; org-scoped authority lives entirely in the delegate.
 *
 * Session-first (hand-rolled, copied from `runCommand`'s own sequence
 * above): a missing session is "Unauthorized" before Zod ever sees the
 * input. Deliberately NO `isDemoMode()` short-circuit of its own — unlike
 * every guarded action module in this codebase — because the delegate
 * ALREADY has one, and duplicating it here would create a second,
 * potentially-inconsistent demo-mode message. The delegate stays the
 * single source of that string (spec §3.2's explicit "we do not want two
 * different demo messages" decision).
 */
export async function confirmWriteCommand(raw: unknown): Promise<ActionResult> {
  // Session re-assert only — unlike runCommand (which passes session.orgId
  // into every read executor), this function has no executor of its own to
  // hand orgId to: `execute()` delegates straight to the underlying guarded
  // action, which re-derives orgId from its OWN requireSession() call. The
  // point of asserting a session here is solely the Unauthorized gate for
  // an unauthenticated confirm click.
  try {
    await requireSession();
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = confirmWriteCommandInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  const { commandId, resolvedParams } = parsed.data;

  // Object.hasOwn, not `in` — the same review-driven lesson as every other
  // command-id whitelist in this slice (route.ts's parseRouterResponse,
  // runCommand's write branch above): a client-forged commandId of
  // "__proto__"/"constructor"/etc must never pass this guard and reach
  // `WRITE_COMMANDS[commandId]` (which would otherwise resolve to
  // `Object.prototype`'s own property, not a command def, and throw trying
  // to call `.execute` on it).
  if (!Object.hasOwn(WRITE_COMMANDS, commandId)) {
    return { ok: false, error: "Unknown command" };
  }
  const id = commandId as WriteCommandId;

  try {
    // `execute` is a thin passthrough to the underlying guarded action
    // (writeRegistry.ts's own doc comment) — that action re-validates
    // `resolvedParams` with ITS OWN Zod and re-runs its own session/org/
    // demo/status/overpay checks from scratch, so this call is where the
    // ENTIRE security story for this function actually lives. Its
    // `ActionResult` (ok/simulated/error) is returned VERBATIM — it has
    // already audited on success, and this function adds nothing to it.
    return await WRITE_COMMANDS[id].execute(resolvedParams);
  } catch (e) {
    const safe = safeErrShape(e);
    // Constant format string + structured extras (CWE-134), same convention
    // as runCommand above. `resolvedParams` is deliberately NEVER included
    // here (or anywhere in this function) — only the commandId tag and the
    // PII-stripped `safe` shape (safeErrShape already drops any field that
    // could carry a caller-supplied value) ever reach Sentry.
    console.error("[command action] error", { action: "confirmWriteCommand", command: id, ...safe });
    Sentry.captureException(new Error("command action failed"), {
      tags: { layer: "command-action", action: "confirmWriteCommand", command: id },
      extra: safe,
    });
    return { ok: false, error: "Couldn't complete that — try again" };
  }
}
