import { desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { websiteSnapshots } from "./schema";
import { isDemoMode } from "@/lib/demo/mode";
import {
  getSeedWebsiteSnapshots,
  getSeedLatestWebsiteSnapshot,
  getSeedWebsiteSnapshotTrend,
} from "@/lib/demo/seed";

export interface WebsiteSnapshotRow {
  id: number;
  orgId: number;
  /** YYYY-MM-DD wire format. Drizzle's date() column returns a string in Node. */
  weekStart: string;
  visitors: number;
  uniqueVisitors: number;
  pageViews: number;
  avgSessionDurationSeconds: number;
  bounceRatePercent: number;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = {
  id: websiteSnapshots.id,
  orgId: websiteSnapshots.orgId,
  weekStart: websiteSnapshots.weekStart,
  visitors: websiteSnapshots.visitors,
  uniqueVisitors: websiteSnapshots.uniqueVisitors,
  pageViews: websiteSnapshots.pageViews,
  avgSessionDurationSeconds: websiteSnapshots.avgSessionDurationSeconds,
  bounceRatePercent: websiteSnapshots.bounceRatePercent,
  createdAt: websiteSnapshots.createdAt,
  updatedAt: websiteSnapshots.updatedAt,
} as const;

/** All snapshots for an org, most-recent week first.
 *
 *  CRITICAL: the isDemoMode() short-circuit is the FIRST statement. The db
 *  argument is not touched in demo. Slice 4's circles review caught the
 *  mirror-image issue — this is the preemptive fix. */
export async function getWebsiteSnapshots(
  db: Db,
  orgId: number,
): Promise<WebsiteSnapshotRow[]> {
  if (isDemoMode()) return getSeedWebsiteSnapshots(orgId);
  return await db
    .select(COLUMNS)
    .from(websiteSnapshots)
    .where(eq(websiteSnapshots.orgId, orgId))
    .orderBy(desc(websiteSnapshots.weekStart));
}

/** Single most-recent snapshot; null when no rows exist for the org. */
export async function getLatestWebsiteSnapshot(
  db: Db,
  orgId: number,
): Promise<WebsiteSnapshotRow | null> {
  if (isDemoMode()) return getSeedLatestWebsiteSnapshot(orgId);
  const rows = await db
    .select(COLUMNS)
    .from(websiteSnapshots)
    .where(eq(websiteSnapshots.orgId, orgId))
    .orderBy(desc(websiteSnapshots.weekStart))
    .limit(1);
  return rows[0] ?? null;
}

/** Last N snapshots, most-recent week first. Default N=8 — feeds the
 *  dashboard panel's 8-week sparkline and the latest/previous delta math. */
export async function getWebsiteSnapshotTrend(
  db: Db,
  orgId: number,
  n: number = 8,
): Promise<WebsiteSnapshotRow[]> {
  if (isDemoMode()) return getSeedWebsiteSnapshotTrend(orgId, n);
  return await db
    .select(COLUMNS)
    .from(websiteSnapshots)
    .where(eq(websiteSnapshots.orgId, orgId))
    .orderBy(desc(websiteSnapshots.weekStart))
    .limit(n);
}
