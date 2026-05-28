import { describe, it, expect, vi, afterEach } from "vitest";
import { indexEtfProxyProvider } from "@/lib/market/providers/index-etf";

describe("indexEtfProxyProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("supports index only", () => {
    expect(indexEtfProxyProvider.supports("index")).toBe(true);
    expect(indexEtfProxyProvider.supports("equity")).toBe(false);
    expect(indexEtfProxyProvider.supports("commodity")).toBe(false);
  });

  it("maps SPX -> SPY via Finnhub and multiplies to approximate the index level", async () => {
    process.env.FINNHUB_API_KEY = "k";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify({ c: 530.5, d: 2.5, dp: 0.47 }));
      })
    );
    const out = await indexEtfProxyProvider.fetchQuotes([
      { symbol: "SPX", assetClass: "index", display: "S&P 500", currency: "USD" },
    ]);
    expect(calls[0]).toContain("symbol=SPY");
    const q = out.get("SPX")!;
    // SPY ~530.50 -> S&P 500 ~5305 via the documented ×10 multiplier
    expect(q.price).toBeCloseTo(5305, 0);
    expect(q.changeAbs).toBeCloseTo(25, 0); // 2.5 * 10
    // % change is preserved (multiplier cancels)
    expect(q.changePct).toBeCloseTo(0.47);
  });

  it("uses ×100 for DJI -> DIA (different ETF scale)", async () => {
    process.env.FINNHUB_API_KEY = "k";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ c: 400, d: 1, dp: 0.25 })))
    );
    const out = await indexEtfProxyProvider.fetchQuotes([
      { symbol: "DJI", assetClass: "index", display: "Dow Jones", currency: "USD" },
    ]);
    // DIA ~400 -> DJI ~40_000 via ×100
    expect(out.get("DJI")?.price).toBeCloseTo(40_000, 0);
  });

  it("skips symbols it does not cover (e.g. VIX has no clean proxy) and missing API key", async () => {
    process.env.FINNHUB_API_KEY = "k";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await indexEtfProxyProvider.fetchQuotes([
      { symbol: "VIX", assetClass: "index", display: "VIX", currency: "USD" },
    ]);
    expect(out.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Missing key -> bail entirely; no fetch.
    delete process.env.FINNHUB_API_KEY;
    const out2 = await indexEtfProxyProvider.fetchQuotes([
      { symbol: "SPX", assetClass: "index", display: "S&P 500", currency: "USD" },
    ]);
    expect(out2.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
