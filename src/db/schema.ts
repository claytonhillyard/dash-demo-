import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";

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
  orgId: integer("org_id").notNull().default(1), // 1 = AIYA; orgs table arrives with multi-tenant slice
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
    orgId: integer("org_id").notNull().default(1),
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
  orgId: integer("org_id").notNull().default(1),
  label: text("label").notNull(),
  kind: text("kind", { enum: ["fancy_diamond", "gem"] }).notNull(),
  pricePerCaratCents: integer("price_per_carat_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const diamondIndexHistory = pgTable("diamond_index_history", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().default(1),
  series: text("series").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  valueCents: integer("value_cents").notNull(),
});
