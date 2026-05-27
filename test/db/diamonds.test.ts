// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { diamondMatrixPrices, diamondPricePoints, diamondIndexHistory } from "@/db/schema";
import { getDiamondSummary, getDiamondTrend } from "@/db/diamonds";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("diamond data-access", () => {
  it("returns null indices and empty points when there is no pricing", async () => {
    const t = await createTestDb(); close = t.close;
    const s = await getDiamondSummary(t.db);
    expect(s.naturalIndex).toBeNull();
    expect(s.labIndex).toBeNull();
    expect(s.points).toEqual([]);
  });

  it("reads the benchmark cell as the index and computes 24h change from history", async () => {
    const t = await createTestDb(); close = t.close;
    await t.db.insert(diamondMatrixPrices).values({
      sheet: "natural", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 800000,
    });
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    await t.db.insert(diamondIndexHistory).values([
      { series: "natural_index", valueCents: 760000, recordedAt: old },
      { series: "natural_index", valueCents: 800000 },
    ]);
    await t.db.insert(diamondPricePoints).values({
      label: "Pink Diamond 1ct", kind: "fancy_diamond", pricePerCaratCents: 1500000,
    });
    const s = await getDiamondSummary(t.db);
    expect(s.naturalIndex?.cents).toBe(800000);
    expect(s.naturalIndex?.change24hPct).toBeGreaterThan(5);
    expect(s.labIndex).toBeNull();
    expect(s.points[0]).toMatchObject({ label: "Pink Diamond 1ct", cents: 1500000 });
  });

  it("returns the natural_index trend series oldest-first", async () => {
    const t = await createTestDb(); close = t.close;
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    await t.db.insert(diamondIndexHistory).values([
      { series: "natural_index", valueCents: 700000, recordedAt: old },
      { series: "natural_index", valueCents: 720000 },
    ]);
    const trend = await getDiamondTrend(t.db, "natural_index");
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
