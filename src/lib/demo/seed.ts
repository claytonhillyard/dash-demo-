import type { InventorySummary } from "@/db/inventory";
import type { DiamondSummary } from "@/db/diamonds";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";
import type { DealRow } from "@/lib/deals/queries";

const COUNTS: Record<InventoryCategory, number> = {
  Rings: 1240, Necklaces: 980, Earrings: 870, Bracelets: 620, Pendants: 450,
  Chains: 320, "Watch Bands": 150, Diamonds: 2350, Gems: 1120,
};

export function seedInventorySummary(): InventorySummary {
  const counts = { ...COUNTS };
  const total = INVENTORY_CATEGORIES.reduce((n, c) => n + counts[c], 0);
  return { counts, total, updatedAt: new Date() };
}

export function seedDiamondSummary(): DiamondSummary {
  return {
    naturalIndex: { cents: 645320, change24hPct: -0.62 },
    labIndex: { cents: 103210, change24hPct: 2.16 },
    points: [
      { label: "Pink Diamond 1ct", kind: "fancy_diamond", cents: 1265000 },
      { label: "Blue Diamond 1ct", kind: "fancy_diamond", cents: 1825000 },
      { label: "Yellow Diamond 1ct", kind: "fancy_diamond", cents: 798000 },
      { label: "Emerald (per ct)", kind: "gem", cents: 210000 },
      { label: "Sapphire (per ct)", kind: "gem", cents: 160000 },
    ],
    updatedAt: new Date(),
  };
}

// Fixed reference instant so relative ages are deterministic across renders.
// (Real `getActiveDeals` runs against the DB; this only fires when isDemoMode().)
const DEMO_REF = new Date("2026-05-28T12:00:00Z").getTime();

// --- Slice 4 demo seed: circles + memberships + cross-circle deals ---
// Demo-only ids; never collide with shared-db test fixtures (1, 999, 888)
// or with prod org ids (which all live below ~500 in practice).

/** AIYA's seeded id in demo mode — same constant getCurrentOrgId returns. */
export const DEMO_AIYA_ORG_ID = 1;

/** The single demo circle. id=201 is high enough to never collide with
 *  shared-db fixtures and low enough to read as obviously seeded. */
export const DEMO_TRUSTED_PARTNERS_CIRCLE_ID = 201;

/** Demo-only partner org ids — they only exist in this file's mental model
 *  (the Netlify demo never boots pglite). 501 / 502 / 503 are visually
 *  distinct from the shared-db 888/999 range. */
export const DEMO_PARTNER_ORG_IDS = {
  MEHTA: 501,    // Mehta Diamonds — Mumbai
  SAINT_CLOUD: 502, // Saint-Cloud Gems — Geneva
  MARATHI: 503,  // Marathi Trading — Surat
} as const;

export interface SeedCircle {
  id: number;
  name: string;
  slug: string;
  ownerOrgId: number;
}

export function getSeedCircles(): SeedCircle[] {
  return [
    {
      id: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      name: "AIYA Trusted Partners",
      slug: "aiya-trusted-partners",
      ownerOrgId: DEMO_AIYA_ORG_ID,
    },
  ];
}

/** Demo membership graph: AIYA + 3 partner orgs all belong to circle 201. */
export function getSeedCircleIdsForOrg(orgId: number): number[] {
  const memberships: Record<number, number[]> = {
    [DEMO_AIYA_ORG_ID]: [DEMO_TRUSTED_PARTNERS_CIRCLE_ID],
    [DEMO_PARTNER_ORG_IDS.MEHTA]: [DEMO_TRUSTED_PARTNERS_CIRCLE_ID],
    [DEMO_PARTNER_ORG_IDS.SAINT_CLOUD]: [DEMO_TRUSTED_PARTNERS_CIRCLE_ID],
    [DEMO_PARTNER_ORG_IDS.MARATHI]: [DEMO_TRUSTED_PARTNERS_CIRCLE_ID],
  };
  return memberships[orgId] ?? [];
}

export function getSeedDeals(): DealRow[] {
  return [
    // --- AIYA's original 5 deals (slice 2) — private (visibilityCircleId = null) ---
    {
      id: 101,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Diamond",
      subject: "Round 1.02ct G/VS1 natural — demo · simulated",
      quantity: 1,
      priceCents: 1240000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 2 * 3600 * 1000),
    },
    {
      id: 102,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "BUY",
      category: "Metal",
      subject: "18K gold chain lot, 10g per link — demo · simulated",
      quantity: 5,
      priceCents: 875000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 5 * 3600 * 1000),
    },
    {
      id: 103,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Gem",
      subject: "Colombian emerald 3.4ct, Gübelin cert — demo · simulated",
      quantity: 1,
      priceCents: 3400000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 26 * 3600 * 1000),
    },
    {
      id: 104,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Finished",
      subject: "Platinum diamond tennis bracelet — demo · simulated",
      quantity: 1,
      priceCents: 2250000,
      currency: "USD",
      status: "Filled",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 72 * 3600 * 1000),
    },
    {
      id: 105,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "BUY",
      category: "Diamond",
      subject: "Lab 2ct F/VVS2 any shape — demo · simulated",
      quantity: 3,
      priceCents: 620000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 15 * 60 * 1000),
    },
    // --- Slice 4 cross-circle demo deals (partner orgs into AIYA Trusted Partners) ---
    {
      id: 106,
      orgId: DEMO_PARTNER_ORG_IDS.MEHTA,
      kind: "SELL",
      category: "Diamond",
      subject: "Round 2.51ct E/VVS1 GIA — Mumbai cutting — demo · simulated",
      quantity: 1,
      priceCents: 4850000,
      currency: "USD",
      status: "Open",
      postedByLabel: "Mehta Diamonds — Mumbai",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      createdAt: new Date(DEMO_REF - 45 * 60 * 1000),
    },
    {
      id: 107,
      orgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD,
      kind: "SELL",
      category: "Gem",
      subject: "Cushion Padparadscha 1.8ct, AGL cert — Geneva consignment — demo · simulated",
      quantity: 1,
      priceCents: 7200000,
      currency: "USD",
      status: "Open",
      postedByLabel: "Saint-Cloud Gems — Geneva",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      createdAt: new Date(DEMO_REF - 90 * 60 * 1000),
    },
    {
      id: 108,
      orgId: DEMO_PARTNER_ORG_IDS.MARATHI,
      kind: "BUY",
      category: "Metal",
      subject: "Looking for 24K bullion, 1kg bars — demo · simulated",
      quantity: 10,
      priceCents: 9700000,
      currency: "USD",
      status: "Open",
      postedByLabel: "Marathi Trading — Surat",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      createdAt: new Date(DEMO_REF - 180 * 60 * 1000),
    },
  ];
}

/** Mirror of the real widened query for the demo runtime. Returns the union
 *  of {rows where orgId === viewer} and {rows whose visibilityCircleId is in
 *  one of the viewer's seeded circles}. */
export function getSeedDealsVisibleTo(orgId: number): DealRow[] {
  const circleIds = new Set(getSeedCircleIdsForOrg(orgId));
  return getSeedDeals().filter(
    (d) =>
      d.orgId === orgId ||
      (d.visibilityCircleId !== null && circleIds.has(d.visibilityCircleId)),
  );
}

// --- Slice 5 demo seed: weekly website KPI snapshots ---
import type { WebsiteSnapshotRow } from "@/db/website";

/** Deterministic reference week for the slice-5 demo. 2026-05-25 is a Monday.
 *  AIYA's 8 weeks span 2026-04-06 (Mon) through 2026-05-25 (Mon). */
const DEMO_WEBSITE_REF_WEEK = "2026-05-25T00:00:00Z";

function makeWeekStart(weeksAgo: number): string {
  const ref = new Date(DEMO_WEBSITE_REF_WEEK);
  ref.setUTCDate(ref.getUTCDate() - weeksAgo * 7);
  return ref.toISOString().slice(0, 10);
}

/** AIYA's seeded weekly snapshots: 8 weeks, gentle visible growth, realistic
 *  ranges for a small luxury-jewelry e-commerce site. Newest-first to match
 *  the DESC ordering of the real query. Demo-only ids in the 5000-range
 *  never collide with real serials (which start at 1 in shared-db). */
function seedAiyaSnapshots(): WebsiteSnapshotRow[] {
  const weeks: Array<Omit<WebsiteSnapshotRow, "id" | "orgId" | "createdAt" | "updatedAt">> = [
    { weekStart: makeWeekStart(0), visitors: 7820, uniqueVisitors: 5640, pageViews: 22130, avgSessionDurationSeconds: 215, bounceRatePercent: 38 },
    { weekStart: makeWeekStart(1), visitors: 7510, uniqueVisitors: 5390, pageViews: 21240, avgSessionDurationSeconds: 208, bounceRatePercent: 40 },
    { weekStart: makeWeekStart(2), visitors: 7080, uniqueVisitors: 5120, pageViews: 19880, avgSessionDurationSeconds: 196, bounceRatePercent: 41 },
    { weekStart: makeWeekStart(3), visitors: 6720, uniqueVisitors: 4940, pageViews: 18920, avgSessionDurationSeconds: 188, bounceRatePercent: 43 },
    { weekStart: makeWeekStart(4), visitors: 6510, uniqueVisitors: 4820, pageViews: 18120, avgSessionDurationSeconds: 184, bounceRatePercent: 44 },
    { weekStart: makeWeekStart(5), visitors: 6020, uniqueVisitors: 4490, pageViews: 16880, avgSessionDurationSeconds: 175, bounceRatePercent: 46 },
    { weekStart: makeWeekStart(6), visitors: 5720, uniqueVisitors: 4310, pageViews: 16210, avgSessionDurationSeconds: 168, bounceRatePercent: 48 },
    { weekStart: makeWeekStart(7), visitors: 5410, uniqueVisitors: 4120, pageViews: 15420, avgSessionDurationSeconds: 161, bounceRatePercent: 49 },
  ];
  return weeks.map((w, i) => ({
    id: 5000 + i,
    orgId: DEMO_AIYA_ORG_ID,
    ...w,
    createdAt: new Date(DEMO_REF),
    updatedAt: new Date(DEMO_REF - i * 86_400_000),
  }));
}

/** Mehta Diamonds (Mumbai) — 2 weeks. Smaller wholesale partner, half the
 *  traffic, longer sessions, slightly higher bounce. The contrast makes the
 *  multi-tenant story visible in the demo. Saint-Cloud and Marathi don't get
 *  website rows (spec: 2 orgs are sufficient). */
function seedMehtaSnapshots(): WebsiteSnapshotRow[] {
  const base: Array<Omit<WebsiteSnapshotRow, "id" | "orgId" | "createdAt" | "updatedAt">> = [
    { weekStart: makeWeekStart(0), visitors: 3140, uniqueVisitors: 2310, pageViews: 9820, avgSessionDurationSeconds: 195, bounceRatePercent: 52 },
    { weekStart: makeWeekStart(1), visitors: 2890, uniqueVisitors: 2150, pageViews: 9120, avgSessionDurationSeconds: 188, bounceRatePercent: 54 },
  ];
  return base.map((w, i) => ({
    id: 5100 + i,
    orgId: DEMO_PARTNER_ORG_IDS.MEHTA,
    ...w,
    createdAt: new Date(DEMO_REF),
    updatedAt: new Date(DEMO_REF - i * 86_400_000),
  }));
}

const ALL_DEMO_WEBSITE_ROWS: WebsiteSnapshotRow[] = [
  ...seedAiyaSnapshots(),
  ...seedMehtaSnapshots(),
];

/** All snapshots for an org, most-recent week first. Mirrors the real query
 *  signature so the demo shape is interchangeable with the DB shape. */
export function getSeedWebsiteSnapshots(orgId: number): WebsiteSnapshotRow[] {
  return ALL_DEMO_WEBSITE_ROWS
    .filter((r) => r.orgId === orgId)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

export function getSeedLatestWebsiteSnapshot(orgId: number): WebsiteSnapshotRow | null {
  return getSeedWebsiteSnapshots(orgId)[0] ?? null;
}

export function getSeedWebsiteSnapshotTrend(
  orgId: number,
  n: number = 8,
): WebsiteSnapshotRow[] {
  return getSeedWebsiteSnapshots(orgId).slice(0, n);
}
