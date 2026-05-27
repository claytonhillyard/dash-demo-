import { describe, it, expect, vi, afterEach } from "vitest";
import { metalsProvider } from "@/lib/market/providers/metals";

describe("metalsProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("supports commodity only", () => {
    expect(metalsProvider.supports("commodity")).toBe(true);
    expect(metalsProvider.supports("index")).toBe(false);
    expect(metalsProvider.supports("equity")).toBe(false);
  });

  it("maps gold-api price responses (keyless) to quotes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      new Response(JSON.stringify({
        symbol: url.includes("XAG") ? "XAG" : "XPT",
        price: url.includes("XAG") ? 74.77 : 1933,
      }))
    ));
    const out = await metalsProvider.fetchQuotes([
      { symbol: "XAG", assetClass: "commodity", display: "Silver", currency: "USD" },
      { symbol: "XPT", assetClass: "commodity", display: "Platinum", currency: "USD" },
    ]);
    expect(out.get("XAG")?.price).toBeCloseTo(74.77);
    expect(out.get("XPT")?.price).toBe(1933);
    // gold-api has no change data — change fields are 0, not fabricated.
    expect(out.get("XAG")?.changePct).toBe(0);
  });

  it("skips symbols it does not cover (no fetch) and bad/empty responses", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ nope: true })));
    vi.stubGlobal("fetch", fetchSpy);
    const out = await metalsProvider.fetchQuotes([
      { symbol: "SPX", assetClass: "commodity", display: "S&P", currency: "USD" }, // unsupported
      { symbol: "XAU", assetClass: "commodity", display: "Gold", currency: "USD" }, // supported but no price in body
    ]);
    expect(out.size).toBe(0);
    // SPX is filtered before any request; only XAU triggers a fetch.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
