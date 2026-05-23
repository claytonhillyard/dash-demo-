# Slice #2: Company Data Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Wire the dashboard's company numbers (revenue, profit, clients, employees, projections) to a real Postgres database with a full in-app Admin CRUD UI, and light up the Company Overview, Revenue Projections, and Company Growth Analytics panels with honest, owner-entered data.

**Architecture:** Drizzle ORM sits behind a single `getDb()` that selects pglite (in-process WASM Postgres, used for dev + tests when `DATABASE_URL` is unset) or Neon HTTP (prod, when `DATABASE_URL` is set). One schema file with Drizzle Kit migrations applied identically to both drivers. Mutations go through `"use server"` Server Actions with zod validation that re-assert the session; reads go through a pure data-access layer (`src/db/queries.ts`) consumed by server components.

**Tech Stack:** Drizzle ORM + Drizzle Kit, `@electric-sql/pglite` (dev/test), `@neondatabase/serverless` (prod), `zod` (validation), `recharts` (charts), on top of the existing Next.js 15 App Router + TypeScript + Tailwind + Vitest stack.

**Spec:** `docs/superpowers/specs/2026-05-18-ceo-command-center-slice-2-company-data-design.md`

---

## Conventions (apply to every task)

- The repo root path contains a space; always quote it in shell.
- Path alias `@/` maps to `src/` (see `tsconfig.json` + `vitest.config.ts`).
- Tests live under `test/` mirroring `src/`. **jsdom is the default test environment.** Tests that touch the DB or Server Actions (Node realm only — pglite + `next/headers`) MUST begin with the pragma comment `// @vitest-environment node` as the very first line, exactly as `test/lib/auth/session.test.ts` does.
- Money is always stored and computed as **integer cents**.
- Commit with the project identity and never bypass hooks:
  `git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "…"`
- Run a single test file with: `npm run test -- <path>`. Run the full suite with `npm run test`.

---

## Task 1: Install dependencies + Drizzle config + env

**Files:**
- Modify: `package.json`
- Create: `drizzle.config.ts`
- Modify: `.env.example`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Install pinned dependencies.** Run from the repo root:

```bash
npm install drizzle-orm@0.45.2 @electric-sql/pglite@0.4.5 @neondatabase/serverless@1.1.0 zod@4.4.3 recharts@3.8.1
```

- [ ] **Step 2: Install pinned dev dependencies.**

```bash
npm install -D drizzle-kit@0.31.10
```

- [ ] **Step 3: Verify `package.json` now contains the exact versions.** Open `package.json` and confirm the `dependencies` block includes `"drizzle-orm": "0.45.2"`, `"@electric-sql/pglite": "0.4.5"`, `"@neondatabase/serverless": "1.1.0"`, `"zod": "4.4.3"`, `"recharts": "3.8.1"`, and `devDependencies` includes `"drizzle-kit": "0.31.10"`. If npm wrote a caret range, edit each to the exact pinned version above and re-run `npm install` to refresh the lockfile.

- [ ] **Step 4: Add db scripts to `package.json`.** Edit the `"scripts"` block so it reads exactly:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
```

- [ ] **Step 5: Create `drizzle.config.ts`** at the repo root with this exact content:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/placeholder",
  },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 6: Add `DATABASE_URL` to `.env.example`.** The file currently ends after `TWELVEDATA_API_KEY=`. Append the trailing block so the full file reads:

```
SESSION_SECRET=change-me-to-a-long-random-string
DASHBOARD_USER=boss
DASHBOARD_PASSWORD=change-me
FINNHUB_API_KEY=
TWELVEDATA_API_KEY=
# Set to a Neon Postgres connection string in production.
# Leave UNSET in dev/test to use in-process pglite (WASM Postgres, no install).
DATABASE_URL=
```

- [ ] **Step 7: Make pglite happy under Vitest.** pglite ships a WASM file that Vite tries to optimize; exclude it so Node-realm tests load it natively. Edit `vitest.config.ts` to its exact new content:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true, setupFiles: ["./test/setup.ts"] },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
});
```

- [ ] **Step 8: Sanity check the install.** Run:

```bash
npm run build
```

Expected: a clean Next.js production build (no new files reference the new deps yet, so this just confirms the install did not break the existing app).

- [ ] **Step 9: Commit.**

```bash
git add package.json package-lock.json drizzle.config.ts .env.example vitest.config.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "chore(slice-2): add drizzle, pglite, neon, zod, recharts + db config"
```

---

## Task 2: Database schema

**Files:**
- Create: `src/db/schema.ts`
- Test: `test/db/schema.test.ts`

- [ ] **Step 1: Write the failing schema-shape test.** Create `test/db/schema.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as schema from "@/db/schema";

describe("db schema", () => {
  it("exports every table the spec section 3 requires", () => {
    expect(schema.revenueMonths).toBeDefined();
    expect(schema.revenueTransactions).toBeDefined();
    expect(schema.profitMonths).toBeDefined();
    expect(schema.clients).toBeDefined();
    expect(schema.employees).toBeDefined();
    expect(schema.projectionAssumptions).toBeDefined();
  });

  it("stores money as integer columns (cents), never floats", () => {
    expect(schema.revenueMonths.amountCents.dataType).toBe("number");
    expect(schema.revenueMonths.amountCents.columnType).toBe("PgInteger");
    expect(schema.clients.valueCents.columnType).toBe("PgInteger");
    expect(schema.projectionAssumptions.baseRevenueCents.columnType).toBe("PgInteger");
  });

  it("keeps client acquired_on separate from created_at", () => {
    expect(schema.clients.acquiredOn).toBeDefined();
    expect(schema.clients.createdAt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`@/db/schema` does not exist yet):

```bash
npm run test -- test/db/schema.test.ts
```

Expected: failure resolving the module `@/db/schema`.

- [ ] **Step 3: Create `src/db/schema.ts`** with this exact content:

```ts
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
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/db/schema.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 5: Commit.**

```bash
git add src/db/schema.ts test/db/schema.test.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): add company-data drizzle schema (money as cents)"
```

---

## Task 3: Generate the initial migration

**Files:**
- Create: `drizzle/0000_*.sql` and `drizzle/meta/*` (generated)

- [ ] **Step 1: Generate the migration from the schema.** Run:

```bash
npm run db:generate
```

Expected: drizzle-kit writes `drizzle/0000_<name>.sql` plus a `drizzle/meta/` folder containing `_journal.json` and `0000_snapshot.json`. (The exact `<name>` is auto-generated; that is fine.)

- [ ] **Step 2: Verify the SQL exists and creates all six tables.** Open the generated `drizzle/0000_*.sql` and confirm it contains `CREATE TABLE "revenue_months"`, `"revenue_transactions"`, `"profit_months"`, `"clients"`, `"employees"`, and `"projection_assumptions"`, and the two unique constraints on `(year, month)`. Do not hand-edit it.

- [ ] **Step 3: Commit the generated migration.**

```bash
git add drizzle
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): generate initial company-data migration"
```

---

## Task 4: Database client (`getDb()` + isolated test DB)

**Files:**
- Create: `src/db/client.ts`
- Test: `test/db/client.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/db/client.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { revenueMonths } from "@/db/schema";

describe("db client", () => {
  it("createTestDb gives an isolated, migrated pglite db", async () => {
    const a = await createTestDb();
    const b = await createTestDb();

    await a.db.insert(revenueMonths).values({ year: 2026, month: 1, amountCents: 100_00 });

    const aRows = await a.db.select().from(revenueMonths);
    const bRows = await b.db.select().from(revenueMonths);

    expect(aRows).toHaveLength(1);
    expect(aRows[0].amountCents).toBe(100_00);
    expect(bRows).toHaveLength(0); // isolation: b never saw a's write

    await a.close();
    await b.close();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`@/db/client` missing):

```bash
npm run test -- test/db/client.test.ts
```

Expected: module-resolution failure for `@/db/client`.

- [ ] **Step 3: Create `src/db/client.ts`** with this exact content. `getDb()` is a lazily-initialized singleton: Neon HTTP when `DATABASE_URL` is set, otherwise an in-memory pglite. `createTestDb()` always returns a fresh isolated pglite with the schema applied via `CREATE TABLE` (push), so tests never depend on the generated SQL filename:

```ts
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { neon } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type Db =
  | ReturnType<typeof drizzleNeon<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>;

const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS "revenue_months" (
  "id" serial PRIMARY KEY NOT NULL,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "amount_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "revenue_months_year_month_uniq" UNIQUE("year","month")
);
CREATE TABLE IF NOT EXISTS "revenue_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "occurred_on" date NOT NULL,
  "amount_cents" integer NOT NULL,
  "memo" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "profit_months" (
  "id" serial PRIMARY KEY NOT NULL,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "amount_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "profit_months_year_month_uniq" UNIQUE("year","month")
);
CREATE TABLE IF NOT EXISTS "clients" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL,
  "value_cents" integer DEFAULT 0 NOT NULL,
  "acquired_on" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "employees" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "hired_on" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "projection_assumptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "base_year" integer NOT NULL,
  "base_revenue_cents" integer NOT NULL,
  "cagr_pct" integer NOT NULL,
  "per_year_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
`;

let singleton: Db | null = null;

export function getDb(): Db {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (url) {
    singleton = drizzleNeon(neon(url), { schema });
  } else {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    // Best-effort local bootstrap so a fresh dev machine works without a manual migrate step.
    void client.exec(DDL);
    singleton = db;
  }
  return singleton;
}

/** Fresh, isolated, migrated in-memory pglite for a single test. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await client.exec(DDL);
  return { db, close: () => client.close() };
}

export { sql };
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/db/client.test.ts
```

Expected: 1 passing test confirming isolation.

- [ ] **Step 5: Commit.**

```bash
git add src/db/client.ts test/db/client.test.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): getDb() pglite/neon selector + isolated createTestDb"
```

---

## Task 5: Pure derived-metric helpers (no DB)

These are pure functions so projection/margin math is unit-testable without a database (spec section 4, section 7 Unit). The DB-backed query layer in Task 6 calls them.

**Files:**
- Create: `src/db/metrics.ts`
- Test: `test/db/metrics.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/db/metrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { operatingMarginPct, resolveMonthRevenue, projectFiveYears } from "@/db/metrics";

describe("operatingMarginPct", () => {
  it("computes profit / revenue as a percentage", () => {
    expect(operatingMarginPct(25_00, 100_00)).toBe(25);
  });
  it("guards divide-by-zero, returning null", () => {
    expect(operatingMarginPct(25_00, 0)).toBeNull();
  });
});

describe("resolveMonthRevenue (precedence rule, spec section 3.1)", () => {
  it("uses transaction sum when transactions exist", () => {
    expect(resolveMonthRevenue(99_00, [10_00, 20_00, 5_00])).toBe(35_00);
  });
  it("falls back to the manual bucket when no transactions", () => {
    expect(resolveMonthRevenue(99_00, [])).toBe(99_00);
  });
  it("is 0 when neither bucket nor transactions exist", () => {
    expect(resolveMonthRevenue(null, [])).toBe(0);
  });
});

describe("projectFiveYears (spec section 4)", () => {
  it("compounds base by cagr for 5 years", () => {
    const out = projectFiveYears(2026, 100_00, 10, {});
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ year: 2026, amountCents: 100_00 });
    expect(out[1]).toEqual({ year: 2027, amountCents: 110_00 });
    expect(out[2]).toEqual({ year: 2028, amountCents: 121_00 });
  });
  it("lets a per-year override win for that year only", () => {
    const out = projectFiveYears(2026, 100_00, 10, { "2028": 200_00 });
    expect(out[1].amountCents).toBe(110_00); // 2027 still computed
    expect(out[2]).toEqual({ year: 2028, amountCents: 200_00 }); // override
    expect(out[3].year).toBe(2029); // 2029 computed off compounded base, not the override
    expect(out[3].amountCents).toBe(133_10);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`@/db/metrics` missing):

```bash
npm run test -- test/db/metrics.test.ts
```

Expected: module-resolution failure for `@/db/metrics`.

- [ ] **Step 3: Create `src/db/metrics.ts`** with this exact content:

```ts
export interface ProjectionPoint {
  year: number;
  amountCents: number;
}

/** Operating margin as a whole-number percent, or null when revenue is 0 (divide-by-zero guard). */
export function operatingMarginPct(profitCents: number, revenueCents: number): number | null {
  if (revenueCents === 0) return null;
  return Math.round((profitCents / revenueCents) * 100);
}

/**
 * Revenue precedence (spec section 3.1): if a month has any transactions, its revenue is their sum;
 * otherwise it is the manual monthly bucket; otherwise 0.
 */
export function resolveMonthRevenue(
  bucketCents: number | null,
  transactionCentsList: number[]
): number {
  if (transactionCentsList.length > 0) {
    return transactionCentsList.reduce((sum, c) => sum + c, 0);
  }
  return bucketCents ?? 0;
}

/**
 * 5-year revenue projection (spec section 4): base x (1 + cagr)^n, with per-year overrides taking
 * precedence for any year explicitly set. Overrides do NOT alter the compounding baseline —
 * later non-overridden years still compound off the original base.
 */
export function projectFiveYears(
  baseYear: number,
  baseRevenueCents: number,
  cagrPct: number,
  perYearOverrides: Record<string, number>
): ProjectionPoint[] {
  const rate = cagrPct / 100;
  const out: ProjectionPoint[] = [];
  for (let n = 0; n < 5; n++) {
    const year = baseYear + n;
    const override = perYearOverrides[String(year)];
    const computed = Math.round(baseRevenueCents * Math.pow(1 + rate, n));
    out.push({ year, amountCents: override ?? computed });
  }
  return out;
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/db/metrics.test.ts
```

Expected: all assertions pass.

- [ ] **Step 5: Commit.**

```bash
git add src/db/metrics.ts test/db/metrics.test.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): pure metrics (margin, revenue precedence, projection)"
```

---

## Task 6: DB-backed query layer

**Files:**
- Create: `src/db/queries.ts`
- Test: `test/db/queries.test.ts`

- [ ] **Step 1: Write the failing integration test against pglite.** Create `test/db/queries.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import {
  revenueMonths,
  revenueTransactions,
  profitMonths,
  clients,
  employees,
  projectionAssumptions,
} from "@/db/schema";
import {
  getCurrentMonthRevenueCents,
  getCurrentMonthProfitCents,
  getCurrentOperatingMarginPct,
  getClientCounts,
  getEmployeeCount,
  getTrailingTwelveMonths,
  getProjection,
} from "@/db/queries";

const Y = 2026;
const M = 4; // a fixed "current" month for deterministic tests

describe("queries against pglite", () => {
  it("current revenue: transactions override the manual bucket (precedence)", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: Y, month: M, amountCents: 999_00 });
    await db.insert(revenueTransactions).values([
      { occurredOn: "2026-04-03", amountCents: 10_00, memo: "deal a" },
      { occurredOn: "2026-04-20", amountCents: 25_00, memo: "deal b" },
    ]);
    expect(await getCurrentMonthRevenueCents(db, Y, M)).toBe(35_00);
    await close();
  });

  it("current revenue: falls back to the manual bucket when no transactions", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: Y, month: M, amountCents: 250_00 });
    expect(await getCurrentMonthRevenueCents(db, Y, M)).toBe(250_00);
    await close();
  });

  it("profit + margin for the current month, with divide-by-zero guard", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: Y, month: M, amountCents: 100_00 });
    await db.insert(profitMonths).values({ year: Y, month: M, amountCents: 25_00 });
    expect(await getCurrentMonthProfitCents(db, Y, M)).toBe(25_00);
    expect(await getCurrentOperatingMarginPct(db, Y, M)).toBe(25);

    const { db: db2, close: close2 } = await createTestDb();
    await db2.insert(profitMonths).values({ year: Y, month: M, amountCents: 25_00 });
    expect(await getCurrentOperatingMarginPct(db2, Y, M)).toBeNull(); // no revenue
    await close();
    await close2();
  });

  it("client counts: active count + total", async () => {
    const { db, close } = await createTestDb();
    await db.insert(clients).values([
      { name: "A", status: "active", valueCents: 0, acquiredOn: "2026-01-01" },
      { name: "B", status: "active", valueCents: 0, acquiredOn: "2026-02-01" },
      { name: "C", status: "prospect", valueCents: 0, acquiredOn: "2026-03-01" },
      { name: "D", status: "churned", valueCents: 0, acquiredOn: "2025-12-01" },
    ]);
    expect(await getClientCounts(db)).toEqual({ active: 2, total: 4 });
    await close();
  });

  it("employee count", async () => {
    const { db, close } = await createTestDb();
    await db.insert(employees).values([
      { name: "E1", role: "eng", hiredOn: "2025-01-01" },
      { name: "E2", role: "ops", hiredOn: "2026-01-01" },
    ]);
    expect(await getEmployeeCount(db)).toBe(2);
    await close();
  });

  it("trailing 12 months: revenue + profit + clients-added by acquired_on", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: Y, month: M, amountCents: 500_00 });
    await db.insert(profitMonths).values({ year: Y, month: M, amountCents: 120_00 });
    await db.insert(clients).values([
      { name: "X", status: "active", valueCents: 0, acquiredOn: "2026-04-10" },
      { name: "Y", status: "active", valueCents: 0, acquiredOn: "2026-04-22" },
    ]);
    const series = await getTrailingTwelveMonths(db, Y, M);
    expect(series).toHaveLength(12);
    const last = series[11];
    expect(last).toMatchObject({
      year: Y,
      month: M,
      revenueCents: 500_00,
      profitCents: 120_00,
      clientsAdded: 2,
    });
    const first = series[0];
    expect(first).toMatchObject({ revenueCents: 0, profitCents: 0, clientsAdded: 0 });
    await close();
  });

  it("projection: returns null when no assumptions row exists", async () => {
    const { db, close } = await createTestDb();
    expect(await getProjection(db)).toBeNull();
    await close();
  });

  it("projection: compounds from the singleton assumptions row with overrides", async () => {
    const { db, close } = await createTestDb();
    await db.insert(projectionAssumptions).values({
      baseYear: 2026,
      baseRevenueCents: 100_00,
      cagrPct: 10,
      perYearOverrides: { "2028": 200_00 },
    });
    const out = await getProjection(db);
    expect(out).not.toBeNull();
    expect(out!.points).toHaveLength(5);
    expect(out!.points[2]).toEqual({ year: 2028, amountCents: 200_00 });
    expect(out!.updatedAt).toBeInstanceOf(Date);
    await close();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`@/db/queries` missing):

```bash
npm run test -- test/db/queries.test.ts
```

Expected: module-resolution failure for `@/db/queries`.

- [ ] **Step 3: Create `src/db/queries.ts`** with this exact content:

```ts
import { and, eq, sql, gte, lte, desc } from "drizzle-orm";
import type { Db } from "./client";
import {
  revenueMonths,
  revenueTransactions,
  profitMonths,
  clients,
  employees,
  projectionAssumptions,
} from "./schema";
import {
  operatingMarginPct,
  resolveMonthRevenue,
  projectFiveYears,
  type ProjectionPoint,
} from "./metrics";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First date and one-past-last date (YYYY-MM-DD) for a given year/month. */
function monthBounds(year: number, month: number): { start: string; nextStart: string } {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start: `${year}-${pad2(month)}-01`, nextStart: `${nextYear}-${pad2(nextMonth)}-01` };
}

async function bucketCentsFor(db: Db, year: number, month: number): Promise<number | null> {
  const rows = await db
    .select({ amountCents: revenueMonths.amountCents })
    .from(revenueMonths)
    .where(and(eq(revenueMonths.year, year), eq(revenueMonths.month, month)));
  return rows.length ? rows[0].amountCents : null;
}

async function txnCentsFor(db: Db, year: number, month: number): Promise<number[]> {
  const { start, nextStart } = monthBounds(year, month);
  const endInclusive = addDays(nextStart, -1);
  const rows = await db
    .select({ amountCents: revenueTransactions.amountCents })
    .from(revenueTransactions)
    .where(
      and(
        gte(revenueTransactions.occurredOn, start),
        lte(revenueTransactions.occurredOn, endInclusive)
      )
    );
  return rows.map((r) => r.amountCents);
}

export async function getCurrentMonthRevenueCents(
  db: Db,
  year: number,
  month: number
): Promise<number> {
  const [bucket, txns] = await Promise.all([
    bucketCentsFor(db, year, month),
    txnCentsFor(db, year, month),
  ]);
  return resolveMonthRevenue(bucket, txns);
}

export async function getCurrentMonthProfitCents(
  db: Db,
  year: number,
  month: number
): Promise<number> {
  const rows = await db
    .select({ amountCents: profitMonths.amountCents })
    .from(profitMonths)
    .where(and(eq(profitMonths.year, year), eq(profitMonths.month, month)));
  return rows.length ? rows[0].amountCents : 0;
}

export async function getCurrentOperatingMarginPct(
  db: Db,
  year: number,
  month: number
): Promise<number | null> {
  const [revenue, profit] = await Promise.all([
    getCurrentMonthRevenueCents(db, year, month),
    getCurrentMonthProfitCents(db, year, month),
  ]);
  return operatingMarginPct(profit, revenue);
}

export async function getClientCounts(db: Db): Promise<{ active: number; total: number }> {
  const rows = await db.select({ status: clients.status }).from(clients);
  const active = rows.filter((r) => r.status === "active").length;
  return { active, total: rows.length };
}

export async function getEmployeeCount(db: Db): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(employees);
  return rows[0]?.count ?? 0;
}

export interface MonthPoint {
  year: number;
  month: number;
  revenueCents: number;
  profitCents: number;
  clientsAdded: number;
}

/** Trailing 12 months ending at (year, month) inclusive — oldest first. */
export async function getTrailingTwelveMonths(
  db: Db,
  year: number,
  month: number
): Promise<MonthPoint[]> {
  const months: { year: number; month: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const total = year * 12 + (month - 1) - i;
    months.push({ year: Math.floor(total / 12), month: (total % 12) + 1 });
  }
  return Promise.all(
    months.map(async ({ year: y, month: m }) => {
      const { start, nextStart } = monthBounds(y, m);
      const endInclusive = addDays(nextStart, -1);
      const [revenueCents, profitCents, addedRows] = await Promise.all([
        getCurrentMonthRevenueCents(db, y, m),
        getCurrentMonthProfitCents(db, y, m),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(clients)
          .where(and(gte(clients.acquiredOn, start), lte(clients.acquiredOn, endInclusive))),
      ]);
      return {
        year: y,
        month: m,
        revenueCents,
        profitCents,
        clientsAdded: addedRows[0]?.count ?? 0,
      };
    })
  );
}

export interface Projection {
  points: ProjectionPoint[];
  updatedAt: Date;
}

export async function getProjection(db: Db): Promise<Projection | null> {
  const rows = await db
    .select()
    .from(projectionAssumptions)
    .orderBy(desc(projectionAssumptions.updatedAt))
    .limit(1);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    points: projectFiveYears(r.baseYear, r.baseRevenueCents, r.cagrPct, r.perYearOverrides),
    updatedAt: r.updatedAt,
  };
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/db/queries.test.ts
```

Expected: all query tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/db/queries.ts test/db/queries.test.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): db query layer (revenue precedence, margin, TTM, projection)"
```

---

## Task 7: Validation schemas (zod)

Pure zod schemas, unit-testable in isolation; reused by the Server Actions in Task 9.

**Files:**
- Create: `src/lib/company/validation.ts`
- Test: `test/lib/company/validation.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/lib/company/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  revenueMonthInput,
  revenueTransactionInput,
  profitMonthInput,
  clientInput,
  employeeInput,
  projectionInput,
} from "@/lib/company/validation";

describe("company validation", () => {
  it("accepts a valid revenue month", () => {
    const r = revenueMonthInput.safeParse({ year: 2026, month: 4, amountCents: 100_00 });
    expect(r.success).toBe(true);
  });
  it("rejects month out of 1..12", () => {
    expect(revenueMonthInput.safeParse({ year: 2026, month: 13, amountCents: 1 }).success).toBe(false);
    expect(revenueMonthInput.safeParse({ year: 2026, month: 0, amountCents: 1 }).success).toBe(false);
  });
  it("rejects non-integer cents", () => {
    expect(revenueMonthInput.safeParse({ year: 2026, month: 4, amountCents: 1.5 }).success).toBe(false);
  });
  it("requires a memo-optional transaction with an ISO date", () => {
    expect(
      revenueTransactionInput.safeParse({ occurredOn: "2026-04-01", amountCents: 5_00 }).success
    ).toBe(true);
    expect(
      revenueTransactionInput.safeParse({ occurredOn: "nope", amountCents: 5_00 }).success
    ).toBe(false);
  });
  it("validates profit month like revenue month", () => {
    expect(profitMonthInput.safeParse({ year: 2026, month: 4, amountCents: -5_00 }).success).toBe(true);
  });
  it("requires a client name and a valid status + acquiredOn", () => {
    expect(
      clientInput.safeParse({ name: "Acme", status: "active", valueCents: 0, acquiredOn: "2026-01-01" })
        .success
    ).toBe(true);
    expect(
      clientInput.safeParse({ name: "", status: "active", valueCents: 0, acquiredOn: "2026-01-01" })
        .success
    ).toBe(false);
    expect(
      clientInput.safeParse({ name: "Acme", status: "lead", valueCents: 0, acquiredOn: "2026-01-01" })
        .success
    ).toBe(false);
  });
  it("requires employee name, role, hiredOn", () => {
    expect(employeeInput.safeParse({ name: "E", role: "eng", hiredOn: "2025-01-01" }).success).toBe(true);
    expect(employeeInput.safeParse({ name: "E", role: "", hiredOn: "2025-01-01" }).success).toBe(false);
  });
  it("validates a projection assumptions input incl. per-year overrides", () => {
    expect(
      projectionInput.safeParse({
        baseYear: 2026,
        baseRevenueCents: 100_00,
        cagrPct: 15,
        perYearOverrides: { "2028": 200_00 },
      }).success
    ).toBe(true);
    expect(
      projectionInput.safeParse({
        baseYear: 2026,
        baseRevenueCents: 100_00,
        cagrPct: 15,
        perYearOverrides: { "2028": 1.5 },
      }).success
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`@/lib/company/validation` missing):

```bash
npm run test -- test/lib/company/validation.test.ts
```

Expected: module-resolution failure.

- [ ] **Step 3: Create `src/lib/company/validation.ts`** with this exact content:

```ts
import { z } from "zod";

const intCents = z.number().int();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const year = z.number().int().min(1900).max(3000);
const month = z.number().int().min(1).max(12);

export const revenueMonthInput = z.object({
  year,
  month,
  amountCents: intCents,
});
export type RevenueMonthInput = z.infer<typeof revenueMonthInput>;

export const revenueTransactionInput = z.object({
  occurredOn: isoDate,
  amountCents: intCents,
  memo: z.string().max(280).optional(),
});
export type RevenueTransactionInput = z.infer<typeof revenueTransactionInput>;

export const profitMonthInput = z.object({
  year,
  month,
  amountCents: intCents,
});
export type ProfitMonthInput = z.infer<typeof profitMonthInput>;

export const clientInput = z.object({
  name: z.string().min(1, "name is required").max(120),
  status: z.enum(["active", "prospect", "churned"]),
  valueCents: intCents.min(0),
  acquiredOn: isoDate,
});
export type ClientInput = z.infer<typeof clientInput>;

export const employeeInput = z.object({
  name: z.string().min(1, "name is required").max(120),
  role: z.string().min(1, "role is required").max(120),
  hiredOn: isoDate,
});
export type EmployeeInput = z.infer<typeof employeeInput>;

export const projectionInput = z.object({
  baseYear: year,
  baseRevenueCents: intCents.min(0),
  cagrPct: z.number().int().min(-100).max(1000),
  perYearOverrides: z.record(z.string(), intCents),
});
export type ProjectionInput = z.infer<typeof projectionInput>;

/** Flatten the first zod issue into a single human-readable message for the UI. */
export function firstZodError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/lib/company/validation.test.ts
```

Expected: all validation tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/company/validation.ts test/lib/company/validation.test.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): zod validation schemas for company data inputs"
```

---

## Task 8: Server-side session assertion helper

Server Actions must re-assert the session (spec section 2, defense in depth) by reading the `ccc_session` cookie and verifying it with the existing `verifySession`. We extract this so it is testable in the Node realm.

**Files:**
- Create: `src/lib/auth/requireSession.ts`
- Test: `test/lib/auth/requireSession.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/lib/auth/requireSession.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieStore = { value: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (cookieStore.value ? { name: n, value: cookieStore.value } : undefined),
  }),
}));

import { createSession } from "@/lib/auth/session";
import { requireSession } from "@/lib/auth/requireSession";

const SECRET = "test-secret-test-secret-test-secret";

describe("requireSession", () => {
  beforeEach(() => {
    cookieStore.value = undefined;
    process.env.SESSION_SECRET = SECRET;
  });

  it("returns the session user for a valid cookie", async () => {
    cookieStore.value = await createSession("boss", SECRET);
    expect(await requireSession()).toEqual({ user: "boss" });
  });

  it("throws when no cookie is present", async () => {
    await expect(requireSession()).rejects.toThrow(/unauthorized/i);
  });

  it("throws when the cookie is invalid", async () => {
    cookieStore.value = "garbage.token.value";
    await expect(requireSession()).rejects.toThrow(/unauthorized/i);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`@/lib/auth/requireSession` missing):

```bash
npm run test -- test/lib/auth/requireSession.test.ts
```

Expected: module-resolution failure.

- [ ] **Step 3: Create `src/lib/auth/requireSession.ts`** with this exact content:

```ts
import { cookies } from "next/headers";
import { verifySession } from "./session";

/** Re-assert the slice-0 session inside a Server Action. Throws "Unauthorized" if absent/invalid. */
export async function requireSession(): Promise<{ user: string }> {
  const token = (await cookies()).get("ccc_session")?.value;
  const session = token ? await verifySession(token, process.env.SESSION_SECRET!) : null;
  if (!session) throw new Error("Unauthorized");
  return session;
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/lib/auth/requireSession.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/requireSession.ts test/lib/auth/requireSession.test.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): requireSession helper for Server Action auth re-assertion"
```

---

## Task 9: Server Actions (CRUD)

Mutations live here (`"use server"`), validate with zod, re-assert the session, return `{ ok: true } | { ok: false; error }`, and `revalidatePath("/")` so the dashboard re-reads. To keep the round-trip tests fast and isolated, the action module reads its DB through `getDb()`; the test injects an isolated pglite by stubbing the module's `__setTestDb` hook.

**Files:**
- Create: `src/lib/company/actions.ts`
- Test: `test/lib/company/actions.test.ts`

- [ ] **Step 1: Write the failing round-trip test.** Create `test/lib/company/actions.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss" })),
}));

import { createTestDb } from "@/db/client";
import {
  saveRevenueMonth,
  addRevenueTransaction,
  saveProfitMonth,
  createClient,
  deleteClient,
  createEmployee,
  saveProjection,
  __setTestDb,
} from "@/lib/company/actions";
import { requireSession } from "@/lib/auth/requireSession";

let close: () => Promise<void>;

beforeEach(async () => {
  vi.clearAllMocks();
  const t = await createTestDb();
  await __setTestDb(t.db);
  close = t.close;
});

describe("company server actions", () => {
  it("saveRevenueMonth upserts the manual bucket", async () => {
    expect(await saveRevenueMonth({ year: 2026, month: 4, amountCents: 100_00 })).toEqual({ ok: true });
    expect(await saveRevenueMonth({ year: 2026, month: 4, amountCents: 250_00 })).toEqual({ ok: true });
    await close();
  });

  it("rejects invalid input with a typed error and no throw", async () => {
    const res = await saveRevenueMonth({ year: 2026, month: 99, amountCents: 1 });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error).toMatch(/month/);
    await close();
  });

  it("re-asserts the session and surfaces unauthorized as a typed error", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized")
    );
    const res = await createEmployee({ name: "E", role: "eng", hiredOn: "2025-01-01" });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    await close();
  });

  it("addRevenueTransaction inserts an itemized row", async () => {
    expect(await addRevenueTransaction({ occurredOn: "2026-04-03", amountCents: 5_00, memo: "x" })).toEqual({
      ok: true,
    });
    await close();
  });

  it("saveProfitMonth upserts profit", async () => {
    expect(await saveProfitMonth({ year: 2026, month: 4, amountCents: 25_00 })).toEqual({ ok: true });
    await close();
  });

  it("createClient + deleteClient round-trip", async () => {
    expect(
      await createClient({ name: "Acme", status: "active", valueCents: 0, acquiredOn: "2026-01-01" })
    ).toEqual({ ok: true });
    expect(await deleteClient(999_999)).toEqual({ ok: true }); // deleting a missing id is still ok
    await close();
  });

  it("createEmployee persists a row", async () => {
    expect(await createEmployee({ name: "E1", role: "eng", hiredOn: "2025-01-01" })).toEqual({ ok: true });
    await close();
  });

  it("saveProjection persists the singleton assumptions", async () => {
    expect(
      await saveProjection({
        baseYear: 2026,
        baseRevenueCents: 100_00,
        cagrPct: 12,
        perYearOverrides: { "2028": 200_00 },
      })
    ).toEqual({ ok: true });
    await close();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`@/lib/company/actions` missing):

```bash
npm run test -- test/lib/company/actions.test.ts
```

Expected: module-resolution failure.

- [ ] **Step 3: Create `src/lib/company/actions.ts`** with this exact content:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import {
  revenueMonths,
  revenueTransactions,
  profitMonths,
  clients,
  employees,
  projectionAssumptions,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import {
  revenueMonthInput,
  revenueTransactionInput,
  profitMonthInput,
  clientInput,
  employeeInput,
  projectionInput,
  firstZodError,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

// --- test seam: allow tests to inject an isolated pglite db ---
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Shared wrapper: re-assert session, validate, run, revalidate, never throw to the UI. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T) => Promise<void>
): Promise<ActionResult> {
  try {
    await requireSession();
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Database error" };
  }
}

export async function saveRevenueMonth(raw: unknown): Promise<ActionResult> {
  return run(revenueMonthInput, raw, async (input) => {
    await db()
      .insert(revenueMonths)
      .values({ year: input.year, month: input.month, amountCents: input.amountCents })
      .onConflictDoUpdate({
        target: [revenueMonths.year, revenueMonths.month],
        set: { amountCents: input.amountCents, updatedAt: new Date() },
      });
  });
}

export async function addRevenueTransaction(raw: unknown): Promise<ActionResult> {
  return run(revenueTransactionInput, raw, async (input) => {
    await db().insert(revenueTransactions).values({
      occurredOn: input.occurredOn,
      amountCents: input.amountCents,
      memo: input.memo ?? null,
    });
  });
}

export async function deleteRevenueTransaction(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid) => {
    await db().delete(revenueTransactions).where(eq(revenueTransactions.id, rid));
  });
}

export async function saveProfitMonth(raw: unknown): Promise<ActionResult> {
  return run(profitMonthInput, raw, async (input) => {
    await db()
      .insert(profitMonths)
      .values({ year: input.year, month: input.month, amountCents: input.amountCents })
      .onConflictDoUpdate({
        target: [profitMonths.year, profitMonths.month],
        set: { amountCents: input.amountCents, updatedAt: new Date() },
      });
  });
}

export async function createClient(raw: unknown): Promise<ActionResult> {
  return run(clientInput, raw, async (input) => {
    await db().insert(clients).values({
      name: input.name,
      status: input.status,
      valueCents: input.valueCents,
      acquiredOn: input.acquiredOn,
    });
  });
}

const clientUpdateInput = clientInput.extend({ id: z.number().int() });

export async function updateClient(raw: unknown): Promise<ActionResult> {
  return run(clientUpdateInput, raw, async (input) => {
    await db()
      .update(clients)
      .set({
        name: input.name,
        status: input.status,
        valueCents: input.valueCents,
        acquiredOn: input.acquiredOn,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, input.id));
  });
}

export async function deleteClient(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid) => {
    await db().delete(clients).where(eq(clients.id, rid));
  });
}

export async function createEmployee(raw: unknown): Promise<ActionResult> {
  return run(employeeInput, raw, async (input) => {
    await db().insert(employees).values({
      name: input.name,
      role: input.role,
      hiredOn: input.hiredOn,
    });
  });
}

export async function deleteEmployee(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid) => {
    await db().delete(employees).where(eq(employees.id, rid));
  });
}

export async function saveProjection(raw: unknown): Promise<ActionResult> {
  return run(projectionInput, raw, async (input) => {
    const existing = await db()
      .select({ id: projectionAssumptions.id })
      .from(projectionAssumptions)
      .limit(1);
    if (existing.length) {
      await db()
        .update(projectionAssumptions)
        .set({
          baseYear: input.baseYear,
          baseRevenueCents: input.baseRevenueCents,
          cagrPct: input.cagrPct,
          perYearOverrides: input.perYearOverrides,
          updatedAt: new Date(),
        })
        .where(eq(projectionAssumptions.id, existing[0].id));
    } else {
      await db().insert(projectionAssumptions).values({
        baseYear: input.baseYear,
        baseRevenueCents: input.baseRevenueCents,
        cagrPct: input.cagrPct,
        perYearOverrides: input.perYearOverrides,
      });
    }
  });
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/lib/company/actions.test.ts
```

Expected: all action round-trip tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/company/actions.ts test/lib/company/actions.test.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): company CRUD server actions (zod, session re-assert, revalidate)"
```

---

## Task 10: Formatting + provenance helpers

Shared display helpers used by both admin UI and panels: cents to currency string, and a "updated Xd ago" provenance label (spec section 6).

**Files:**
- Create: `src/lib/company/format.ts`
- Test: `test/lib/company/format.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/lib/company/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCents, updatedAgo } from "@/lib/company/format";

describe("formatCents", () => {
  it("formats integer cents as USD whole dollars", () => {
    expect(formatCents(0)).toBe("$0");
    expect(formatCents(100_00)).toBe("$100");
    expect(formatCents(1_234_56)).toBe("$1,235"); // rounded to whole dollars
  });
  it("renders an em dash for null/undefined", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
  });
});

describe("updatedAgo", () => {
  const now = new Date("2026-05-23T12:00:00Z").getTime();
  it("says 'updated today' for same-day", () => {
    expect(updatedAgo(new Date("2026-05-23T01:00:00Z"), now)).toBe("updated today");
  });
  it("counts whole days", () => {
    expect(updatedAgo(new Date("2026-05-21T12:00:00Z"), now)).toBe("updated 2d ago");
  });
  it("returns null when no date", () => {
    expect(updatedAgo(null, now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`@/lib/company/format` missing):

```bash
npm run test -- test/lib/company/format.test.ts
```

Expected: module-resolution failure.

- [ ] **Step 3: Create `src/lib/company/format.ts`** with this exact content:

```ts
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Integer cents to whole-dollar USD string, or an em dash when there is no value. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return USD.format(Math.round(cents / 100));
}

/** "updated today" / "updated Nd ago" provenance label, or null when no date. */
export function updatedAgo(
  updatedAt: Date | null | undefined,
  now: number = Date.now()
): string | null {
  if (!updatedAt) return null;
  const days = Math.floor((now - updatedAt.getTime()) / 86_400_000);
  if (days <= 0) return "updated today";
  return `updated ${days}d ago`;
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/lib/company/format.test.ts
```

Expected: all format tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/company/format.ts test/lib/company/format.test.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): formatCents + updatedAgo provenance helpers"
```

---

## Task 11: Admin form primitives + Clients page (representative CRUD UI)

The admin section lives under the `(admin)` route group at `/company/*` (a route group renders no URL segment, so the path is `/company`, still under the `/` tree). This task builds the reusable client-side form helpers and the Clients page as the representative full-CRUD page with validation + empty state. Tasks 12–13 reuse these primitives for the remaining pages.

**Files:**
- Create: `src/components/company/FormStatus.tsx`
- Create: `src/components/company/ClientsAdmin.tsx`
- Create: `src/app/(admin)/company/layout.tsx`
- Create: `src/app/(admin)/company/clients/page.tsx`
- Test: `test/components/company/ClientsAdmin.test.tsx`

- [ ] **Step 1: Write the failing component test** (validation error surfaced + empty state). Create `test/components/company/ClientsAdmin.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientsAdmin } from "@/components/company/ClientsAdmin";

describe("ClientsAdmin", () => {
  it("shows an 'Add your first' empty state when there are no clients", () => {
    const create = vi.fn(async () => ({ ok: true as const }));
    const del = vi.fn(async () => ({ ok: true as const }));
    render(<ClientsAdmin clients={[]} createAction={create} deleteAction={del} />);
    expect(screen.getByText(/add your first client/i)).toBeInTheDocument();
  });

  it("surfaces a server validation error, never failing silently", async () => {
    const create = vi.fn(async () => ({ ok: false as const, error: "name: name is required" }));
    const del = vi.fn(async () => ({ ok: true as const }));
    render(<ClientsAdmin clients={[]} createAction={create} deleteAction={del} />);
    fireEvent.change(screen.getByLabelText(/acquired/i), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /add client/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/name is required/i));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("lists existing clients with their status", () => {
    const create = vi.fn(async () => ({ ok: true as const }));
    const del = vi.fn(async () => ({ ok: true as const }));
    render(
      <ClientsAdmin
        clients={[{ id: 1, name: "Acme", status: "active", valueCents: 500_00, acquiredOn: "2026-01-01" }]}
        createAction={create}
        deleteAction={del}
      />
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.queryByText(/add your first client/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (`@/components/company/ClientsAdmin` missing):

```bash
npm run test -- test/components/company/ClientsAdmin.test.tsx
```

Expected: module-resolution failure.

- [ ] **Step 3: Create `src/components/company/FormStatus.tsx`** with this exact content:

```tsx
"use client";

/** Inline error/success line for admin forms. Errors use role="alert" so tests + a11y catch them. */
export function FormStatus({ error, ok }: { error?: string | null; ok?: boolean }) {
  if (error) {
    return (
      <p role="alert" className="text-bad text-sm">
        {error}
      </p>
    );
  }
  if (ok) {
    return <p className="text-ok text-sm">Saved.</p>;
  }
  return null;
}
```

- [ ] **Step 4: Create `src/components/company/ClientsAdmin.tsx`** with this exact content:

```tsx
"use client";

import { useState } from "react";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";
import { formatCents } from "@/lib/company/format";

export interface ClientRow {
  id: number;
  name: string;
  status: "active" | "prospect" | "churned";
  valueCents: number;
  acquiredOn: string;
}

export function ClientsAdmin({
  clients,
  createAction,
  deleteAction,
}: {
  clients: ClientRow[];
  createAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<ClientRow["status"]>("active");
  const [valueDollars, setValueDollars] = useState("");
  const [acquiredOn, setAcquiredOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const res = await createAction({
      name,
      status,
      valueCents: Math.round(Number(valueDollars || 0) * 100),
      acquiredOn,
    });
    setPending(false);
    if (res.ok) {
      setOk(true);
      setName("");
      setValueDollars("");
      setAcquiredOn("");
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">Clients</h2>

      <form onSubmit={submit} className="mb-4 grid grid-cols-2 gap-2 text-sm">
        <label className="flex flex-col">
          Name
          <input aria-label="name" className="bg-bg p-2" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Status
          <select
            aria-label="status"
            className="bg-bg p-2"
            value={status}
            onChange={(e) => setStatus(e.target.value as ClientRow["status"])}
          >
            <option value="active">active</option>
            <option value="prospect">prospect</option>
            <option value="churned">churned</option>
          </select>
        </label>
        <label className="flex flex-col">
          Value ($)
          <input
            aria-label="value"
            type="number"
            className="bg-bg p-2"
            value={valueDollars}
            onChange={(e) => setValueDollars(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Acquired on
          <input
            aria-label="acquired on"
            type="date"
            className="bg-bg p-2"
            value={acquiredOn}
            onChange={(e) => setAcquiredOn(e.target.value)}
          />
        </label>
        <div className="col-span-2 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Add client
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>

      {clients.length === 0 ? (
        <p className="text-text/40 text-sm">Add your first client to start tracking the book.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {clients.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <span>{c.name}</span>
              <span className="text-text/60">{c.status}</span>
              <span className="text-text/60">{formatCents(c.valueCents)}</span>
              <button className="text-bad" onClick={() => deleteAction(c.id)} aria-label={`delete ${c.name}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the test — expect PASS:**

```bash
npm run test -- test/components/company/ClientsAdmin.test.tsx
```

Expected: 3 passing tests (empty state, surfaced error, list render).

- [ ] **Step 6: Create the admin layout `src/app/(admin)/company/layout.tsx`** with this exact content:

```tsx
import type { ReactNode } from "react";
import Link from "next/link";

const TABS = [
  { href: "/company/clients", label: "Clients" },
  { href: "/company/revenue", label: "Revenue" },
  { href: "/company/profit", label: "Profit" },
  { href: "/company/employees", label: "Employees" },
  { href: "/company/projections", label: "Projections" },
];

export default function CompanyAdminLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-gold text-xl tracking-widest">Company Data</h1>
        <Link href="/" className="text-text/50 text-sm hover:text-text">
          Back to dashboard
        </Link>
      </header>
      <nav className="mb-4 flex gap-3 text-sm">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="text-text/60 hover:text-gold">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
```

- [ ] **Step 7: Create the Clients page `src/app/(admin)/company/clients/page.tsx`** with this exact content. It is a server component that reads via the db layer and wires the Server Actions:

```tsx
import { getDb } from "@/db/client";
import { clients } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ClientsAdmin, type ClientRow } from "@/components/company/ClientsAdmin";
import { createClient, deleteClient } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const rows = await getDb()
    .select({
      id: clients.id,
      name: clients.name,
      status: clients.status,
      valueCents: clients.valueCents,
      acquiredOn: clients.acquiredOn,
    })
    .from(clients)
    .orderBy(desc(clients.acquiredOn));

  return <ClientsAdmin clients={rows as ClientRow[]} createAction={createClient} deleteAction={deleteClient} />;
}
```

- [ ] **Step 8: Confirm the build still compiles** (the new route group + server component):

```bash
npm run build
```

Expected: build succeeds and lists a `/company/clients` route.

- [ ] **Step 9: Commit.**

```bash
git add "src/components/company/FormStatus.tsx" "src/components/company/ClientsAdmin.tsx" "src/app/(admin)/company/layout.tsx" "src/app/(admin)/company/clients/page.tsx" "test/components/company/ClientsAdmin.test.tsx"
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): admin Clients CRUD page + form primitives"
```

---

## Task 12: Remaining admin pages — Revenue, Profit, Employees

These reuse `FormStatus` and follow the `ClientsAdmin` pattern. The Revenue page also exposes the itemized-transaction form so the precedence rule is owner-controllable.

**Files:**
- Create: `src/components/company/MonthAmountAdmin.tsx`
- Create: `src/components/company/RevenueTxnAdmin.tsx`
- Create: `src/components/company/EmployeesAdmin.tsx`
- Create: `src/app/(admin)/company/revenue/page.tsx`
- Create: `src/app/(admin)/company/profit/page.tsx`
- Create: `src/app/(admin)/company/employees/page.tsx`
- Test: `test/components/company/MonthAmountAdmin.test.tsx`

- [ ] **Step 1: Write the failing test for the shared month/amount form.** Create `test/components/company/MonthAmountAdmin.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MonthAmountAdmin } from "@/components/company/MonthAmountAdmin";

describe("MonthAmountAdmin", () => {
  it("submits cents (dollars times 100) to the action", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<MonthAmountAdmin title="Revenue (manual bucket)" saveAction={save} rows={[]} />);
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText(/month/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ year: 2026, month: 4, amountCents: 100000 }));
  });

  it("surfaces an action error", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "month: too big" }));
    render(<MonthAmountAdmin title="Profit" saveAction={save} rows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/too big/i));
  });

  it("shows an empty state when no months entered", () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<MonthAmountAdmin title="Profit" saveAction={save} rows={[]} />);
    expect(screen.getByText(/no months entered yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL:**

```bash
npm run test -- test/components/company/MonthAmountAdmin.test.tsx
```

Expected: module-resolution failure for `@/components/company/MonthAmountAdmin`.

- [ ] **Step 3: Create `src/components/company/MonthAmountAdmin.tsx`** with this exact content:

```tsx
"use client";

import { useState } from "react";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";
import { formatCents } from "@/lib/company/format";

export interface MonthRow {
  year: number;
  month: number;
  amountCents: number;
}

export function MonthAmountAdmin({
  title,
  rows,
  saveAction,
}: {
  title: string;
  rows: MonthRow[];
  saveAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getUTCFullYear()));
  const [month, setMonth] = useState(String(now.getUTCMonth() + 1));
  const [amountDollars, setAmountDollars] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const res = await saveAction({
      year: Number(year),
      month: Number(month),
      amountCents: Math.round(Number(amountDollars || 0) * 100),
    });
    setPending(false);
    if (res.ok) {
      setOk(true);
      setAmountDollars("");
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">{title}</h2>
      <form onSubmit={submit} className="mb-4 grid grid-cols-3 gap-2 text-sm">
        <label className="flex flex-col">
          Year
          <input aria-label="year" type="number" className="bg-bg p-2" value={year} onChange={(e) => setYear(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Month
          <input
            aria-label="month"
            type="number"
            min={1}
            max={12}
            className="bg-bg p-2"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Amount ($)
          <input
            aria-label="amount"
            type="number"
            className="bg-bg p-2"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
          />
        </label>
        <div className="col-span-3 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Save month
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="text-text/40 text-sm">No months entered yet.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {rows.map((r) => (
            <li key={`${r.year}-${r.month}`} className="flex justify-between py-2">
              <span className="text-text/60">
                {r.year}-{String(r.month).padStart(2, "0")}
              </span>
              <span>{formatCents(r.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/components/company/MonthAmountAdmin.test.tsx
```

Expected: 3 passing tests.

- [ ] **Step 5: Create `src/components/company/RevenueTxnAdmin.tsx`** with this exact content:

```tsx
"use client";

import { useState } from "react";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";
import { formatCents } from "@/lib/company/format";

export interface TxnRow {
  id: number;
  occurredOn: string;
  amountCents: number;
  memo: string | null;
}

export function RevenueTxnAdmin({
  rows,
  addAction,
  deleteAction,
}: {
  rows: TxnRow[];
  addAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  const [occurredOn, setOccurredOn] = useState("");
  const [amountDollars, setAmountDollars] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const res = await addAction({
      occurredOn,
      amountCents: Math.round(Number(amountDollars || 0) * 100),
      memo: memo || undefined,
    });
    setPending(false);
    if (res.ok) {
      setOk(true);
      setOccurredOn("");
      setAmountDollars("");
      setMemo("");
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">
        Itemized transactions
        <span className="text-text/40 ml-2 text-xs normal-case">
          (any month with transactions ignores its manual bucket)
        </span>
      </h2>
      <form onSubmit={submit} className="mb-4 grid grid-cols-3 gap-2 text-sm">
        <label className="flex flex-col">
          Date
          <input
            aria-label="occurred on"
            type="date"
            className="bg-bg p-2"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Amount ($)
          <input
            aria-label="txn amount"
            type="number"
            className="bg-bg p-2"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Memo
          <input aria-label="memo" className="bg-bg p-2" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <div className="col-span-3 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Add transaction
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="text-text/40 text-sm">No transactions yet.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <span className="text-text/60">{t.occurredOn}</span>
              <span>{formatCents(t.amountCents)}</span>
              <span className="text-text/40">{t.memo ?? ""}</span>
              <button
                className="text-bad"
                onClick={() => deleteAction(t.id)}
                aria-label={`delete transaction ${t.id}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Create `src/components/company/EmployeesAdmin.tsx`** with this exact content:

```tsx
"use client";

import { useState } from "react";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";

export interface EmployeeRow {
  id: number;
  name: string;
  role: string;
  hiredOn: string;
}

export function EmployeesAdmin({
  rows,
  createAction,
  deleteAction,
}: {
  rows: EmployeeRow[];
  createAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [hiredOn, setHiredOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const res = await createAction({ name, role, hiredOn });
    setPending(false);
    if (res.ok) {
      setOk(true);
      setName("");
      setRole("");
      setHiredOn("");
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">Employees</h2>
      <form onSubmit={submit} className="mb-4 grid grid-cols-3 gap-2 text-sm">
        <label className="flex flex-col">
          Name
          <input
            aria-label="employee name"
            className="bg-bg p-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Role
          <input aria-label="role" className="bg-bg p-2" value={role} onChange={(e) => setRole(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Hired on
          <input
            aria-label="hired on"
            type="date"
            className="bg-bg p-2"
            value={hiredOn}
            onChange={(e) => setHiredOn(e.target.value)}
          />
        </label>
        <div className="col-span-3 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Add employee
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="text-text/40 text-sm">Add your first employee to track headcount.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {rows.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2">
              <span>{e.name}</span>
              <span className="text-text/60">{e.role}</span>
              <span className="text-text/40">{e.hiredOn}</span>
              <button className="text-bad" onClick={() => deleteAction(e.id)} aria-label={`delete ${e.name}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Create the Revenue page `src/app/(admin)/company/revenue/page.tsx`** with this exact content:

```tsx
import { getDb } from "@/db/client";
import { revenueMonths, revenueTransactions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { MonthAmountAdmin, type MonthRow } from "@/components/company/MonthAmountAdmin";
import { RevenueTxnAdmin, type TxnRow } from "@/components/company/RevenueTxnAdmin";
import { saveRevenueMonth, addRevenueTransaction, deleteRevenueTransaction } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function RevenuePage() {
  const db = getDb();
  const months = (await db
    .select({
      year: revenueMonths.year,
      month: revenueMonths.month,
      amountCents: revenueMonths.amountCents,
    })
    .from(revenueMonths)
    .orderBy(desc(revenueMonths.year), desc(revenueMonths.month))) as MonthRow[];

  const txns = (await db
    .select({
      id: revenueTransactions.id,
      occurredOn: revenueTransactions.occurredOn,
      amountCents: revenueTransactions.amountCents,
      memo: revenueTransactions.memo,
    })
    .from(revenueTransactions)
    .orderBy(desc(revenueTransactions.occurredOn))) as TxnRow[];

  return (
    <div className="space-y-4">
      <MonthAmountAdmin title="Revenue (manual monthly bucket)" rows={months} saveAction={saveRevenueMonth} />
      <RevenueTxnAdmin rows={txns} addAction={addRevenueTransaction} deleteAction={deleteRevenueTransaction} />
    </div>
  );
}
```

- [ ] **Step 8: Create the Profit page `src/app/(admin)/company/profit/page.tsx`** with this exact content:

```tsx
import { getDb } from "@/db/client";
import { profitMonths } from "@/db/schema";
import { desc } from "drizzle-orm";
import { MonthAmountAdmin, type MonthRow } from "@/components/company/MonthAmountAdmin";
import { saveProfitMonth } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function ProfitPage() {
  const rows = (await getDb()
    .select({
      year: profitMonths.year,
      month: profitMonths.month,
      amountCents: profitMonths.amountCents,
    })
    .from(profitMonths)
    .orderBy(desc(profitMonths.year), desc(profitMonths.month))) as MonthRow[];

  return <MonthAmountAdmin title="Profit (monthly)" rows={rows} saveAction={saveProfitMonth} />;
}
```

- [ ] **Step 9: Create the Employees page `src/app/(admin)/company/employees/page.tsx`** with this exact content:

```tsx
import { getDb } from "@/db/client";
import { employees } from "@/db/schema";
import { desc } from "drizzle-orm";
import { EmployeesAdmin, type EmployeeRow } from "@/components/company/EmployeesAdmin";
import { createEmployee, deleteEmployee } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const rows = (await getDb()
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
      hiredOn: employees.hiredOn,
    })
    .from(employees)
    .orderBy(desc(employees.hiredOn))) as EmployeeRow[];

  return <EmployeesAdmin rows={rows} createAction={createEmployee} deleteAction={deleteEmployee} />;
}
```

- [ ] **Step 10: Build to confirm all new routes compile:**

```bash
npm run build
```

Expected: build succeeds, listing `/company/revenue`, `/company/profit`, `/company/employees`.

- [ ] **Step 11: Commit.**

```bash
git add "src/components/company/MonthAmountAdmin.tsx" "src/components/company/RevenueTxnAdmin.tsx" "src/components/company/EmployeesAdmin.tsx" "src/app/(admin)/company/revenue/page.tsx" "src/app/(admin)/company/profit/page.tsx" "src/app/(admin)/company/employees/page.tsx" "test/components/company/MonthAmountAdmin.test.tsx"
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): admin Revenue/Profit/Employees pages + shared month form"
```

---

## Task 13: Projections admin page

**Files:**
- Create: `src/components/company/ProjectionsAdmin.tsx`
- Create: `src/app/(admin)/company/projections/page.tsx`
- Test: `test/components/company/ProjectionsAdmin.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `test/components/company/ProjectionsAdmin.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectionsAdmin } from "@/components/company/ProjectionsAdmin";

describe("ProjectionsAdmin", () => {
  it("prefills from existing assumptions and saves cents", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(
      <ProjectionsAdmin
        initial={{ baseYear: 2026, baseRevenueCents: 100_00, cagrPct: 15, perYearOverrides: {} }}
        saveAction={save}
      />
    );
    expect((screen.getByLabelText(/base revenue/i) as HTMLInputElement).value).toBe("100");
    fireEvent.click(screen.getByRole("button", { name: /save projection/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        baseYear: 2026,
        baseRevenueCents: 100_00,
        cagrPct: 15,
        perYearOverrides: {},
      })
    );
  });

  it("shows an empty/first-run hint when there are no assumptions yet", () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<ProjectionsAdmin initial={null} saveAction={save} />);
    expect(screen.getByText(/set your first projection/i)).toBeInTheDocument();
  });

  it("surfaces an action error", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "cagrPct: too big" }));
    render(<ProjectionsAdmin initial={null} saveAction={save} />);
    fireEvent.click(screen.getByRole("button", { name: /save projection/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/too big/i));
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL:**

```bash
npm run test -- test/components/company/ProjectionsAdmin.test.tsx
```

Expected: module-resolution failure for `@/components/company/ProjectionsAdmin`.

- [ ] **Step 3: Create `src/components/company/ProjectionsAdmin.tsx`** with this exact content. The per-year overrides input takes a JSON map of year to dollar value and converts to cents on submit; with an empty `{}` the mapping is a no-op, so the test's asserted payload matches exactly:

```tsx
"use client";

import { useState } from "react";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";

export interface ProjectionInitial {
  baseYear: number;
  baseRevenueCents: number;
  cagrPct: number;
  perYearOverrides: Record<string, number>;
}

export function ProjectionsAdmin({
  initial,
  saveAction,
}: {
  initial: ProjectionInitial | null;
  saveAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const [baseYear, setBaseYear] = useState(String(initial?.baseYear ?? new Date().getUTCFullYear()));
  const [baseRevenueDollars, setBaseRevenueDollars] = useState(
    initial ? String(Math.round(initial.baseRevenueCents / 100)) : ""
  );
  const [cagrPct, setCagrPct] = useState(String(initial?.cagrPct ?? ""));
  const [overridesText, setOverridesText] = useState(
    initial ? JSON.stringify(initial.perYearOverrides) : "{}"
  );
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);

    let overrides: Record<string, number>;
    try {
      const parsed = JSON.parse(overridesText || "{}") as Record<string, number>;
      // overrides are entered as dollars per year; store as cents
      overrides = Object.fromEntries(
        Object.entries(parsed).map(([year, dollars]) => [year, Math.round(Number(dollars) * 100)])
      );
    } catch {
      setError('Per-year overrides must be JSON like {"2028": 200000}');
      return;
    }

    setPending(true);
    const res = await saveAction({
      baseYear: Number(baseYear),
      baseRevenueCents: Math.round(Number(baseRevenueDollars || 0) * 100),
      cagrPct: Math.round(Number(cagrPct || 0)),
      perYearOverrides: overrides,
    });
    setPending(false);
    if (res.ok) setOk(true);
    else setError(res.error);
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">Revenue Projection</h2>
      {!initial && (
        <p className="text-text/40 mb-3 text-sm">
          Set your first projection: a base year, base revenue, and an annual growth rate.
        </p>
      )}
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 text-sm">
        <label className="flex flex-col">
          Base year
          <input
            aria-label="base year"
            type="number"
            className="bg-bg p-2"
            value={baseYear}
            onChange={(e) => setBaseYear(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Base revenue ($)
          <input
            aria-label="base revenue"
            type="number"
            className="bg-bg p-2"
            value={baseRevenueDollars}
            onChange={(e) => setBaseRevenueDollars(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          CAGR (%)
          <input
            aria-label="cagr"
            type="number"
            className="bg-bg p-2"
            value={cagrPct}
            onChange={(e) => setCagrPct(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Per-year overrides ($, JSON)
          <input
            aria-label="overrides"
            className="bg-bg p-2"
            value={overridesText}
            onChange={(e) => setOverridesText(e.target.value)}
          />
        </label>
        <div className="col-span-2 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Save projection
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/components/company/ProjectionsAdmin.test.tsx
```

Expected: 3 passing tests.

- [ ] **Step 5: Create the Projections page `src/app/(admin)/company/projections/page.tsx`** with this exact content:

```tsx
import { getDb } from "@/db/client";
import { projectionAssumptions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ProjectionsAdmin, type ProjectionInitial } from "@/components/company/ProjectionsAdmin";
import { saveProjection } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function ProjectionsPage() {
  const rows = await getDb()
    .select({
      baseYear: projectionAssumptions.baseYear,
      baseRevenueCents: projectionAssumptions.baseRevenueCents,
      cagrPct: projectionAssumptions.cagrPct,
      perYearOverrides: projectionAssumptions.perYearOverrides,
    })
    .from(projectionAssumptions)
    .orderBy(desc(projectionAssumptions.updatedAt))
    .limit(1);

  const initial = (rows[0] ?? null) as ProjectionInitial | null;
  return <ProjectionsAdmin initial={initial} saveAction={saveProjection} />;
}
```

- [ ] **Step 6: Build to confirm:**

```bash
npm run build
```

Expected: build succeeds, listing `/company/projections`.

- [ ] **Step 7: Commit.**

```bash
git add "src/components/company/ProjectionsAdmin.tsx" "src/app/(admin)/company/projections/page.tsx" "test/components/company/ProjectionsAdmin.test.tsx"
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): admin Projections assumptions page"
```

---

## Task 14: Dashboard read aggregator + Company Overview panel

A single server-side reader assembles everything the dashboard panels need, so `page.tsx` does one round of reads. Then the Company Overview panel renders real KPIs (honest em dash when missing).

**Files:**
- Create: `src/db/dashboard.ts`
- Create: `src/components/company/CompanyOverviewPanel.tsx`
- Test: `test/db/dashboard.test.ts`
- Test: `test/components/company/CompanyOverviewPanel.test.tsx`

- [ ] **Step 1: Write the failing aggregator test.** Create `test/db/dashboard.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { revenueMonths, profitMonths, clients, employees } from "@/db/schema";
import { readCompanyDashboard } from "@/db/dashboard";

describe("readCompanyDashboard", () => {
  it("returns zeroed KPIs and empty series for a fresh db", async () => {
    const { db, close } = await createTestDb();
    const out = await readCompanyDashboard(db, 2026, 4);
    expect(out.kpis.revenueCents).toBe(0);
    expect(out.kpis.profitCents).toBe(0);
    expect(out.kpis.marginPct).toBeNull();
    expect(out.kpis.activeClients).toBe(0);
    expect(out.kpis.totalClients).toBe(0);
    expect(out.kpis.employees).toBe(0);
    expect(out.series).toHaveLength(12);
    expect(out.projection).toBeNull();
    expect(out.hasAnyData).toBe(false);
    await close();
  });

  it("assembles real KPIs when data exists", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: 2026, month: 4, amountCents: 100_00 });
    await db.insert(profitMonths).values({ year: 2026, month: 4, amountCents: 25_00 });
    await db.insert(clients).values({ name: "A", status: "active", valueCents: 0, acquiredOn: "2026-01-01" });
    await db.insert(employees).values({ name: "E", role: "eng", hiredOn: "2025-01-01" });
    const out = await readCompanyDashboard(db, 2026, 4);
    expect(out.kpis.revenueCents).toBe(100_00);
    expect(out.kpis.marginPct).toBe(25);
    expect(out.kpis.activeClients).toBe(1);
    expect(out.kpis.employees).toBe(1);
    expect(out.hasAnyData).toBe(true);
    await close();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL:**

```bash
npm run test -- test/db/dashboard.test.ts
```

Expected: module-resolution failure for `@/db/dashboard`.

- [ ] **Step 3: Create `src/db/dashboard.ts`** with this exact content:

```ts
import type { Db } from "./client";
import {
  getCurrentMonthRevenueCents,
  getCurrentMonthProfitCents,
  getCurrentOperatingMarginPct,
  getClientCounts,
  getEmployeeCount,
  getTrailingTwelveMonths,
  getProjection,
  type MonthPoint,
  type Projection,
} from "./queries";

export interface DashboardKpis {
  revenueCents: number;
  profitCents: number;
  marginPct: number | null;
  activeClients: number;
  totalClients: number;
  employees: number;
}

export interface CompanyDashboard {
  kpis: DashboardKpis;
  series: MonthPoint[];
  projection: Projection | null;
  hasAnyData: boolean;
}

export async function readCompanyDashboard(
  db: Db,
  year: number,
  month: number
): Promise<CompanyDashboard> {
  const [revenueCents, profitCents, marginPct, counts, employeeCount, series, projection] =
    await Promise.all([
      getCurrentMonthRevenueCents(db, year, month),
      getCurrentMonthProfitCents(db, year, month),
      getCurrentOperatingMarginPct(db, year, month),
      getClientCounts(db),
      getEmployeeCount(db),
      getTrailingTwelveMonths(db, year, month),
      getProjection(db),
    ]);

  const hasAnyData =
    revenueCents > 0 || profitCents > 0 || counts.total > 0 || employeeCount > 0 || projection !== null;

  return {
    kpis: {
      revenueCents,
      profitCents,
      marginPct,
      activeClients: counts.active,
      totalClients: counts.total,
      employees: employeeCount,
    },
    series,
    projection,
    hasAnyData,
  };
}
```

- [ ] **Step 4: Run the aggregator test — expect PASS:**

```bash
npm run test -- test/db/dashboard.test.ts
```

Expected: 2 passing tests.

- [ ] **Step 5: Write the failing panel test.** Create `test/components/company/CompanyOverviewPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompanyOverviewPanel } from "@/components/company/CompanyOverviewPanel";

const kpis = {
  revenueCents: 100_00,
  profitCents: 25_00,
  marginPct: 25,
  activeClients: 3,
  totalClients: 5,
  employees: 7,
};

describe("CompanyOverviewPanel", () => {
  it("shows an empty CTA when there is no data, never fake numbers", () => {
    render(
      <CompanyOverviewPanel
        kpis={{ revenueCents: 0, profitCents: 0, marginPct: null, activeClients: 0, totalClients: 0, employees: 0 }}
        hasAnyData={false}
        updatedLabel={null}
      />
    );
    expect(screen.getByText(/add your first/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$1/)).not.toBeInTheDocument();
  });

  it("renders real KPIs and an em dash for a null margin", () => {
    render(
      <CompanyOverviewPanel kpis={{ ...kpis, marginPct: null }} hasAnyData={true} updatedLabel="updated 2d ago" />
    );
    expect(screen.getByText("$100")).toBeInTheDocument();
    expect(screen.getByText("updated 2d ago")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-margin")).toHaveTextContent("—");
  });

  it("shows margin percent when present", () => {
    render(<CompanyOverviewPanel kpis={kpis} hasAnyData={true} updatedLabel="updated today" />);
    expect(screen.getByTestId("kpi-margin")).toHaveTextContent("25%");
  });
});
```

- [ ] **Step 6: Run the panel test — expect FAIL:**

```bash
npm run test -- test/components/company/CompanyOverviewPanel.test.tsx
```

Expected: module-resolution failure for `@/components/company/CompanyOverviewPanel`.

- [ ] **Step 7: Create `src/components/company/CompanyOverviewPanel.tsx`** with this exact content:

```tsx
import Link from "next/link";
import { Panel } from "@/components/Panel";
import { formatCents } from "@/lib/company/format";
import type { DashboardKpis } from "@/db/dashboard";

function Kpi({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <div className="text-text/50 text-xs uppercase tracking-wider">{label}</div>
      <div data-testid={testId} className="font-display text-lg text-text">
        {value}
      </div>
    </div>
  );
}

export function CompanyOverviewPanel({
  kpis,
  hasAnyData,
  updatedLabel,
}: {
  kpis: DashboardKpis;
  hasAnyData: boolean;
  updatedLabel: string | null;
}) {
  if (!hasAnyData) {
    return (
      <Panel title="Company Overview" state="ready">
        <p className="text-text/40 text-sm">
          No company data yet.{" "}
          <Link href="/company/revenue" className="text-gold underline">
            Add your first numbers
          </Link>
          .
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Company Overview" state="ready">
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Revenue MTD" value={formatCents(kpis.revenueCents)} />
        <Kpi label="Net Profit MTD" value={formatCents(kpis.profitCents)} />
        <Kpi label="Operating Margin" testId="kpi-margin" value={kpis.marginPct === null ? "—" : `${kpis.marginPct}%`} />
        <Kpi label="Clients (active/total)" value={`${kpis.activeClients}/${kpis.totalClients}`} />
        <Kpi label="Employees" value={String(kpis.employees)} />
      </div>
      {updatedLabel && <p className="text-text/40 mt-3 text-xs">{updatedLabel}</p>}
    </Panel>
  );
}
```

- [ ] **Step 8: Run the panel test — expect PASS:**

```bash
npm run test -- test/components/company/CompanyOverviewPanel.test.tsx
```

Expected: 3 passing tests.

- [ ] **Step 9: Commit.**

```bash
git add src/db/dashboard.ts "src/components/company/CompanyOverviewPanel.tsx" test/db/dashboard.test.ts "test/components/company/CompanyOverviewPanel.test.tsx"
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): dashboard read aggregator + Company Overview KPI panel"
```

---

## Task 15: Revenue Projections panel (Recharts)

**Files:**
- Create: `src/components/company/RevenueProjectionsPanel.tsx`
- Test: `test/components/company/RevenueProjectionsPanel.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `test/components/company/RevenueProjectionsPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RevenueProjectionsPanel } from "@/components/company/RevenueProjectionsPanel";

describe("RevenueProjectionsPanel", () => {
  it("renders an empty CTA when there is no projection", () => {
    render(<RevenueProjectionsPanel projection={null} updatedLabel={null} />);
    expect(screen.getByText(/set a projection/i)).toBeInTheDocument();
  });

  it("renders the projected end-year value and provenance when present", () => {
    render(
      <RevenueProjectionsPanel
        projection={{
          points: [
            { year: 2026, amountCents: 100_00 },
            { year: 2027, amountCents: 110_00 },
            { year: 2028, amountCents: 121_00 },
            { year: 2029, amountCents: 133_10 },
            { year: 2030, amountCents: 146_41 },
          ],
          updatedAt: new Date("2026-05-20T00:00:00Z"),
        }}
        updatedLabel="updated 3d ago"
      />
    );
    expect(screen.getByText(/2030/)).toBeInTheDocument();
    expect(screen.getByText("updated 3d ago")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL:**

```bash
npm run test -- test/components/company/RevenueProjectionsPanel.test.tsx
```

Expected: module-resolution failure for `@/components/company/RevenueProjectionsPanel`.

- [ ] **Step 3: Create `src/components/company/RevenueProjectionsPanel.tsx`** with this exact content:

```tsx
"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { Panel } from "@/components/Panel";
import { formatCents } from "@/lib/company/format";
import type { Projection } from "@/db/queries";

export function RevenueProjectionsPanel({
  projection,
  updatedLabel,
}: {
  projection: Projection | null;
  updatedLabel: string | null;
}) {
  if (!projection) {
    return (
      <Panel title="Revenue Projections" state="ready">
        <p className="text-text/40 text-sm">
          Set a projection in Company Data, Projections to see the 5-year forecast.
        </p>
      </Panel>
    );
  }

  const data = projection.points.map((p) => ({
    year: String(p.year),
    dollars: Math.round(p.amountCents / 100),
    label: formatCents(p.amountCents),
  }));
  const end = projection.points[projection.points.length - 1];

  return (
    <Panel title="Revenue Projections" state="ready">
      <div className="text-text/70 mb-2 text-xs">
        {end.year}: <span className="text-gold">{formatCents(end.amountCents)}</span> projected
      </div>
      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="year" tick={{ fill: "rgb(180 190 200)", fontSize: 11 }} />
            <YAxis hide />
            <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} labelStyle={{ color: "#111" }} />
            <Bar dataKey="dollars" fill="hsl(41 78% 64%)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {updatedLabel && <p className="text-text/40 mt-2 text-xs">{updatedLabel}</p>}
    </Panel>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/components/company/RevenueProjectionsPanel.test.tsx
```

Expected: 2 passing tests.

- [ ] **Step 5: Commit.**

```bash
git add "src/components/company/RevenueProjectionsPanel.tsx" "test/components/company/RevenueProjectionsPanel.test.tsx"
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): Revenue Projections panel (recharts bar chart)"
```

---

## Task 16: Company Growth Analytics panel (Recharts multi-line)

**Files:**
- Create: `src/components/company/GrowthAnalyticsPanel.tsx`
- Test: `test/components/company/GrowthAnalyticsPanel.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `test/components/company/GrowthAnalyticsPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GrowthAnalyticsPanel } from "@/components/company/GrowthAnalyticsPanel";
import type { MonthPoint } from "@/db/queries";

const emptySeries: MonthPoint[] = Array.from({ length: 12 }, (_, i) => ({
  year: 2026,
  month: i + 1,
  revenueCents: 0,
  profitCents: 0,
  clientsAdded: 0,
}));

describe("GrowthAnalyticsPanel", () => {
  it("renders an empty state when every month is zero", () => {
    render(<GrowthAnalyticsPanel series={emptySeries} updatedLabel={null} />);
    expect(screen.getByText(/no monthly history yet/i)).toBeInTheDocument();
  });

  it("renders the chart and a legend when there is real history", () => {
    const series: MonthPoint[] = emptySeries.map((m, i) =>
      i === 11 ? { ...m, revenueCents: 500_00, profitCents: 120_00, clientsAdded: 2 } : m
    );
    render(<GrowthAnalyticsPanel series={series} updatedLabel="updated today" />);
    expect(screen.getByText(/revenue/i)).toBeInTheDocument();
    expect(screen.getByText(/profit/i)).toBeInTheDocument();
    expect(screen.getByText("updated today")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL:**

```bash
npm run test -- test/components/company/GrowthAnalyticsPanel.test.tsx
```

Expected: module-resolution failure for `@/components/company/GrowthAnalyticsPanel`.

- [ ] **Step 3: Create `src/components/company/GrowthAnalyticsPanel.tsx`** with this exact content:

```tsx
"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Panel } from "@/components/Panel";
import type { MonthPoint } from "@/db/queries";

export function GrowthAnalyticsPanel({
  series,
  updatedLabel,
}: {
  series: MonthPoint[];
  updatedLabel: string | null;
}) {
  const hasHistory = series.some((m) => m.revenueCents > 0 || m.profitCents > 0 || m.clientsAdded > 0);

  if (!hasHistory) {
    return (
      <Panel title="Company Growth Analytics" state="ready">
        <p className="text-text/40 text-sm">
          No monthly history yet. Enter revenue, profit, and clients to build the trend.
        </p>
      </Panel>
    );
  }

  const data = series.map((m) => ({
    label: `${String(m.year).slice(2)}-${String(m.month).padStart(2, "0")}`,
    revenue: Math.round(m.revenueCents / 100),
    profit: Math.round(m.profitCents / 100),
    clientsAdded: m.clientsAdded,
  }));

  return (
    <Panel title="Company Growth Analytics" state="ready">
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="label" tick={{ fill: "rgb(180 190 200)", fontSize: 10 }} />
            <YAxis hide />
            <Tooltip labelStyle={{ color: "#111" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(41 78% 64%)" dot={false} />
            <Line type="monotone" dataKey="profit" name="Profit" stroke="hsl(168 64% 52%)" dot={false} />
            <Line type="monotone" dataKey="clientsAdded" name="Clients added" stroke="hsl(210 20% 70%)" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {updatedLabel && <p className="text-text/40 mt-2 text-xs">{updatedLabel}</p>}
    </Panel>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/components/company/GrowthAnalyticsPanel.test.tsx
```

Expected: 2 passing tests.

- [ ] **Step 5: Commit.**

```bash
git add "src/components/company/GrowthAnalyticsPanel.tsx" "test/components/company/GrowthAnalyticsPanel.test.tsx"
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): Company Growth Analytics multi-line panel"
```

---

## Task 17: Wire the panels into the dashboard

Replace the `Company Overview` and `Revenue Projections` `unwired` placeholders in `src/app/page.tsx` with the real panels, add the new `Company Growth Analytics` panel, and keep the out-of-scope panels (`Work Orders`, `Client Satisfaction`) as honest `unwired` placeholders (spec section 8). `page.tsx` becomes a server component that reads the dashboard data; the existing client-only ticker/market subtree stays untouched (zero impact on the market poller, spec section 7).

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/company/CompanyPanels.tsx`
- Test: `test/components/company/CompanyPanels.test.tsx`

- [ ] **Step 1: Write the failing wrapper test.** `CompanyPanels` is a small client wrapper that lays out the three company panels from one `CompanyDashboard` object plus a precomputed provenance label (kept as a pure presentational unit so it is testable without a DB). Create `test/components/company/CompanyPanels.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompanyPanels } from "@/components/company/CompanyPanels";
import type { CompanyDashboard } from "@/db/dashboard";

const empty: CompanyDashboard = {
  kpis: { revenueCents: 0, profitCents: 0, marginPct: null, activeClients: 0, totalClients: 0, employees: 0 },
  series: Array.from({ length: 12 }, (_, i) => ({
    year: 2026,
    month: i + 1,
    revenueCents: 0,
    profitCents: 0,
    clientsAdded: 0,
  })),
  projection: null,
  hasAnyData: false,
};

describe("CompanyPanels", () => {
  it("renders all three company panels in their empty states", () => {
    render(<CompanyPanels data={empty} updatedLabel={null} />);
    expect(screen.getByText("Company Overview")).toBeInTheDocument();
    expect(screen.getByText("Revenue Projections")).toBeInTheDocument();
    expect(screen.getByText("Company Growth Analytics")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL:**

```bash
npm run test -- test/components/company/CompanyPanels.test.tsx
```

Expected: module-resolution failure for `@/components/company/CompanyPanels`.

- [ ] **Step 3: Create `src/components/company/CompanyPanels.tsx`** with this exact content:

```tsx
"use client";

import { CompanyOverviewPanel } from "./CompanyOverviewPanel";
import { RevenueProjectionsPanel } from "./RevenueProjectionsPanel";
import { GrowthAnalyticsPanel } from "./GrowthAnalyticsPanel";
import type { CompanyDashboard } from "@/db/dashboard";

export function CompanyPanels({
  data,
  updatedLabel,
}: {
  data: CompanyDashboard;
  updatedLabel: string | null;
}) {
  return (
    <>
      <CompanyOverviewPanel kpis={data.kpis} hasAnyData={data.hasAnyData} updatedLabel={updatedLabel} />
      <RevenueProjectionsPanel projection={data.projection} updatedLabel={updatedLabel} />
      <div className="col-span-2">
        <GrowthAnalyticsPanel series={data.series} updatedLabel={updatedLabel} />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS:**

```bash
npm run test -- test/components/company/CompanyPanels.test.tsx
```

Expected: 1 passing test.

- [ ] **Step 5: Rewrite `src/app/page.tsx`** to its exact new content. It reads company data server-side, derives the provenance label from the projection's `updatedAt` (falling back to null), and composes the panels. The `QuotesProvider`/`Shell`/`TickerStrip`/`MarketAnalysisPanel` subtree is unchanged:

```tsx
import { Shell } from "@/components/dashboard/Shell";
import { Panel } from "@/components/Panel";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { MarketAnalysisPanel } from "@/components/market/MarketAnalysisPanel";
import { CompanyPanels } from "@/components/company/CompanyPanels";
import { getDb } from "@/db/client";
import { readCompanyDashboard } from "@/db/dashboard";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const data = await readCompanyDashboard(getDb(), year, month);
  const updatedLabel = updatedAgo(data.projection?.updatedAt ?? null);

  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <div className="grid grid-cols-4 gap-3" data-testid="dashboard-root">
          <div className="col-span-2">
            <MarketAnalysisPanel />
          </div>
          <CompanyPanels data={data} updatedLabel={updatedLabel} />
          <Panel title="Work Orders" state="unwired" />
          <Panel title="Client Satisfaction" state="unwired" />
        </div>
      </Shell>
    </QuotesProvider>
  );
}
```

- [ ] **Step 6: Build to confirm the dashboard composes with the new server-side reads:**

```bash
npm run build
```

Expected: build succeeds; `/` is now a dynamic route (it reads the DB).

- [ ] **Step 7: Commit.**

```bash
git add src/app/page.tsx "src/components/company/CompanyPanels.tsx" "test/components/company/CompanyPanels.test.tsx"
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): wire company panels into dashboard, keep out-of-scope placeholders honest"
```

---

## Task 18: Protect /company routes in middleware

The middleware matcher currently only guards `/` and `/api/quotes`. The `(admin)` route group resolves to `/company/*`, which is NOT covered, so add it (spec section 2: admin pages behind the slice-0 session gate).

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Update the matcher.** Edit the final exported line of `src/middleware.ts` from:

```ts
export const config = { matcher: ["/", "/api/quotes"] };
```

to:

```ts
export const config = { matcher: ["/", "/api/quotes", "/company/:path*"] };
```

- [ ] **Step 2: Confirm existing auth tests still pass** (the session helpers are unchanged):

```bash
npm run test -- test/lib/auth/session.test.ts test/lib/auth/requireSession.test.ts
```

Expected: all auth tests pass.

- [ ] **Step 3: Commit.**

```bash
git add src/middleware.ts
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "feat(slice-2): gate /company admin routes behind the session middleware"
```

---

## Task 19: Final verification + tag

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite.**

```bash
npm run test
```

Expected: every test passes — the pre-existing slice-0/slice-1 suites plus all new slice-2 tests (schema, client, metrics, queries, validation, requireSession, actions, format, dashboard, and the company component tests). Zero failures.

- [ ] **Step 2: Run the production build.**

```bash
npm run build
```

Expected: a clean build. The `/company/*` admin routes appear as separate route entries (code-split, spec section 7), and `/` is a dynamic server-rendered route.

- [ ] **Step 3: If and only if both succeed, create the verification commit.** (There may be nothing to commit if all prior tasks committed cleanly; in that case skip the commit and go straight to the tag.)

```bash
git add -A
git -c user.email=claytonhillyard@me.com -c user.name="Clayton Hillyard" commit -m "chore(slice-2): verification — full test suite + build green" || echo "nothing to commit"
```

- [ ] **Step 4: Tag the slice.**

```bash
git tag slice-2-company-data
```

- [ ] **Step 5: Confirm the tag exists.**

```bash
git tag --list slice-2-company-data
```

Expected: prints `slice-2-company-data`.

---

## Done

At this point: Postgres-backed company data flows through `getDb()` (pglite in dev/test, Neon in prod), a full Admin CRUD UI lives under `/company/*` behind the session gate, and the Company Overview, Revenue Projections, and Company Growth Analytics panels render real owner data with honest empty states and "updated Xd ago" provenance. The market subsystem and the out-of-scope (section 8) placeholders are untouched. Distribution work (section 9) is intentionally not included.
