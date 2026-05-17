import { describe, it, expect } from "vitest";
import { lookup, ALL_SYMBOLS } from "@/lib/market/registry";

describe("registry", () => {
  it("classifies known symbols", () => {
    expect(lookup("AAPL")?.assetClass).toBe("equity");
    expect(lookup("BTC")?.assetClass).toBe("crypto");
    expect(lookup("EURUSD")?.assetClass).toBe("fx");
    expect(lookup("SPX")?.assetClass).toBe("index");
    expect(lookup("XAU")?.assetClass).toBe("commodity");
  });
  it("returns undefined for unknown", () => {
    expect(lookup("NOPE")).toBeUndefined();
  });
  it("exports a non-empty symbol list", () => {
    expect(ALL_SYMBOLS.length).toBeGreaterThan(10);
  });
});
