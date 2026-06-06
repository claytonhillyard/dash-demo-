import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  jsonb,
  unique,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

export const orgs = pgTable(
  "orgs",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUniq: unique("orgs_slug_uniq").on(t.slug),
  })
);

export const circles = pgTable(
  "circles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ownerOrgId: integer("owner_org_id").notNull().references(() => orgs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUniq: unique("circles_slug_uniq").on(t.slug),
    ownerIdx: index("circles_owner_org_idx").on(t.ownerOrgId),
  })
);

export const circleMembers = pgTable(
  "circle_members",
  {
    id: serial("id").primaryKey(),
    circleId: integer("circle_id").notNull().references(() => circles.id),
    orgId: integer("org_id").notNull().references(() => orgs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    memberUniq: unique("circle_members_circle_org_uniq").on(t.circleId, t.orgId),
    orgIdx: index("circle_members_org_idx").on(t.orgId),
    circleIdx: index("circle_members_circle_idx").on(t.circleId),
  })
);

export const circleInvitations = pgTable(
  "circle_invitations",
  {
    id: serial("id").primaryKey(),
    circleId: integer("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    fromOrgId: integer("from_org_id")
      .notNull()
      .references(() => orgs.id),
    toOrgSlug: text("to_org_slug").notNull(),
    token: text("token").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "withdrawn", "expired"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => ({
    tokenUniq: unique("circle_invitations_token_uniq").on(t.token),
    // Partial UNIQUE: only one pending invite per (circle, target slug) at a time.
    // Historical accepted/declined/withdrawn rows do NOT occupy the index, so
    // re-invites after a non-pending response are allowed.
    pendingUniq: uniqueIndex("circle_invitations_pending_uniq")
      .on(t.circleId, t.toOrgSlug)
      .where(sql`${t.status} = 'pending'`),
    toSlugStatusIdx: index("circle_invitations_to_slug_status_idx")
      .on(t.toOrgSlug, t.status),
    fromOrgStatusIdx: index("circle_invitations_from_org_status_idx")
      .on(t.fromOrgId, t.status),
  }),
);

export const revenueMonths = pgTable(
  "revenue_months",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1..12
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ uniqYearMonth: unique("revenue_months_year_month_uniq").on(t.year, t.month) })
);

export const revenueTransactions = pgTable("revenue_transactions", {
  id: serial("id").primaryKey(),
  occurredOn: date("occurred_on").notNull(),
  amountCents: integer("amount_cents").notNull(),
  memo: text("memo"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const profitMonths = pgTable(
  "profit_months",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1..12
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ uniqYearMonth: unique("profit_months_year_month_uniq").on(t.year, t.month) })
);

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "prospect", "churned"] }).notNull(),
  valueCents: integer("value_cents").notNull().default(0),
  acquiredOn: date("acquired_on").notNull(), // business acquisition date (drives growth series)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  hiredOn: date("hired_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectionAssumptions = pgTable("projection_assumptions", {
  id: serial("id").primaryKey(),
  baseYear: integer("base_year").notNull(),
  baseRevenueCents: integer("base_revenue_cents").notNull(),
  cagrPct: integer("cagr_pct").notNull(), // whole-percent CAGR, e.g. 15 = 15%
  perYearOverrides: jsonb("per_year_overrides")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().default(1).references(() => orgs.id), // 1 = AIYA
  category: text("category", {
    enum: [
      "Rings", "Necklaces", "Earrings", "Bracelets", "Pendants",
      "Chains", "Watch Bands", "Diamonds", "Gems",
    ],
  }).notNull(),
  name: text("name").notNull(),
  sku: text("sku"),
  quantity: integer("quantity").notNull().default(1),
  status: text("status", { enum: ["in_stock", "reserved", "sold"] })
    .notNull()
    .default("in_stock"),
  unitCostCents: integer("unit_cost_cents").notNull().default(0),
  retailPriceCents: integer("retail_price_cents").notNull().default(0),
  metal: text("metal", { enum: ["gold", "silver", "platinum", "other"] }),
  weightMg: integer("weight_mg"),
  caratX100: integer("carat_x100"),
  cut: text("cut"),
  color: text("color"),
  clarity: text("clarity"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const diamondMatrixPrices = pgTable(
  "diamond_matrix_prices",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull().default(1).references(() => orgs.id), // 1 = AIYA
    sheet: text("sheet", { enum: ["natural", "lab"] }).notNull(),
    shape: text("shape", { enum: ["round", "fancy"] }).notNull(),
    color: text("color").notNull(),
    clarity: text("clarity").notNull(),
    caratBand: text("carat_band").notNull(),
    pricePerCaratCents: integer("price_per_carat_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqCell: unique("diamond_matrix_cell_uniq").on(
      t.orgId, t.sheet, t.shape, t.color, t.clarity, t.caratBand
    ),
  })
);

export const diamondPricePoints = pgTable("diamond_price_points", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().default(1).references(() => orgs.id), // 1 = AIYA
  label: text("label").notNull(),
  kind: text("kind", { enum: ["fancy_diamond", "gem"] }).notNull(),
  pricePerCaratCents: integer("price_per_carat_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const diamondIndexHistory = pgTable("diamond_index_history", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().default(1).references(() => orgs.id), // 1 = AIYA
  series: text("series").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  valueCents: integer("value_cents").notNull(),
});

export const deals = pgTable(
  "deals",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull().default(1).references(() => orgs.id), // 1 = AIYA
    kind: text("kind", { enum: ["BUY", "SELL"] }).notNull(),
    category: text("category", {
      enum: ["Diamond", "Gem", "Metal", "Finished", "Other"],
    }).notNull(),
    subject: text("subject").notNull(),
    quantity: integer("quantity").notNull().default(1),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status", { enum: ["Open", "Filled", "Withdrawn"] })
      .notNull()
      .default("Open"),
    postedByLabel: text("posted_by_label").notNull(),
    visibilityCircleId: integer("visibility_circle_id").references(
      () => circles.id,
      { onDelete: "set null" },
    ),
    threadMode: text("thread_mode", { enum: ["private", "group"] })
      .notNull()
      .default("private"),
    bidMode: text("bid_mode", { enum: ["single", "history"] })
      .notNull()
      .default("single"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgStatusCreatedIdx: index("deals_org_status_created_idx").on(
      t.orgId,
      t.status,
      t.createdAt.desc()
    ),
    orgKindIdx: index("deals_org_kind_idx").on(t.orgId, t.kind),
    orgCategoryIdx: index("deals_org_category_idx").on(t.orgId, t.category),
    // Partial index for the slice-4 widened OR clause: the visibility branch of
    // getActiveDeals / getAllDeals scans by visibility_circle_id IN (...) +
    // status filter + recent-first sort. Partial WHERE clause keeps the index
    // small (only deals shared with a circle ever appear here).
    visibilityCircleIdx: index("deals_visibility_circle_idx")
      .on(t.visibilityCircleId, t.status, t.createdAt.desc())
      .where(sql`${t.visibilityCircleId} IS NOT NULL`),
  })
);

export const dealMessages = pgTable(
  "deal_messages",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    fromOrgId: integer("from_org_id")
      .notNull()
      .references(() => orgs.id),
    fromOrgLabel: text("from_org_label").notNull(),
    body: text("body").notNull(),
    threadMode: text("thread_mode", { enum: ["private", "group"] }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    dealCreatedIdx: index("deal_messages_deal_created_idx").on(
      t.dealId,
      t.createdAt.desc(),
    ),
    fromOrgCreatedIdx: index("deal_messages_from_org_created_idx").on(
      t.fromOrgId,
      t.createdAt.desc(),
    ),
  }),
);

export const dealThreadReads = pgTable(
  "deal_thread_reads",
  {
    orgId: integer("org_id")
      .notNull()
      .references(() => orgs.id),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.dealId] }),
  }),
);

export const bids = pgTable(
  "bids",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    bidderOrgId: integer("bidder_org_id")
      .notNull()
      .references(() => orgs.id),
    bidderOrgLabel: text("bidder_org_label").notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    notes: text("notes"),
    bidMode: text("bid_mode", { enum: ["single", "history"] }).notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "rejected", "withdrawn", "auto_rejected"],
    })
      .notNull()
      .default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    dealCreatedIdx: index("bids_deal_created_idx").on(t.dealId, t.createdAt.desc()),
    bidderStatusIdx: index("bids_bidder_status_idx").on(t.bidderOrgId, t.status),
    pendingByDealIdx: index("bids_pending_by_deal_idx")
      .on(t.dealId, t.status)
      .where(sql`${t.status} = 'pending'`),
  }),
);

export const websiteSnapshots = pgTable(
  "website_snapshots",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull().default(1).references(() => orgs.id), // 1 = AIYA
    // Calendar week marker (date-only, no time component). Any valid YYYY-MM-DD
    // — the owner picks whatever day matches their analytics provider's week
    // boundary (US Sun→Sat or ISO Mon→Sun). The unique constraint below
    // enforces "one row per week" treating this value as canonical.
    weekStart: date("week_start").notNull(),
    // Range enforced at the Zod layer (>= 0); DB-level CHECK is deferred
    // (see slice 5 spec §2.6).
    visitors: integer("visitors").notNull(),
    uniqueVisitors: integer("unique_visitors").notNull(),
    pageViews: integer("page_views").notNull(),
    avgSessionDurationSeconds: integer("avg_session_duration_seconds").notNull(),
    // Range enforced at the Zod layer (0..100); DB-level CHECK is deferred.
    bounceRatePercent: integer("bounce_rate_percent").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgWeekUniq: unique("website_snapshots_org_week_uniq").on(t.orgId, t.weekStart),
    orgWeekIdx: index("website_snapshots_org_week_idx").on(t.orgId, t.weekStart.desc()),
  })
);
