import { describe, it, expect, vi, afterEach } from "vitest";
import { rangeToDays, fetchHistory } from "@/lib/market/history";

afterEach(() => vi.unstubAllGlobals());

describe("price history", () => {
  it("maps range labels to day counts", () => {
    expect(rangeToDays("1D")).toBe(1);
    expect(rangeToDays("1M")).toBe(30);
    expect(rangeToDays("1Y")).toBe(365);
    expect(rangeToDays("ALL")).toBe(1825);
  });

  it("returns a real BTC series from CoinGecko (keyless)", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ prices: [[1, 67000], [2, 67500], [3, 68000]] }),
    } as Response));
    const series = await fetchHistory("BTC", "1M");
    expect(series.points).toEqual([67000, 67500, 68000]);
    expect(series.freshness).toBe("live");
  });

  it("falls back to a labeled simulated series for gold without a key", async () => {
    delete process.env.TWELVEDATA_API_KEY;
    const series = await fetchHistory("XAU", "1M");
    expect(series.points.length).toBeGreaterThan(0);
    expect(series.freshness).toBe("simulated");
  });
});
