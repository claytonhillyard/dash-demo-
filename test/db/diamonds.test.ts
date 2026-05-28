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
    const s = await getDiamondSummary(db);
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
    const s = await getDiamondSummary(db);
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
    const trend = await getDiamondTrend(db, "natural_index");
    expect(trend).toEqual([700000, 720000]);
  });
});

describe("getDiamondSummary demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns seeded indices without touching the db when demo is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const s = await getDiamondSummary(null as never);
    expect(s.naturalIndex?.cents).toBeGreaterThan(0);
    expect(s.points.length).toBeGreaterThan(0);
  });
});
