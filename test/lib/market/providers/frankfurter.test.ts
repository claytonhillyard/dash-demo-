import { describe, it, expect, vi, afterEach } from "vitest";
import { frankfurterProvider } from "@/lib/market/providers/frankfurter";
const SYMS = [{ symbol: "EURUSD", assetClass: "fx" as const, display: "EUR/USD", currency: "USD" }];
describe("frankfurterProvider", () => {
  afterEach(() => vi.restoreAllMocks());
  it("supports only fx", () => {
    expect(frankfurterProvider.supports("fx")).toBe(true);
    expect(frankfurterProvider.supports("crypto")).toBe(false);
  });
  it("maps latest rate to RawQuote", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      rates: { USD: 1.0856 },
    }))));
    const out = await frankfurterProvider.fetchQuotes(SYMS);
    expect(out.get("EURUSD")!.price).toBeCloseTo(1.0856);
  });
});
