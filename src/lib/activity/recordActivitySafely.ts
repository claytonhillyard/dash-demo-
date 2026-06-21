import * as Sentry from "@sentry/nextjs";
import type { Db } from "@/db/client";
import { recordActivity } from "./recordActivity";
import type { RecordActivityInput } from "./types";
import { isDemoMode } from "@/lib/demo/mode";

/**
 * Action-safe wrapper around `recordActivity`. Catches every failure,
 * tags Sentry with orgId + action + subStep, and SWALLOWS so audit
 * failure never blocks the user-facing action.
 *
 * Action sites MUST use this wrapper, not `recordActivity` directly.
 * Calling the raw helper inside a `runWithUser` block is a bug — audit
 * failure would propagate up and surface as an action error.
 */
export async function recordActivitySafely(
  db: Db,
  input: RecordActivityInput,
  ctx: { action: string },
): Promise<void> {
  // Demo guard: action sites that route through customers/actions.ts `run()`
  // never reach this branch (run() early-returns in demo). Kept defensive for
  // future direct callers (cron jobs, background importers) that may bypass
  // the action wrapper but should still respect the "demo never writes" rule.
  if (isDemoMode()) return;
  try {
    await recordActivity(db, input);
  } catch (e) {
    Sentry.withScope((scope) => {
      scope.setTag("orgId", input.orgId);
      scope.setTag("action", ctx.action);
      scope.setTag("subStep", "recordActivity");
      Sentry.captureException(e);
    });
    // Audit is best-effort. Do not re-throw.
  }
}
