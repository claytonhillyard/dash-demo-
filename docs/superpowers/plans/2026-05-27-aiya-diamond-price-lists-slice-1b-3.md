# AIYA Diamond & Gem Price Lists (Slice 1b-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner-maintained Rapaport-style diamond pricing (matrix + named points + history) that lights up the Natural/Lab Index KPIs, the Market Intelligence Diamonds tab, and the Price Trend diamond line — from real owner-supplied data.

**Architecture:** Extends the slice-1b-1 pattern exactly: Drizzle schema + generated migration; pure constants/CSV/validation modules; a `src/db/diamonds.ts` data-access read; server actions (run() wrapper + `requireSession` + `ensureDbReady`) for import/edit/CRUD; server reads passed as serializable props into the existing client panels. New `/diamonds` admin + `/api/diamond-history` route, both auth-gated.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle ORM, pglite/Neon, Zod, Recharts, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-27-aiya-diamond-price-lists-slice-1b-3-design.md`

**Scope refinements (spec-faithful, noted for the reviewer):**
- Diamond data reaches the **client** KPI/Market-Intelligence panels via **server-read props** (the inventory pattern), not a new client store.
- "Inline edit": the **single-cell upsert action** (`upsertMatrixCell`) is built and tested this slice; its small admin *form* is deferred to a follow-up. **Bulk CSV import is the primary entry path** (and a full editable color×clarity grid — 220 inputs/band — is out of scope).

**Conventions:** single test file: `npx vitest run <path>`. DB/action tests use `// @vitest-environment node`, `createTestDb()`, and the `__setTestDb` seam. Money is integer cents. Commit after every green step.

---

## Phase A — Data layer

### Task A1: Diamond constants

**Files:** Create `src/lib/diamonds/constants.ts`; Test `test/lib/diamonds/constants.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/diamonds/constants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DIAMOND_COLORS, DIAMOND_CLARITIES, CARAT_BANDS, BENCHMARK, SHEETS, SHAPES,
} from "@/lib/diamonds/constants";

describe("diamond constants", () => {
  it("defines the grading scales and a benchmark cell", () => {
    expect(DIAMOND_COLORS).toContain("D");
    expect(DIAMOND_COLORS).toContain("Z");
    expect(DIAMOND_CLARITIES[0]).toBe("IF");
    expect(DIAMOND_CLARITIES).toContain("I3");
    expect(CARAT_BANDS).toContain("1.00-1.49");
    expect(SHEETS).toEqual(["natural", "lab"]);
    expect(SHAPES).toEqual(["round", "fancy"]);
    expect(BENCHMARK).toEqual({ shape: "round", color: "G", clarity: "VS1", caratBand: "1.00-1.49" });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/diamonds/constants.test.ts` (module not found).

- [ ] **Step 3: Implement.** Create `src/lib/diamonds/constants.ts`:

```ts
export const SHEETS = ["natural", "lab"] as const;
export type Sheet = (typeof SHEETS)[number];

export const SHAPES = ["round", "fancy"] as const;
export type Shape = (typeof SHAPES)[number];

export const DIAMOND_COLORS = [
  "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
] as const;
export type DiamondColor = (typeof DIAMOND_COLORS)[number];

export const DIAMOND_CLARITIES = [
  "IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "SI3", "I1", "I2", "I3",
] as const;
export type DiamondClarity = (typeof DIAMOND_CLARITIES)[number];

export const CARAT_BANDS = [
  "0.01-0.03", "0.04-0.07", "0.08-0.14", "0.15-0.17", "0.18-0.22", "0.23-0.29",
  "0.30-0.39", "0.40-0.49", "0.50-0.69", "0.70-0.89", "0.90-0.99", "1.00-1.49",
  "1.50-1.99", "2.00-2.99", "3.00-3.99", "4.00-4.99", "5.00-5.99", "10.00-10.99",
] as const;
export type CaratBand = (typeof CARAT_BANDS)[number];

/** The single cell whose price IS the index, applied per sheet. */
export const BENCHMARK = {
  shape: "round" as Shape,
  color: "G",
  clarity: "VS1",
  caratBand: "1.00-1.49",
};

export const NAMED_POINT_KINDS = ["fancy_diamond", "gem"] as const;
export type NamedPointKind = (typeof NAMED_POINT_KINDS)[number];
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/lib/diamonds/constants.test.ts`
- [ ] **Step 5: Commit.** `git add src/lib/diamonds/constants.ts test/lib/diamonds/constants.test.ts && git commit -m "feat(diamonds): grading-scale + benchmark constants"`

---

### Task A2: Schema — three diamond tables

**Files:** Modify `src/db/schema.ts`; Test `test/db/schema.test.ts`

- [ ] **Step 1: Failing assertions.** Append inside `describe("db schema", …)` in `test/db/schema.test.ts`:

```ts
  it("exports the diamond pricing tables with integer cents + org scoping", () => {
    expect(schema.diamondMatrixPrices).toBeDefined();
    expect(schema.diamondMatrixPrices.pricePerCaratCents.columnType).toBe("PgInteger");
    expect(schema.diamondMatrixPrices.orgId.columnType).toBe("PgInteger");
    expect(schema.diamondPricePoints.pricePerCaratCents.columnType).toBe("PgInteger");
    expect(schema.diamondIndexHistory.valueCents.columnType).toBe("PgInteger");
  });
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/db/schema.test.ts`

- [ ] **Step 3: Implement.** Append to `src/db/schema.ts` (imports `pgTable, serial, integer, text, timestamp, unique` already exist):

```ts
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
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/db/schema.test.ts`
- [ ] **Step 5: Commit.** `git add src/db/schema.ts test/db/schema.test.ts && git commit -m "feat(db): add diamond matrix/price-point/history tables"`

---

### Task A3: Generate migration

**Files:** Create `drizzle/0002_*.sql` + meta; Test `test/db/diamond-migration.test.ts`

- [ ] **Step 1: Generate.** Run `npm run db:generate`. Confirm a new `drizzle/0002_*.sql` with `CREATE TABLE "diamond_matrix_prices"` (+ the other two) and updated `drizzle/meta/_journal.json`. If it appears to hang for input, report BLOCKED.

- [ ] **Step 2: Smoke test.** Create `test/db/diamond-migration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@/db/client";
import { diamondMatrixPrices } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("diamond migration", () => {
  it("creates the diamond tables in a fresh pglite db", async () => {
    const t = await createTestDb();
    close = t.close;
    const rows = await t.db.select({ id: diamondMatrixPrices.id }).from(diamondMatrixPrices);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run → PASS.** `npx vitest run test/db/diamond-migration.test.ts`
- [ ] **Step 4: Commit.** `git add drizzle test/db/diamond-migration.test.ts && git commit -m "feat(db): generate diamond pricing migration"`

---

### Task A4: Validation (named point + cell)

**Files:** Create `src/lib/diamonds/validation.ts`; Test `test/lib/diamonds/validation.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/diamonds/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matrixCellInput, pricePointInput } from "@/lib/diamonds/validation";

describe("diamond validation", () => {
  it("accepts a valid matrix cell", () => {
    expect(matrixCellInput.safeParse({
      sheet: "natural", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 800000,
    }).success).toBe(true);
  });
  it("rejects an unknown color/clarity/band", () => {
    expect(matrixCellInput.safeParse({
      sheet: "natural", shape: "round", color: "ZZ", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 1,
    }).success).toBe(false);
    expect(matrixCellInput.safeParse({
      sheet: "natural", shape: "round", color: "G", clarity: "VS1",
      caratBand: "9.99-9.99", pricePerCaratCents: 1,
    }).success).toBe(false);
  });
  it("validates a named price point", () => {
    expect(pricePointInput.safeParse({
      label: "Pink Diamond 1ct", kind: "fancy_diamond", pricePerCaratCents: 1500000,
    }).success).toBe(true);
    expect(pricePointInput.safeParse({
      label: "", kind: "gem", pricePerCaratCents: 1,
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/diamonds/validation.test.ts`

- [ ] **Step 3: Implement.** Create `src/lib/diamonds/validation.ts`:

```ts
import { z } from "zod";
import {
  SHEETS, SHAPES, DIAMOND_COLORS, DIAMOND_CLARITIES, CARAT_BANDS, NAMED_POINT_KINDS,
} from "./constants";

const cents = z.number().int().min(0);

export const matrixCellInput = z.object({
  sheet: z.enum(SHEETS),
  shape: z.enum(SHAPES),
  color: z.enum(DIAMOND_COLORS),
  clarity: z.enum(DIAMOND_CLARITIES),
  caratBand: z.enum(CARAT_BANDS),
  pricePerCaratCents: cents,
});
export type MatrixCellInput = z.infer<typeof matrixCellInput>;

export const pricePointInput = z.object({
  label: z.string().min(1, "label is required").max(120),
  kind: z.enum(NAMED_POINT_KINDS),
  pricePerCaratCents: cents,
});
export type PricePointInput = z.infer<typeof pricePointInput>;

export const pricePointUpdateInput = pricePointInput.extend({ id: z.number().int() });
export type PricePointUpdateInput = z.infer<typeof pricePointUpdateInput>;

export const importInput = z.object({
  sheet: z.enum(SHEETS),
  shape: z.enum(SHAPES),
  csv: z.string().min(1, "paste CSV rows"),
});
export type ImportInput = z.infer<typeof importInput>;

export { firstZodError } from "@/lib/company/validation";
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/lib/diamonds/validation.test.ts`
- [ ] **Step 5: Commit.** `git add src/lib/diamonds/validation.ts test/lib/diamonds/validation.test.ts && git commit -m "feat(diamonds): zod validation for cells, points, imports"`

---

### Task A5: CSV parser

**Files:** Create `src/lib/diamonds/csv.ts`; Test `test/lib/diamonds/csv.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/diamonds/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMatrixCsv } from "@/lib/diamonds/csv";

const HEADER = "carat_band,color,clarity,price_per_carat";

describe("parseMatrixCsv", () => {
  it("parses valid rows into cents", () => {
    const r = parseMatrixCsv(`${HEADER}\n1.00-1.49,G,VS1,8000\n1.00-1.49,H,VS2,6500.50`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(2);
      expect(r.rows[0]).toEqual({ caratBand: "1.00-1.49", color: "G", clarity: "VS1", pricePerCaratCents: 800000 });
      expect(r.rows[1].pricePerCaratCents).toBe(650050);
    }
  });
  it("rejects a missing header", () => {
    const r = parseMatrixCsv(`1.00-1.49,G,VS1,8000`);
    expect(r.ok).toBe(false);
  });
  it("rejects a bad grade with the offending line number", () => {
    const r = parseMatrixCsv(`${HEADER}\n1.00-1.49,G,VS1,8000\n1.00-1.49,ZZ,VS1,9000`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/line 3/);
  });
  it("rejects a non-positive or non-numeric price", () => {
    expect(parseMatrixCsv(`${HEADER}\n1.00-1.49,G,VS1,-5`).ok).toBe(false);
    expect(parseMatrixCsv(`${HEADER}\n1.00-1.49,G,VS1,abc`).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/diamonds/csv.test.ts`

- [ ] **Step 3: Implement.** Create `src/lib/diamonds/csv.ts`:

```ts
import {
  DIAMOND_COLORS, DIAMOND_CLARITIES, CARAT_BANDS,
  type DiamondColor, type DiamondClarity, type CaratBand,
} from "./constants";

export interface ParsedCell {
  caratBand: CaratBand;
  color: DiamondColor;
  clarity: DiamondClarity;
  pricePerCaratCents: number;
}
export type ParseResult =
  | { ok: true; rows: ParsedCell[] }
  | { ok: false; error: string };

const COLORS = new Set<string>(DIAMOND_COLORS);
const CLARITIES = new Set<string>(DIAMOND_CLARITIES);
const BANDS = new Set<string>(CARAT_BANDS);

/** Parse `carat_band,color,clarity,price_per_carat` rows (dollars/ct → cents). */
export function parseMatrixCsv(text: string): ParseResult {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, error: "no rows" };
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  if (header.join(",") !== "carat_band,color,clarity,price_per_carat") {
    return { ok: false, error: "header must be: carat_band,color,clarity,price_per_carat" };
  }
  const rows: ParsedCell[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1; // 1-based, header is line 1
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length !== 4) return { ok: false, error: `line ${lineNo}: expected 4 columns` };
    const [caratBand, color, clarity, priceRaw] = cols;
    if (!BANDS.has(caratBand)) return { ok: false, error: `line ${lineNo}: unknown carat band "${caratBand}"` };
    if (!COLORS.has(color)) return { ok: false, error: `line ${lineNo}: unknown color "${color}"` };
    if (!CLARITIES.has(clarity)) return { ok: false, error: `line ${lineNo}: unknown clarity "${clarity}"` };
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: `line ${lineNo}: price must be a positive number` };
    }
    rows.push({
      caratBand: caratBand as CaratBand,
      color: color as DiamondColor,
      clarity: clarity as DiamondClarity,
      pricePerCaratCents: Math.round(price * 100),
    });
  }
  if (rows.length === 0) return { ok: false, error: "no data rows" };
  return { ok: true, rows };
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/lib/diamonds/csv.test.ts`
- [ ] **Step 5: Commit.** `git add src/lib/diamonds/csv.ts test/lib/diamonds/csv.test.ts && git commit -m "feat(diamonds): CSV matrix parser with row-level validation"`

---

### Task A6: Data-access (summary + history)

**Files:** Create `src/db/diamonds.ts`; Test `test/db/diamonds.test.ts`

- [ ] **Step 1: Failing test.** Create `test/db/diamonds.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { diamondMatrixPrices, diamondPricePoints, diamondIndexHistory } from "@/db/schema";
import { getDiamondSummary, getDiamondTrend } from "@/db/diamonds";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("diamond data-access", () => {
  it("returns null indices and empty points when there is no pricing", async () => {
    const t = await createTestDb(); close = t.close;
    const s = await getDiamondSummary(t.db);
    expect(s.naturalIndex).toBeNull();
    expect(s.labIndex).toBeNull();
    expect(s.points).toEqual([]);
  });

  it("reads the benchmark cell as the index and computes 24h change from history", async () => {
    const t = await createTestDb(); close = t.close;
    // benchmark = round / G / VS1 / 1.00-1.49
    await t.db.insert(diamondMatrixPrices).values({
      sheet: "natural", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 800000,
    });
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    await t.db.insert(diamondIndexHistory).values([
      { series: "natural_index", valueCents: 760000, recordedAt: old },
      { series: "natural_index", valueCents: 800000 },
    ]);
    await t.db.insert(diamondPricePoints).values({
      label: "Pink Diamond 1ct", kind: "fancy_diamond", pricePerCaratCents: 1500000,
    });
    const s = await getDiamondSummary(t.db);
    expect(s.naturalIndex?.cents).toBe(800000);
    // (800000-760000)/760000 ≈ 5.26%
    expect(s.naturalIndex?.change24hPct).toBeGreaterThan(5);
    expect(s.labIndex).toBeNull();
    expect(s.points[0]).toMatchObject({ label: "Pink Diamond 1ct", cents: 1500000 });
  });

  it("returns the natural_index trend series oldest-first", async () => {
    const t = await createTestDb(); close = t.close;
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    await t.db.insert(diamondIndexHistory).values([
      { series: "natural_index", valueCents: 700000, recordedAt: old },
      { series: "natural_index", valueCents: 720000 },
    ]);
    const trend = await getDiamondTrend(t.db, "natural_index");
    expect(trend).toEqual([700000, 720000]);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/db/diamonds.test.ts`

- [ ] **Step 3: Implement.** Create `src/db/diamonds.ts`:

```ts
import { and, eq, asc, desc } from "drizzle-orm";
import type { Db } from "./client";
import { diamondMatrixPrices, diamondPricePoints, diamondIndexHistory } from "./schema";
import { AIYA_ORG_ID } from "./org";
import { BENCHMARK, type Sheet } from "@/lib/diamonds/constants";

export interface IndexValue { cents: number; change24hPct: number | null }
export interface NamedPoint { label: string; kind: string; cents: number }
export interface DiamondSummary {
  naturalIndex: IndexValue | null;
  labIndex: IndexValue | null;
  points: NamedPoint[];
  updatedAt: Date | null;
}

async function benchmarkCents(db: Db, orgId: number, sheet: Sheet): Promise<number | null> {
  const rows = await db
    .select({ cents: diamondMatrixPrices.pricePerCaratCents })
    .from(diamondMatrixPrices)
    .where(
      and(
        eq(diamondMatrixPrices.orgId, orgId),
        eq(diamondMatrixPrices.sheet, sheet),
        eq(diamondMatrixPrices.shape, BENCHMARK.shape),
        eq(diamondMatrixPrices.color, BENCHMARK.color),
        eq(diamondMatrixPrices.clarity, BENCHMARK.clarity),
        eq(diamondMatrixPrices.caratBand, BENCHMARK.caratBand)
      )
    )
    .limit(1);
  return rows[0]?.cents ?? null;
}

/** Latest vs most-recent snapshot >= 24h older; null if <2 usable points. */
async function change24hPct(db: Db, orgId: number, series: string): Promise<number | null> {
  const rows = await db
    .select({ valueCents: diamondIndexHistory.valueCents, recordedAt: diamondIndexHistory.recordedAt })
    .from(diamondIndexHistory)
    .where(and(eq(diamondIndexHistory.orgId, orgId), eq(diamondIndexHistory.series, series)))
    .orderBy(desc(diamondIndexHistory.recordedAt));
  if (rows.length < 2) return null;
  const latest = rows[0];
  const cutoff = latest.recordedAt.getTime() - 24 * 3600 * 1000;
  const prior = rows.find((r) => r.recordedAt.getTime() <= cutoff) ?? rows[rows.length - 1];
  if (!prior.valueCents) return null;
  return ((latest.valueCents - prior.valueCents) / prior.valueCents) * 100;
}

async function indexValue(db: Db, orgId: number, sheet: Sheet, series: string): Promise<IndexValue | null> {
  const cents = await benchmarkCents(db, orgId, sheet);
  if (cents == null) return null;
  return { cents, change24hPct: await change24hPct(db, orgId, series) };
}

export async function getDiamondSummary(db: Db, orgId: number = AIYA_ORG_ID): Promise<DiamondSummary> {
  const [naturalIndex, labIndex, pointRows] = await Promise.all([
    indexValue(db, orgId, "natural", "natural_index"),
    indexValue(db, orgId, "lab", "lab_index"),
    db
      .select({
        label: diamondPricePoints.label,
        kind: diamondPricePoints.kind,
        cents: diamondPricePoints.pricePerCaratCents,
        updatedAt: diamondPricePoints.updatedAt,
      })
      .from(diamondPricePoints)
      .where(eq(diamondPricePoints.orgId, orgId))
      .orderBy(asc(diamondPricePoints.label)),
  ]);
  const updatedAt = pointRows[0]?.updatedAt ?? null;
  const points = pointRows.map((p) => ({ label: p.label, kind: p.kind, cents: p.cents }));
  return { naturalIndex, labIndex, points, updatedAt };
}

export async function getDiamondTrend(
  db: Db,
  series: string = "natural_index",
  orgId: number = AIYA_ORG_ID
): Promise<number[]> {
  const rows = await db
    .select({ valueCents: diamondIndexHistory.valueCents })
    .from(diamondIndexHistory)
    .where(and(eq(diamondIndexHistory.orgId, orgId), eq(diamondIndexHistory.series, series)))
    .orderBy(asc(diamondIndexHistory.recordedAt));
  return rows.map((r) => r.valueCents);
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/db/diamonds.test.ts`
- [ ] **Step 5: Commit.** `git add src/db/diamonds.ts test/db/diamonds.test.ts && git commit -m "feat(db): diamond summary (benchmark indices + 24h change) and trend"`

---

### Task A7: Server actions (import / cell upsert / point CRUD)

**Files:** Create `src/lib/diamonds/actions.ts`; Test `test/lib/diamonds/actions.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/diamonds/actions.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss" })),
}));

import { createTestDb, type Db } from "@/db/client";
import { getDiamondSummary } from "@/db/diamonds";
import {
  importMatrix, upsertMatrixCell, savePricePoint, deletePricePoint, __setTestDb,
} from "@/lib/diamonds/actions";
import { diamondPricePoints } from "@/db/schema";

let close: () => Promise<void>;
let db: Db;
beforeEach(async () => {
  vi.clearAllMocks();
  const t = await createTestDb();
  await __setTestDb(t.db);
  db = t.db; close = t.close;
});
afterEach(async () => { await close(); });

const HEADER = "carat_band,color,clarity,price_per_carat";

describe("diamond actions", () => {
  it("imports a CSV that sets the benchmark → index becomes available", async () => {
    const res = await importMatrix({
      sheet: "natural", shape: "round",
      csv: `${HEADER}\n1.00-1.49,G,VS1,8000`,
    });
    expect(res).toEqual({ ok: true, imported: 1 });
    const s = await getDiamondSummary(db);
    expect(s.naturalIndex?.cents).toBe(800000);
  });

  it("rejects a malformed CSV with no partial writes", async () => {
    const res = await importMatrix({
      sheet: "natural", shape: "round",
      csv: `${HEADER}\n1.00-1.49,ZZ,VS1,8000`,
    });
    expect(res.ok).toBe(false);
    const s = await getDiamondSummary(db);
    expect(s.naturalIndex).toBeNull(); // nothing written
  });

  it("re-import replaces the prior sheet/shape cells", async () => {
    await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,G,VS1,8000` });
    await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,G,VS1,9000` });
    const s = await getDiamondSummary(db);
    expect(s.naturalIndex?.cents).toBe(900000);
  });

  it("upserts a single cell and CRUDs a named point", async () => {
    expect(await upsertMatrixCell({
      sheet: "lab", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 120000,
    })).toEqual({ ok: true });
    expect((await getDiamondSummary(db)).labIndex?.cents).toBe(120000);

    expect(await savePricePoint({ label: "Emerald", kind: "gem", pricePerCaratCents: 50000 }))
      .toEqual({ ok: true });
    const [row] = await db.select({ id: diamondPricePoints.id }).from(diamondPricePoints);
    expect((await getDiamondSummary(db)).points).toHaveLength(1);
    expect(await deletePricePoint(row.id)).toEqual({ ok: true });
    expect((await getDiamondSummary(db)).points).toHaveLength(0);
  });

  it("surfaces unauthorized as a typed error", async () => {
    const { requireSession } = await import("@/lib/auth/requireSession");
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await savePricePoint({ label: "X", kind: "gem", pricePerCaratCents: 1 });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/diamonds/actions.test.ts`

- [ ] **Step 3: Implement.** Create `src/lib/diamonds/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { diamondMatrixPrices, diamondPricePoints, diamondIndexHistory } from "@/db/schema";
import { AIYA_ORG_ID } from "@/db/org";
import { requireSession } from "@/lib/auth/requireSession";
import { BENCHMARK } from "@/lib/diamonds/constants";
import { parseMatrixCsv } from "@/lib/diamonds/csv";
import {
  matrixCellInput, pricePointInput, pricePointUpdateInput, importInput, firstZodError,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };
type ImportResult = { ok: true; imported: number } | { ok: false; error: string };

let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> { testDb = db; }
function db(): Db { return testDb ?? getDb(); }

async function assertSession(): Promise<string | null> {
  try { await requireSession(); return null; } catch { return "Unauthorized"; }
}

/** Append a snapshot of the natural/lab benchmark indices to history. */
async function snapshotIndices(d: Db, orgId: number): Promise<void> {
  for (const [sheet, series] of [["natural", "natural_index"], ["lab", "lab_index"]] as const) {
    const rows = await d
      .select({ cents: diamondMatrixPrices.pricePerCaratCents })
      .from(diamondMatrixPrices)
      .where(and(
        eq(diamondMatrixPrices.orgId, orgId), eq(diamondMatrixPrices.sheet, sheet),
        eq(diamondMatrixPrices.shape, BENCHMARK.shape), eq(diamondMatrixPrices.color, BENCHMARK.color),
        eq(diamondMatrixPrices.clarity, BENCHMARK.clarity), eq(diamondMatrixPrices.caratBand, BENCHMARK.caratBand)
      ))
      .limit(1);
    if (rows[0]) {
      await d.insert(diamondIndexHistory).values({ orgId, series, valueCents: rows[0].cents });
    }
  }
}

export async function importMatrix(raw: unknown): Promise<ImportResult> {
  const unauth = await assertSession();
  if (unauth) return { ok: false, error: unauth };
  const parsedInput = importInput.safeParse(raw);
  if (!parsedInput.success) return { ok: false, error: firstZodError(parsedInput.error) };
  const { sheet, shape, csv } = parsedInput.data;
  const parsed = parseMatrixCsv(csv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  try {
    const d = db();
    // Replace this sheet/shape's cells, then insert the new ones.
    await d.delete(diamondMatrixPrices).where(and(
      eq(diamondMatrixPrices.orgId, AIYA_ORG_ID),
      eq(diamondMatrixPrices.sheet, sheet),
      eq(diamondMatrixPrices.shape, shape)
    ));
    await d.insert(diamondMatrixPrices).values(
      parsed.rows.map((r) => ({
        orgId: AIYA_ORG_ID, sheet, shape,
        color: r.color, clarity: r.clarity, caratBand: r.caratBand,
        pricePerCaratCents: r.pricePerCaratCents,
      }))
    );
    await snapshotIndices(d, AIYA_ORG_ID);
    revalidatePath("/");
    revalidatePath("/diamonds");
    return { ok: true, imported: parsed.rows.length };
  } catch (e) {
    console.error("[diamond import] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

async function run<T>(schema: z.ZodType<T>, raw: unknown, fn: (input: T) => Promise<void>): Promise<ActionResult> {
  const unauth = await assertSession();
  if (unauth) return { ok: false, error: unauth };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data);
    revalidatePath("/");
    revalidatePath("/diamonds");
    return { ok: true };
  } catch (e) {
    console.error("[diamond action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

export async function upsertMatrixCell(raw: unknown): Promise<ActionResult> {
  return run(matrixCellInput, raw, async (input) => {
    await db().insert(diamondMatrixPrices).values({ orgId: AIYA_ORG_ID, ...input })
      .onConflictDoUpdate({
        target: [
          diamondMatrixPrices.orgId, diamondMatrixPrices.sheet, diamondMatrixPrices.shape,
          diamondMatrixPrices.color, diamondMatrixPrices.clarity, diamondMatrixPrices.caratBand,
        ],
        set: { pricePerCaratCents: input.pricePerCaratCents, updatedAt: new Date() },
      });
    await snapshotIndices(db(), AIYA_ORG_ID);
  });
}

export async function savePricePoint(raw: unknown): Promise<ActionResult> {
  const isUpdate = typeof (raw as { id?: unknown })?.id === "number";
  return run(isUpdate ? pricePointUpdateInput : pricePointInput, raw, async (input) => {
    if ("id" in input) {
      await db().update(diamondPricePoints)
        .set({ label: input.label, kind: input.kind, pricePerCaratCents: input.pricePerCaratCents, updatedAt: new Date() })
        .where(eq(diamondPricePoints.id, input.id));
    } else {
      await db().insert(diamondPricePoints).values({ orgId: AIYA_ORG_ID, ...input });
    }
  });
}

export async function deletePricePoint(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid) => {
    await db().delete(diamondPricePoints).where(eq(diamondPricePoints.id, rid));
  });
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/lib/diamonds/actions.test.ts`
- [ ] **Step 5: Commit.** `git add src/lib/diamonds/actions.ts test/lib/diamonds/actions.test.ts && git commit -m "feat(diamonds): import / cell upsert / price-point CRUD actions"`

---

## Phase B — UI & wiring

### Task B1: `/api/diamond-history` route

**Files:** Create `src/app/api/diamond-history/route.ts`; Test `test/app/api/diamond-history.test.ts`

- [ ] **Step 1: Failing test.** Create `test/app/api/diamond-history.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createTestDb } from "@/db/client";
import { diamondIndexHistory } from "@/db/schema";
import { GET, __setHistoryTestDb } from "@/app/api/diamond-history/route";

let close: () => Promise<void>;
beforeEach(async () => {
  const t = await createTestDb();
  __setHistoryTestDb(t.db);
  close = t.close;
  await t.db.insert(diamondIndexHistory).values([
    { series: "natural_index", valueCents: 700000 },
    { series: "natural_index", valueCents: 720000 },
  ]);
});
afterEach(async () => { __setHistoryTestDb(null); await close(); });

describe("/api/diamond-history", () => {
  it("returns the natural index series", async () => {
    const res = await GET(new Request("http://localhost/api/diamond-history"));
    const body = await res.json();
    expect(body.points).toEqual([700000, 720000]);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/app/api/diamond-history.test.ts`

- [ ] **Step 3: Implement.** Create `src/app/api/diamond-history/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ensureDbReady, type Db } from "@/db/client";
import { getDiamondTrend } from "@/db/diamonds";

export const dynamic = "force-dynamic";

// test seam (mirrors the action __setTestDb pattern for route-level tests)
let testDb: Db | null = null;
export function __setHistoryTestDb(db: Db | null): void { testDb = db; }

export async function GET(_request: Request) {
  const db = testDb ?? (await ensureDbReady());
  const points = await getDiamondTrend(db, "natural_index");
  return NextResponse.json({ points, freshness: "delayed" as const });
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/app/api/diamond-history.test.ts`
- [ ] **Step 5: Commit.** `git add "src/app/api/diamond-history/route.ts" test/app/api/diamond-history.test.ts && git commit -m "feat(api): /api/diamond-history for the trend line"`

---

### Task B2: Diamond admin component

**Files:** Create `src/components/diamonds/DiamondAdmin.tsx`; Test `test/components/diamonds/DiamondAdmin.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/diamonds/DiamondAdmin.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiamondAdmin, type PricePointRow } from "@/components/diamonds/DiamondAdmin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const points: PricePointRow[] = [];

it("submits a CSV import", async () => {
  const importAction = vi.fn(async (_raw: unknown) => ({ ok: true as const, imported: 1 }));
  const savePoint = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
  const deletePoint = vi.fn(async (_id: number) => ({ ok: true as const }));
  render(<DiamondAdmin points={points} importAction={importAction}
    savePoint={savePoint} deletePoint={deletePoint} />);
  fireEvent.change(screen.getByLabelText("csv"), {
    target: { value: "carat_band,color,clarity,price_per_carat\n1.00-1.49,G,VS1,8000" },
  });
  fireEvent.click(screen.getByRole("button", { name: /import/i }));
  await waitFor(() => expect(importAction).toHaveBeenCalledTimes(1));
  expect(importAction.mock.calls[0][0]).toMatchObject({ sheet: "natural", shape: "round" });
});

it("surfaces an import error", async () => {
  const importAction = vi.fn(async (_raw: unknown) => ({ ok: false as const, error: "line 2: unknown color" }));
  const savePoint = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
  const deletePoint = vi.fn(async (_id: number) => ({ ok: true as const }));
  render(<DiamondAdmin points={points} importAction={importAction}
    savePoint={savePoint} deletePoint={deletePoint} />);
  fireEvent.change(screen.getByLabelText("csv"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: /import/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/unknown color/);
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/components/diamonds/DiamondAdmin.test.tsx`

- [ ] **Step 3: Implement.** Create `src/components/diamonds/DiamondAdmin.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { formatCents } from "@/lib/company/format";
import { SHEETS, SHAPES, NAMED_POINT_KINDS } from "@/lib/diamonds/constants";

type Result = { ok: true } | { ok: false; error: string };
type ImportResult = { ok: true; imported: number } | { ok: false; error: string };

export interface PricePointRow {
  id: number;
  label: string;
  kind: string;
  pricePerCaratCents: number;
}

export function DiamondAdmin({
  points, importAction, savePoint, deletePoint,
}: {
  points: PricePointRow[];
  importAction: (raw: unknown) => Promise<ImportResult>;
  savePoint: (raw: unknown) => Promise<Result>;
  deletePoint: (id: number) => Promise<Result>;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<string>("natural");
  const [shape, setShape] = useState<string>("round");
  const [csv, setCsv] = useState("");
  const [impErr, setImpErr] = useState<string | null>(null);
  const [impOk, setImpOk] = useState<string | null>(null);

  // named point form
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<string>("fancy_diamond");
  const [ppDollars, setPpDollars] = useState("");
  const [pErr, setPErr] = useState<string | null>(null);

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setImpErr(null); setImpOk(null);
    const res = await importAction({ sheet, shape, csv });
    if (res.ok) { setImpOk(`Imported ${res.imported} cells.`); setCsv(""); router.refresh(); }
    else setImpErr(res.error);
  }

  async function addPoint(e: React.FormEvent) {
    e.preventDefault();
    setPErr(null);
    const res = await savePoint({
      label, kind, pricePerCaratCents: Math.round(Number(ppDollars || 0) * 100),
    });
    if (res.ok) { setLabel(""); setPpDollars(""); router.refresh(); }
    else setPErr(res.error);
  }

  async function removePoint(id: number) {
    const res = await deletePoint(id);
    if (res.ok) router.refresh();
    else setPErr(res.error);
  }

  return (
    <div className="space-y-4">
      <section className="surface-card rounded-xl p-4">
        <h2 className="mb-2 font-display tracking-wider text-gold">Import price sheet (CSV)</h2>
        <p className="mb-2 text-xs text-text/40">
          Header: <code>carat_band,color,clarity,price_per_carat</code> (price in $/ct). Replaces the
          selected sheet + shape.
        </p>
        <form onSubmit={runImport} className="space-y-2 text-sm">
          <div className="flex gap-2">
            <select aria-label="sheet" value={sheet} onChange={(e) => setSheet(e.target.value)} className="bg-bg p-2">
              {SHEETS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="shape" value={shape} onChange={(e) => setShape(e.target.value)} className="bg-bg p-2">
              {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <textarea aria-label="csv" value={csv} onChange={(e) => setCsv(e.target.value)}
            rows={6} className="w-full bg-bg p-2 font-mono text-xs" />
          <div className="flex items-center justify-between">
            <button type="submit" className="rounded bg-gold p-2 text-black">Import</button>
            <FormStatus error={impErr} />
            {impOk && <span className="text-ok text-sm">{impOk}</span>}
          </div>
        </form>
      </section>

      <section className="surface-card rounded-xl p-4">
        <h2 className="mb-2 font-display tracking-wider text-gold">Named price points (fancy + gems)</h2>
        <form onSubmit={addPoint} className="mb-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <input aria-label="label" placeholder="Pink Diamond 1ct" value={label}
            onChange={(e) => setLabel(e.target.value)} className="bg-bg p-2" />
          <select aria-label="point kind" value={kind} onChange={(e) => setKind(e.target.value)} className="bg-bg p-2">
            {NAMED_POINT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input aria-label="price per carat" type="number" placeholder="$/ct" value={ppDollars}
            onChange={(e) => setPpDollars(e.target.value)} className="bg-bg p-2" />
          <button type="submit" className="rounded bg-gold p-2 text-black">Add point</button>
        </form>
        <FormStatus error={pErr} />
        {points.length === 0 ? (
          <p className="text-sm text-text/40">No named points yet.</p>
        ) : (
          <ul className="divide-y divide-text/10 text-sm">
            {points.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span className="flex-1">{p.label}</span>
                <span className="text-text/50">{p.kind}</span>
                <span className="text-text/60">{formatCents(p.pricePerCaratCents)}/ct</span>
                <button className="text-bad" onClick={() => removePoint(p.id)}
                  aria-label={`delete ${p.label}`}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/components/diamonds/DiamondAdmin.test.tsx`
- [ ] **Step 5: Commit.** `git add src/components/diamonds/DiamondAdmin.tsx test/components/diamonds/DiamondAdmin.test.tsx && git commit -m "feat(diamonds): admin (CSV import + named-point CRUD)"`

---

### Task B3: `/diamonds` admin page

**Files:** Create `src/app/(admin)/diamonds/page.tsx`

- [ ] **Step 1: Implement.** Create `src/app/(admin)/diamonds/page.tsx`:

```tsx
import Link from "next/link";
import { asc } from "drizzle-orm";
import { ensureDbReady } from "@/db/client";
import { diamondPricePoints } from "@/db/schema";
import { DiamondAdmin, type PricePointRow } from "@/components/diamonds/DiamondAdmin";
import { importMatrix, savePricePoint, deletePricePoint } from "@/lib/diamonds/actions";

export const dynamic = "force-dynamic";

export default async function DiamondsPage() {
  const db = await ensureDbReady();
  const rows = await db
    .select({
      id: diamondPricePoints.id,
      label: diamondPricePoints.label,
      kind: diamondPricePoints.kind,
      pricePerCaratCents: diamondPricePoints.pricePerCaratCents,
    })
    .from(diamondPricePoints)
    .orderBy(asc(diamondPricePoints.label));

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Diamond &amp; Gem Pricing</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <DiamondAdmin
        points={rows as PricePointRow[]}
        importAction={importMatrix}
        savePoint={savePricePoint}
        deletePoint={deletePricePoint}
      />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → clean.
- [ ] **Step 3: Commit.** `git add "src/app/(admin)/diamonds/page.tsx" && git commit -m "feat(diamonds): admin page at /diamonds"`

---

### Task B4: Gate `/diamonds` + `/api/diamond-history`; link nav

**Files:** Modify `src/middleware.ts`, `src/components/dashboard/Nav.tsx`; Test `test/middleware.test.ts`

- [ ] **Step 1: Failing matcher test.** In `test/middleware.test.ts`, add inside `describe`:

```ts
  it("guards the diamonds admin + history API (slice-1b-3)", () => {
    expect(isMatched("/diamonds")).toBe(true);
    expect(isMatched("/api/diamond-history")).toBe(true);
  });
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/middleware.test.ts`

- [ ] **Step 3: Implement matcher.** In `src/middleware.ts`, update the matcher array to:

```ts
  matcher: [
    "/", "/api/quotes", "/api/convert", "/api/history", "/api/diamond-history",
    "/inventory", "/diamonds", "/company/:path*",
  ],
```

- [ ] **Step 4: Link nav.** In `src/components/dashboard/Nav.tsx`, change the `ROUTES` map to:

```ts
const ROUTES: Record<string, string> = { Inventory: "/inventory", Diamonds: "/diamonds" };
```

- [ ] **Step 5: Run → PASS.** `npx vitest run test/middleware.test.ts`
- [ ] **Step 6: Commit.** `git add src/middleware.ts src/components/dashboard/Nav.tsx test/middleware.test.ts && git commit -m "feat(diamonds): gate /diamonds + history API, link nav entry"`

---

### Task B5: Wire diamond indices into the KPI ticker

**Files:** Modify `src/components/market/KpiTicker.tsx`; Test `test/components/market/KpiTicker.test.tsx`

- [ ] **Step 1: Add failing assertions.** Append to `test/components/market/KpiTicker.test.tsx` a new test (the file already seeds the quotes store in `beforeEach`; add this `it`):

```tsx
  it("shows the diamond index value + change when provided", () => {
    render(<KpiTicker diamond={{ naturalIndex: { cents: 800000, change24hPct: 1.5 }, labIndex: null }} />);
    const natural = screen.getByTestId("kpi-natural-diamond");
    expect(within(natural).getByText(/8,?000\.00|8000\.00/)).toBeInTheDocument();
    const lab = screen.getByTestId("kpi-lab-diamond");
    expect(within(lab).getByText(/awaiting price list/i)).toBeInTheDocument();
  });
```

(`within` is already imported in this test file from slice 1a; if not, add `import { within } from "@testing-library/react"` — actually import from the same `@testing-library/react` render import.)

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/components/market/KpiTicker.test.tsx` (KpiTicker takes no props yet).

- [ ] **Step 3: Implement.** Edit `src/components/market/KpiTicker.tsx`:
  - Add an exported prop type and accept it:

```tsx
export interface DiamondIndexView { cents: number; change24hPct: number | null }
export interface DiamondKpis { naturalIndex: DiamondIndexView | null; labIndex: DiamondIndexView | null }
```

  - Replace the `DiamondPlaceholder` component with one that renders a value when present:

```tsx
function DiamondCard({ testid, label, value }: { testid: string; label: string; value: DiamondIndexView | null }) {
  if (!value) {
    return (
      <div data-testid={testid} className="surface-card rounded-xl border-dashed px-3 py-2 opacity-80">
        <div className="text-[9px] uppercase tracking-wider text-text/45">{label}</div>
        <div className="font-mono text-lg text-text/35">—</div>
        <div className="text-[9px] italic text-text/30">awaiting price list</div>
      </div>
    );
  }
  const up = (value.change24hPct ?? 0) >= 0;
  return (
    <div data-testid={testid} className="surface-card rounded-xl px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-text/45">{label}</div>
      <div className="font-mono text-lg text-text">${(value.cents / 100).toFixed(2)}</div>
      <div className={`text-xs ${up ? "text-ok" : "text-bad"}`}>
        {value.change24hPct == null ? "" : `${up ? "▲" : "▼"} ${Math.abs(value.change24hPct).toFixed(2)}%`}
      </div>
    </div>
  );
}
```

  - Change the `KpiTicker` signature + the two diamond cards:

```tsx
export function KpiTicker({ diamond }: { diamond?: DiamondKpis }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
      <LiveCard {...LIVE_CARDS[0]} featured />
      <DiamondCard testid="kpi-natural-diamond" label="Natural Diamond Index" value={diamond?.naturalIndex ?? null} />
      <DiamondCard testid="kpi-lab-diamond" label="Lab Diamond Index" value={diamond?.labIndex ?? null} />
      {LIVE_CARDS.slice(1).map((c) => (
        <LiveCard key={c.symbol} {...c} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/components/market/KpiTicker.test.tsx` (existing tests + the new one; the existing "honest placeholders" test renders `<KpiTicker />` with no prop → both diamond cards show "awaiting price list", still passing).

- [ ] **Step 5: Commit.** `git add src/components/market/KpiTicker.tsx test/components/market/KpiTicker.test.tsx && git commit -m "feat(dashboard): KPI ticker shows diamond indices when priced"`

---

### Task B6: Wire the Market Intelligence Diamonds tab

**Files:** Modify `src/components/market/MarketIntelligencePanel.tsx`; Test `test/components/market/MarketIntelligencePanel.test.tsx`

- [ ] **Step 1: Add failing test.** Append to `test/components/market/MarketIntelligencePanel.test.tsx`:

```tsx
  it("renders diamond rows on the Diamonds tab when provided", () => {
    render(<MarketIntelligencePanel diamondRows={[
      { label: "Natural 1ct", cents: 800000, change24hPct: 1.2 },
      { label: "Pink Diamond 1ct", cents: 1500000, change24hPct: null },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Diamonds" }));
    expect(screen.getByText("Natural 1ct")).toBeInTheDocument();
    expect(screen.getByText("Pink Diamond 1ct")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/components/market/MarketIntelligencePanel.test.tsx`

- [ ] **Step 3: Implement.** Edit `src/components/market/MarketIntelligencePanel.tsx`:
  - Add an exported row type:

```tsx
export interface DiamondRow { label: string; cents: number; change24hPct: number | null }
```

  - Change the signature to accept the prop and render the Diamonds tab from it:

```tsx
export function MarketIntelligencePanel({ diamondRows }: { diamondRows?: DiamondRow[] }) {
  const [tab, setTab] = useState<Tab>("Gold");
  const liveSymbols = ROWS[tab];
  return (
    <Panel title="Market Intelligence" state="ready">
      <div className="mb-2 flex gap-3 text-xs">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={t === tab ? "text-gold" : "text-text/50"}>
            {t}
          </button>
        ))}
      </div>
      {liveSymbols ? (
        <LiveRows symbols={liveSymbols} />
      ) : tab === "Diamonds" && diamondRows && diamondRows.length > 0 ? (
        <table className="w-full text-xs">
          <tbody>
            {diamondRows.map((r) => {
              const up = (r.change24hPct ?? 0) >= 0;
              return (
                <tr key={r.label} className="border-b border-white/5">
                  <td className="py-1 text-text/80">{r.label}</td>
                  <td className="py-1 text-right font-mono">${(r.cents / 100).toFixed(2)}/ct</td>
                  <td className={`py-1 text-right ${up ? "text-ok" : "text-bad"}`}>
                    {r.change24hPct == null ? "" : `${up ? "▲" : "▼"} ${Math.abs(r.change24hPct).toFixed(2)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="py-4 text-sm italic text-text/30">Not yet wired — future slice</div>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/components/market/MarketIntelligencePanel.test.tsx` (the existing "labels the Diamonds tab as not yet wired" test renders with NO `diamondRows` → still shows the not-yet-wired message; keep it passing).

- [ ] **Step 5: Commit.** `git add src/components/market/MarketIntelligencePanel.tsx test/components/market/MarketIntelligencePanel.test.tsx && git commit -m "feat(dashboard): Market Intelligence Diamonds tab from price data"`

---

### Task B7: Add the diamond line to the Price Trend chart

**Files:** Modify `src/components/market/PriceTrendPanel.tsx`; Test `test/components/market/PriceTrendPanel.test.tsx`

- [ ] **Step 1: Add failing test.** Append to `test/components/market/PriceTrendPanel.test.tsx`:

```tsx
  it("also fetches the diamond index history", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ points: [1, 2, 3], freshness: "delayed" }) } as Response;
    });
    render(<PriceTrendPanel />);
    await waitFor(() => expect(screen.getByTestId("trend-loaded")).toBeInTheDocument());
    expect(calls.some((u) => u.includes("/api/diamond-history"))).toBe(true);
  });
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/components/market/PriceTrendPanel.test.tsx`

- [ ] **Step 3: Implement.** Edit `src/components/market/PriceTrendPanel.tsx`:
  - Add a loader for the diamond history (after the `load` function):

```tsx
async function loadDiamond(): Promise<number[]> {
  const res = await fetch(`/api/diamond-history`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { points?: number[] };
  return data.points ?? [];
}
```

  - Add diamond state + fetch it in the effect, and include it in the chart. Replace the component body's state + effect + `data` + chart so it reads:

```tsx
  const [range, setRange] = useState<Range>("1M");
  const [gold, setGold] = useState<Series | null>(null);
  const [btc, setBtc] = useState<Series | null>(null);
  const [diamond, setDiamond] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([load("XAU", range), load("BTC", range), loadDiamond()]).then(([g, b, d]) => {
      if (cancelled) return;
      setGold(g); setBtc(b); setDiamond(d);
    });
    return () => { cancelled = true; };
  }, [range]);

  const loaded = gold != null && btc != null;
  const data = loaded
    ? gold!.points.map((g, i) => ({ i, gold: g, btc: btc!.points[i] ?? null, diamond: diamond[i] ?? null }))
    : [];
```

  - Add a third `<Line>` (with its own hidden axis) inside the `<LineChart>` after the btc line:

```tsx
            <YAxis yAxisId="diamond" hide domain={["auto", "auto"]} />
            <Line yAxisId="diamond" type="monotone" dataKey="diamond" stroke="hsl(var(--accent-pink))" dot={false} isAnimationActive={false} />
```

  (Place the new `<YAxis>` next to the other YAxis elements and the new `<Line>` after the btc `<Line>`.)

- [ ] **Step 4: Run → PASS.** `npx vitest run test/components/market/PriceTrendPanel.test.tsx` (existing 2 tests + new one; existing tests stub fetch generically so the extra call is harmless).

- [ ] **Step 5: Commit.** `git add src/components/market/PriceTrendPanel.tsx test/components/market/PriceTrendPanel.test.tsx && git commit -m "feat(dashboard): add diamond index line to Price Trend"`

---

### Task B8: Server-read diamond data into the dashboard

**Files:** Modify `src/app/DashboardGrid.tsx`, `src/app/page.tsx`; Test `test/components/dashboard/Dashboard.test.tsx`

- [ ] **Step 1: Update the Dashboard test.** In `test/components/dashboard/Dashboard.test.tsx`, extend the existing render to pass a `diamond` prop and assert the natural index renders. Replace the `render(<DashboardGrid inventory={inventory} />);` line with:

```tsx
    const diamond = {
      kpis: { naturalIndex: { cents: 800000, change24hPct: 1.2 }, labIndex: null },
      rows: [{ label: "Natural 1ct", cents: 800000, change24hPct: 1.2 }],
    };
    render(<DashboardGrid inventory={inventory} diamond={diamond} />);
```

  and add this assertion after the inventory one:

```tsx
    // diamond index now shows a value (not the placeholder text)
    expect(screen.getByTestId("kpi-natural-diamond").textContent).toMatch(/8000\.00|8,000\.00/);
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/components/dashboard/Dashboard.test.tsx`

- [ ] **Step 3: Update `DashboardGrid`.** In `src/app/DashboardGrid.tsx`:
  - Add imports:

```tsx
import type { DiamondKpis } from "@/components/market/KpiTicker";
import type { DiamondRow } from "@/components/market/MarketIntelligencePanel";
```

  - Add to the prop interface + signature:

```tsx
export interface DiamondView { kpis: DiamondKpis; rows: DiamondRow[] }

export function DashboardGrid({ inventory, diamond }: { inventory?: InventoryView; diamond?: DiamondView }) {
```

  - Pass props into the two panels:

```tsx
      <KpiTicker diamond={diamond?.kpis} />
```
```tsx
        <div className="xl:col-span-1"><MarketIntelligencePanel diamondRows={diamond?.rows} /></div>
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/components/dashboard/Dashboard.test.tsx`

- [ ] **Step 5: Wire `page.tsx`.** In `src/app/page.tsx`, read the diamond summary alongside inventory and pass it down. Replace the body so it reads:

```tsx
import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { ensureDbReady } from "@/db/client";
import { getInventorySummary } from "@/db/inventory";
import { getDiamondSummary } from "@/db/diamonds";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await ensureDbReady();
  const [invSummary, dia] = await Promise.all([getInventorySummary(db), getDiamondSummary(db)]);
  const inventory = {
    counts: invSummary.counts,
    total: invSummary.total,
    updatedLabel: updatedAgo(invSummary.updatedAt),
  };
  const diamond = {
    kpis: { naturalIndex: dia.naturalIndex, labIndex: dia.labIndex },
    rows: [
      ...(dia.naturalIndex ? [{ label: "Natural 1ct", cents: dia.naturalIndex.cents, change24hPct: dia.naturalIndex.change24hPct }] : []),
      ...(dia.labIndex ? [{ label: "Lab 1ct", cents: dia.labIndex.cents, change24hPct: dia.labIndex.change24hPct }] : []),
      ...dia.points.map((p) => ({ label: p.label, cents: p.cents, change24hPct: null })),
    ],
  };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} />
      </Shell>
    </QuotesProvider>
  );
}
```

- [ ] **Step 6: Typecheck.** `npx tsc --noEmit` → clean.
- [ ] **Step 7: Commit.** `git add src/app/DashboardGrid.tsx src/app/page.tsx test/components/dashboard/Dashboard.test.tsx && git commit -m "feat(dashboard): server-read diamond pricing into KPIs + Diamonds tab"`

---

## Phase C — Verification

### Task C1: Full suite + typecheck + build + smoke

- [ ] **Step 1:** `npm test` → all green (re-run any single pglite file that flakes under load).
- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3:** `rm -rf .next && npm run build` → success; routes include `/diamonds` and `/api/diamond-history`.
- [ ] **Step 4: Manual smoke** (`npm run dev`, log in):
  - `/diamonds`: paste `carat_band,color,clarity,price_per_carat` + a benchmark row `1.00-1.49,G,VS1,8000` for sheet=natural/shape=round → import; add a named point "Pink Diamond 1ct" fancy_diamond.
  - `/`: Natural Diamond Index KPI shows $8,000.00; Diamonds tab lists Natural 1ct + Pink Diamond 1ct; Price Trend shows a third (pink) line after a second import.
  - Confirm `/diamonds` redirects to `/login` when logged out.
- [ ] **Step 5:** Commit any fixes.

---

## Done criteria
- All new tests green; full suite green; `tsc` clean; build succeeds.
- Diamond KPIs/tab/trend reflect real owner-supplied pricing; honest empty states when absent; no seeded Rapaport values.
- `/diamonds` + `/api/diamond-history` auth-gated; actions re-assert session; DB errors generic.
- Next: slice 1c (customizable layout) or the Netlify demo slice.
