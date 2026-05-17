import { describe, it, expect, vi, afterEach } from "vitest";
import { coingeckoProvider } from "@/lib/market/providers/coingecko";

const SYMS = [
  { symbol: "BTC", assetClass: "crypto" as const, display: "Bitcoin", currency: "USD" },
];

describe("coingeckoProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("only supports crypto", () => {
    expect(coingeckoProvider.supports("crypto")).toBe(true);
    expect(coingeckoProvider.supports("equity")).toBe(false);
  });

  it("maps the API response into RawQuote", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      bitcoin: { usd: 67842, usd_24h_change: 2.35 },
    }))));
    const out = await coingeckoProvider.fetchQuotes(SYMS);
    const q = out.get("BTC")!;
    expect(q.price).toBe(67842);
    expect(q.changePct).toBeCloseTo(2.35);
  });

  it("returns an empty map on HTTP error (router will fail over)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const out = await coingeckoProvider.fetchQuotes(SYMS);
    expect(out.size).toBe(0);
  });
});
