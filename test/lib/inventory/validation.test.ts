import { describe, it, expect } from "vitest";
import { inventoryItemInput } from "@/lib/inventory/validation";

describe("inventory validation", () => {
  it("accepts a valid finished piece", () => {
    const r = inventoryItemInput.safeParse({
      category: "Rings", name: "Solitaire Band", quantity: 3, status: "in_stock",
      unitCostCents: 50000, retailPriceCents: 120000, metal: "gold", weightMg: 4200,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a loose stone with the 4 Cs", () => {
    const r = inventoryItemInput.safeParse({
      category: "Diamonds", name: "Round Brilliant", quantity: 1, status: "in_stock",
      unitCostCents: 800000, retailPriceCents: 1500000,
      caratX100: 101, cut: "Round", color: "F", clarity: "VVS1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const r = inventoryItemInput.safeParse({
      category: "Spaceships", name: "x", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative quantity", () => {
    const r = inventoryItemInput.safeParse({
      category: "Rings", name: "x", quantity: -1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(r.success).toBe(false);
  });
});
