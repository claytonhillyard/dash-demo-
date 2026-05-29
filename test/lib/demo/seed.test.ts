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
    const aiyaIds = deals.filter((d) => d.orgId === DEMO_AIYA_ORG_ID).map((d) => d.id);
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
    const aiya = deals.filter((d) => d.orgId === DEMO_AIYA_ORG_ID);
    for (const d of aiya) {
      expect(d.visibilityCircleId).toBeNull();
    }
  });
});

describe("getSeedDealsVisibleTo", () => {
  it("returns AIYA's private deals + cross-circle deals shared into circles AIYA is in", () => {
    const rows = getSeedDealsVisibleTo(DEMO_AIYA_ORG_ID);
    const ids = rows.map((d) => d.id).sort();
    expect(ids).toEqual([101, 102, 103, 104, 105, 106, 107, 108]);
  });

  it("an unseeded org sees no demo deals", () => {
    expect(getSeedDealsVisibleTo(9999)).toEqual([]);
  });
});
