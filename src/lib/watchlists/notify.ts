import { and, eq, isNull, lt, or } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import type { Db } from "@/db/client";
import { watchlists } from "@/db/schema";
import { sendEmail } from "@/lib/email/sendEmail";
import type { RecordActivityInput } from "@/lib/activity/types";
import { isDemoMode } from "@/lib/demo/mode";
import { buildAlertEmail } from "./buildAlertEmail";

/** Per-watch cooldown: at most one alert email per watch per hour, so a
 *  burst of edits on a hot entity doesn't spam its watchers. */
export const WATCH_COOLDOWN_MS = 60 * 60 * 1000;
/** Max watchers emailed per activity event — a hard spam ceiling. Tuning
 *  notification volume beyond this is slice 38 (Sentinel)'s job. */
export const WATCH_NOTIFY_CAP = 5;

/**
 * Dispatches alert emails to every eligible watcher of the entity an
 * activity event just landed on. Hooked into `recordActivitySafely` (see
 * spec §5) so all 21 instrumented action handlers get watch alerts for
 * free, with zero per-action wiring.
 *
 * Semantics (spec §5, followed exactly):
 *   1. Skip immediately when there's no concrete entity to watch
 *      (`entityId === null`) or in demo mode (demo never sends real email
 *      and never mutates `last_notified_at`).
 *   2. One indexed SELECT on (orgId, entityType, entityId) with the
 *      cooldown predicate baked in (`last_notified_at` NULL or older than
 *      `WATCH_COOLDOWN_MS`), capped at `WATCH_NOTIFY_CAP` rows.
 *   3. Per watch, send a plain-text alert built by the pure
 *      `buildAlertEmail`.
 *   4. Only a live, non-simulated send consumes the cooldown — a
 *      simulated send (keyless/demo/build env) must NOT update
 *      `last_notified_at`, or a due watcher could silently miss its real
 *      alert once a live key is configured.
 *   5. The entire body runs under one try/catch: any failure (a bad
 *      query, a rejected `sendEmail` call, anything) is Sentry-tagged and
 *      swallowed. This function can NEVER throw — audits and business
 *      logic must never be blocked by notification failures.
 *
 * PII discipline: no recipient address, subject, or body text ever
 * reaches a Sentry tag — only the fixed `feature`/`subStep` attribution.
 */
export async function notifyWatchersSafely(
  db: Db,
  event: RecordActivityInput,
  now: Date = new Date(),
): Promise<void> {
  try {
    if (event.entityId === null || isDemoMode()) return;

    const cutoff = new Date(now.getTime() - WATCH_COOLDOWN_MS);
    const dueWatches = await db
      .select()
      .from(watchlists)
      .where(
        and(
          eq(watchlists.orgId, event.orgId),
          eq(watchlists.entityType, event.entityType),
          eq(watchlists.entityId, event.entityId),
          or(isNull(watchlists.lastNotifiedAt), lt(watchlists.lastNotifiedAt, cutoff)),
        ),
      )
      .limit(WATCH_NOTIFY_CAP);

    const { subject, text } = buildAlertEmail(event, now);

    for (const watch of dueWatches) {
      const res = await sendEmail({
        to: watch.notifyEmail,
        subject,
        text,
        feature: "watchlist-alert",
      });
      if (res.ok && !res.simulated) {
        await db
          .update(watchlists)
          .set({ lastNotifiedAt: now })
          .where(eq(watchlists.id, watch.id));
      }
    }
  } catch (e) {
    Sentry.withScope((scope) => {
      scope.setTag("feature", "watchlist-alert");
      scope.setTag("subStep", "notifyWatchers");
      Sentry.captureException(e);
    });
    // Best-effort. Never re-throw — see the doc comment above.
  }
}
