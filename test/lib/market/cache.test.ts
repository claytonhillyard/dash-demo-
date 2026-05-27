import { describe, it, expect, vi } from "vitest";
import { QuoteCache } from "@/lib/market/cache";
import type { Quote } from "@/lib/market/types";

const q: Quote = {
  symbol: "BTC", assetClass: "crypto", display: "Bitcoin", currency: "USD",
  price: 1, changeAbs: 0, changePct: 0, asOf: Date.now(),
  source: "coingecko", freshness: "live",
};

describe("QuoteCache", () => {
  it("returns empty before first refresh", () => {
    const c = new QuoteCache(async () => [q]);
    expect(c.snapshot()).toEqual([]);
  });
  it("populates snapshot after refresh and dedupes by symbol", async () => {
    const fetcher = vi.fn(async () => [q, { ...q, price: 2 }]);
    const c = new QuoteCache(fetcher);
    await c.refresh();
    const snap = c.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].price).toBe(2);
  });
  it("keeps last good snapshot if a refresh throws", async () => {
    let calls = 0;
    const c = new QuoteCache(async () => {
      calls++;
      if (calls === 2) throw new Error("upstream down");
      return [q];
    });
    await c.refresh();
    await c.refresh(); // throws internally, swallowed
    expect(c.snapshot()).toHaveLength(1);
  });
  it("refreshSymbols fetches only the requested subset (per-class budget)", async () => {
    const seen: string[][] = [];
    const c = new QuoteCache(async (syms) => {
      seen.push(syms.map((s) => s.symbol));
      return [];
    });
    await c.refreshSymbols([
      { symbol: "XAU", assetClass: "commodity", display: "Gold", currency: "USD" },
    ]);
    expect(seen).toEqual([["XAU"]]);
  });
});
