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

import {
  DEMO_ARGYLE_ORG_ID,
  getSeedPendingInvitesForOrg,
  getSeedOwnedCirclesForOrg,
  DEMO_DEAL_ATTACHMENTS,
} from "@/lib/demo/seed";

describe("DEMO_ARGYLE_ORG_ID", () => {
  it("is a numeric id outside the partner-org range", () => {
    expect(typeof DEMO_ARGYLE_ORG_ID).toBe("number");
    expect(DEMO_ARGYLE_ORG_ID).toBeGreaterThan(503); // beyond the slice-4 partner range
  });
});

describe("getSeedPendingInvitesForOrg", () => {
  it("returns one pending invite from AIYA to argyle-mining", () => {
    const invites = getSeedPendingInvitesForOrg(DEMO_AIYA_ORG_ID);
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      circleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      circleName: "AIYA Trusted Partners",
      fromOrgId: DEMO_AIYA_ORG_ID,
      fromOrgName: "AIYA Designs",
      toOrgSlug: "argyle-mining",
      status: "pending",
    });
    // Token is present but is a static demo string — the UI never displays it.
    expect(typeof invites[0].token).toBe("string");
    expect(invites[0].token.length).toBeGreaterThan(0);
    // Expiry is in the future so the demo UI shows the invite as pending.
    expect(invites[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns [] for any non-AIYA org", () => {
    expect(getSeedPendingInvitesForOrg(999)).toEqual([]);
    expect(getSeedPendingInvitesForOrg(DEMO_PARTNER_ORG_IDS.MEHTA)).toEqual([]);
  });
});

describe("getSeedOwnedCirclesForOrg", () => {
  it("returns the demo Trusted Partners circle for AIYA", () => {
    const owned = getSeedOwnedCirclesForOrg(DEMO_AIYA_ORG_ID);
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({
      id: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      name: "AIYA Trusted Partners",
      ownerOrgId: DEMO_AIYA_ORG_ID,
    });
  });

  it("returns [] for any non-AIYA org", () => {
    expect(getSeedOwnedCirclesForOrg(999)).toEqual([]);
    expect(getSeedOwnedCirclesForOrg(DEMO_PARTNER_ORG_IDS.MEHTA)).toEqual([]);
  });
});

import {
  getSeedSharedInventoryRows,
  getSeedSharedInventoryForOrg,
} from "@/lib/demo/seed";

describe("slice 15 shared inventory seed", () => {
  it("getSeedSharedInventoryRows returns 3 partner-org rows", () => {
    const rows = getSeedSharedInventoryRows();
    expect(rows.map((r) => r.id).sort()).toEqual([601, 602, 603]);
    for (const r of rows) {
      expect(r.visibilityCircleId).toBe(DEMO_TRUSTED_PARTNERS_CIRCLE_ID);
      // No AIYA-owned rows in the partner seed — Option A in spec §6.2.
      expect(r.orgId).not.toBe(DEMO_AIYA_ORG_ID);
      // Honest "demo · simulated" provenance.
      expect(r.name).toMatch(/demo · simulated/);
    }
  });

  it("getSeedSharedInventoryForOrg(AIYA) returns the 3 partner rows", () => {
    const rows = getSeedSharedInventoryForOrg(DEMO_AIYA_ORG_ID);
    expect(rows.length).toBe(3);
  });

  it("getSeedSharedInventoryForOrg(999) returns [] (no circle memberships)", () => {
    expect(getSeedSharedInventoryForOrg(999)).toEqual([]);
  });

  it("getSeedSharedInventoryForOrg(MEHTA) returns 2 rows (excludes own)", () => {
    const rows = getSeedSharedInventoryForOrg(DEMO_PARTNER_ORG_IDS.MEHTA);
    // 601 is Mehta's own item — excluded by ne(orgId).
    expect(rows.map((r) => r.id).sort()).toEqual([602, 603]);
  });
});

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

import { DEMO_INVENTORY_BIDS, getSeedInventoryBidModes } from "@/lib/demo/seed";

describe("slice 18 demo seed: DEMO_INVENTORY_BIDS", () => {
  it("exposes 3 pending bids from AIYA on items 601 + 602 + 603 (slice 18b)", () => {
    expect(DEMO_INVENTORY_BIDS).toHaveLength(3);
    expect(DEMO_INVENTORY_BIDS.every((b) => b.bidderOrgId === DEMO_AIYA_ORG_ID)).toBe(true);
    expect(DEMO_INVENTORY_BIDS.map((b) => b.inventoryItemId).sort()).toEqual([601, 602, 603]);
    expect(DEMO_INVENTORY_BIDS.every((b) => b.status === "pending")).toBe(true);
  });

  it("getSeedInventoryBidModes: 601 single, 602 history, 603 history (slice 18b)", () => {
    const modes = getSeedInventoryBidModes();
    expect(modes.get(601)).toBe("single");
    expect(modes.get(602)).toBe("history");
    expect(modes.get(603)).toBe("history");
  });

  it("getSeedSharedInventoryForOrg threads bidMode through to AIYA's view", () => {
    const rows = getSeedSharedInventoryForOrg(DEMO_AIYA_ORG_ID);
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.id, r.bidMode]));
    expect(byId.get(601)).toBe("single");
    expect(byId.get(602)).toBe("history");
    expect(byId.get(603)).toBe("history");
  });

  it("every DEMO_INVENTORY_BIDS item has a non-null bid mode (fixture consistency)", () => {
    const modes = getSeedInventoryBidModes();
    for (const bid of DEMO_INVENTORY_BIDS) {
      expect(modes.get(bid.inventoryItemId)).not.toBeNull();
    }
  });

  it("every DEMO_INVENTORY_BIDS entry has a positive integer quantityRequested (slice 18b)", () => {
    for (const b of DEMO_INVENTORY_BIDS) {
      expect(b.quantityRequested).toBeGreaterThan(0);
      expect(Number.isInteger(b.quantityRequested)).toBe(true);
    }
  });

  it("the slice-18b item-603 bid is 5 units (partial-fill demo)", () => {
    const b603 = DEMO_INVENTORY_BIDS.find((b) => b.inventoryItemId === 603);
    expect(b603?.quantityRequested).toBe(5);
  });
});

import {
  DEMO_CUSTOMERS,
  getSeedCustomersForOrg,
  getSeedCustomerById,
  DEMO_ACTIVITY,
  DEMO_WATCHLISTS,
} from "@/lib/demo/seed";
import { ACTIVITY_ENTITY_TYPES, ACTIVITY_VERBS } from "@/lib/activity/types";

describe("DEMO_CUSTOMERS — slice-22 authored seed", () => {
  it("ships between 8 and 12 customers, all on AIYA", () => {
    expect(DEMO_CUSTOMERS.length).toBeGreaterThanOrEqual(8);
    expect(DEMO_CUSTOMERS.length).toBeLessThanOrEqual(12);
    expect(DEMO_CUSTOMERS.every((c) => c.orgId === DEMO_AIYA_ORG_ID)).toBe(true);
  });

  it("has a mix of business-owned, individual, name-only, and external_ref rows", () => {
    expect(DEMO_CUSTOMERS.some((c) => c.businessName !== null)).toBe(true);
    expect(DEMO_CUSTOMERS.some((c) => c.businessName === null)).toBe(true);
    expect(
      DEMO_CUSTOMERS.some((c) => c.email === null && c.address === null),
    ).toBe(true);
    expect(DEMO_CUSTOMERS.some((c) => c.externalRef !== null)).toBe(true);
  });

  it("includes the canonical Mehta + Saint-Cloud anchors from the slice-22 spec", () => {
    const byName = new Map(DEMO_CUSTOMERS.map((c) => [c.name, c]));
    expect(byName.get("Priya Mehta")?.businessName).toBe("Mehta Diamonds Pvt Ltd");
    expect(byName.get("Jean-Marc Auclair")?.businessName).toBe("Saint-Cloud Atelier");
  });
});

describe("getSeedCustomersForOrg — demo-mode short-circuit", () => {
  it("filters by org (foreign orgs see []) and strips orgId from the view", () => {
    const aiya = getSeedCustomersForOrg(DEMO_AIYA_ORG_ID);
    expect(aiya.length).toBe(DEMO_CUSTOMERS.length);
    // CustomerView has no orgId field
    expect((aiya[0] as unknown as { orgId?: unknown }).orgId).toBeUndefined();
    expect(getSeedCustomersForOrg(99999)).toEqual([]);
  });

  it("free-text search matches against name/business/email/phone (case-insensitive)", () => {
    const hits = getSeedCustomersForOrg(DEMO_AIYA_ORG_ID, { search: "mehta" });
    expect(hits.some((c) => c.name === "Priya Mehta")).toBe(true);
    expect(getSeedCustomersForOrg(DEMO_AIYA_ORG_ID, { search: "+91" }).length).toBeGreaterThan(0);
  });

  it("sorts by name ASC", () => {
    const rows = getSeedCustomersForOrg(DEMO_AIYA_ORG_ID);
    const names = rows.map((r) => r.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

describe("getSeedCustomerById — demo-mode owner-only single fetch", () => {
  it("returns the row when org + id match", () => {
    const r = getSeedCustomerById(DEMO_AIYA_ORG_ID, 2201);
    expect(r?.name).toBe("Priya Mehta");
  });

  it("returns null for a foreign-org viewer (cross-org isolation)", () => {
    expect(getSeedCustomerById(99999, 2201)).toBeNull();
  });

  it("returns null for an id that doesn't exist", () => {
    expect(getSeedCustomerById(DEMO_AIYA_ORG_ID, 999999)).toBeNull();
  });
});

describe("DEMO_ACTIVITY (slice 24)", () => {
  it("has exactly 10 events", () => {
    expect(DEMO_ACTIVITY.length).toBe(10);
  });

  it("all events are scoped to DEMO_ORG_ID = 1", () => {
    for (const e of DEMO_ACTIVITY) {
      expect(e.orgId).toBe(1);
    }
  });

  it("all entityTypes are valid against the whitelist", () => {
    for (const e of DEMO_ACTIVITY) {
      expect(ACTIVITY_ENTITY_TYPES).toContain(e.entityType);
    }
  });

  it("all verbs are valid against the whitelist", () => {
    for (const e of DEMO_ACTIVITY) {
      expect(ACTIVITY_VERBS).toContain(e.verb);
    }
  });

  it("all summaries are within the 240-char cap", () => {
    for (const e of DEMO_ACTIVITY) {
      expect(e.summary.length).toBeGreaterThan(0);
      expect(e.summary.length).toBeLessThanOrEqual(240);
    }
  });

  it("ids are unique", () => {
    const ids = DEMO_ACTIVITY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("DEMO_WATCHLISTS (slice 25)", () => {
  it("has exactly 2 entries", () => {
    expect(DEMO_WATCHLISTS.length).toBe(2);
  });

  it("all entries are scoped to DEMO_ORG_ID = 1", () => {
    for (const w of DEMO_WATCHLISTS) {
      expect(w.orgId).toBe(1);
    }
  });

  it("all entityTypes are valid against the whitelist", () => {
    for (const w of DEMO_WATCHLISTS) {
      expect(ACTIVITY_ENTITY_TYPES).toContain(w.entityType);
    }
  });

  it("notify emails look like emails", () => {
    for (const w of DEMO_WATCHLISTS) {
      expect(w.notifyEmail).toContain("@");
    }
  });

  it("ids are unique", () => {
    const ids = DEMO_WATCHLISTS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
