import { describe, it, expect } from "vitest";
import { matrixCellInput, pricePointInput } from "@/lib/diamonds/validation";

describe("diamond validation", () => {
  it("accepts a valid matrix cell", () => {
    expect(matrixCellInput.safeParse({
      sheet: "natural", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 800000,
    }).success).toBe(true);
  });
  it("rejects an unknown color/clarity/band", () => {
    expect(matrixCellInput.safeParse({
      sheet: "natural", shape: "round", color: "ZZ", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 1,
    }).success).toBe(false);
    expect(matrixCellInput.safeParse({
      sheet: "natural", shape: "round", color: "G", clarity: "VS1",
      caratBand: "9.99-9.99", pricePerCaratCents: 1,
    }).success).toBe(false);
  });
  it("validates a named price point", () => {
    expect(pricePointInput.safeParse({
      label: "Pink Diamond 1ct", kind: "fancy_diamond", pricePerCaratCents: 1500000,
    }).success).toBe(true);
    expect(pricePointInput.safeParse({
      label: "", kind: "gem", pricePerCaratCents: 1,
    }).success).toBe(false);
  });
});
