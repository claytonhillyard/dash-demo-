import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getProviderStatus,
  recordProviderResult,
  __resetHealth,
} from "@/lib/market/health";

const ORIG_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE;

beforeEach(() => {
  __resetHealth();
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
});
afterEach(() => {
  if (ORIG_DEMO === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
  else process.env.NEXT_PUBLIC_DEMO_MODE = ORIG_DEMO;
});

describe("getProviderStatus — demo short-circuit", () => {
  it("returns every provider as 'simulated' in demo mode", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const rows = getProviderStatus();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const r of rows) {
      expect(r.freshness).toBe("simulated");
      expect(r.lastOkAt).toBeNull();
      expect(r.lastErrorAt).toBeNull();
      expect(r.lastErrorMessage).toBeNull();
    }
  });
});

describe("getProviderStatus — live aggregation", () => {
  it("a fresh successful fetch ≤ 30s ago marks the provider 'live'", () => {
    recordProviderResult("finnhub", true, undefined, Date.now() - 5_000);
    const row = getProviderStatus().find((r) => r.id === "finnhub")!;
    expect(row.freshness).toBe("live");
    expect(row.lastErrorMessage).toBeNull();
  });

  it("a successful fetch between 30s and 5min ago marks the provider 'delayed'", () => {
    recordProviderResult("finnhub", true, undefined, Date.now() - 60_000);
    const row = getProviderStatus().find((r) => r.id === "finnhub")!;
    expect(row.freshness).toBe("delayed");
  });

  it("a successful fetch older than 5min marks the provider 'stale'", () => {
    recordProviderResult("finnhub", true, undefined, Date.now() - 10 * 60_000);
    const row = getProviderStatus().find((r) => r.id === "finnhub")!;
    expect(row.freshness).toBe("stale");
  });

  it("a fetch error captures lastErrorMessage but does not overwrite a prior lastOkAt", () => {
    const tOk = Date.now() - 10_000;
    recordProviderResult("finnhub", true, undefined, tOk);
    recordProviderResult("finnhub", false, new Error("ECONNRESET"));
    const row = getProviderStatus().find((r) => r.id === "finnhub")!;
    expect(row.lastErrorMessage).toBe("ECONNRESET");
    expect(row.lastOkAt).toBe(tOk);
    // The row is still 'live' because lastOkAt is recent — errors do NOT
    // override last-good-time.
    expect(row.freshness).toBe("live");
  });

  it("a provider that has NEVER been fetched is 'stale' (worst-case honesty)", () => {
    const row = getProviderStatus().find((r) => r.id === "twelvedata")!;
    expect(row.lastOkAt).toBeNull();
    expect(row.freshness).toBe("stale");
  });

  it("the row order matches PROVIDER_DISPLAY's declaration order", () => {
    const ids = getProviderStatus().map((r) => r.id);
    expect(ids).toEqual([
      "finnhub", "twelvedata", "coingecko", "frankfurter", "metals", "index-etf", "simulated",
    ]);
  });

  it("each row's display label is the human-friendly string", () => {
    const row = getProviderStatus().find((r) => r.id === "metals")!;
    expect(row.display).toMatch(/gold-api.com/);
  });
});
