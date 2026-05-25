import { describe, it, expect, vi, afterEach } from "vitest";
import { twelvedataProvider } from "@/lib/market/providers/twelvedata";
const SYMS = [{ symbol: "SPX", assetClass: "index" as const, display: "S&P 500", currency: "USD" }];
describe("twelvedataProvider", () => {
  afterEach(() => vi.restoreAllMocks());
  it("supports index and commodity", () => {
    expect(twelvedataProvider.supports("index")).toBe(true);
    expect(twelvedataProvider.supports("crypto")).toBe(false);
  });
  it("maps /quote response", async () => {
    process.env.TWELVEDATA_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      close: "5303.27", change: "28.62", percent_change: "0.54",
    }))));
    const out = await twelvedataProvider.fetchQuotes(SYMS);
    const q = out.get("SPX")!;
    expect(q.price).toBeCloseTo(5303.27);
    expect(q.changePct).toBeCloseTo(0.54);
  });
  it("requests XPT/USD for platinum", async () => {
    process.env.TWELVEDATA_API_KEY = "k";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ close: "1021.30", change: "4.30", percent_change: "0.44" }),
      } as Response;
    });
    const out = await twelvedataProvider.fetchQuotes([
      { symbol: "XPT", assetClass: "commodity", display: "Platinum", currency: "USD" },
    ]);
    expect(calls[0]).toContain("XPT%2FUSD");
    expect(out.get("XPT")?.price).toBe(1021.3);
  });
});
