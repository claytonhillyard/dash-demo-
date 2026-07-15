import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customerHealthSnapshots } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_HEALTH_SNAPSHOTS } from "@/lib/demo/seed";
import type { HealthBand } from "@/lib/customers/healthScore";
import { toUtcDay } from "./capture";

/** How far back "prior" looks for a real (non-fallback) comparison point.
 *  Exported so the edit-page trend line (slice 38-3) can independently derive
 *  the same boundary to decide its "vs last week" / "vs first snapshot"
 *  label without this module having to bake that UI concern into its return
 *  shape. */
export const TREND_WINDOW_DAYS = 7;

export type SnapshotTrend = {
  current: { score: number; band: HealthBand; capturedOn: string };
  prior: { score: number; capturedOn: string } | null;
};

type TrendRow = { score: number; band: HealthBand; capturedOn: string };

/**
 * Reduces a customer's full snapshot history (unsorted, any order) to the two
 * points the edit-page Health card needs (spec §5):
 *
 *  - `current` — the latest snapshot.
 *  - `prior` — the snapshot with `captured_on <= today - 7d`, closest to that
 *    boundary (i.e. the newest one at-or-before it). When no snapshot is that
 *    old but at least 2 rows exist overall, falls back to the single OLDEST
 *    row (so a customer with only a few days of history still shows *some*
 *    trend). `null` when fewer than 2 rows exist.
 *
 * Returns `null` entirely when there are zero rows (nothing to show at all).
 * Pure + shared by both the live-db and demo branches below so the two can
 * never disagree on semantics.
 */
function reduceTrend(rows: TrendRow[], now: Date): SnapshotTrend | null {
  if (rows.length === 0) return null;

  // Descending by capturedOn ("YYYY-MM-DD" strings sort lexicographically in
  // the same order as chronologically, so a plain string compare suffices).
  const sorted = [...rows].sort((a, b) =>
    a.capturedOn < b.capturedOn ? 1 : a.capturedOn > b.capturedOn ? -1 : 0,
  );
  const current = sorted[0]!;
  const rest = sorted.slice(1);

  if (rest.length === 0) {
    return { current, prior: null };
  }

  const boundary = toUtcDay(new Date(now.getTime() - TREND_WINDOW_DAYS * 86_400_000));
  // `rest` is newest-first, so the first match at-or-before the boundary is
  // the one CLOSEST to it — never the oldest candidate.
  const atOrBeforeBoundary = rest.find((r) => r.capturedOn <= boundary);
  const prior = atOrBeforeBoundary ?? rest[rest.length - 1]!; // fallback: oldest of the rest

  return {
    current,
    prior: { score: prior.score, capturedOn: prior.capturedOn },
  };
}

/**
 * Reads the snapshot history `captureHealthSnapshots` (slice 38-2) has been
 * writing and reduces it to the current/prior pair the edit-page Health card
 * renders as a trend line (spec §5). Read-only — never writes, never alerts.
 *
 * Demo mode reads `DEMO_HEALTH_SNAPSHOTS` directly (capture never runs in
 * demo — that seed is the only source of snapshot history there), through
 * the identical `reduceTrend` reduction so the two branches can't drift.
 */
export async function getSnapshotTrend(
  db: Db,
  orgId: number,
  customerId: number,
  now: Date = new Date(),
): Promise<SnapshotTrend | null> {
  if (isDemoMode()) {
    const rows: TrendRow[] = DEMO_HEALTH_SNAPSHOTS.filter(
      (s) => s.orgId === orgId && s.customerId === customerId,
    ).map((s) => ({ score: s.score, band: s.band, capturedOn: s.capturedOn }));
    return reduceTrend(rows, now);
  }

  const dbRows = await db
    .select({
      score: customerHealthSnapshots.score,
      band: customerHealthSnapshots.band,
      capturedOn: customerHealthSnapshots.capturedOn,
    })
    .from(customerHealthSnapshots)
    .where(
      and(
        eq(customerHealthSnapshots.orgId, orgId),
        eq(customerHealthSnapshots.customerId, customerId),
      ),
    );

  const rows: TrendRow[] = dbRows.map((r) => ({
    score: r.score,
    band: r.band as HealthBand,
    capturedOn: r.capturedOn,
  }));

  return reduceTrend(rows, now);
}
