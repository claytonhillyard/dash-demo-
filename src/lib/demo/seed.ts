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

// --- Slice 22 demo seed: authored-only customer book ---
// Same pattern as DEMO_DEAL_ATTACHMENTS — TS constants, not inserted at
// runtime. The customers query layer short-circuits demo mode and reads
// this constant filtered by orgId. Shape matches `CustomerView` from
// src/db/customers.ts so the table renders identically in demo and live.
//
// Mix is deliberate: business buyers with full address (Mehta, Saint-Cloud),
// individuals with partial address (Sharma), and name-only walk-ins (Patel,
// Klein). A handful carry `externalRef` to preview the slice-26 WinJewel
// import shape without yet exercising it.
import type { CustomerView } from "@/db/customers";
import type { ActivityEvent } from "@/lib/activity/types";

const DEMO_CUSTOMER_REF = new Date("2026-06-06T12:00:00Z").getTime();
const cmAgo = (days: number) =>
  new Date(DEMO_CUSTOMER_REF - days * 86_400_000);

type DemoCustomer = CustomerView & { orgId: number };

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    id: 2201,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Priya Mehta",
    businessName: "Mehta Diamonds Pvt Ltd",
    email: "priya@mehtadiamonds.in",
    phone: "+91 22 5555 1100",
    address: {
      street1: "12 Opera House",
      city: "Mumbai",
      state: "MH",
      zip: "400004",
      country: "IN",
    },
    notes: "Long-time wholesale partner; prefers wire transfer.",
    externalRef: "WJ-10421",
    firstSeenAt: cmAgo(420),
    createdAt: cmAgo(120),
    updatedAt: cmAgo(2),
  },
  {
    id: 2202,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Jean-Marc Auclair",
    businessName: "Saint-Cloud Atelier",
    email: "jm@saintcloud.fr",
    phone: "+33 1 42 60 11 22",
    address: {
      street1: "8 Rue de Rivoli",
      city: "Paris",
      zip: "75001",
      country: "FR",
    },
    notes: "Boutique buyer — small lots, high clarity grade.",
    externalRef: "WJ-10488",
    firstSeenAt: cmAgo(310),
    createdAt: cmAgo(90),
    updatedAt: cmAgo(5),
  },
  {
    id: 2203,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Anita Sharma",
    businessName: null,
    email: "anita.sharma@example.com",
    phone: "+1 415 555 0177",
    address: {
      street1: "1500 Fillmore St",
      city: "San Francisco",
      state: "CA",
      zip: "94115",
      country: "US",
    },
    notes: null,
    externalRef: null,
    firstSeenAt: cmAgo(180),
    createdAt: cmAgo(45),
    updatedAt: cmAgo(7),
  },
  {
    id: 2204,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Yuki Tanaka",
    businessName: "Ginza Pearl House",
    email: "y.tanaka@ginzapearl.jp",
    phone: "+81 3 3535 8800",
    address: {
      street1: "5-2-1 Ginza",
      city: "Tokyo",
      zip: "104-0061",
      country: "JP",
    },
    notes: "Repeat buyer of fancy yellow rounds, 0.7-1.2ct.",
    externalRef: "WJ-10502",
    firstSeenAt: cmAgo(240),
    createdAt: cmAgo(60),
    updatedAt: cmAgo(11),
  },
  {
    id: 2205,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Marcus Klein",
    businessName: null,
    email: null,
    phone: "+1 212 555 0913",
    address: null,
    notes: "Walk-in — bring up engagement ring options on next visit.",
    externalRef: null,
    firstSeenAt: null,
    createdAt: cmAgo(14),
    updatedAt: cmAgo(14),
  },
  {
    id: 2206,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Rohan Patel",
    businessName: null,
    email: "rohan.patel@example.com",
    phone: null,
    address: null,
    notes: null,
    externalRef: null,
    firstSeenAt: null,
    createdAt: cmAgo(9),
    updatedAt: cmAgo(9),
  },
  {
    id: 2207,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Sofia Russo",
    businessName: "Russo Goldsmiths",
    email: "sofia@russogoldsmiths.it",
    phone: "+39 02 7611 2200",
    address: {
      street1: "Via Montenapoleone 14",
      city: "Milan",
      state: "MI",
      zip: "20121",
      country: "IT",
    },
    notes: "Specializes in 22k bridal. Net-30 terms.",
    externalRef: "WJ-10560",
    firstSeenAt: cmAgo(200),
    createdAt: cmAgo(75),
    updatedAt: cmAgo(3),
  },
  {
    id: 2208,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Ahmed Al-Mansouri",
    businessName: "Al-Mansouri Trading",
    email: "ahmed@almansouri.ae",
    phone: "+971 4 555 2200",
    address: {
      street1: "Sheikh Zayed Rd, Tower 3",
      street2: "Suite 1810",
      city: "Dubai",
      country: "AE",
    },
    notes: "High-volume buyer; gold bars + investment grade.",
    externalRef: "WJ-10612",
    firstSeenAt: cmAgo(155),
    createdAt: cmAgo(50),
    updatedAt: cmAgo(1),
  },
  {
    id: 2209,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Elena Vargas",
    businessName: null,
    email: "elena.vargas@example.com",
    phone: "+34 91 555 4477",
    address: {
      city: "Madrid",
      country: "ES",
    },
    notes: "Custom commission — sapphire pendant due Q3.",
    externalRef: null,
    firstSeenAt: null,
    createdAt: cmAgo(30),
    updatedAt: cmAgo(4),
  },
  {
    id: 2210,
    orgId: DEMO_AIYA_ORG_ID,
    name: "James Whitford",
    businessName: "Whitford & Sons",
    email: "james@whitfordandsons.co.uk",
    phone: "+44 20 7946 0100",
    address: {
      street1: "12 Bond Street",
      city: "London",
      zip: "W1S 4RT",
      country: "GB",
    },
    notes: "Estate-jewelry house. Buys vintage diamond lots.",
    externalRef: "WJ-10677",
    firstSeenAt: cmAgo(95),
    createdAt: cmAgo(40),
    updatedAt: cmAgo(8),
  },
];

/** Demo-mode helper used by `getCustomers` — filters DEMO_CUSTOMERS by org
 *  and (optionally) by free-text search across name/business/email/phone.
 *  Mirrors the SQL's `ILIKE '%q%'` over the same four columns. */
export function getSeedCustomersForOrg(
  orgId: number,
  opts: { search?: string; limit?: number } = {},
): CustomerView[] {
  const search = opts.search?.trim().toLowerCase() ?? null;
  const limit = opts.limit ?? 50;
  const rows = DEMO_CUSTOMERS.filter((c) => c.orgId === orgId).filter((c) => {
    if (!search) return true;
    const haystacks = [c.name, c.businessName, c.email, c.phone].filter(
      (s): s is string => typeof s === "string",
    );
    return haystacks.some((s) => s.toLowerCase().includes(search));
  });
  rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  // strip the orgId before returning — CustomerView has no orgId field
  return rows.slice(0, limit).map(({ orgId: _o, ...view }) => view);
}

/** Demo-mode helper used by `getCustomerById` — null when the row doesn't
 *  exist OR exists in a different org (same contract as the SQL query). */
export function getSeedCustomerById(
  orgId: number,
  id: number,
): CustomerView | null {
  const row = DEMO_CUSTOMERS.find((c) => c.id === id && c.orgId === orgId);
  if (!row) return null;
  const { orgId: _o, ...view } = row;
  return view;
}

// --- Slice 24 demo seed: activity feed ---
// Same pattern as DEMO_CUSTOMERS — TS constant, not inserted at runtime.
// The activityEvents query layer short-circuits demo mode and returns these
// events filtered/sorted in-memory. Drives the ActivityPanel in slice 24c.
//
// 10 events on DEMO_ORG_ID, all entityType: "customer", staggered 2 hours
// apart over the past day. Mix of created/updated/deleted verbs.

/**
 * 10 authored activity events on DEMO_ORG_ID, all `entityType: "customer"`,
 * mix of created/updated/deleted, staggered 2 hours apart over the past
 * day. Drives the future ActivityPanel rendering in demo mode (slice 24c).
 *
 * Slice 24 ships the seed; slice 24c ships the panel.
 */
const NOW = new Date();
const HOURS_AGO = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

export const DEMO_ACTIVITY: ActivityEvent[] = [
  { id: 9001, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2201, verb: "created", summary: "Added Priya Mehta",          payload: { name: "Priya Mehta", businessName: "Mehta Diamonds Pvt Ltd" },     createdAt: HOURS_AGO(22) },
  { id: 9002, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2202, verb: "created", summary: "Added Jean-Marc Auclair",    payload: { name: "Jean-Marc Auclair", businessName: "Saint-Cloud Atelier" },  createdAt: HOURS_AGO(20) },
  { id: 9003, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2203, verb: "created", summary: "Added Anita Sharma",         payload: { name: "Anita Sharma", businessName: null },                        createdAt: HOURS_AGO(18) },
  { id: 9004, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2204, verb: "created", summary: "Added Yuki Tanaka",          payload: { name: "Yuki Tanaka", businessName: "Ginza Pearl House" },          createdAt: HOURS_AGO(16) },
  { id: 9005, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2201, verb: "updated", summary: "Updated Priya Mehta",        payload: { changedFields: ["email"] },                                        createdAt: HOURS_AGO(14) },
  { id: 9006, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2205, verb: "created", summary: "Added Marcus Klein",         payload: { name: "Marcus Klein", businessName: null },                        createdAt: HOURS_AGO(12) },
  { id: 9007, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2206, verb: "created", summary: "Added Rohan Patel",          payload: { name: "Rohan Patel", businessName: null },                         createdAt: HOURS_AGO(10) },
  { id: 9008, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2207, verb: "created", summary: "Added Sofia Russo",          payload: { name: "Sofia Russo", businessName: "Russo Goldsmiths" },           createdAt: HOURS_AGO(8) },
  { id: 9009, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2202, verb: "updated", summary: "Updated Jean-Marc Auclair",  payload: { changedFields: ["phone", "address"] },                             createdAt: HOURS_AGO(6) },
  { id: 9010, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 9999, verb: "deleted", summary: "Deleted Test Account",       payload: { name: "Test Account" },                                            createdAt: HOURS_AGO(2) },
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

// --- Slice 4c demo seed: pending invite + owned-circle helper ---

/** Demo-only org id for the recipient of the seeded pending invite.
 *  Outside the slice-4 partner range (501-503), high enough to read as
 *  fixture-only. The org itself does NOT exist in any membership graph —
 *  the recipient is, by definition, "not yet a member". */
export const DEMO_ARGYLE_ORG_ID = 504;

export interface SeedInvitation {
  id: number;
  circleId: number;
  circleName: string;
  fromOrgId: number;
  fromOrgName: string;
  toOrgSlug: string;
  /** Static demo token — never produced by crypto.randomUUID() in demo mode.
   *  The demo UI never displays the token (same as real invites). */
  token: string;
  status: "pending";
  createdAt: Date;
  expiresAt: Date;
}

const DEMO_INVITE_ID = 301;
// Far enough in the future that the demo UI always shows the invite as
// pending (demo time is frozen at DEMO_REF for deals; this expiry sits
// 7 days after now() at module-eval — sufficient for any preview deploy).
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function getSeedPendingInvitesForOrg(orgId: number): SeedInvitation[] {
  if (orgId !== DEMO_AIYA_ORG_ID) return [];
  return [
    {
      id: DEMO_INVITE_ID,
      circleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      circleName: "AIYA Trusted Partners",
      fromOrgId: DEMO_AIYA_ORG_ID,
      fromOrgName: "AIYA Designs",
      toOrgSlug: "argyle-mining",
      token: "demo-static-token-do-not-display",
      status: "pending",
      createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS - 60 * 60 * 1000),
    },
  ];
}

export function getSeedOwnedCirclesForOrg(orgId: number): SeedCircle[] {
  if (orgId !== DEMO_AIYA_ORG_ID) return [];
  return getSeedCircles();
}

// --- Slice 15 demo seed: cross-circle inventory shared via Trusted Partners ---

const DEMO_INV_REF = new Date("2026-06-06T12:00:00Z").getTime();
const hAgo = (h: number) => new Date(DEMO_INV_REF - h * 60 * 60 * 1000);

export interface SeedSharedInventoryRow {
  id: number;
  orgId: number;
  ownerOrgLabel: string;
  category: InventoryCategory;
  name: string;
  quantity: number;
  status: "in_stock" | "reserved" | "sold";
  visibilityCircleId: number;
  bidMode: "single" | "history" | null; // slice 18
  updatedAt: Date;
}

/** Three partner-org inventory items, all shared with Trusted Partners. */
export function getSeedSharedInventoryRows(): SeedSharedInventoryRow[] {
  return [
    {
      id: 601,
      orgId: DEMO_PARTNER_ORG_IDS.MEHTA,
      ownerOrgLabel: "Mehta Diamonds — Mumbai",
      category: "Diamonds",
      name: "Round 2.51ct E/VVS1 GIA — Mumbai cutting — demo · simulated",
      quantity: 1,
      status: "in_stock",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      bidMode: null,
      updatedAt: hAgo(3),
    },
    {
      id: 602,
      orgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD,
      ownerOrgLabel: "Saint-Cloud Gems — Geneva",
      category: "Gems",
      name: "Cushion Padparadscha 1.8ct AGL cert — demo · simulated",
      quantity: 1,
      status: "in_stock",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      bidMode: null,
      updatedAt: hAgo(12),
    },
    {
      id: 603,
      orgId: DEMO_PARTNER_ORG_IDS.MARATHI,
      ownerOrgLabel: "Marathi Trading — Surat",
      category: "Diamonds",
      name: "Princess 1.05ct G/SI1 IGI parcel x 50 — demo · simulated",
      quantity: 50,
      status: "in_stock",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      bidMode: null,
      updatedAt: hAgo(30),
    },
  ];
}

/** Demo widening: rows visible to a given org via the seed circle graph,
 *  excluding the viewer's own rows. Mirrors the real getSharedInventoryForOrg
 *  shape — same WHERE clause logic, in-memory. */
export function getSeedSharedInventoryForOrg(orgId: number): SeedSharedInventoryRow[] {
  const circleIds = new Set(getSeedCircleIdsForOrg(orgId));
  if (circleIds.size === 0) return [];
  const modes = getSeedInventoryBidModes();
  return getSeedSharedInventoryRows()
    .filter((r) => r.orgId !== orgId && circleIds.has(r.visibilityCircleId))
    .map((r) => ({ ...r, bidMode: modes.get(r.id) ?? null }));
}

// --- Slice 18 demo seed: inventory bids + per-item bid-mode ---

export interface SeedInventoryBid {
  inventoryItemId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  // Slice 18b: how many units this bid is requesting. Defaults to 1 for
  // slice-18-vintage seeds (semantically singular bids on quantity-1 items).
  quantityRequested: number;
  status: "pending";
  createdAtOffsetMinutes: number;
}

/** Three pending bids from AIYA on partner items. The bids never enter
 *  pglite (the Netlify demo is in-memory); they exist as fixture data the
 *  eventual /exchange demo-shim can render. The real query
 *  getInventoryBidsForItem returns [] in demo mode per slice-16 convention;
 *  rendering them is the component's responsibility (consume the constant
 *  directly).
 *
 *  Slice 18b adds the item-603 partial-fill demo bid (5 of 50 units) so
 *  reviewers can see the new mechanic in the canned demo. */
export const DEMO_INVENTORY_BIDS: SeedInventoryBid[] = [
  {
    inventoryItemId: 601, // Mehta Round 2.51ct (slice 15 seed)
    bidderOrgId: DEMO_AIYA_ORG_ID,
    bidderOrgLabel: "AIYA Designs",
    priceCents: 168_500_00,
    currency: "USD",
    notes: "Firm. 7-day inspection window.",
    quantityRequested: 1,
    status: "pending",
    createdAtOffsetMinutes: 40,
  },
  {
    inventoryItemId: 602, // Saint-Cloud Cushion Padparadscha (slice 15 seed)
    bidderOrgId: DEMO_AIYA_ORG_ID,
    bidderOrgLabel: "AIYA Designs",
    priceCents: 42_000_00,
    currency: "USD",
    notes: null,
    quantityRequested: 1,
    status: "pending",
    createdAtOffsetMinutes: 12,
  },
  {
    inventoryItemId: 603, // Marathi Princess parcel (quantity 50)
    bidderOrgId: DEMO_AIYA_ORG_ID,
    bidderOrgLabel: "AIYA Designs",
    priceCents: 14_000_00,
    currency: "USD",
    notes: "Cherry-picking 5 stones from the parcel — please call to discuss.",
    quantityRequested: 5,
    status: "pending",
    createdAtOffsetMinutes: 75,
  },
];

/** Which seeded inventory items have bidding enabled, and in which mode.
 *  Item 601: single-bid mode (Mehta Round 2.51ct — one outstanding bid).
 *  Item 602: history mode (Saint-Cloud Padparadscha — owner sees a thread).
 *  Item 603: history mode — slice 18b's partial-fill demo (5-of-50 bid). */
export function getSeedInventoryBidModes(): Map<number, "single" | "history" | null> {
  return new Map<number, "single" | "history" | null>([
    [601, "single"],
    [602, "history"],
    [603, "history"],
  ]);
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

// --- Slice 25 demo seed: watchlists ---
// Same pattern as DEMO_ACTIVITY (TS constant, not inserted at runtime) —
// the watchlists query layer short-circuits demo mode and returns these
// rows filtered/sorted in-memory. 2 entries on DEMO_ORG_ID, both owned by
// the demo owner actor, watching customers 2201 and 2204 (both of which
// already have DEMO_ACTIVITY rows, so the demo story reads coherently:
// "the owner watches Priya Mehta and Yuki Tanaka"). Neither has been
// notified yet (lastNotifiedAt: null) — live alerts only fire once
// RESEND_API_KEY + EMAIL_FROM land (slice 25-4).
import type { WatchlistView } from "@/lib/watchlists/queries";

export type DemoWatchlist = WatchlistView & { orgId: number; actor: string };

export const DEMO_WATCHLISTS: DemoWatchlist[] = [
  {
    id: 9101,
    orgId: 1,
    actor: "owner@aiya.demo",
    entityType: "customer",
    entityId: 2201,
    notifyEmail: "owner@aiya.demo",
    lastNotifiedAt: null,
    createdAt: HOURS_AGO(4),
  },
  {
    id: 9102,
    orgId: 1,
    actor: "owner@aiya.demo",
    entityType: "customer",
    entityId: 2204,
    notifyEmail: "owner@aiya.demo",
    lastNotifiedAt: null,
    createdAt: HOURS_AGO(1),
  },
];

// --- Slice 38 demo seed: customer health snapshots (Anomaly Sentinel) ---
// Same pattern as DEMO_WATCHLISTS/DEMO_ACTIVITY — a TS constant, not
// inserted at runtime; captureHealthSnapshots() never runs in demo mode
// (spec §1), so this is the only source of snapshot history the demo trend
// line (slice 38-3) reads. 3 daily rows each for customers 2201 and 2204,
// built on HOURS_AGO (the same real-time helper DEMO_ACTIVITY uses) so the
// trend always reads as "recent" regardless of when the demo is viewed:
//   2201 (Priya Mehta) — trending UP, watch band throughout (55 -> 58 -> 61).
//   2204 (Yuki Tanaka) — embeds the anomaly this slice detects: healthy ->
//   healthy -> watch (72 -> 74 -> 63), the drop the trend line + sentinel
//   activity event narrate.
import type { HealthBand } from "@/lib/customers/healthScore";

type DemoHealthSnapshot = {
  id: number;
  orgId: number;
  customerId: number;
  score: number;
  band: HealthBand;
  components: { recency: number; frequency: number; breadth: number };
  capturedOn: string; // UTC "YYYY-MM-DD", derived from capturedAt
  capturedAt: Date;
};

/** `daysBack` days before demo "now" (built on HOURS_AGO — same real-time
 *  helper DEMO_ACTIVITY uses), as both the Date and its derived UTC day
 *  string, computed once so the two always agree. */
function snapshotDay(daysBack: number): { capturedAt: Date; capturedOn: string } {
  const capturedAt = HOURS_AGO(daysBack * 24);
  return { capturedAt, capturedOn: capturedAt.toISOString().slice(0, 10) };
}

export const DEMO_HEALTH_SNAPSHOTS: DemoHealthSnapshot[] = [
  // Priya Mehta (2201) — steady upward trend, watch band throughout.
  {
    id: 9201, orgId: 1, customerId: 2201, score: 55, band: "watch",
    components: { recency: 22, frequency: 20, breadth: 13 },
    ...snapshotDay(2),
  },
  {
    id: 9202, orgId: 1, customerId: 2201, score: 58, band: "watch",
    components: { recency: 24, frequency: 21, breadth: 13 },
    ...snapshotDay(1),
  },
  {
    id: 9203, orgId: 1, customerId: 2201, score: 61, band: "watch",
    components: { recency: 26, frequency: 22, breadth: 13 },
    ...snapshotDay(0),
  },
  // Yuki Tanaka (2204) — healthy -> healthy -> watch (embedded band drop).
  {
    id: 9204, orgId: 1, customerId: 2204, score: 72, band: "healthy",
    components: { recency: 34, frequency: 25, breadth: 13 },
    ...snapshotDay(2),
  },
  {
    id: 9205, orgId: 1, customerId: 2204, score: 74, band: "healthy",
    components: { recency: 35, frequency: 26, breadth: 13 },
    ...snapshotDay(1),
  },
  {
    id: 9206, orgId: 1, customerId: 2204, score: 63, band: "watch",
    components: { recency: 15, frequency: 28, breadth: 20 },
    ...snapshotDay(0),
  },
];

// --- Slice 27 demo seed: invoices ---
// Same pattern as DEMO_WATCHLISTS/DEMO_HEALTH_SNAPSHOTS — TS constants, not
// inserted at runtime; src/db/invoices.ts short-circuits demo mode and
// reads these filtered/sorted in-memory.
//
// 3 invoices on DEMO_AIYA_ORG_ID, one per lifecycle status, on customers
// 2201 (Priya Mehta / Mehta Diamonds) and 2204 (Yuki Tanaka / Ginza Pearl
// House) — both already carry DEMO_ACTIVITY + DEMO_HEALTH_SNAPSHOTS rows, so
// the demo story stays coherent. Stored totals below are computed BY HAND
// using the exact `computeTotals` formula (quantity * unitPriceCents per
// line, then `Math.round(subtotal * taxRateBps / 10000)`) — the seed
// integrity test in test/lib/demo/seed.test.ts imports the real helper and
// asserts equality, so any drift between a comment's arithmetic and the
// stored numbers fails loudly.
import type {
  InvoiceStatus,
  BillTo,
  InvoiceListRow,
  InvoiceItemRow,
  InvoiceDetail,
} from "@/db/invoices";
import type { PaymentRow } from "@/db/payments";

export type DemoInvoice = {
  id: number;
  orgId: number;
  customerId: number;
  invoiceNumber: string;
  status: InvoiceStatus;
  billTo: BillTo;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  sentTo: string | null;
};

export type DemoInvoiceItem = InvoiceItemRow & { invoiceId: number };

/** `daysAgo` days before demo "now" (negative = days in the future), as a
 *  UTC "YYYY-MM-DD" string — built on HOURS_AGO (the same real-time helper
 *  DEMO_ACTIVITY/DEMO_HEALTH_SNAPSHOTS use) so invoice dates always read as
 *  "current" regardless of when the demo is viewed. */
function invoiceDay(daysAgo: number): string {
  return HOURS_AGO(daysAgo * 24).toISOString().slice(0, 10);
}

const MEHTA_BILL_TO: BillTo = {
  name: "Priya Mehta",
  businessName: "Mehta Diamonds Pvt Ltd",
  email: "priya@mehtadiamonds.in",
  address: {
    street1: "12 Opera House",
    city: "Mumbai",
    state: "MH",
    zip: "400004",
    country: "IN",
  },
};

const TANAKA_BILL_TO: BillTo = {
  name: "Yuki Tanaka",
  businessName: "Ginza Pearl House",
  email: "y.tanaka@ginzapearl.jp",
  address: {
    street1: "5-2-1 Ginza",
    city: "Tokyo",
    zip: "104-0061",
    country: "JP",
  },
};

export const DEMO_INVOICES: DemoInvoice[] = [
  // Issued ~9 days ago, first of the three created — INV-2026-0001.
  {
    id: 9302,
    orgId: DEMO_AIYA_ORG_ID,
    customerId: 2204,
    invoiceNumber: "INV-2026-0001",
    status: "issued",
    billTo: TANAKA_BILL_TO,
    issueDate: invoiceDay(9),
    dueDate: invoiceDay(-21), // 30-day terms from issue
    currency: "USD",
    // items 9403-9405: 2,650,000 + 320,000 + 15,000 = 2,985,000
    subtotalCents: 2_985_000,
    taxRateBps: 0, // export sale
    taxCents: 0,
    totalCents: 2_985_000,
    notes: "Ships via insured courier from Tokyo; signature required on delivery.",
    createdAt: HOURS_AGO(9 * 24 + 4),
    updatedAt: HOURS_AGO(9 * 24),
    // Slice 28: the seeded "sent" example — emailed to the customer's own
    // address (bill_to snapshot) ~2 days ago. Sending doesn't change status;
    // this invoice is still "issued".
    sentAt: HOURS_AGO(2 * 24),
    sentTo: TANAKA_BILL_TO.email ?? null,
  },
  // Issued ~20 days ago, then voided ~5 days ago — INV-2026-0002.
  {
    id: 9303,
    orgId: DEMO_AIYA_ORG_ID,
    customerId: 2201,
    invoiceNumber: "INV-2026-0002",
    status: "void",
    billTo: MEHTA_BILL_TO,
    issueDate: invoiceDay(20),
    dueDate: invoiceDay(-10), // 30-day terms from issue
    currency: "USD",
    // items 9406-9408: 2,250,000 + 12,500 + 12,500 = 2,275,000
    subtotalCents: 2_275_000,
    taxRateBps: 825,
    // Math.round(2,275,000 * 825 / 10000) = Math.round(187,687.5) = 187,688
    taxCents: 187_688,
    totalCents: 2_462_688,
    notes: "Canceled — customer requested a different stone size. Rebooked as a new order.",
    createdAt: HOURS_AGO(20 * 24 + 5),
    updatedAt: HOURS_AGO(5 * 24),
    sentAt: null,
    sentTo: null,
  },
  // Still being drafted (created ~1 day ago, last touched 3h ago) — INV-2026-0003.
  {
    id: 9301,
    orgId: DEMO_AIYA_ORG_ID,
    customerId: 2201,
    invoiceNumber: "INV-2026-0003",
    status: "draft",
    billTo: MEHTA_BILL_TO,
    issueDate: null,
    dueDate: invoiceDay(-14),
    currency: "USD",
    // items 9401-9402: 1,240,000 + 8,500 = 1,248,500
    subtotalCents: 1_248_500,
    taxRateBps: 800,
    // 1,248,500 * 800 / 10000 = 99,880 exactly
    taxCents: 99_880,
    totalCents: 1_348_380,
    notes: null,
    createdAt: HOURS_AGO(1 * 24 + 3),
    updatedAt: HOURS_AGO(3),
    sentAt: null,
    sentTo: null,
  },
];

export const DEMO_INVOICE_ITEMS: DemoInvoiceItem[] = [
  // Invoice 9301 (draft, Priya Mehta)
  {
    id: 9401,
    invoiceId: 9301,
    position: 0,
    description: "18K Gold Solitaire Ring Setting — 1.02ct Round Diamond, G/VS1",
    quantity: 1,
    unitPriceCents: 1_240_000,
    lineTotalCents: 1_240_000,
  },
  {
    id: 9402,
    invoiceId: 9301,
    position: 1,
    description: "Ring sizing & rhodium polish",
    quantity: 1,
    unitPriceCents: 8_500,
    lineTotalCents: 8_500,
  },
  // Invoice 9302 (issued, Yuki Tanaka)
  {
    id: 9403,
    invoiceId: 9302,
    position: 0,
    description: "Fancy Yellow Round Diamond, 0.85ct, GIA certified",
    quantity: 1,
    unitPriceCents: 2_650_000,
    lineTotalCents: 2_650_000,
  },
  {
    id: 9404,
    invoiceId: 9302,
    position: 1,
    description: "18K Yellow Gold Setting — custom",
    quantity: 1,
    unitPriceCents: 320_000,
    lineTotalCents: 320_000,
  },
  {
    id: 9405,
    invoiceId: 9302,
    position: 2,
    description: "GIA Certification Fee",
    quantity: 1,
    unitPriceCents: 15_000,
    lineTotalCents: 15_000,
  },
  // Invoice 9303 (void, Priya Mehta)
  {
    id: 9406,
    invoiceId: 9303,
    position: 0,
    description: "Platinum Diamond Tennis Bracelet, 5.5ct total",
    quantity: 1,
    unitPriceCents: 2_250_000,
    lineTotalCents: 2_250_000,
  },
  {
    id: 9407,
    invoiceId: 9303,
    position: 1,
    description: "18K White Gold Huggie Hoops (pair)",
    quantity: 2,
    unitPriceCents: 6_250,
    lineTotalCents: 12_500,
  },
  {
    id: 9408,
    invoiceId: 9303,
    position: 2,
    description: "Insurance appraisal",
    quantity: 1,
    unitPriceCents: 12_500,
    lineTotalCents: 12_500,
  },
];

/** Demo-mode helper used by `getInvoices` — filters DEMO_INVOICES by org
 *  (+ optional status), newest first, mirroring the real query's shape. */
export function getSeedInvoicesForOrg(
  orgId: number,
  opts: { status?: InvoiceStatus; limit?: number } = {},
): InvoiceListRow[] {
  const limit = opts.limit ?? 50;
  const rows = DEMO_INVOICES.filter((inv) => inv.orgId === orgId)
    .filter((inv) => !opts.status || inv.status === opts.status)
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows.slice(0, limit).map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    billToName: inv.billTo.name,
    totalCents: inv.totalCents,
    currency: inv.currency,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    createdAt: inv.createdAt,
    sentAt: inv.sentAt,
    sentTo: inv.sentTo,
    // Slice 29: sum of DEMO_PAYMENTS on this invoice (org-scoped by the
    // getSeedPaymentsByInvoiceId filter, defined below in this file).
    paidCents: getSeedPaymentsByInvoiceId(orgId, inv.id).reduce(
      (sum, p) => sum + p.amountCents,
      0,
    ),
  }));
}

/** Demo-mode helper used by `getInvoiceById` — null when the row doesn't
 *  exist OR exists in a different org (same contract as the SQL query).
 *  Items come from DEMO_INVOICE_ITEMS, ordered by position. `payments` /
 *  `paidCents` / `balanceCents` (slice 29) mirror the real reader: payments
 *  come from DEMO_PAYMENTS via getSeedPaymentsByInvoiceId, paidCents is
 *  summed in JS from those rows, balanceCents = totalCents - paidCents. */
export function getSeedInvoiceById(orgId: number, id: number): InvoiceDetail | null {
  const inv = DEMO_INVOICES.find((i) => i.id === id && i.orgId === orgId);
  if (!inv) return null;
  const items = DEMO_INVOICE_ITEMS.filter((it) => it.invoiceId === id)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(({ invoiceId: _invoiceId, ...item }) => item);
  const payments = getSeedPaymentsByInvoiceId(orgId, id);
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  return {
    id: inv.id,
    customerId: inv.customerId,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    billTo: inv.billTo,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    subtotalCents: inv.subtotalCents,
    taxRateBps: inv.taxRateBps,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    notes: inv.notes,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    sentAt: inv.sentAt,
    sentTo: inv.sentTo,
    items,
    payments,
    paidCents,
    balanceCents: inv.totalCents - paidCents,
  };
}

// --- Slice 29 demo seed: payments ---
// Same pattern as DEMO_INVOICE_ITEMS — a TS constant, not inserted at
// runtime; src/db/payments.ts and src/db/invoices.ts short-circuit demo
// mode and read this filtered/sorted in-memory.
//
// Two payments on invoice 9302 (issued, Yuki Tanaka) — the only seeded
// invoice with payments, so it reads "Partial" (0 < paid < total). 9301
// (draft) and 9303 (void) get none. Amounts are integer fractions of 9302's
// SEEDED totalCents (Math.floor), never a hardcoded literal that would
// silently drift if 9302's items/totals ever change:
//   9501: card, Math.floor(totalCents * 0.4) — a deposit taken a few days
//     after issue, before the invoice was emailed (sentAt HOURS_AGO(2*24)).
//   9502: wire, Math.floor(totalCents * 0.2) — a second, more recent
//     payment, after the email went out.
// Sum is 60% of totalCents — comfortably < totalCents, so the integrity
// test (test/lib/demo/seed.test.ts) can assert "partial, never overpaid"
// without hand-computing the exact cents.
export type DemoPayment = PaymentRow & { orgId: number; invoiceId: number };

const PAYMENT_9302_TOTAL_CENTS = DEMO_INVOICES.find((inv) => inv.id === 9302)!.totalCents;

export const DEMO_PAYMENTS: DemoPayment[] = [
  {
    id: 9501,
    orgId: DEMO_AIYA_ORG_ID,
    invoiceId: 9302,
    amountCents: Math.floor(PAYMENT_9302_TOTAL_CENTS * 0.4),
    method: "card",
    receivedDate: invoiceDay(7),
    note: "Deposit via card, taken at order confirmation.",
    createdAt: HOURS_AGO(7 * 24),
  },
  {
    id: 9502,
    orgId: DEMO_AIYA_ORG_ID,
    invoiceId: 9302,
    amountCents: Math.floor(PAYMENT_9302_TOTAL_CENTS * 0.2),
    method: "wire",
    receivedDate: invoiceDay(1),
    note: null,
    createdAt: HOURS_AGO(1 * 24),
  },
];

/** Demo-mode helper used by `getPaymentsByInvoiceId` — filters DEMO_PAYMENTS
 *  by org + invoice, ordered receivedDate DESC then id DESC (same contract
 *  as the SQL query). Strips orgId/invoiceId before returning — PaymentRow
 *  has neither field (the caller already knows both). */
export function getSeedPaymentsByInvoiceId(orgId: number, invoiceId: number): PaymentRow[] {
  return DEMO_PAYMENTS.filter((p) => p.orgId === orgId && p.invoiceId === invoiceId)
    .slice()
    .sort((a, b) => b.receivedDate.localeCompare(a.receivedDate) || b.id - a.id)
    .map(({ orgId: _orgId, invoiceId: _invoiceId, ...row }) => row);
}
