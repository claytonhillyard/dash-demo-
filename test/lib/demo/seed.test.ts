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
