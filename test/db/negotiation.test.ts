// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { deals, bids } from "@/db/schema";
import { getPartnerBidHistory } from "@/db/negotiation";
import { computeNegotiationStats } from "@/lib/negotiation/compute";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

async function seedDeal(orgId: number, overrides: Partial<typeof deals.$inferInsert> = {}) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId,
      kind: "SELL",
      category: "Diamond",
      subject: "negotiation-test",
      quantity: 1,
      priceCents: 100_000,
      postedByLabel: "owner",
      ...overrides,
    })
    .returning();
  return row!.id;
}

async function seedBid(
  dealId: number,
  bidderOrgId: number,
  overrides: Partial<typeof bids.$inferInsert> = {},
) {
  const [row] = await db
    .insert(bids)
    .values({
      dealId,
      bidderOrgId,
      bidderOrgLabel: "Partner",
      priceCents: 1000,
      bidMode: "single",
      ...overrides,
    })
    .returning();
  return row!;
}

describe("getPartnerBidHistory", () => {
  it("returns this partner's bids on deals owned by the owner, joined with the deal's kind/price", async () => {
    const dealId = await seedDeal(1, { kind: "SELL", priceCents: 500_000 });
    await seedBid(dealId, 999, {
      priceCents: 480_000,
      status: "accepted",
      createdAt: new Date("2026-01-30T00:00:00Z"),
      decidedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const rows = await getPartnerBidHistory(db, 1, 999, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dealId,
      dealKind: "SELL",
      dealPriceCents: 500_000,
      bidPriceCents: 480_000,
      status: "accepted",
    });
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    expect(rows[0]!.decidedAt).toBeInstanceOf(Date);
  });

  it("excludes bids from a DIFFERENT bidder on the owner's deals (bidder-scoped)", async () => {
    const dealId = await seedDeal(1);
    await seedBid(dealId, 999, { priceCents: 100 });
    await seedBid(dealId, 888, { priceCents: 200 }); // a different bidder, same deal

    const rows = await getPartnerBidHistory(db, 1, 999, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bidPriceCents).toBe(100);
  });

  it("a bid this SAME partner placed on a DIFFERENT org's deal is invisible (org-scoped, not a viewer predicate)", async () => {
    const myDealId = await seedDeal(1);
    const othersDealId = await seedDeal(999); // a different deal owner
    await seedBid(myDealId, 888, { priceCents: 111 });
    // Adversarial: the SAME bidder (888) also bid on a deal owned by org
    // 999 — this must never leak into org 1's read of "how has 888
    // negotiated against ME."
    await seedBid(othersDealId, 888, { priceCents: 999_999 });

    const rows = await getPartnerBidHistory(db, 1, 888, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bidPriceCents).toBe(111);
  });

  it("excludeDealId omits that specific deal's rows only", async () => {
    const currentDealId = await seedDeal(1);
    const priorDealId = await seedDeal(1);
    await seedBid(currentDealId, 999, { priceCents: 1 });
    await seedBid(priorDealId, 999, { priceCents: 2 });

    const rows = await getPartnerBidHistory(db, 1, 999, currentDealId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dealId).toBe(priorDealId);
  });

  it("returns [] when this partner has no history on the owner's deals", async () => {
    expect(await getPartnerBidHistory(db, 1, 999, 0)).toEqual([]);
  });

  it("orders by dealId then createdAt ascending", async () => {
    const dealA = await seedDeal(1);
    const dealB = await seedDeal(1);
    await seedBid(dealB, 999, { priceCents: 20, createdAt: new Date("2026-01-01T00:00:00Z") });
    await seedBid(dealA, 999, { priceCents: 11, createdAt: new Date("2026-01-02T00:00:00Z") });
    await seedBid(dealA, 999, { priceCents: 10, createdAt: new Date("2026-01-01T00:00:00Z") });

    const rows = await getPartnerBidHistory(db, 1, 999, 0);
    const orderedByDealThenTime = [...rows].sort(
      (a, b) => a.dealId - b.dealId || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    expect(rows).toEqual(orderedByDealThenTime);
    expect(rows.map((r) => r.bidPriceCents)).toEqual(
      dealA < dealB ? [10, 11, 20] : [20, 10, 11],
    );
  });
});

describe("getPartnerBidHistory — demo mode", () => {
  const ORIGINAL_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    vi.resetModules();
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = ORIGINAL_DEMO;
    vi.resetModules();
  });

  it("returns the authored Mehta/AIYA history, excluding the current deal (109)", async () => {
    const mod = await import("@/db/negotiation");
    const { DEMO_AIYA_ORG_ID, DEMO_PARTNER_ORG_IDS, DEMO_PARTNER_BID_HISTORY } = await import(
      "@/lib/demo/seed"
    );

    const rows = await mod.getPartnerBidHistory(db, DEMO_AIYA_ORG_ID, DEMO_PARTNER_ORG_IDS.MEHTA, 109);

    expect(rows).toHaveLength(DEMO_PARTNER_BID_HISTORY.length);
    expect(rows.every((r) => r.dealId !== 109)).toBe(true);
    // "demo-is-canonical" requires enough closes for a real coached verdict.
    const closedDealIds = new Set(
      rows.filter((r) => r.status === "accepted").map((r) => r.dealId),
    );
    expect(closedDealIds.size).toBeGreaterThanOrEqual(3);
  });

  it("feeds computeNegotiationStats a real coached verdict, not insufficient_history (demo-is-canonical)", async () => {
    const mod = await import("@/db/negotiation");
    const { DEMO_AIYA_ORG_ID, DEMO_PARTNER_ORG_IDS } = await import("@/lib/demo/seed");

    const history = await mod.getPartnerBidHistory(db, DEMO_AIYA_ORG_ID, DEMO_PARTNER_ORG_IDS.MEHTA, 109);
    const stats = computeNegotiationStats(
      history,
      { kind: "SELL", askCents: 1_240_000, partnerPendingBidsCents: [1_230_000] },
      "Mehta Diamonds",
    );

    expect(stats.kind).toBe("coached");
    if (stats.kind === "coached") {
      expect(stats.closes).toBeGreaterThanOrEqual(3);
      expect(stats.decidedDeals).toBe(stats.closes); // every authored group in this story closed
      expect(stats.winRatePct).toBe(100);
    }
  });

  it("an unseeded (ownerOrgId, bidderOrgId) pair returns []", async () => {
    const mod = await import("@/db/negotiation");
    expect(await mod.getPartnerBidHistory(db, 999_999, 888_888, 0)).toEqual([]);
  });
});
