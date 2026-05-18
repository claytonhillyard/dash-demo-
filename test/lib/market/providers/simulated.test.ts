import { describe, it, expect } from "vitest";
import { simulatedProvider } from "@/lib/market/providers/simulated";
import { ALL_SYMBOLS } from "@/lib/market/registry";

describe("simulatedProvider", () => {
  it("supports every asset class", () => {
    for (const c of ["equity","crypto","fx","index","commodity","bond"] as const) {
      expect(simulatedProvider.supports(c)).toBe(true);
    }
  });
  it("returns a deterministic-shaped quote for each symbol", async () => {
    const out = await simulatedProvider.fetchQuotes(ALL_SYMBOLS.slice(0, 3));
    expect(out.size).toBe(3);
    const q = out.get("AAPL")!;
    expect(q.price).toBeGreaterThan(0);
    expect(typeof q.changePct).toBe("number");
    expect(q.asOf).toBeGreaterThan(0);
  });
  it("uses realistic reference prices for known symbols", async () => {
    const out = await simulatedProvider.fetchQuotes([
      { symbol: "SPX", assetClass: "index", display: "S&P 500", currency: "USD" },
      { symbol: "AAPL", assetClass: "equity", display: "Apple Inc.", currency: "USD" },
    ]);
    // simulated index/equity values must be plausible, not the old 10..110 seed
    expect(out.get("SPX")!.price).toBeGreaterThan(1000);
    expect(out.get("AAPL")!.price).toBeGreaterThan(100);
  });
});
