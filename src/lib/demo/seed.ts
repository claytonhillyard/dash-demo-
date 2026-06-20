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
