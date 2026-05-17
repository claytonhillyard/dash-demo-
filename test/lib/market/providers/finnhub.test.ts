import { describe, it, expect, vi, afterEach } from "vitest";
import { finnhubProvider } from "@/lib/market/providers/finnhub";
const SYMS = [{ symbol: "AAPL", assetClass: "equity" as const, display: "Apple", currency: "USD" }];
describe("finnhubProvider", () => {
  afterEach(() => vi.restoreAllMocks());
  it("supports equity and fx", () => {
    expect(finnhubProvider.supports("equity")).toBe(true);
    expect(finnhubProvider.supports("commodity")).toBe(false);
  });
  it("maps /quote response", async () => {
    process.env.FINNHUB_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      c: 195.84, d: 2.17, dp: 1.12,
    }))));
    const out = await finnhubProvider.fetchQuotes(SYMS);
    const q = out.get("AAPL")!;
    expect(q.price).toBe(195.84);
    expect(q.changePct).toBeCloseTo(1.12);
  });
  it("returns empty on missing key", async () => {
    delete process.env.FINNHUB_API_KEY;
    const out = await finnhubProvider.fetchQuotes(SYMS);
    expect(out.size).toBe(0);
  });
});
