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
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const orgs = pgTable(
  "orgs",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Slice C-1 (module-skeleton): identifies which vertical module this tenant
    // runs. NULL = "core only" tenant (bare command center, no jewelry-specific
    // UI). Non-NULL value is the registry key in src/modules/registry.ts (e.g.
    // "aiya-jewelry"). Validation happens at the app boundary (Zod) — the DB
    // stores raw text so a tenant can switch modules without DDL. See
    // docs/MODULES.md §6.1.
    moduleId: text("module_id"),
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

export const inventoryItems = pgTable(
  "inventory_items",
  {
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
    visibilityCircleId: integer("visibility_circle_id").references(
      () => circles.id,
      { onDelete: "set null" },
    ),
    bidMode: text("bid_mode", { enum: ["single", "history"] }), // NULLABLE — null = bidding off
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    visibilityCircleIdx: index("inventory_items_visibility_circle_idx")
      .on(t.visibilityCircleId, t.orgId)
      .where(sql`${t.visibilityCircleId} IS NOT NULL`),
  }),
);

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    businessName: text("business_name"),
    email: text("email"),
    phone: text("phone"),
    address: jsonb("address"),
    notes: text("notes"),
    externalRef: text("external_ref"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    orgCreatedIdx: index("customers_org_created_idx").on(t.orgId, t.createdAt.desc()),
    // Partial unique on external_ref so WinJewel import (slice 26) is idempotent.
    // Allows multiple NULL rows (direct-create customers); enforces uniqueness only
    // when external_ref is set.
    orgExternalRefUnique: uniqueIndex("customers_org_external_ref_unique")
      .on(t.orgId, t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
  }),
);

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

export const dealAttachments = pgTable(
  "deal_attachments",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    uploadedByOrgId: integer("uploaded_by_org_id")
      .notNull()
      .references(() => orgs.id),
    kind: text("kind", { enum: ["image", "cert"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    altText: text("alt_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    storageKeyUnique: uniqueIndex("deal_attachments_storage_key_unique").on(t.storageKey),
    dealKindCreatedIdx: index("deal_attachments_deal_kind_created_idx").on(
      t.dealId,
      t.kind,
      t.createdAt.asc(),
    ),
  }),
);

export const inventoryBids = pgTable(
  "inventory_bids",
  {
    id: serial("id").primaryKey(),
    inventoryItemId: integer("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    bidderOrgId: integer("bidder_org_id")
      .notNull()
      .references(() => orgs.id),
    bidderOrgLabel: text("bidder_org_label").notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    notes: text("notes"),
    // Slice 18b: quantity of units this bid is requesting. INTEGER NOT NULL
    // DEFAULT 1. The default preserves existing slice-18-seeded rows without
    // a data-fixup migration — they semantically interpret as "1 unit" which
    // matches the slice-18 mental model (every bid was implicitly singular).
    quantityRequested: integer("quantity_requested").notNull().default(1),
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
    itemCreatedIdx: index("inventory_bids_item_created_idx").on(
      t.inventoryItemId,
      t.createdAt.desc(),
    ),
    bidderCreatedIdx: index("inventory_bids_bidder_created_idx").on(
      t.bidderOrgId,
      t.createdAt.desc(),
    ),
    pendingByItemIdx: index("inventory_bids_pending_by_item_idx")
      .on(t.inventoryItemId, t.status)
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

export const activityEvents = pgTable(
  "activity_events",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    actor: text("actor"),                 // session.user label; NULL = system event
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    verb: text("verb").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload"),
    // mode:"date" is intentional — ActivityEvent.createdAt is typed as Date.
    // Other tables use the drizzle default (mode:"string"); align them in a
    // follow-up clean-up, not here.
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    orgCreatedIdx: index("activity_events_org_created_idx").on(
      t.orgId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    orgEntityIdx: index("activity_events_org_entity_idx").on(
      t.orgId,
      t.entityType,
      t.entityId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  }),
);

export const watchlists = pgTable(
  "watchlists",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(), // session.user who created the watch
    entityType: text("entity_type").notNull(), // whitelisted via ACTIVITY_ENTITY_TYPES
    entityId: integer("entity_id").notNull(),
    notifyEmail: text("notify_email").notNull(), // explicit recipient (v1 recipient model)
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true, mode: "date" }),
    // mode:"date" is intentional — ActivityEvent.createdAt is typed as Date.
    // Other tables use the drizzle default (mode:"string"); align them in a
    // follow-up clean-up, not here.
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    orgActorEntityUnique: uniqueIndex("watchlists_org_actor_entity_unique").on(
      t.orgId,
      t.actor,
      t.entityType,
      t.entityId,
    ),
    orgEntityIdx: index("watchlists_org_entity_idx").on(
      t.orgId,
      t.entityType,
      t.entityId,
    ),
  }),
);

export const customerHealthSnapshots = pgTable(
  "customer_health_snapshots",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // No FK: snapshots survive customer deletion (audit-adjacent history,
    // same rationale as activity_events.entity_id — entities can be deleted
    // while their historical rows must survive; defended-in-depth via the
    // org_id FK alone).
    customerId: integer("customer_id").notNull(),
    score: integer("score").notNull(),
    band: text("band").notNull(), // HealthBand union — src/lib/customers/healthScore.ts is the source of truth
    components: jsonb("components")
      .$type<{ recency: number; frequency: number; breadth: number }>()
      .notNull(),
    capturedOn: text("captured_on").notNull(), // UTC "YYYY-MM-DD" derived from the injected `now`
    // mode:"date" is intentional — ActivityEvent.createdAt is typed as Date.
    // Other tables use the drizzle default (mode:"string"); align them in a
    // follow-up clean-up, not here.
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    orgCustomerDayUnique: uniqueIndex("customer_health_snapshots_org_customer_day_unique").on(
      t.orgId,
      t.customerId,
      t.capturedOn,
    ),
    orgCustomerIdx: index("customer_health_snapshots_org_customer_idx").on(
      t.orgId,
      t.customerId,
      t.capturedOn.desc(),
    ),
  }),
);

export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgs.id),
    // No onDelete (no-action): the DB blocks deleting a customer that has
    // invoices — financial records are never allowed to dangle. The action
    // layer maps the resulting 23503 to a friendly message via
    // mapDbConstraintError (src/lib/actionErrors.ts).
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    invoiceNumber: text("invoice_number").notNull(), // editable; auto-suggested INV-YYYY-NNNN
    status: text("status", { enum: ["draft", "issued", "void"] }) // 'paid' added by slice 29
      .notNull()
      .default("draft"),
    // { name, businessName?, email?, address? } snapshot of the customer row
    // at save time (CustomerAddress shape — src/db/customers.ts — inside
    // `address`). Refreshed on every draft save; frozen at issue.
    billTo: jsonb("bill_to").notNull(),
    issueDate: text("issue_date"), // "YYYY-MM-DD", stamped by issueInvoice
    dueDate: text("due_date"), // "YYYY-MM-DD", operator-set
    currency: text("currency").notNull().default("USD"),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull().default(0), // basis points, 0..2500 (Zod-enforced)
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    notes: text("notes"), // ≤2000, Zod-enforced
    // Slice 28: sendInvoice stamps both on a real (non-simulated) send;
    // NULL until then. sentTo is the frozen recipient at send time — an
    // emailed invoice stays status "issued" (sending is not a status
    // change). Re-sending overwrites both.
    // mode:"date" is intentional — ActivityEvent.createdAt is typed as Date.
    // Other tables use the drizzle default (mode:"string"); align them in a
    // follow-up clean-up, not here.
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    sentTo: text("sent_to"),
    // mode:"date" is intentional — ActivityEvent.createdAt is typed as Date.
    // Other tables use the drizzle default (mode:"string"); align them in a
    // follow-up clean-up, not here.
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    orgNumberUnique: uniqueIndex("invoices_org_number_unique").on(
      t.orgId,
      t.invoiceNumber,
    ),
    orgStatusCreatedIdx: index("invoices_org_status_created_idx").on(
      t.orgId,
      t.status,
      t.createdAt.desc(),
    ),
    orgCustomerIdx: index("invoices_org_customer_idx").on(
      t.orgId,
      t.customerId,
    ),
  }),
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }), // child-ownership convention
    position: integer("position").notNull(), // 0-based render order
    description: text("description").notNull(), // 1..500, Zod-enforced
    quantity: integer("quantity").notNull().default(1), // 1..10000, Zod-enforced
    unitPriceCents: integer("unit_price_cents").notNull(), // 0..100_000_000 ($0..$1M), Zod-enforced
    lineTotalCents: integer("line_total_cents").notNull(), // quantity × unit_price, server-computed
  },
  (t) => ({
    invoicePositionIdx: index("invoice_items_invoice_position_idx").on(
      t.invoiceId,
      t.position,
    ),
  }),
);
