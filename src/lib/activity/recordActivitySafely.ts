import * as Sentry from "@sentry/nextjs";
import type { Db } from "@/db/client";
import { recordActivity } from "./recordActivity";
import type { RecordActivityInput } from "./types";
import { isDemoMode } from "@/lib/demo/mode";
import { notifyWatchersSafely } from "@/lib/watchlists/notify";

/**
 * Action-safe wrapper around `recordActivity`. Catches every failure,
 * tags Sentry with orgId + action + subStep, and SWALLOWS so audit
 * failure never blocks the user-facing action. After a successful audit
 * write, also dispatches watch-alert emails via `notifyWatchersSafely` —
 * this is the chokepoint slice 25 hooks into so all 21 instrumented
 * action handlers get watcher notifications for free, with zero
 * per-action wiring. `notifyWatchersSafely` never throws on its own, but
 * it's called inside this function's try so even a bug there falls into
 * the same swallow.
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
    await notifyWatchersSafely(db, input);
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
