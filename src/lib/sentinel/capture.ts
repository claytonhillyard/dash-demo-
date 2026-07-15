import { and, eq, sql } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import type { Db } from "@/db/client";
import { customerHealthSnapshots } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { isBuildPhase } from "@/lib/market/buildPhase";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import type { HealthBand } from "@/lib/customers/healthScore";

/** One entry per already-scored customer, exactly as `computeHealthScore`
 *  (slice 36) produces at the customers-list render — capture NEVER
 *  recomputes a score, it only remembers what was already computed. */
export type ScoredCustomerHealth = {
  customerId: number;
  name: string;
  score: number;
  band: HealthBand;
  components: { recency: number; frequency: number; breadth: number };
};

/** UTC calendar day as "YYYY-MM-DD", derived from an injected `now` (never
 *  `Date.now()` directly) — matches `customer_health_snapshots.captured_on`
 *  and the demo seed's `snapshotDay` helper (src/lib/demo/seed.ts). */
export function toUtcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Ordinal rank for band-drop comparisons — lower is worse. A "drop" is a
 *  strictly decreasing rank (today's rank < the prior snapshot's rank).
 *  Exported for reuse by the trend reader (slice 38-3) and its tests. */
export function bandRank(band: HealthBand): number {
  if (band === "at_risk") return 0;
  if (band === "watch") return 1;
  return 2; // "healthy"
}

type LatestSnapshot = { score: number; band: HealthBand; capturedOn: string };

/**
 * Piggybacks on the customers-list render (spec §4). For each already-scored
 * customer, the first render of a UTC day INSERTs a snapshot row and checks
 * for a band drop against the prior snapshot; every subsequent render that
 * same day UPDATEs the existing row's score/band/components silently — no
 * re-check, so a single day never produces more than one alert.
 *
 * A drop (today's band strictly worse than the prior snapshot's band) emits
 * a `health_dropped` activity event via `recordActivitySafely`, which also
 * chains watcher-email notification for free (slice 25's chokepoint) — an
 * anomaly IS an activity event, nothing more. A customer's first-ever
 * snapshot never alerts (there is nothing to compare against).
 *
 * Skips entirely in demo mode, during the Next.js build phase, or when
 * `scored` is empty (also avoids building an invalid empty SQL `IN ()`).
 * Best-effort: the whole body runs under one try/catch tagged
 * `{ feature: "sentinel", subStep: "capture" }` and swallows — Sentinel can
 * never break the customers-page render it piggybacks on.
 */
export async function captureHealthSnapshots(
  db: Db,
  orgId: number,
  scored: ScoredCustomerHealth[],
  now: Date = new Date(),
): Promise<void> {
  if (isDemoMode() || isBuildPhase() || scored.length === 0) return;

  try {
    const customerIds = scored.map((s) => s.customerId);
    const res = await db.execute(sql`
      SELECT DISTINCT ON (customer_id) customer_id, score, band, captured_on
        FROM customer_health_snapshots
       WHERE org_id = ${orgId}
         AND customer_id IN (${sql.join(
           customerIds.map((id) => sql`${id}`),
           sql`, `,
         )})
       ORDER BY customer_id, captured_on DESC
    `);

    const rows = (
      res as unknown as {
        rows: {
          customer_id: number | string;
          score: number | string;
          band: string;
          captured_on: string;
        }[];
      }
    ).rows;

    // customer_id/score are plain `integer` columns — pglite/pg return these
    // as native JS numbers over the raw execute() path (unlike the bigint
    // aggregates in getCustomerActivityStats, which come back as strings) —
    // but Number(...) them defensively anyway: a silent string/number
    // mismatch on customer_id would break the Map lookup below (every
    // same-day update would silently misfire as a first-ever insert).
    // captured_on is `text`, already a plain "YYYY-MM-DD" string, so unlike
    // getCustomerActivityStats there is no Date coercion to do here — this
    // query never selects a timestamp column.
    const latestByCustomer = new Map<number, LatestSnapshot>();
    for (const r of rows) {
      latestByCustomer.set(Number(r.customer_id), {
        score: Number(r.score),
        band: r.band as HealthBand,
        capturedOn: r.captured_on,
      });
    }

    const today = toUtcDay(now);

    for (const customer of scored) {
      const prior = latestByCustomer.get(customer.customerId);

      if (prior && prior.capturedOn === today) {
        await db
          .update(customerHealthSnapshots)
          .set({
            score: customer.score,
            band: customer.band,
            components: customer.components,
          })
          .where(
            and(
              eq(customerHealthSnapshots.orgId, orgId),
              eq(customerHealthSnapshots.customerId, customer.customerId),
              eq(customerHealthSnapshots.capturedOn, today),
            ),
          );
        continue;
      }

      await db.insert(customerHealthSnapshots).values({
        orgId,
        customerId: customer.customerId,
        score: customer.score,
        band: customer.band,
        components: customer.components,
        capturedOn: today,
      });

      if (prior && bandRank(customer.band) < bandRank(prior.band)) {
        await recordActivitySafely(
          db,
          {
            orgId,
            actor: null,
            entityType: "customer",
            entityId: customer.customerId,
            verb: "health_dropped",
            summary: `Health dropped: ${customer.name} ${prior.band} → ${customer.band}`,
            payload: {
              prevBand: prior.band,
              band: customer.band,
              prevScore: prior.score,
              score: customer.score,
            },
          },
          { action: "sentinel.capture" },
        );
      }
    }
  } catch (e) {
    Sentry.withScope((scope) => {
      scope.setTag("feature", "sentinel");
      scope.setTag("subStep", "capture");
      Sentry.captureException(e);
    });
    // Best-effort. Never re-throw — see the doc comment above.
  }
}
