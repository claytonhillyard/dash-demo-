import { describe, it, expect } from "vitest";
import { computeFreshness } from "@/lib/market/freshness";

describe("computeFreshness", () => {
  const now = Date.UTC(2026, 4, 17, 12, 0, 0);
  it("simulated source is always simulated", () => {
    expect(computeFreshness("simulated", now, now)).toBe("simulated");
  });
  it("recent real data is live", () => {
    expect(computeFreshness("finnhub", now - 5_000, now)).toBe("live");
  });
  it("older real data is delayed", () => {
    expect(computeFreshness("finnhub", now - 120_000, now)).toBe("delayed");
  });
  it("very old real data is stale", () => {
    expect(computeFreshness("finnhub", now - 30 * 60_000, now)).toBe("stale");
  });
});
