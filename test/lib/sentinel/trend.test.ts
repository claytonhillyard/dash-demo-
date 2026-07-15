// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import type { Db } from "@/db/client";
import { customerHealthSnapshots } from "@/db/schema";
import { getSnapshotTrend } from "@/lib/sentinel/trend";
import { toUtcDay } from "@/lib/sentinel/capture";

const NOW = new Date("2026-07-03T12:00:00Z");
const ORG_ID = 1;
const CUSTOMER_ID = 2201;

function daysBeforeNow(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("getSnapshotTrend", () => {
  let db: Db;

  beforeAll(async () => {
    db = await getSharedDb();
  });

  beforeEach(async () => {
    await resetSharedDb();
  });

  afterAll(async () => {
    await closeSharedDb();
  });

  async function insertSnapshot(
    daysBack: number,
    overrides: Partial<{
      customerId: number;
      score: number;
      band: "healthy" | "watch" | "at_risk";
    }> = {},
  ) {
    await db.insert(customerHealthSnapshots).values({
      orgId: ORG_ID,
      customerId: CUSTOMER_ID,
      score: 50,
      band: "watch",
      components: { recency: 20, frequency: 15, breadth: 10 },
      capturedOn: toUtcDay(daysBeforeNow(daysBack)),
      ...overrides,
    });
  }

  it("returns null when there are zero snapshot rows", async () => {
    expect(await getSnapshotTrend(db, ORG_ID, CUSTOMER_ID, NOW)).toBeNull();
  });

  it("single row: current is populated, prior is null", async () => {
    await insertSnapshot(0, { score: 61, band: "watch" });

    const trend = await getSnapshotTrend(db, ORG_ID, CUSTOMER_ID, NOW);

    expect(trend).not.toBeNull();
    expect(trend!.current).toEqual({
      score: 61,
      band: "watch",
      capturedOn: toUtcDay(NOW),
    });
    expect(trend!.prior).toBeNull();
  });

  it("young-history fallback: all rows <7d old (>=2 rows) -> prior is the OLDEST row", async () => {
    await insertSnapshot(4, { score: 50, band: "watch" });
    await insertSnapshot(2, { score: 55, band: "watch" });
    await insertSnapshot(0, { score: 61, band: "watch" });

    const trend = await getSnapshotTrend(db, ORG_ID, CUSTOMER_ID, NOW);

    expect(trend!.current.score).toBe(61);
    expect(trend!.prior).toEqual({ score: 50, capturedOn: toUtcDay(daysBeforeNow(4)) });
  });

  it("7-day pick among three old candidates: picks the newest <= boundary, not the oldest", async () => {
    // Boundary = NOW - 7d. All three rows below are >= 7 days back, so all
    // three qualify as candidates — the correct pick is the one CLOSEST to
    // the boundary (8 days back), not the actual oldest row (20 days back).
    await insertSnapshot(20, { score: 10, band: "at_risk" });
    await insertSnapshot(10, { score: 20, band: "at_risk" });
    await insertSnapshot(8, { score: 30, band: "watch" });
    await insertSnapshot(0, { score: 61, band: "watch" });

    const trend = await getSnapshotTrend(db, ORG_ID, CUSTOMER_ID, NOW);

    expect(trend!.current.score).toBe(61);
    expect(trend!.prior).toEqual({ score: 30, capturedOn: toUtcDay(daysBeforeNow(8)) });
  });

  it("boundary is inclusive: a row exactly 7 days back is picked over an older one", async () => {
    // If the comparison were a strict "<" instead of "<=", the 7-day-back row
    // would wrongly fail to qualify and the 14-day-back row would be picked
    // instead.
    await insertSnapshot(14, { score: 5, band: "at_risk" });
    await insertSnapshot(7, { score: 33, band: "watch" });
    await insertSnapshot(0, { score: 61, band: "watch" });

    const trend = await getSnapshotTrend(db, ORG_ID, CUSTOMER_ID, NOW);

    expect(trend!.prior).toEqual({ score: 33, capturedOn: toUtcDay(daysBeforeNow(7)) });
  });

  it("multi-customer: only rows for the requested customerId are considered", async () => {
    const OTHER_ID = 2204;
    await insertSnapshot(0, { score: 61, band: "watch" });
    await db.insert(customerHealthSnapshots).values({
      orgId: ORG_ID,
      customerId: OTHER_ID,
      score: 15,
      band: "at_risk",
      components: { recency: 5, frequency: 5, breadth: 5 },
      capturedOn: toUtcDay(daysBeforeNow(0)),
    });

    const trend = await getSnapshotTrend(db, ORG_ID, CUSTOMER_ID, NOW);

    expect(trend!.current.score).toBe(61);
  });

  describe("demo branch", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("customer 2201: 3 rows ending ~today, all <7d old -> fallback -> prior = oldest, current = newest", async () => {
      vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

      // Real current time, matching the demo seed's own HOURS_AGO-relative
      // timestamps (src/lib/demo/seed.ts NOW = new Date()) — not the fixed
      // NOW used above for the shared-db tests.
      const trend = await getSnapshotTrend(db, ORG_ID, 2201, new Date());

      expect(trend).not.toBeNull();
      expect(trend!.current).toMatchObject({ score: 61, band: "watch" });
      expect(trend!.prior).not.toBeNull();
      expect(trend!.prior!.score).toBe(55);
    });

    it("returns null for a customer with no seeded snapshot history in demo mode", async () => {
      vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

      const trend = await getSnapshotTrend(db, ORG_ID, 2202, new Date());

      expect(trend).toBeNull();
    });
  });
});
