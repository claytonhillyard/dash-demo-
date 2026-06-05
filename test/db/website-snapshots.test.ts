// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { websiteSnapshots } from "@/db/schema";
import {
  getWebsiteSnapshots,
  getLatestWebsiteSnapshot,
  getWebsiteSnapshotTrend,
} from "@/db/website";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

// TODO(slice-5 review): plan code used `.returning({ id: websiteSnapshots.id })`,
// but the Db union (Neon | PGlite) doesn't resolve the overloaded returning
// signature under tsc — same finding as slice-4. Switched to no-arg
// returning() (returns all columns; we only read .id). Runtime identical.
async function insert(
  over: Partial<typeof websiteSnapshots.$inferInsert>,
): Promise<number> {
  const [row] = await db.insert(websiteSnapshots).values({
    orgId: 1, weekStart: "2026-05-25",
    visitors: 5000, uniqueVisitors: 3500, pageViews: 18000,
    avgSessionDurationSeconds: 210, bounceRatePercent: 42,
    ...over,
  }).returning();
  return row.id;
}

describe("getWebsiteSnapshots", () => {
  it("returns [] for an org with no rows", async () => {
    expect(await getWebsiteSnapshots(db, 1)).toEqual([]);
  });

  it("returns rows for the requested org only (cross-org isolation)", async () => {
    await insert({ orgId: 1, weekStart: "2026-05-25", visitors: 100 });
    await insert({ orgId: 1, weekStart: "2026-05-18", visitors: 200 });
    await insert({ orgId: 1, weekStart: "2026-05-11", visitors: 300 });
    await insert({ orgId: 999, weekStart: "2026-05-25", visitors: 9999 });
    await insert({ orgId: 999, weekStart: "2026-05-18", visitors: 9999 });

    expect(await getWebsiteSnapshots(db, 1)).toHaveLength(3);
    expect(await getWebsiteSnapshots(db, 999)).toHaveLength(2);
    // Belt-and-suspenders: no org-999 row leaks through the org-1 query.
    const aiyaRows = await getWebsiteSnapshots(db, 1);
    expect(aiyaRows.every((r) => r.orgId === 1)).toBe(true);
  });

  it("orders rows by weekStart DESC", async () => {
    await insert({ weekStart: "2026-05-04" });
    await insert({ weekStart: "2026-05-18" });
    await insert({ weekStart: "2026-05-11" });
    const rows = await getWebsiteSnapshots(db, 1);
    expect(rows.map((r) => r.weekStart)).toEqual(["2026-05-18", "2026-05-11", "2026-05-04"]);
  });

  it("populates every WebsiteSnapshotRow field from the DB row", async () => {
    await insert({
      orgId: 1, weekStart: "2026-05-25",
      visitors: 7820, uniqueVisitors: 5640, pageViews: 22130,
      avgSessionDurationSeconds: 215, bounceRatePercent: 38,
    });
    const [r] = await getWebsiteSnapshots(db, 1);
    expect(r.orgId).toBe(1);
    expect(r.weekStart).toBe("2026-05-25");
    expect(r.visitors).toBe(7820);
    expect(r.uniqueVisitors).toBe(5640);
    expect(r.pageViews).toBe(22130);
    expect(r.avgSessionDurationSeconds).toBe(215);
    expect(r.bounceRatePercent).toBe(38);
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.updatedAt).toBeInstanceOf(Date);
  });
});

describe("getLatestWebsiteSnapshot", () => {
  it("returns null for an org with no rows", async () => {
    expect(await getLatestWebsiteSnapshot(db, 1)).toBeNull();
  });

  it("returns the row with the most recent weekStart", async () => {
    await insert({ weekStart: "2026-05-04", visitors: 1 });
    await insert({ weekStart: "2026-05-18", visitors: 2 });
    await insert({ weekStart: "2026-05-11", visitors: 3 });
    const latest = await getLatestWebsiteSnapshot(db, 1);
    expect(latest?.weekStart).toBe("2026-05-18");
    expect(latest?.visitors).toBe(2);
  });

  it("is scoped per org (org 999 doesn't see org 1's latest)", async () => {
    await insert({ orgId: 1, weekStart: "2026-05-25" });
    expect(await getLatestWebsiteSnapshot(db, 999)).toBeNull();
  });
});

describe("getWebsiteSnapshotTrend", () => {
  it("caps at the requested N", async () => {
    for (let i = 0; i < 12; i++) {
      const day = String(4 + (i % 28)).padStart(2, "0");
      const month = String(3 + Math.floor(i / 28)).padStart(2, "0");
      await insert({ weekStart: `2026-${month}-${day}`, visitors: i });
    }
    const rows = await getWebsiteSnapshotTrend(db, 1, 8);
    expect(rows).toHaveLength(8);
  });

  it("returns the 8 MOST RECENT rows when N=8 and 12 exist", async () => {
    const weeks = [
      "2026-04-06","2026-04-13","2026-04-20","2026-04-27",
      "2026-05-04","2026-05-11","2026-05-18","2026-05-25",
      "2026-03-30","2026-03-23","2026-03-16","2026-03-09",
    ];
    for (let i = 0; i < weeks.length; i++) {
      await insert({ weekStart: weeks[i], visitors: i });
    }
    const rows = await getWebsiteSnapshotTrend(db, 1, 8);
    expect(rows.map((r) => r.weekStart)).toEqual([
      "2026-05-25","2026-05-18","2026-05-11","2026-05-04",
      "2026-04-27","2026-04-20","2026-04-13","2026-04-06",
    ]);
  });

  it("defaults N to 8 when no argument is supplied", async () => {
    for (let i = 0; i < 12; i++) {
      const day = String(1 + i).padStart(2, "0");
      await insert({ weekStart: `2026-05-${day}`, visitors: i });
    }
    const rows = await getWebsiteSnapshotTrend(db, 1);
    expect(rows).toHaveLength(8);
  });

  it("respects cross-org isolation", async () => {
    await insert({ orgId: 1, weekStart: "2026-05-25" });
    await insert({ orgId: 999, weekStart: "2026-05-25" });
    await insert({ orgId: 999, weekStart: "2026-05-18" });
    const rows = await getWebsiteSnapshotTrend(db, 1, 8);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
  });
});
