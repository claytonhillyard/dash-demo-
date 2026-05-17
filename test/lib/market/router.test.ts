import { describe, it, expect, vi } from "vitest";
import { resolveQuotes } from "@/lib/market/router";
import type { QuoteProvider } from "@/lib/market/types";

const sym = { symbol: "BTC", assetClass: "crypto" as const, display: "Bitcoin", currency: "USD" };

function provider(id: any, ok: boolean): QuoteProvider {
  return {
    id,
    supports: () => true,
    fetchQuotes: vi.fn(async () =>
      ok ? new Map([["BTC", { price: 1, changeAbs: 0, changePct: 0, asOf: Date.now() }]])
         : new Map()),
  };
}

describe("resolveQuotes", () => {
  it("uses the primary provider when it succeeds", async () => {
    const primary = provider("coingecko", true);
    const fallback = provider("finnhub", true);
    const q = await resolveQuotes([sym], [primary, fallback]);
    expect(q[0].source).toBe("coingecko");
    expect(fallback.fetchQuotes).not.toHaveBeenCalled();
  });

  it("fails over to the next provider", async () => {
    const q = await resolveQuotes([sym], [provider("coingecko", false), provider("finnhub", true)]);
    expect(q[0].source).toBe("finnhub");
  });

  it("falls back to simulated when all fail and labels it", async () => {
    const q = await resolveQuotes([sym], [provider("coingecko", false)]);
    expect(q[0].source).toBe("simulated");
    expect(q[0].freshness).toBe("simulated");
  });
});
