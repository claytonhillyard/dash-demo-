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

const hoursAgo = (h: number) => new Date(DEMO_REF - h * 60 * 60 * 1000);

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
      threadMode: "private",
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
      threadMode: "private",
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
      threadMode: "private",
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
      threadMode: "private",
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
      threadMode: "private",
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
      threadMode: "private",
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
      threadMode: "private",
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
      threadMode: "private",
      createdAt: new Date(DEMO_REF - 180 * 60 * 1000),
    },
    // --- Slice 10 demo deals: AIYA -> circle, used to seed thread examples ---
    // TODO(slice-10 review): plan also lists `updatedAt` on these entries; the
    // current `DealRow` shape (mirrors the slice-2/4 seed) has no updatedAt
    // field, so it's omitted here. Carry over if/when the type grows one.
    {
      id: 109,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Diamond",
      subject: "1.02ct G/VS1 round — natural — demo · simulated",
      quantity: 1,
      priceCents: 1_240_000,
      currency: "USD",
      status: "Open",
      postedByLabel: "AIYA",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      threadMode: "private",
      createdAt: hoursAgo(6),
    },
    {
      id: 110,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Metal",
      subject: "18k chain lot — 320g — demo · simulated",
      quantity: 320,
      priceCents: 28_800_000,
      currency: "USD",
      status: "Open",
      postedByLabel: "AIYA",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      threadMode: "group",
      createdAt: hoursAgo(3),
    },
  ];
}

// --- Slice 10 seed messages for deals 109/110 ---
export interface SeedDealMessage {
  dealId: number;
  fromOrgId: number;
  fromOrgLabel: string;
  body: string;
  threadMode: "private" | "group";
  createdAtOffsetMinutes: number; // minutes before DEMO_REF "now"
}

export const DEMO_DEAL_MESSAGES: SeedDealMessage[] = [
  // Deal 109 — private thread between AIYA and Mehta
  {
    dealId: 109,
    fromOrgId: DEMO_PARTNER_ORG_IDS.MEHTA,
    fromOrgLabel: "Mehta Diamonds",
    body: "Still available? Can do $12,100 today, cash on pickup.",
    threadMode: "private",
    createdAtOffsetMinutes: 90,
  },
  {
    dealId: 109,
    fromOrgId: DEMO_AIYA_ORG_ID,
    fromOrgLabel: "AIYA Designs",
    body: "Yes, available. Can meet $12,250 today. Photos already match what's posted.",
    threadMode: "private",
    createdAtOffsetMinutes: 60,
  },
  // Deal 110 — group thread visible to AIYA + all Trusted Partners
  {
    dealId: 110,
    fromOrgId: DEMO_PARTNER_ORG_IDS.MEHTA,
    fromOrgLabel: "Mehta Diamonds",
    body: "Interested. Where are you shipping from?",
    threadMode: "group",
    createdAtOffsetMinutes: 45,
  },
  {
    dealId: 110,
    fromOrgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD,
    fromOrgLabel: "Saint-Cloud Atelier",
    body: "Same question. Lead time?",
    threadMode: "group",
    createdAtOffsetMinutes: 30,
  },
  {
    dealId: 110,
    fromOrgId: DEMO_AIYA_ORG_ID,
    fromOrgLabel: "AIYA Designs",
    body: "Ships from Bandra. Same-day pickup or 2-day courier. Both partners welcome.",
    threadMode: "group",
    createdAtOffsetMinutes: 15,
  },
];

// TODO(slice-10 review): plan's C1 Step 4 wires DEMO_DEAL_MESSAGES through a
// `db.insert(dealMessages).values(...)` runner. This codebase's demo seed is a
// pure-TS in-memory module (no runner inserts into pglite/Neon for demo mode —
// `isDemoMode()` short-circuits at the query layer). The DB query helpers
// `getDealMessages` / `getUnreadCountsForOrg` already return `[]` / empty Map
// in demo mode, so the seeded messages above are an authored constant exposed
// to any future demo-mode UI shim. If a real demo runner is ever added, this
// constant is the source.

// --- Slice 16 demo seed: authored-only bid examples ---
// See the comment above DEMO_DEAL_MESSAGES — this is also a TS constant,
// not actually inserted at runtime. The query layer short-circuits in demo
// mode. If a real demo runner is ever added, this is the source.
export type SeedBid = {
  dealId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  bidMode: "single" | "history";
  status: "pending";
  createdAtOffsetMinutes: number;
};

export const DEMO_BIDS: SeedBid[] = [
  {
    dealId: 109,
    bidderOrgId: DEMO_PARTNER_ORG_IDS.MEHTA,
    bidderOrgLabel: "Mehta Diamonds",
    priceCents: 12_300_00,
    currency: "USD",
    notes: "Can pick up today, cash.",
    bidMode: "single",
    status: "pending",
    createdAtOffsetMinutes: 25,
  },
  {
    dealId: 110,
    bidderOrgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD,
    bidderOrgLabel: "Saint-Cloud Atelier",
    priceCents: 89_500_00,
    currency: "USD",
    notes: "Spot price + 2%, 2-day courier.",
    bidMode: "single",
    status: "pending",
    createdAtOffsetMinutes: 10,
  },
];

// --- Slice 17 demo seed: authored-only attachment examples ---
// Same pattern as DEMO_DEAL_MESSAGES / DEMO_BIDS — TS constants, not
// inserted at runtime. The query layer short-circuits demo mode and the
// RSC stitches these directly into the carousel via their publicCdnUrl.
export type SeedDealAttachment = {
  id: number;                    // synthetic id (not from a real serial)
  dealId: number;
  uploadedByOrgId: number;
  kind: "image" | "cert";
  publicCdnUrl: string;
  mimeType: string;
  altText: string | null;
  createdAtOffsetMinutes: number;
};

export const DEMO_DEAL_ATTACHMENTS: SeedDealAttachment[] = [
  {
    id: 1701,
    dealId: 109,
    uploadedByOrgId: DEMO_AIYA_ORG_ID,
    kind: "image",
    publicCdnUrl: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=400",
    mimeType: "image/jpeg",
    altText: "1.02ct G/VS1 round diamond, top view, daylight",
    createdAtOffsetMinutes: 120,
  },
  {
    id: 1702,
    dealId: 109,
    uploadedByOrgId: DEMO_AIYA_ORG_ID,
    kind: "image",
    publicCdnUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=400",
    mimeType: "image/jpeg",
    altText: "1.02ct G/VS1 round diamond, side view, studio light",
    createdAtOffsetMinutes: 115,
  },
  {
    id: 1703,
    dealId: 110,
    uploadedByOrgId: DEMO_AIYA_ORG_ID,
    kind: "image",
    publicCdnUrl: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=400",
    mimeType: "image/jpeg",
    altText: "18k gold chain lot, fanned display",
    createdAtOffsetMinutes: 90,
  },
];

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
