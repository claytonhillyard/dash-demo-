"use server";

import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { requireSession } from "@/lib/auth/requireSession";
import { firstZodError } from "@/lib/company/validation";
import { safeErrShape } from "@/lib/actionErrors";
import { COMMANDS, HELP_RESULT, type CommandId, type CommandResult } from "./registry";
import { routeCommand } from "./route";

/**
 * runCommand — the one action in this module (spec §5). Read-only: routes a
 * free-text question to a whitelisted command and runs its org-scoped
 * executor. No audit row (reads aren't audited anywhere in this codebase),
 * no `revalidatePath` (nothing on any page changes).
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
): Promise<{ ok: true; result: CommandResult; command: CommandId | "help" } | { ok: false; error: string }> {
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
  let commandForTag: CommandId | "help" | "unrouted" = "unrouted";
  try {
    const routed = await routeCommand(parsed.data.question, orgId);
    commandForTag = routed.id;

    if (routed.id === "help") {
      return { ok: true, result: HELP_RESULT, command: "help" };
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
