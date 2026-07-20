import { describe, it, expect } from "vitest";
import { computeTotals } from "@/lib/invoices/totals";

describe("computeTotals", () => {
  it("computes lineTotals as quantity * unitPriceCents, in input order", () => {
    const result = computeTotals(
      [
        { quantity: 2, unitPriceCents: 500 },
        { quantity: 1, unitPriceCents: 1250 },
        { quantity: 3, unitPriceCents: 0 },
      ],
      0,
    );
    expect(result.lineTotals).toEqual([1000, 1250, 0]);
    expect(result.subtotalCents).toBe(2250);
  });

  it("zero tax rate yields zero tax and total === subtotal", () => {
    const result = computeTotals([{ quantity: 1, unitPriceCents: 10_000 }], 0);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(result.subtotalCents);
    expect(result.totalCents).toBe(10_000);
  });

  it("zero-price items contribute zero everywhere", () => {
    const result = computeTotals([{ quantity: 5, unitPriceCents: 0 }], 825);
    expect(result.lineTotals).toEqual([0]);
    expect(result.subtotalCents).toBe(0);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(0);
  });

  it("rounds tax at the documented 825bps-on-$10.01 boundary (round-half-up)", () => {
    // subtotal = 1001 cents ($10.01); tax = round(1001 * 825 / 10000) = round(82.5825) = 83
    const result = computeTotals([{ quantity: 1, unitPriceCents: 1001 }], 825);
    expect(result.subtotalCents).toBe(1001);
    expect(result.taxCents).toBe(83);
    expect(result.totalCents).toBe(1084);
  });

  it("rounds an exact .5 fraction up, not to even (round-half-up, not banker's rounding)", () => {
    // subtotal = 200 cents; bps = 25 -> 200 * 25 / 10000 = 0.5 exactly -> rounds up to 1
    const result = computeTotals([{ quantity: 2, unitPriceCents: 100 }], 25);
    expect(result.subtotalCents).toBe(200);
    expect(result.taxCents).toBe(1);
    expect(result.totalCents).toBe(201);
  });

  it("sums multiple line items into subtotalCents before taxing", () => {
    const result = computeTotals(
      [
        { quantity: 1, unitPriceCents: 1_240_000 },
        { quantity: 1, unitPriceCents: 8_500 },
      ],
      800,
    );
    expect(result.lineTotals).toEqual([1_240_000, 8_500]);
    expect(result.subtotalCents).toBe(1_248_500);
    // 1,248,500 * 800 / 10000 = 99,880 exactly
    expect(result.taxCents).toBe(99_880);
    expect(result.totalCents).toBe(1_348_380);
  });

  it("returns all-zero totals for an empty items array", () => {
    const result = computeTotals([], 825);
    expect(result.lineTotals).toEqual([]);
    expect(result.subtotalCents).toBe(0);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(0);
  });
});
