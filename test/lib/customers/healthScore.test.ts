import { describe, it, expect } from "vitest";
import { computeHealthScore, HEALTH_WEIGHTS } from "@/lib/customers/healthScore";

// Formulas (spec §3, authoritative):
//   daysSince = (now - (lastActivityAt ?? customerCreatedAt)) / 86_400_000
//   recency   = daysSince <= 2 ? 40 : 40 * clamp01((30 - daysSince) / 28)
//   frequency = 35 * clamp01(eventsLast30d / 8)
//   breadth   = 25 * clamp01(distinctVerbs30d / 4)
//   score     = clamp(round(recency + frequency + breadth), 0, 100)
//   band      = score >= 70 ? "healthy" : score >= 40 ? "watch" : "at_risk"
//
// IMPORTANT: recency alone maxes at 40, which only reaches the "watch" band
// (40-69), not "healthy". Every expectation below is derived by hand from the
// formulas above, not from narrative intuition about what "should" be healthy.

const NOW = new Date("2026-06-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("computeHealthScore", () => {
  it("fresh customer created 1 day ago, no events → 40 recency + 0 + 0 = 40 → watch", () => {
    // daysSince = 1 (<=2) -> recency = 40 (full); freq = 0; breadth = 0
    // score = round(40 + 0 + 0) = 40 -> band: 40 >= 40 and < 70 -> "watch"
    const r = computeHealthScore(
      { lastActivityAt: null, eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: daysAgo(1) },
      NOW,
    );
    expect(r.score).toBe(40);
    expect(r.band).toBe("watch");
    expect(r.components).toEqual({ recency: 40, frequency: 0, breadth: 0 });
  });

  it("full activity: recency<=2d + 8 events + 4 verbs → 40 + 35 + 25 = 100 → healthy", () => {
    // daysSince = 1 (<=2) -> recency = 40
    // frequency = 35 * clamp01(8/8) = 35 * 1 = 35 (saturated)
    // breadth   = 25 * clamp01(4/4) = 25 * 1 = 25 (saturated)
    // score = round(40 + 35 + 25) = 100 -> band: 100 >= 70 -> "healthy"
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(1), eventsLast30d: 8, distinctVerbs30d: 4, customerCreatedAt: daysAgo(90) },
      NOW,
    );
    expect(r.score).toBe(100);
    expect(r.band).toBe("healthy");
    expect(r.components).toEqual({ recency: 40, frequency: 35, breadth: 25 });
  });

  it("30+ days silent, no recent events → 0 + 0 + 0 = 0 → at_risk", () => {
    // daysSince = 45 (>2) -> recency = 40 * clamp01((30-45)/28) = 40 * clamp01(-0.5357) = 40 * 0 = 0
    // frequency = 0; breadth = 0
    // score = round(0 + 0 + 0) = 0 -> band: 0 < 40 -> "at_risk"
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(45), eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: daysAgo(400) },
      NOW,
    );
    expect(r.score).toBe(0);
    expect(r.band).toBe("at_risk");
    expect(r.components).toEqual({ recency: 0, frequency: 0, breadth: 0 });
  });

  it("recency boundary at exactly 2 days → full 40 points (still inside the <=2 branch)", () => {
    // daysSince = 2 (<=2, inclusive) -> recency = 40 (full, not the decay formula)
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(2), eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: daysAgo(2) },
      NOW,
    );
    expect(r.components.recency).toBe(40);
    expect(r.score).toBe(40);
  });

  it("recency boundary at exactly 30 days → 0 points (decay fully bottomed out)", () => {
    // daysSince = 30 (>2) -> recency = 40 * clamp01((30-30)/28) = 40 * clamp01(0) = 0
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(30), eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: daysAgo(30) },
      NOW,
    );
    expect(r.components.recency).toBe(0);
    expect(r.score).toBe(0);
  });

  it("mid-decay recency at 16 days → 40 * (30-16)/28 = 20", () => {
    // daysSince = 16 -> recency = 40 * clamp01((30-16)/28) = 40 * (14/28) = 40 * 0.5 = 20
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(16), eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: daysAgo(16) },
      NOW,
    );
    expect(r.components.recency).toBe(20);
    expect(r.score).toBe(20);
    expect(r.band).toBe("at_risk"); // 20 < 40
  });

  it("frequency saturates at 8 events: 9 events still caps at 35 (isolated from recency/breadth)", () => {
    // daysSince = 90 (>>30) -> recency = 0
    // frequency = 35 * clamp01(9/8) = 35 * clamp01(1.125) = 35 * 1 = 35 (clamped, saturation confirmed)
    // breadth = 0
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(90), eventsLast30d: 9, distinctVerbs30d: 0, customerCreatedAt: daysAgo(90) },
      NOW,
    );
    expect(r.components.frequency).toBe(35);
    expect(r.score).toBe(35);
  });

  it("frequency partial: 4 events → 35 * (4/8) = 17.5 (isolated from recency/breadth)", () => {
    // daysSince = 90 -> recency = 0; frequency = 35 * clamp01(4/8) = 35 * 0.5 = 17.5; breadth = 0
    // score = round(0 + 17.5 + 0) = round(17.5) = 18 (banker's-rounding-free Math.round rounds .5 up)
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(90), eventsLast30d: 4, distinctVerbs30d: 0, customerCreatedAt: daysAgo(90) },
      NOW,
    );
    expect(r.components.frequency).toBe(17.5);
    expect(r.score).toBe(18);
  });

  it("breadth saturates at 4 verbs: 5 verbs still caps at 25 (isolated from recency/frequency)", () => {
    // daysSince = 90 -> recency = 0; frequency = 0
    // breadth = 25 * clamp01(5/4) = 25 * clamp01(1.25) = 25 * 1 = 25 (clamped, saturation confirmed)
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(90), eventsLast30d: 0, distinctVerbs30d: 5, customerCreatedAt: daysAgo(90) },
      NOW,
    );
    expect(r.components.breadth).toBe(25);
    expect(r.score).toBe(25);
  });

  it("breadth partial: 2 verbs → 25 * (2/4) = 12.5 (isolated from recency/frequency)", () => {
    // daysSince = 90 -> recency = 0; frequency = 0; breadth = 25 * clamp01(2/4) = 25 * 0.5 = 12.5
    // score = round(0 + 0 + 12.5) = round(12.5) = 13
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(90), eventsLast30d: 0, distinctVerbs30d: 2, customerCreatedAt: daysAgo(90) },
      NOW,
    );
    expect(r.components.breadth).toBe(12.5);
    expect(r.score).toBe(13);
  });

  it("band boundary: score 39 (at_risk) at daysSince=2.7, no events/verbs", () => {
    // daysSince = 2.7 (>2) -> recency = 40 * clamp01((30-2.7)/28) = 40 * (27.3/28) = 40 * 0.975 = 39
    // frequency = 0; breadth = 0 -> score = round(39) = 39 -> band: 39 < 40 -> "at_risk"
    const lastActivityAt = new Date(NOW.getTime() - 2.7 * 86_400_000);
    const r = computeHealthScore(
      { lastActivityAt, eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: lastActivityAt },
      NOW,
    );
    expect(r.score).toBe(39);
    expect(r.band).toBe("at_risk");
  });

  it("band boundary: score 40 (watch) at daysSince=2, no events/verbs", () => {
    // daysSince = 2 (<=2) -> recency = 40 (full, boundary case of the <=2 branch)
    // frequency = 0; breadth = 0 -> score = 40 -> band: 40 >= 40 and < 70 -> "watch"
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(2), eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: daysAgo(2) },
      NOW,
    );
    expect(r.score).toBe(40);
    expect(r.band).toBe("watch");
  });

  it("band boundary: score 69 (watch) via recency=40 + 1 event + 4 verbs", () => {
    // daysSince = 1 (<=2) -> recency = 40
    // frequency = 35 * clamp01(1/8) = 35 * 0.125 = 4.375
    // breadth   = 25 * clamp01(4/4) = 25 * 1 = 25 (saturated)
    // raw = 40 + 4.375 + 25 = 69.375 -> score = round(69.375) = 69 -> band: 69 < 70 -> "watch"
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(1), eventsLast30d: 1, distinctVerbs30d: 4, customerCreatedAt: daysAgo(1) },
      NOW,
    );
    expect(r.score).toBe(69);
    expect(r.band).toBe("watch");
  });

  it("band boundary: score 70 (healthy) via recency=40 + 4 events + 2 verbs", () => {
    // daysSince = 1 (<=2) -> recency = 40
    // frequency = 35 * clamp01(4/8) = 35 * 0.5 = 17.5
    // breadth   = 25 * clamp01(2/4) = 25 * 0.5 = 12.5
    // raw = 40 + 17.5 + 12.5 = 70 (exact integer, no rounding ambiguity) -> band: 70 >= 70 -> "healthy"
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(1), eventsLast30d: 4, distinctVerbs30d: 2, customerCreatedAt: daysAgo(1) },
      NOW,
    );
    expect(r.score).toBe(70);
    expect(r.band).toBe("healthy");
  });

  it("components sum approximately equals score, within rounding", () => {
    // daysSince = 16 -> recency = 20; frequency = 35*clamp01(3/8) = 35*0.375 = 13.125;
    // breadth = 25*clamp01(2/4) = 25*0.5 = 12.5
    // raw = 20 + 13.125 + 12.5 = 45.625 -> score = round(45.625) = 46
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(16), eventsLast30d: 3, distinctVerbs30d: 2, customerCreatedAt: daysAgo(16) },
      NOW,
    );
    const sum = r.components.recency + r.components.frequency + r.components.breadth;
    expect(sum).toBeCloseTo(45.625, 5);
    expect(Math.abs(sum - r.score)).toBeLessThan(1);
    expect(r.score).toBe(46);
    expect(r.band).toBe("watch");
  });

  it("is deterministic: identical inputs + now produce identical results across calls", () => {
    const inputs = { lastActivityAt: daysAgo(10), eventsLast30d: 5, distinctVerbs30d: 3, customerCreatedAt: daysAgo(200) };
    const r1 = computeHealthScore(inputs, NOW);
    const r2 = computeHealthScore(inputs, NOW);
    expect(r1).toEqual(r2);
  });

  it("prefers lastActivityAt over customerCreatedAt as the recency anchor when both are present", () => {
    // lastActivityAt is 1 day ago (recency=40 if used); customerCreatedAt is 200 days ago
    // (recency=0 if that were used instead). The function must anchor on lastActivityAt.
    const r = computeHealthScore(
      { lastActivityAt: daysAgo(1), eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: daysAgo(200) },
      NOW,
    );
    expect(r.components.recency).toBe(40);
    expect(r.score).toBe(40);
  });

  it("falls back to customerCreatedAt as the recency anchor when lastActivityAt is null", () => {
    // lastActivityAt is null -> anchor = customerCreatedAt (45 days ago) -> recency = 0
    const r = computeHealthScore(
      { lastActivityAt: null, eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: daysAgo(45) },
      NOW,
    );
    expect(r.components.recency).toBe(0);
    expect(r.score).toBe(0);
    expect(r.band).toBe("at_risk");
  });

  it("exposes HEALTH_WEIGHTS constants matching the spec's documented values", () => {
    expect(HEALTH_WEIGHTS).toEqual({
      recencyMax: 40,
      recencyFullDays: 2,
      recencyZeroDays: 30,
      frequencyMax: 35,
      frequencySaturation: 8,
      breadthMax: 25,
      breadthSaturation: 4,
      healthyMin: 70,
      watchMin: 40,
    });
  });
});
