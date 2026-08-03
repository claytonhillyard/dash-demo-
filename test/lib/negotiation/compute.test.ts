import { describe, it, expect } from "vitest";
import { computeNegotiationStats, type PartnerBidRow, type NegotiationStats } from "@/lib/negotiation/compute";
import type { BidStatus } from "@/db/bids";

// --- Fixture builder --------------------------------------------------------
// Every field a test actually cares about is explicit at the call site;
// dealKind/dealPriceCents default to SELL/0 since most tests below don't
// care about them (dealKind is overridden explicitly wherever the point of
// the test IS the deal's kind — BUY/SELL inversion, mixed-kind history).
function makeRow(opts: {
  dealId: number;
  bidPriceCents: number;
  status: BidStatus;
  createdAt: string; // ISO instant, always includes an explicit "Z" offset
  decidedAt?: string | null; // ISO instant, or omitted/null for still-pending rows
  dealKind?: "BUY" | "SELL";
  dealPriceCents?: number;
}): PartnerBidRow {
  return {
    dealId: opts.dealId,
    dealKind: opts.dealKind ?? "SELL",
    dealPriceCents: opts.dealPriceCents ?? 0,
    bidPriceCents: opts.bidPriceCents,
    status: opts.status,
    createdAt: new Date(opts.createdAt),
    decidedAt: opts.decidedAt == null ? null : new Date(opts.decidedAt),
  };
}

type Coached = Extract<NegotiationStats, { kind: "coached" }>;
type Insufficient = Extract<NegotiationStats, { kind: "insufficient_history" }>;

function asCoached(r: NegotiationStats): Coached {
  if (r.kind !== "coached") throw new Error(`expected "coached", got "${r.kind}"`);
  return r;
}
function asInsufficient(r: NegotiationStats): Insufficient {
  if (r.kind !== "insufficient_history") throw new Error(`expected "insufficient_history", got "${r.kind}"`);
  return r;
}

describe("computeNegotiationStats", () => {
  it("SELL — a close's uplift is accepted minus first bid (positive = moved up toward the owner's ask)", () => {
    const history: PartnerBidRow[] = [
      // Deal 301: opened at $10,000, owner rejected, partner came back at
      // $11,200 and got accepted -> uplift = 1_120_000 - 1_000_000 = 120_000
      makeRow({
        dealId: 301,
        dealKind: "SELL",
        bidPriceCents: 1_000_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 301,
        dealKind: "SELL",
        bidPriceCents: 1_120_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      // Deal 302: $5,000 -> $5,600 accepted -> uplift = 60_000
      makeRow({
        dealId: 302,
        dealKind: "SELL",
        bidPriceCents: 500_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 302,
        dealKind: "SELL",
        bidPriceCents: 560_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 1_200_000, partnerPendingBidsCents: [] },
      "Ginza Pearl",
    );
    const coached = asCoached(result);
    expect(coached.partnerLabel).toBe("Ginza Pearl");
    expect(coached.closes).toBe(2);
    // avg uplift = (120_000 + 60_000) / 2 = 90_000
    expect(coached.avgUpliftCents).toBe(90_000);
  });

  it("BUY — a close's uplift is first bid minus accepted (positive = moved down toward the owner's target)", () => {
    const history: PartnerBidRow[] = [
      // Deal 401: opened at $2,000, accepted later at $1,800 -> uplift = 20_000
      makeRow({
        dealId: 401,
        dealKind: "BUY",
        bidPriceCents: 200_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 401,
        dealKind: "BUY",
        bidPriceCents: 180_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      // Deal 402: $1,000 -> $880 accepted -> uplift = 12_000
      makeRow({
        dealId: 402,
        dealKind: "BUY",
        bidPriceCents: 100_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 402,
        dealKind: "BUY",
        bidPriceCents: 88_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "BUY", askCents: 90_000, partnerPendingBidsCents: [] },
      "Mehta Diamonds",
    );
    const coached = asCoached(result);
    // avg uplift = (20_000 + 12_000) / 2 = 16_000
    expect(coached.avgUpliftCents).toBe(16_000);
  });

  it("uses each historical deal's OWN kind for uplift sign, independent of the CURRENT deal's kind", () => {
    const history: PartnerBidRow[] = [
      // A past SELL deal: $1,000 -> $1,150 accepted -> SELL uplift = +15_000
      makeRow({
        dealId: 501,
        dealKind: "SELL",
        bidPriceCents: 100_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 501,
        dealKind: "SELL",
        bidPriceCents: 115_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      // A past BUY deal: $500 -> $420 accepted -> BUY uplift = +8_000
      makeRow({
        dealId: 502,
        dealKind: "BUY",
        bidPriceCents: 50_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 502,
        dealKind: "BUY",
        bidPriceCents: 42_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    // The CURRENT deal being negotiated is a BUY — that must NOT bleed into
    // deal 501's (SELL) uplift math. A buggy implementation that used
    // current.kind for every close would score deal 501 as
    // (100_000 - 115_000 = -15_000) instead of the correct
    // (115_000 - 100_000 = +15_000), landing on an average of -3_500
    // instead of the correct +11_500 asserted below.
    const result = computeNegotiationStats(
      history,
      { kind: "BUY", askCents: 40_000, partnerPendingBidsCents: [] },
      "Saint-Cloud Gems",
    );
    const coached = asCoached(result);
    expect(coached.avgUpliftCents).toBe(11_500);
  });

  it("avgUpliftCents never surfaces a negative zero (Math.round(-0.5) would otherwise be -0)", () => {
    const history: PartnerBidRow[] = [
      // Close A: uplift = 99 - 100 = -1
      makeRow({
        dealId: 1,
        dealKind: "SELL",
        bidPriceCents: 100,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 1,
        dealKind: "SELL",
        bidPriceCents: 99,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      // Close B: single round, immediate accept -> first === accepted -> uplift = 0
      makeRow({
        dealId: 2,
        dealKind: "SELL",
        bidPriceCents: 100,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
    ];
    // mean = (-1 + 0) / 2 = -0.5 -> Math.round(-0.5) is -0 in JS, not +0
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 100, partnerPendingBidsCents: [] },
      "Partner",
    );
    const coached = asCoached(result);
    expect(coached.avgUpliftCents).toBe(0);
    expect(Object.is(coached.avgUpliftCents, -0)).toBe(false);
  });

  it("no history at all → insufficient_history, honestly reporting 0 closes and the kind-aware current best (SELL = max pending bid)", () => {
    const result = computeNegotiationStats(
      [],
      { kind: "SELL", askCents: 500_000, partnerPendingBidsCents: [480_000, 495_000, 300_000] },
      "New Partner",
    );
    const insufficient = asInsufficient(result);
    expect(insufficient.partnerLabel).toBe("New Partner");
    expect(insufficient.closes).toBe(0);
    expect(insufficient.currentBestCents).toBe(495_000); // SELL: highest pending bid is best
    expect(insufficient.askCents).toBe(500_000);
  });

  it("exactly 1 close is still insufficient_history (the 2-close threshold is strict)", () => {
    const history: PartnerBidRow[] = [
      makeRow({
        dealId: 601,
        bidPriceCents: 100_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 601,
        bidPriceCents: 110_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      // Noise: a withdrawn-only group on a different deal — must not read
      // as a second close.
      makeRow({
        dealId: 602,
        bidPriceCents: 99_900,
        status: "withdrawn",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-01T01:00:00Z",
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 200_000, partnerPendingBidsCents: [] },
      "One-Time Partner",
    );
    const insufficient = asInsufficient(result);
    expect(insufficient.closes).toBe(1);
    expect(insufficient.currentBestCents).toBeNull();
  });

  it("winRatePct is closes / decidedDeals as an integer percentage", () => {
    const history: PartnerBidRow[] = [
      makeRow({
        dealId: 801,
        bidPriceCents: 10_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 802,
        bidPriceCents: 20_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 803,
        bidPriceCents: 15_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 804,
        bidPriceCents: 25_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 30_000, partnerPendingBidsCents: [] },
      "Partner",
    );
    const coached = asCoached(result);
    expect(coached.closes).toBe(2);
    expect(coached.decidedDeals).toBe(4);
    expect(coached.winRatePct).toBe(50);
  });

  it("avgRounds is the mean row-count per decided deal, rounded to 1 decimal", () => {
    const history: PartnerBidRow[] = [
      // Deal 901: 1 round, immediately accepted.
      makeRow({
        dealId: 901,
        bidPriceCents: 10_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      // Deal 902: 1 round, rejected (decided, not a close).
      makeRow({
        dealId: 902,
        bidPriceCents: 5_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      // Deal 903: 3 rounds — two superseded (auto_rejected), one accepted.
      makeRow({
        dealId: 903,
        bidPriceCents: 8_000,
        status: "auto_rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-05T00:00:00Z",
      }),
      makeRow({
        dealId: 903,
        bidPriceCents: 9_000,
        status: "auto_rejected",
        createdAt: "2026-01-02T00:00:00Z",
        decidedAt: "2026-01-05T00:00:00Z",
      }),
      makeRow({
        dealId: 903,
        bidPriceCents: 10_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-05T00:00:00Z",
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 12_000, partnerPendingBidsCents: [] },
      "Partner",
    );
    const coached = asCoached(result);
    expect(coached.decidedDeals).toBe(3);
    // rounds per decided deal = [1, 1, 3] -> mean = 5/3 = 1.6666... -> 1.7
    expect(coached.avgRounds).toBe(1.7);
  });

  it("medianDaysToDecide — even count of decided deals is the rounded mean of the middle two", () => {
    const history: PartnerBidRow[] = [
      // day-diffs (first bid createdAt -> decidedAt): 1, 2, 5, 8
      makeRow({
        dealId: 1001,
        bidPriceCents: 10_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z", // +1 day
      }),
      makeRow({
        dealId: 1002,
        bidPriceCents: 5_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-03T00:00:00Z", // +2 days
      }),
      makeRow({
        dealId: 1003,
        bidPriceCents: 20_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-06T00:00:00Z", // +5 days
      }),
      makeRow({
        dealId: 1004,
        bidPriceCents: 8_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-09T00:00:00Z", // +8 days
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 25_000, partnerPendingBidsCents: [] },
      "Partner",
    );
    const coached = asCoached(result);
    expect(coached.decidedDeals).toBe(4);
    // sorted [1,2,5,8] -> mean of the middle two (2,5) = 3.5 -> rounded -> 4
    expect(coached.medianDaysToDecide).toBe(4);
  });

  it("medianDaysToDecide — odd count of decided deals is the middle value", () => {
    const history: PartnerBidRow[] = [
      // day-diffs: 1, 4, 10
      makeRow({
        dealId: 1101,
        bidPriceCents: 10_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z", // +1 day
      }),
      makeRow({
        dealId: 1102,
        bidPriceCents: 5_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-05T00:00:00Z", // +4 days
      }),
      makeRow({
        dealId: 1103,
        bidPriceCents: 20_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-11T00:00:00Z", // +10 days
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 25_000, partnerPendingBidsCents: [] },
      "Partner",
    );
    const coached = asCoached(result);
    expect(coached.decidedDeals).toBe(3);
    expect(coached.medianDaysToDecide).toBe(4);
  });

  it("currentBestCents picks the MIN pending bid for a BUY (lowest price is best for a buyer)", () => {
    const result = computeNegotiationStats(
      [],
      { kind: "BUY", askCents: 1, partnerPendingBidsCents: [100_000, 250_000, 180_000] },
      "Partner",
    );
    const insufficient = asInsufficient(result);
    expect(insufficient.currentBestCents).toBe(100_000);
  });

  it("empty pending bids → currentBestCents is null and the suggested counter falls back to the ask", () => {
    const history: PartnerBidRow[] = [
      makeRow({
        dealId: 301,
        dealKind: "SELL",
        bidPriceCents: 1_000_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 301,
        dealKind: "SELL",
        bidPriceCents: 1_120_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      makeRow({
        dealId: 302,
        dealKind: "SELL",
        bidPriceCents: 500_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 302,
        dealKind: "SELL",
        bidPriceCents: 560_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 1_050_000, partnerPendingBidsCents: [] },
      "Ginza Pearl",
    );
    const coached = asCoached(result);
    expect(coached.currentBestCents).toBeNull();
    expect(coached.suggestedCounterCents).toBe(1_050_000);
  });

  it("suggestedCounterCents = currentBest + avgUplift for a SELL", () => {
    const history: PartnerBidRow[] = [
      makeRow({
        dealId: 301,
        dealKind: "SELL",
        bidPriceCents: 1_000_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 301,
        dealKind: "SELL",
        bidPriceCents: 1_120_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      makeRow({
        dealId: 302,
        dealKind: "SELL",
        bidPriceCents: 500_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 302,
        dealKind: "SELL",
        bidPriceCents: 560_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    // avgUpliftCents = 90_000 (see the SELL-uplift test above)
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 1_200_000, partnerPendingBidsCents: [1_000_000, 1_030_000] },
      "Ginza Pearl",
    );
    const coached = asCoached(result);
    expect(coached.currentBestCents).toBe(1_030_000);
    expect(coached.avgUpliftCents).toBe(90_000);
    expect(coached.suggestedCounterCents).toBe(1_120_000); // 1_030_000 + 90_000
  });

  it("suggestedCounterCents = currentBest − avgUplift for a BUY", () => {
    const history: PartnerBidRow[] = [
      makeRow({
        dealId: 401,
        dealKind: "BUY",
        bidPriceCents: 200_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 401,
        dealKind: "BUY",
        bidPriceCents: 180_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      makeRow({
        dealId: 402,
        dealKind: "BUY",
        bidPriceCents: 100_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 402,
        dealKind: "BUY",
        bidPriceCents: 88_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    // avgUpliftCents = 16_000 (see the BUY-uplift test above)
    const result = computeNegotiationStats(
      history,
      { kind: "BUY", askCents: 90_000, partnerPendingBidsCents: [190_000, 170_000] },
      "Mehta Diamonds",
    );
    const coached = asCoached(result);
    expect(coached.currentBestCents).toBe(170_000);
    expect(coached.avgUpliftCents).toBe(16_000);
    expect(coached.suggestedCounterCents).toBe(154_000); // 170_000 - 16_000
  });

  it("suggestedCounterCents clamps at the int4 ceiling (2_147_483_647)", () => {
    const history: PartnerBidRow[] = [
      makeRow({
        dealId: 1,
        dealKind: "SELL",
        bidPriceCents: 100,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 1,
        dealKind: "SELL",
        bidPriceCents: 2_000_000_100,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      makeRow({
        dealId: 2,
        dealKind: "SELL",
        bidPriceCents: 100,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 2,
        dealKind: "SELL",
        bidPriceCents: 2_000_000_100,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    // avgUpliftCents = 2_000_000_000; currentBest (SELL max) = 2_000_000_000
    // -> raw suggestion = 4_000_000_000, far past the int4 ceiling.
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 1, partnerPendingBidsCents: [2_000_000_000] },
      "Partner",
    );
    const coached = asCoached(result);
    expect(coached.avgUpliftCents).toBe(2_000_000_000);
    expect(coached.suggestedCounterCents).toBe(2_147_483_647);
  });

  it("suggestedCounterCents clamps to 1 when the raw computation goes to zero or below", () => {
    const history: PartnerBidRow[] = [
      makeRow({
        dealId: 1,
        dealKind: "BUY",
        bidPriceCents: 20_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 1,
        dealKind: "BUY",
        bidPriceCents: 10_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
      makeRow({
        dealId: 2,
        dealKind: "BUY",
        bidPriceCents: 20_000,
        status: "rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 2,
        dealKind: "BUY",
        bidPriceCents: 10_000,
        status: "accepted",
        createdAt: "2026-01-03T00:00:00Z",
        decidedAt: "2026-01-04T00:00:00Z",
      }),
    ];
    // avgUpliftCents = 10_000; currentBest (BUY min of [500]) = 500
    // -> raw suggestion = 500 - 10_000 = -9_500
    const result = computeNegotiationStats(
      history,
      { kind: "BUY", askCents: 15_000, partnerPendingBidsCents: [500] },
      "Partner",
    );
    const coached = asCoached(result);
    expect(coached.avgUpliftCents).toBe(10_000);
    expect(coached.suggestedCounterCents).toBe(1);
  });

  it("a withdrawn-only deal group doesn't count as decided or a close", () => {
    const history: PartnerBidRow[] = [
      makeRow({
        dealId: 1,
        bidPriceCents: 10_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 2,
        bidPriceCents: 20_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      // Withdrawn bids DO get a decidedAt stamp (withdrawBid sets one) — it
      // must still not count toward decidedDeals or closes.
      makeRow({
        dealId: 3,
        bidPriceCents: 99_900,
        status: "withdrawn",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-01T12:00:00Z",
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 30_000, partnerPendingBidsCents: [] },
      "Partner",
    );
    const coached = asCoached(result);
    expect(coached.closes).toBe(2);
    expect(coached.decidedDeals).toBe(2); // NOT 3
    expect(coached.winRatePct).toBe(100); // would be 67 if the withdrawn row counted
  });

  it("an auto_rejected-only deal group doesn't count as decided or a close", () => {
    const history: PartnerBidRow[] = [
      makeRow({
        dealId: 1,
        bidPriceCents: 10_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      makeRow({
        dealId: 2,
        bidPriceCents: 20_000,
        status: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-02T00:00:00Z",
      }),
      // Lost to a competing bidder on deal 3 — this partner's own bid is
      // swept to auto_rejected (with a decidedAt stamp) as collateral of
      // someone ELSE's bid being accepted, not as a decision made about
      // this partner's bid specifically.
      makeRow({
        dealId: 3,
        bidPriceCents: 99_900,
        status: "auto_rejected",
        createdAt: "2026-01-01T00:00:00Z",
        decidedAt: "2026-01-01T12:00:00Z",
      }),
    ];
    const result = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 30_000, partnerPendingBidsCents: [] },
      "Partner",
    );
    const coached = asCoached(result);
    expect(coached.closes).toBe(2);
    expect(coached.decidedDeals).toBe(2); // NOT 3
    expect(coached.winRatePct).toBe(100);
  });
});
