// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import type { Db } from "@/db/client";
import { diamondMatrixPrices, diamondPricePoints, diamondIndexHistory } from "@/db/schema";
import { getDiamondSummary, getDiamondTrend } from "@/db/diamonds";

describe("diamond data-access", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(() => resetSharedDb());
  afterAll(() => closeSharedDb());

  it("returns null indices and empty points when there is no pricing", async () => {
    const s = await getDiamondSummary(db, 1);
    expect(s.naturalIndex).toBeNull();
    expect(s.labIndex).toBeNull();
    expect(s.points).toEqual([]);
  });

  it("reads the benchmark cell as the index and computes 24h change from history", async () => {
    await db.insert(diamondMatrixPrices).values({
      sheet: "natural", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 800000,
    });
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    await db.insert(diamondIndexHistory).values([
      { series: "natural_index", valueCents: 760000, recordedAt: old },
      { series: "natural_index", valueCents: 800000 },
    ]);
    await db.insert(diamondPricePoints).values({
      label: "Pink Diamond 1ct", kind: "fancy_diamond", pricePerCaratCents: 1500000,
    });
    const s = await getDiamondSummary(db, 1);
    expect(s.naturalIndex?.cents).toBe(800000);
    expect(s.naturalIndex?.change24hPct).toBeGreaterThan(5);
    expect(s.labIndex).toBeNull();
    expect(s.points[0]).toMatchObject({ label: "Pink Diamond 1ct", cents: 1500000 });
  });

  it("returns the natural_index trend series oldest-first", async () => {
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    await db.insert(diamondIndexHistory).values([
      { series: "natural_index", valueCents: 700000, recordedAt: old },
      { series: "natural_index", valueCents: 720000 },
    ]);
    const trend = await getDiamondTrend(db, "natural_index", 1);
    expect(trend).toEqual([700000, 720000]);
  });
});

describe("getDiamondSummary demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns seeded indices without touching the db when demo is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const s = await getDiamondSummary(null as never, 1);
    expect(s.naturalIndex?.cents).toBeGreaterThan(0);
    expect(s.points.length).toBeGreaterThan(0);
  });
});

describe("getDiamondSummary / getDiamondTrend cross-org isolation", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(() => resetSharedDb());
  afterAll(() => closeSharedDb());

  it("returns only the requested org's index, points, and trend", async () => {
    // Benchmark cells for both orgs (so each org has a natural_index reading).
    await db.insert(diamondMatrixPrices).values([
      { orgId: 1, sheet: "natural", shape: "round", color: "G", clarity: "VS1",
        caratBand: "1.00-1.49", pricePerCaratCents: 800000 },
      { orgId: 999, sheet: "natural", shape: "round", color: "G", clarity: "VS1",
        caratBand: "1.00-1.49", pricePerCaratCents: 200000 },
    ]);
    await db.insert(diamondPricePoints).values([
      { orgId: 1, label: "aiya-point", kind: "gem", pricePerCaratCents: 1 },
      { orgId: 999, label: "other-point", kind: "gem", pricePerCaratCents: 2 },
    ]);
    await db.insert(diamondIndexHistory).values([
      { orgId: 1, series: "natural_index", valueCents: 800000 },
      { orgId: 999, series: "natural_index", valueCents: 200000 },
    ]);

    const aiya = await getDiamondSummary(db, 1);
    expect(aiya.naturalIndex?.cents).toBe(800000);
    expect(aiya.points.map((p) => p.label)).toEqual(["aiya-point"]);

    const other = await getDiamondSummary(db, 999);
    expect(other.naturalIndex?.cents).toBe(200000);
    expect(other.points.map((p) => p.label)).toEqual(["other-point"]);

    const aiyaTrend = await getDiamondTrend(db, "natural_index", 1);
    expect(aiyaTrend).toEqual([800000]);
    const otherTrend = await getDiamondTrend(db, "natural_index", 999);
    expect(otherTrend).toEqual([200000]);
  });
});
