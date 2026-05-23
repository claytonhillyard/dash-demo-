import { describe, it, expect } from "vitest";
import { operatingMarginPct, resolveMonthRevenue, projectFiveYears } from "@/db/metrics";

describe("operatingMarginPct", () => {
  it("computes profit / revenue as a percentage", () => {
    expect(operatingMarginPct(25_00, 100_00)).toBe(25);
  });
  it("guards divide-by-zero, returning null", () => {
    expect(operatingMarginPct(25_00, 0)).toBeNull();
  });
});

describe("resolveMonthRevenue (precedence rule, spec section 3.1)", () => {
  it("uses transaction sum when transactions exist", () => {
    expect(resolveMonthRevenue(99_00, [10_00, 20_00, 5_00])).toBe(35_00);
  });
  it("falls back to the manual bucket when no transactions", () => {
    expect(resolveMonthRevenue(99_00, [])).toBe(99_00);
  });
  it("is 0 when neither bucket nor transactions exist", () => {
    expect(resolveMonthRevenue(null, [])).toBe(0);
  });
});

describe("projectFiveYears (spec section 4)", () => {
  it("compounds base by cagr for 5 years", () => {
    const out = projectFiveYears(2026, 100_00, 10, {});
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ year: 2026, amountCents: 100_00 });
    expect(out[1]).toEqual({ year: 2027, amountCents: 110_00 });
    expect(out[2]).toEqual({ year: 2028, amountCents: 121_00 });
  });
  it("lets a per-year override win for that year only", () => {
    const out = projectFiveYears(2026, 100_00, 10, { "2028": 200_00 });
    expect(out[1].amountCents).toBe(110_00); // 2027 still computed
    expect(out[2]).toEqual({ year: 2028, amountCents: 200_00 }); // override
    expect(out[3].year).toBe(2029); // 2029 computed off compounded base, not the override
    expect(out[3].amountCents).toBe(133_10);
  });
});
