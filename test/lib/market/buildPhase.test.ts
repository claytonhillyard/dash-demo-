import { describe, it, expect, afterEach, vi } from "vitest";
import { defaultQuoteFetcher } from "@/lib/market/cache";
import { fetchHistory } from "@/lib/market/history";
import { ALL_SYMBOLS } from "@/lib/market/registry";
import { isBuildPhase } from "@/lib/market/buildPhase";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isBuildPhase", () => {
  it("is true only when NEXT_PHASE === phase-production-build", () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(isBuildPhase()).toBe(true);
    vi.stubEnv("NEXT_PHASE", "phase-development-server");
    expect(isBuildPhase()).toBe(false);
    vi.stubEnv("NEXT_PHASE", "");
    expect(isBuildPhase()).toBe(false);
  });
});

describe("build-time fetch resilience", () => {
  it("defaultQuoteFetcher uses the simulated provider during `next build` (no network)", async () => {
    // Spy on global fetch so a regression that lets a provider through during
    // the build immediately fails this test.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    // No provider keys present → without the guard, the chain still tries
    // coingecko/frankfurter/gold-api which can return malformed JSON on flaky
    // networks. With the guard, simulated must be the sole source.
    delete process.env.TWELVEDATA_API_KEY;
    delete process.env.FINNHUB_API_KEY;

    const quotes = await defaultQuoteFetcher(ALL_SYMBOLS);

    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((q) => q.source === "simulated")).toBe(true);
    expect(quotes.every((q) => q.freshness === "simulated")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetchHistory short-circuits to a simulated series during build (no network)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    const btc = await fetchHistory("BTC", "1M");
    const xau = await fetchHistory("XAU", "1M");

    expect(btc.freshness).toBe("simulated");
    expect(btc.points.length).toBeGreaterThan(0);
    expect(xau.freshness).toBe("simulated");
    expect(xau.points.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
