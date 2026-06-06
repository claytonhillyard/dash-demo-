import { describe, it, expect } from "vitest";
import { seedInventorySummary, seedDiamondSummary } from "@/lib/demo/seed";
import { INVENTORY_CATEGORIES } from "@/lib/inventory/validation";

describe("demo seed", () => {
  it("inventory seed covers all 9 categories and totals correctly", () => {
    const s = seedInventorySummary();
    for (const c of INVENTORY_CATEGORIES) expect(typeof s.counts[c]).toBe("number");
    const sum = INVENTORY_CATEGORIES.reduce((n, c) => n + s.counts[c], 0);
    expect(s.total).toBe(sum);
    expect(s.updatedAt).not.toBeNull();
  });
  it("diamond seed has both indices and at least one named point", () => {
    const d = seedDiamondSummary();
    expect(d.naturalIndex?.cents).toBeGreaterThan(0);
    expect(d.labIndex?.cents).toBeGreaterThan(0);
    expect(d.points.length).toBeGreaterThan(0);
  });
});

import {
  getSeedDeals,
  getSeedCircles,
  getSeedCircleIdsForOrg,
  getSeedDealsVisibleTo,
  DEMO_AIYA_ORG_ID,
  DEMO_PARTNER_ORG_IDS,
  DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
} from "@/lib/demo/seed";
import { DEAL_KINDS, DEAL_CATEGORIES, DEAL_STATUSES } from "@/lib/deals/constants";

describe("getSeedDeals (baseline shape preserved)", () => {
  it("each row has valid kind/category/status", () => {
    for (const d of getSeedDeals()) {
      expect(DEAL_KINDS).toContain(d.kind);
      expect(DEAL_CATEGORIES).toContain(d.category);
      expect(DEAL_STATUSES).toContain(d.status);
    }
  });
  it("every subject carries the 'demo · simulated' provenance suffix", () => {
    for (const d of getSeedDeals()) {
      expect(d.subject).toMatch(/demo · simulated/);
    }
  });
  it("price_cents >= 0 and quantity >= 1 everywhere", () => {
    for (const d of getSeedDeals()) {
      expect(d.priceCents).toBeGreaterThanOrEqual(0);
      expect(d.quantity).toBeGreaterThanOrEqual(1);
    }
  });
  it("createdAt is a Date instance on every row", () => {
    for (const d of getSeedDeals()) {
      expect(d.createdAt).toBeInstanceOf(Date);
    }
  });
});

describe("getSeedCircles", () => {
  it("returns exactly one demo circle: AIYA Trusted Partners", () => {
    const circles = getSeedCircles();
    expect(circles).toHaveLength(1);
    expect(circles[0]).toMatchObject({
      id: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      name: "AIYA Trusted Partners",
      slug: "aiya-trusted-partners",
      ownerOrgId: DEMO_AIYA_ORG_ID,
    });
  });
});

describe("getSeedCircleIdsForOrg", () => {
  it("returns the demo circle for AIYA", () => {
    expect(getSeedCircleIdsForOrg(DEMO_AIYA_ORG_ID))
      .toEqual([DEMO_TRUSTED_PARTNERS_CIRCLE_ID]);
  });

  it("returns the demo circle for each fixture partner org", () => {
    expect(getSeedCircleIdsForOrg(501)).toEqual([DEMO_TRUSTED_PARTNERS_CIRCLE_ID]);
    expect(getSeedCircleIdsForOrg(502)).toEqual([DEMO_TRUSTED_PARTNERS_CIRCLE_ID]);
  });

  it("returns [] for any unseeded org", () => {
    expect(getSeedCircleIdsForOrg(999)).toEqual([]);
    expect(getSeedCircleIdsForOrg(7777)).toEqual([]);
  });
});

describe("getSeedDeals (extended)", () => {
  it("includes AIYA's original 5 deals (slice 2) unchanged", () => {
    const deals = getSeedDeals();
    const aiyaIds = deals
      .filter((d) => d.orgId === DEMO_AIYA_ORG_ID && d.visibilityCircleId === null)
      .map((d) => d.id);
    expect(aiyaIds).toEqual([101, 102, 103, 104, 105]);
  });

  it("includes 3 cross-circle deals from partner orgs into the demo circle", () => {
    const deals = getSeedDeals();
    const partner = deals.filter((d) => d.orgId !== DEMO_AIYA_ORG_ID);
    expect(partner.map((d) => d.id).sort()).toEqual([106, 107, 108]);
    for (const d of partner) {
      expect(d.visibilityCircleId).toBe(DEMO_TRUSTED_PARTNERS_CIRCLE_ID);
    }
  });

  it("every cross-circle demo deal subject contains 'demo · simulated' (honest provenance)", () => {
    const deals = getSeedDeals();
    const cross = deals.filter((d) => d.orgId !== DEMO_AIYA_ORG_ID);
    for (const d of cross) {
      expect(d.subject.toLowerCase()).toContain("demo · simulated");
    }
  });

  it("AIYA's 5 original deals have visibilityCircleId = null (slice-2 private behavior)", () => {
    const deals = getSeedDeals();
    const aiya = deals.filter(
      (d) => d.orgId === DEMO_AIYA_ORG_ID && d.id >= 101 && d.id <= 105,
    );
    for (const d of aiya) {
      expect(d.visibilityCircleId).toBeNull();
    }
  });
});

describe("getSeedDealsVisibleTo", () => {
  it("returns AIYA's private deals + cross-circle deals shared into circles AIYA is in", () => {
    const rows = getSeedDealsVisibleTo(DEMO_AIYA_ORG_ID);
    const ids = rows.map((d) => d.id).sort();
    expect(ids).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
  });

  it("an unseeded org sees no demo deals", () => {
    expect(getSeedDealsVisibleTo(9999)).toEqual([]);
  });
});

// --- Slice 10 demo seed: deals 109/110 + 5 reply messages ---
import { DEMO_DEAL_MESSAGES, DEMO_BIDS } from "@/lib/demo/seed";

describe("DEMO_BIDS — slice-16 authored seed", () => {
  it("exports exactly 2 pending bids on deals 109 + 110", () => {
    expect(DEMO_BIDS).toHaveLength(2);
    const byDeal = new Map(DEMO_BIDS.map((b) => [b.dealId, b]));
    expect(byDeal.get(109)?.bidderOrgLabel).toBe("Mehta Diamonds");
    expect(byDeal.get(109)?.priceCents).toBe(12_300_00);
    expect(byDeal.get(110)?.bidderOrgLabel).toBe("Saint-Cloud Atelier");
    expect(byDeal.get(110)?.priceCents).toBe(89_500_00);
    expect(DEMO_BIDS.every((b) => b.status === "pending")).toBe(true);
  });
});

describe("getSeedDeals (slice 10 — reply threads)", () => {
  it("appends 2 AIYA-owned demo deals (109 private, 110 group) scoped to Trusted Partners", () => {
    const deals = getSeedDeals();
    expect(deals).toHaveLength(10);
    const d109 = deals.find((d) => d.id === 109);
    const d110 = deals.find((d) => d.id === 110);
    expect(d109).toBeDefined();
    expect(d110).toBeDefined();
    expect(d109!.orgId).toBe(DEMO_AIYA_ORG_ID);
    expect(d109!.threadMode).toBe("private");
    expect(d109!.visibilityCircleId).toBe(DEMO_TRUSTED_PARTNERS_CIRCLE_ID);
    expect(d110!.orgId).toBe(DEMO_AIYA_ORG_ID);
    expect(d110!.threadMode).toBe("group");
    expect(d110!.visibilityCircleId).toBe(DEMO_TRUSTED_PARTNERS_CIRCLE_ID);
  });

  it("every demo deal carries a thread_mode literal ('private' | 'group')", () => {
    for (const d of getSeedDeals()) {
      expect(["private", "group"]).toContain(d.threadMode);
    }
  });
});

describe("DEMO_DEAL_MESSAGES", () => {
  it("exports exactly 5 seed messages across deals 109 + 110", () => {
    expect(DEMO_DEAL_MESSAGES).toHaveLength(5);
  });

  it("deal 109 has 2 private-mode messages (AIYA <-> Mehta)", () => {
    const m109 = DEMO_DEAL_MESSAGES.filter((m) => m.dealId === 109);
    expect(m109).toHaveLength(2);
    expect(m109.every((m) => m.threadMode === "private")).toBe(true);
  });

  it("deal 110 has 3 group-mode messages (AIYA + Mehta + Saint-Cloud)", () => {
    const m110 = DEMO_DEAL_MESSAGES.filter((m) => m.dealId === 110);
    expect(m110).toHaveLength(3);
    expect(m110.every((m) => m.threadMode === "group")).toBe(true);
    const senders = new Set(m110.map((m) => m.fromOrgId));
    expect(senders.size).toBe(3);
  });

  it("the constant is stable — calling consumers cannot accidentally widen the count", () => {
    // Idempotency surrogate: a pure-TS constant cannot be mutated by re-import.
    const again = DEMO_DEAL_MESSAGES;
    expect(again).toHaveLength(5);
    expect(again).toBe(DEMO_DEAL_MESSAGES);
  });
});

import {
  getSeedWebsiteSnapshots,
  getSeedLatestWebsiteSnapshot,
  getSeedWebsiteSnapshotTrend,
} from "@/lib/demo/seed";

describe("getSeedWebsiteSnapshots", () => {
  it("returns 8 weeks for AIYA, sorted DESC by weekStart", () => {
    const rows = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    expect(rows).toHaveLength(8);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].weekStart >= rows[i].weekStart).toBe(true);
    }
  });

  it("AIYA rows have realistic luxury-jewelry KPI ranges", () => {
    const rows = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    for (const r of rows) {
      // Visitors 3k-8k, page views 12k-25k, avg session 150-240, bounce 35-55.
      expect(r.visitors).toBeGreaterThanOrEqual(3000);
      expect(r.visitors).toBeLessThanOrEqual(8500);
      expect(r.pageViews).toBeGreaterThanOrEqual(12000);
      expect(r.pageViews).toBeLessThanOrEqual(25000);
      expect(r.avgSessionDurationSeconds).toBeGreaterThanOrEqual(150);
      expect(r.avgSessionDurationSeconds).toBeLessThanOrEqual(240);
      expect(r.bounceRatePercent).toBeGreaterThanOrEqual(35);
      expect(r.bounceRatePercent).toBeLessThanOrEqual(55);
    }
  });

  it("AIYA shows mostly week-over-week visitor growth (>= 5 of 7 transitions up)", () => {
    const rows = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    // Rows are newest-first; reverse for chronological comparison.
    const chronological = [...rows].reverse();
    let upTransitions = 0;
    for (let i = 1; i < chronological.length; i++) {
      if (chronological[i].visitors > chronological[i - 1].visitors) upTransitions++;
    }
    expect(upTransitions).toBeGreaterThanOrEqual(5);
  });

  it("returns 2 weeks for Mehta Diamonds (multi-tenant story)", () => {
    const rows = getSeedWebsiteSnapshots(DEMO_PARTNER_ORG_IDS.MEHTA);
    expect(rows).toHaveLength(2);
  });

  it("returns [] for any unseeded org (e.g. Saint-Cloud or fixture)", () => {
    expect(getSeedWebsiteSnapshots(DEMO_PARTNER_ORG_IDS.SAINT_CLOUD)).toEqual([]);
    expect(getSeedWebsiteSnapshots(DEMO_PARTNER_ORG_IDS.MARATHI)).toEqual([]);
    expect(getSeedWebsiteSnapshots(999)).toEqual([]);
    expect(getSeedWebsiteSnapshots(7777)).toEqual([]);
  });

  it("every row's bounceRate is in [0, 100]", () => {
    const all = [
      ...getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID),
      ...getSeedWebsiteSnapshots(DEMO_PARTNER_ORG_IDS.MEHTA),
    ];
    for (const r of all) {
      expect(r.bounceRatePercent).toBeGreaterThanOrEqual(0);
      expect(r.bounceRatePercent).toBeLessThanOrEqual(100);
    }
  });
});

describe("getSeedLatestWebsiteSnapshot", () => {
  it("returns AIYA's most-recent week (the first of the 8 DESC rows)", () => {
    const all = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    const latest = getSeedLatestWebsiteSnapshot(DEMO_AIYA_ORG_ID);
    expect(latest?.weekStart).toBe(all[0].weekStart);
    expect(latest?.visitors).toBe(all[0].visitors);
  });

  it("returns null for an unseeded org", () => {
    expect(getSeedLatestWebsiteSnapshot(999)).toBeNull();
    expect(getSeedLatestWebsiteSnapshot(DEMO_PARTNER_ORG_IDS.SAINT_CLOUD)).toBeNull();
  });
});

describe("getSeedWebsiteSnapshotTrend", () => {
  it("caps at the requested N (4 of AIYA's 8)", () => {
    const rows = getSeedWebsiteSnapshotTrend(DEMO_AIYA_ORG_ID, 4);
    expect(rows).toHaveLength(4);
  });

  it("returns the 4 MOST RECENT, not arbitrary 4", () => {
    const all = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    const trend = getSeedWebsiteSnapshotTrend(DEMO_AIYA_ORG_ID, 4);
    expect(trend.map((r) => r.weekStart)).toEqual(all.slice(0, 4).map((r) => r.weekStart));
  });

  it("defaults to 8 when no N supplied (returns all 8 AIYA rows)", () => {
    expect(getSeedWebsiteSnapshotTrend(DEMO_AIYA_ORG_ID)).toHaveLength(8);
  });

  it("returns [] for an unseeded org regardless of N", () => {
    expect(getSeedWebsiteSnapshotTrend(999, 4)).toEqual([]);
    expect(getSeedWebsiteSnapshotTrend(7777)).toEqual([]);
  });
});

import { DEMO_DEAL_ATTACHMENTS } from "@/lib/demo/seed";

describe("DEMO_DEAL_ATTACHMENTS — slice-17 authored seed", () => {
  it("exports 3 image attachments across deals 109 + 110", () => {
    expect(DEMO_DEAL_ATTACHMENTS).toHaveLength(3);
    const byDeal = new Map<number, number>();
    for (const a of DEMO_DEAL_ATTACHMENTS) {
      byDeal.set(a.dealId, (byDeal.get(a.dealId) ?? 0) + 1);
    }
    expect(byDeal.get(109)).toBe(2);
    expect(byDeal.get(110)).toBe(1);
    expect(DEMO_DEAL_ATTACHMENTS.every((a) => a.kind === "image")).toBe(true);
    expect(DEMO_DEAL_ATTACHMENTS.every((a) => a.publicCdnUrl.startsWith("https://"))).toBe(true);
  });
});
