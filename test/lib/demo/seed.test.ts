import { describe, it, expect } from "vitest";
import { seedInventorySummary, seedDiamondSummary } from "@/lib/demo/seed";
import { INVENTORY_CATEGORIES } from "@/lib/inventory/validation";

describe("demo seed", () => {
  it("inventory seed covers all 9 categories and totals correctly", () => {
    const s = seedInventorySummary();
    for (const c of INVENTORY_CATEGORIES) expect(typeof s.counts[c]).toBe("number");
    const sum = INVENTORY_CATEGORIES.reduce((n, c) => n + s.counts[c], 0);
    expect(s.total).toBe(sum);
    expect(s.updatedAt).not.toBeNull();
  });
  it("diamond seed has both indices and at least one named point", () => {
    const d = seedDiamondSummary();
    expect(d.naturalIndex?.cents).toBeGreaterThan(0);
    expect(d.labIndex?.cents).toBeGreaterThan(0);
    expect(d.points.length).toBeGreaterThan(0);
  });
});

import { getSeedDeals } from "@/lib/demo/seed";
import { DEAL_KINDS, DEAL_CATEGORIES, DEAL_STATUSES } from "@/lib/deals/constants";

describe("getSeedDeals", () => {
  it("returns exactly 5 rows", () => {
    expect(getSeedDeals()).toHaveLength(5);
  });
  it("each row has valid kind/category/status", () => {
    for (const d of getSeedDeals()) {
      expect(DEAL_KINDS).toContain(d.kind);
      expect(DEAL_CATEGORIES).toContain(d.category);
      expect(DEAL_STATUSES).toContain(d.status);
    }
  });
  it("every subject carries the 'demo · simulated' provenance suffix", () => {
    for (const d of getSeedDeals()) {
      expect(d.subject).toMatch(/demo · simulated/);
    }
  });
  it("price_cents >= 0 and quantity >= 1 everywhere", () => {
    for (const d of getSeedDeals()) {
      expect(d.priceCents).toBeGreaterThanOrEqual(0);
      expect(d.quantity).toBeGreaterThanOrEqual(1);
    }
  });
  it("createdAt is a Date instance on every row", () => {
    for (const d of getSeedDeals()) {
      expect(d.createdAt).toBeInstanceOf(Date);
    }
  });
});
