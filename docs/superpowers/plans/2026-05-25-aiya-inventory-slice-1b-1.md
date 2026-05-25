# AIYA Inventory (Slice 1b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Item-level inventory for AIYA — an `inventory_items` table (org-scoped), admin CRUD via Server Actions + Zod, and the Inventory Overview dashboard panel wired to derived category counts.

**Architecture:** Extends the slice-2 data pattern exactly: Drizzle schema + generated migration applied to pglite (dev/test) and Neon (prod); reads via a data-access query; mutations via Server Actions behind the session gate. A server component (`page.tsx`) reads the summary and passes it into the client `DashboardGrid` → `InventoryOverviewPanel`. Establishes the `org_id = AIYA` tenancy seam.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle ORM, pglite/Neon, Zod, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-25-aiya-inventory-slice-1b-1-design.md`

**Conventions:**
- Run a single test file: `npx vitest run <path>`
- DB/action tests use `// @vitest-environment node` and `createTestDb()` + the `__setTestDb` seam (mirror `test/lib/company/actions.test.ts`).
- Money is integer cents; metal weight is integer **milligrams**; carat is integer **×100**. No floats in the DB.
- Commit after every green step.

---

## Phase A — Data layer

### Task A1: Add the `inventory_items` table to the schema

**Files:**
- Modify: `src/db/schema.ts`
- Test: `test/db/schema.test.ts`

- [ ] **Step 1: Add failing schema assertions.** Append inside the existing `describe("db schema", …)` in `test/db/schema.test.ts`:

```ts
  it("exports the inventory_items table with integer money/weight and org scoping", () => {
    expect(schema.inventoryItems).toBeDefined();
    expect(schema.inventoryItems.unitCostCents.columnType).toBe("PgInteger");
    expect(schema.inventoryItems.retailPriceCents.columnType).toBe("PgInteger");
    expect(schema.inventoryItems.weightMg.columnType).toBe("PgInteger");
    expect(schema.inventoryItems.caratX100.columnType).toBe("PgInteger");
    expect(schema.inventoryItems.orgId.columnType).toBe("PgInteger");
  });
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/schema.test.ts`
Expected: FAIL — `schema.inventoryItems` is undefined.

- [ ] **Step 3: Add the table.** In `src/db/schema.ts`, append (the imports `pgTable, serial, integer, text, timestamp` already exist at the top of the file):

```ts
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
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/db/schema.ts test/db/schema.test.ts
git commit -m "feat(db): add inventory_items table (org-scoped, integer money/weight)"
```

---

### Task A2: Generate and commit the migration

**Files:**
- Create: `drizzle/0001_*.sql` (generated) + updated `drizzle/meta/*`

- [ ] **Step 1: Generate the migration.** Run: `npm run db:generate`
Expected: a new `drizzle/0001_<name>.sql` appears containing `CREATE TABLE "inventory_items"`, and `drizzle/meta/_journal.json` + a new snapshot are updated. (drizzle-kit diffs `schema.ts` against the committed snapshot; it is non-interactive.)

- [ ] **Step 2: Verify the migration applies to a fresh test DB.** Create `test/db/inventory-migration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@/db/client";
import { inventoryItems } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("inventory_items migration", () => {
  it("creates the table in a freshly migrated pglite db", async () => {
    const t = await createTestDb();
    close = t.close;
    // Selecting from the table proves the migration ran and the table exists.
    // (Use .select().from() — the pattern the Db union supports everywhere.)
    const rows = await t.db.select({ id: inventoryItems.id }).from(inventoryItems);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify PASS.** Run: `npx vitest run test/db/inventory-migration.test.ts`
Expected: PASS (table exists after migrate). If it fails with "relation inventory_items does not exist", the migration was not generated — re-run Step 1.

- [ ] **Step 4: Commit.**
```bash
git add drizzle test/db/inventory-migration.test.ts
git commit -m "feat(db): generate inventory_items migration"
```

---

### Task A3: Org tenancy seam

**Files:**
- Create: `src/db/org.ts`
- Test: `test/db/org.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/db/org.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { AIYA_ORG_ID, currentOrgId } from "@/db/org";

describe("org seam", () => {
  it("defaults the current org to AIYA (1)", () => {
    expect(AIYA_ORG_ID).toBe(1);
    expect(currentOrgId()).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/org.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/db/org.ts`:

```ts
/**
 * Tenancy seam. AIYA is the only org today, so the "current org" is a constant.
 * When the multi-tenant slice lands, `currentOrgId()` becomes the single place
 * that resolves the org from the session — every query/action already calls it.
 */
export const AIYA_ORG_ID = 1;

export function currentOrgId(): number {
  return AIYA_ORG_ID;
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/org.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/db/org.ts test/db/org.test.ts
git commit -m "feat(db): add AIYA org tenancy seam"
```

---

### Task A4: Inventory validation (Zod)

**Files:**
- Create: `src/lib/inventory/validation.ts`
- Test: `test/lib/inventory/validation.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/lib/inventory/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inventoryItemInput } from "@/lib/inventory/validation";

describe("inventory validation", () => {
  it("accepts a valid finished piece", () => {
    const r = inventoryItemInput.safeParse({
      category: "Rings", name: "Solitaire Band", quantity: 3, status: "in_stock",
      unitCostCents: 50000, retailPriceCents: 120000, metal: "gold", weightMg: 4200,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a loose stone with the 4 Cs", () => {
    const r = inventoryItemInput.safeParse({
      category: "Diamonds", name: "Round Brilliant", quantity: 1, status: "in_stock",
      unitCostCents: 800000, retailPriceCents: 1500000,
      caratX100: 101, cut: "Round", color: "F", clarity: "VVS1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const r = inventoryItemInput.safeParse({
      category: "Spaceships", name: "x", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative quantity", () => {
    const r = inventoryItemInput.safeParse({
      category: "Rings", name: "x", quantity: -1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/inventory/validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/lib/inventory/validation.ts`:

```ts
import { z } from "zod";

export const INVENTORY_CATEGORIES = [
  "Rings", "Necklaces", "Earrings", "Bracelets", "Pendants",
  "Chains", "Watch Bands", "Diamonds", "Gems",
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const INVENTORY_STATUSES = ["in_stock", "reserved", "sold"] as const;
export const METALS = ["gold", "silver", "platinum", "other"] as const;

const cents = z.number().int().min(0);

export const inventoryItemInput = z.object({
  category: z.enum(INVENTORY_CATEGORIES),
  name: z.string().min(1, "name is required").max(160),
  sku: z.string().max(80).optional(),
  quantity: z.number().int().min(0),
  status: z.enum(INVENTORY_STATUSES),
  unitCostCents: cents,
  retailPriceCents: cents,
  metal: z.enum(METALS).optional(),
  weightMg: z.number().int().min(0).optional(),
  caratX100: z.number().int().min(0).optional(),
  cut: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  clarity: z.string().max(40).optional(),
});
export type InventoryItemInput = z.infer<typeof inventoryItemInput>;

export const inventoryItemUpdateInput = inventoryItemInput.extend({ id: z.number().int() });
export type InventoryItemUpdateInput = z.infer<typeof inventoryItemUpdateInput>;

/** Reuse the shared single-message flattener from the company slice. */
export { firstZodError } from "@/lib/company/validation";
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/inventory/validation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/inventory/validation.ts test/lib/inventory/validation.test.ts
git commit -m "feat(inventory): add zod validation + category/status/metal enums"
```

---

### Task A5: Inventory summary query

**Files:**
- Create: `src/db/inventory.ts`
- Test: `test/db/inventory.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/db/inventory.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { getInventorySummary } from "@/db/inventory";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

async function seed(db: Db) {
  await db.insert(inventoryItems).values([
    { category: "Rings", name: "A", quantity: 3, status: "in_stock" },
    { category: "Rings", name: "B", quantity: 2, status: "reserved" },
    { category: "Rings", name: "C", quantity: 5, status: "sold" },      // excluded
    { category: "Diamonds", name: "D", quantity: 10, status: "in_stock" },
    { category: "Necklaces", name: "E", quantity: 1, status: "in_stock", orgId: 2 }, // other org
  ]);
}

describe("getInventorySummary", () => {
  it("sums on-hand quantity per category, excludes sold, scopes to the org, zero-fills", async () => {
    const t = await createTestDb();
    close = t.close;
    await seed(t.db);
    const s = await getInventorySummary(t.db); // defaults to AIYA org (1)
    expect(s.counts.Rings).toBe(5);        // 3 + 2, sold excluded
    expect(s.counts.Diamonds).toBe(10);
    expect(s.counts.Necklaces).toBe(0);    // the qty-1 row is org 2
    expect(s.counts.Earrings).toBe(0);     // zero-filled
    expect(s.total).toBe(15);
    expect(s.updatedAt).not.toBeNull();
  });

  it("returns all-zero counts and null updatedAt for an empty org", async () => {
    const t = await createTestDb();
    close = t.close;
    const s = await getInventorySummary(t.db);
    expect(s.total).toBe(0);
    expect(s.counts.Rings).toBe(0);
    expect(s.updatedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/inventory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/db/inventory.ts`:

```ts
import { and, eq, ne, sql, desc } from "drizzle-orm";
import type { Db } from "./client";
import { inventoryItems } from "./schema";
import { AIYA_ORG_ID } from "./org";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";

export interface InventorySummary {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedAt: Date | null;
}

function zeroCounts(): Record<InventoryCategory, number> {
  return Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c, 0])) as Record<
    InventoryCategory,
    number
  >;
}

export async function getInventorySummary(
  db: Db,
  orgId: number = AIYA_ORG_ID
): Promise<InventorySummary> {
  const rows = await db
    .select({
      category: inventoryItems.category,
      qty: sql<number>`coalesce(sum(${inventoryItems.quantity}), 0)::int`,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.orgId, orgId), ne(inventoryItems.status, "sold")))
    .groupBy(inventoryItems.category);

  const counts = zeroCounts();
  for (const r of rows) {
    if (r.category in counts) counts[r.category as InventoryCategory] = r.qty;
  }
  const total = INVENTORY_CATEGORIES.reduce((sum, c) => sum + counts[c], 0);

  const latest = await db
    .select({ updatedAt: inventoryItems.updatedAt })
    .from(inventoryItems)
    .where(eq(inventoryItems.orgId, orgId))
    .orderBy(desc(inventoryItems.updatedAt))
    .limit(1);

  return { counts, total, updatedAt: latest[0]?.updatedAt ?? null };
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/inventory.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/db/inventory.ts test/db/inventory.test.ts
git commit -m "feat(db): inventory summary query (derived category counts)"
```

---

### Task A6: Inventory server actions (CRUD)

**Files:**
- Create: `src/lib/inventory/actions.ts`
- Test: `test/lib/inventory/actions.test.ts`

- [ ] **Step 1: Write the failing test.** Create `test/lib/inventory/actions.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss" })),
}));

import { createTestDb, type Db } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { getInventorySummary } from "@/db/inventory";
import {
  createInventoryItem, updateInventoryItem, deleteInventoryItem, __setTestDb,
} from "@/lib/inventory/actions";
import { requireSession } from "@/lib/auth/requireSession";

let close: () => Promise<void>;
let db: Db;
beforeEach(async () => {
  vi.clearAllMocks();
  const t = await createTestDb();
  await __setTestDb(t.db);
  db = t.db;
  close = t.close;
});
afterEach(async () => { await close(); });

describe("inventory server actions", () => {
  it("creates an item that shows up in the summary", async () => {
    const res = await createInventoryItem({
      category: "Rings", name: "Solitaire", quantity: 4, status: "in_stock",
      unitCostCents: 1000, retailPriceCents: 2000, metal: "gold", weightMg: 4000,
    });
    expect(res).toEqual({ ok: true });
    const s = await getInventorySummary(db);
    expect(s.counts.Rings).toBe(4);
  });

  it("rejects invalid input with a typed error, no throw", async () => {
    const res = await createInventoryItem({
      category: "Rings", name: "", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error).toMatch(/name/);
  });

  it("updates and deletes an item", async () => {
    await createInventoryItem({
      category: "Diamonds", name: "Stone", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    const [row] = await db.select({ id: inventoryItems.id }).from(inventoryItems);
    expect(await updateInventoryItem({
      id: row.id, category: "Diamonds", name: "Stone", quantity: 7, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    })).toEqual({ ok: true });
    expect((await getInventorySummary(db)).counts.Diamonds).toBe(7);
    expect(await deleteInventoryItem(row.id)).toEqual({ ok: true });
    expect((await getInventorySummary(db)).total).toBe(0);
  });

  it("surfaces unauthorized as a typed error", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized")
    );
    const res = await createInventoryItem({
      category: "Rings", name: "x", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/inventory/actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/lib/inventory/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { AIYA_ORG_ID } from "@/db/org";
import { requireSession } from "@/lib/auth/requireSession";
import {
  inventoryItemInput,
  inventoryItemUpdateInput,
  firstZodError,
  type InventoryItemInput,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

// test seam — inject an isolated pglite db (mirrors the company actions pattern)
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Re-assert session, validate, run, revalidate; never throw to the UI. */
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
    console.error("[inventory action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

function values(input: InventoryItemInput) {
  return {
    orgId: AIYA_ORG_ID,
    category: input.category,
    name: input.name,
    sku: input.sku ?? null,
    quantity: input.quantity,
    status: input.status,
    unitCostCents: input.unitCostCents,
    retailPriceCents: input.retailPriceCents,
    metal: input.metal ?? null,
    weightMg: input.weightMg ?? null,
    caratX100: input.caratX100 ?? null,
    cut: input.cut ?? null,
    color: input.color ?? null,
    clarity: input.clarity ?? null,
  };
}

export async function createInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemInput, raw, async (input) => {
    await db().insert(inventoryItems).values(values(input));
  });
}

export async function updateInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemUpdateInput, raw, async (input) => {
    await db()
      .update(inventoryItems)
      .set({ ...values(input), updatedAt: new Date() })
      .where(eq(inventoryItems.id, input.id));
  });
}

export async function deleteInventoryItem(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid) => {
    await db().delete(inventoryItems).where(eq(inventoryItems.id, rid));
  });
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/inventory/actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/inventory/actions.ts test/lib/inventory/actions.test.ts
git commit -m "feat(inventory): server actions for item CRUD"
```

---

## Phase B — UI

### Task B1: Inventory admin component

**Files:**
- Create: `src/components/inventory/InventoryAdmin.tsx`
- Test: `test/components/inventory/InventoryAdmin.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `test/components/inventory/InventoryAdmin.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InventoryAdmin, type InventoryRow } from "@/components/inventory/InventoryAdmin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const rows: InventoryRow[] = [];

it("shows an empty state and submits a new item", async () => {
  const createAction = vi.fn(async () => ({ ok: true as const }));
  const deleteAction = vi.fn(async () => ({ ok: true as const }));
  render(<InventoryAdmin items={rows} createAction={createAction} deleteAction={deleteAction} />);

  expect(screen.getByText(/add your first item/i)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("name"), { target: { value: "Solitaire" } });
  fireEvent.change(screen.getByLabelText("quantity"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: /add item/i }));

  await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
  expect(createAction.mock.calls[0][0]).toMatchObject({ name: "Solitaire", quantity: 3 });
});

it("surfaces an action error", async () => {
  const createAction = vi.fn(async () => ({ ok: false as const, error: "name is required" }));
  const deleteAction = vi.fn(async () => ({ ok: true as const }));
  render(<InventoryAdmin items={rows} createAction={createAction} deleteAction={deleteAction} />);
  fireEvent.click(screen.getByRole("button", { name: /add item/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("name is required");
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/inventory/InventoryAdmin.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/components/inventory/InventoryAdmin.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { formatCents } from "@/lib/company/format";
import type { ActionResult } from "@/lib/inventory/actions";
import {
  INVENTORY_CATEGORIES, INVENTORY_STATUSES, METALS,
  type InventoryCategory,
} from "@/lib/inventory/validation";

export interface InventoryRow {
  id: number;
  category: InventoryCategory;
  name: string;
  quantity: number;
  status: string;
  unitCostCents: number;
  retailPriceCents: number;
}

const STONE_CATEGORIES = new Set<InventoryCategory>(["Diamonds", "Gems"]);

export function InventoryAdmin({
  items, createAction, deleteAction,
}: {
  items: InventoryRow[];
  createAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  const [category, setCategory] = useState<InventoryCategory>("Rings");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState<string>("in_stock");
  const [costDollars, setCostDollars] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [metal, setMetal] = useState("");
  const [weightG, setWeightG] = useState("");
  const [carat, setCarat] = useState("");
  const [cut, setCut] = useState("");
  const [color, setColor] = useState("");
  const [clarity, setClarity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const isStone = STONE_CATEGORIES.has(category);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const raw: Record<string, unknown> = {
      category,
      name,
      quantity: Math.round(Number(quantity || 0)),
      status,
      unitCostCents: Math.round(Number(costDollars || 0) * 100),
      retailPriceCents: Math.round(Number(priceDollars || 0) * 100),
    };
    if (isStone) {
      if (carat) raw.caratX100 = Math.round(Number(carat) * 100);
      if (cut) raw.cut = cut;
      if (color) raw.color = color;
      if (clarity) raw.clarity = clarity;
    } else {
      if (metal) raw.metal = metal;
      if (weightG) raw.weightMg = Math.round(Number(weightG) * 1000);
    }
    const res = await createAction(raw);
    setPending(false);
    if (res.ok) {
      setOk(true);
      setName("");
      setQuantity("1");
      setCostDollars("");
      setPriceDollars("");
      setWeightG("");
      setCarat("");
      setCut("");
      setColor("");
      setClarity("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function remove(id: number) {
    setError(null);
    const res = await deleteAction(id);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <section className="surface-card rounded-xl p-4">
      <h2 className="mb-3 font-display tracking-wider text-gold">Inventory</h2>

      <form onSubmit={submit} className="mb-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
        <label className="flex flex-col">
          Category
          <select aria-label="category" className="bg-bg p-2" value={category}
            onChange={(e) => setCategory(e.target.value as InventoryCategory)}>
            {INVENTORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          Name
          <input aria-label="name" className="bg-bg p-2" value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Quantity
          <input aria-label="quantity" type="number" className="bg-bg p-2" value={quantity}
            onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Status
          <select aria-label="status" className="bg-bg p-2" value={status}
            onChange={(e) => setStatus(e.target.value)}>
            {INVENTORY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          Unit cost ($)
          <input aria-label="unit cost" type="number" className="bg-bg p-2" value={costDollars}
            onChange={(e) => setCostDollars(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Retail price ($)
          <input aria-label="retail price" type="number" className="bg-bg p-2" value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)} />
        </label>

        {isStone ? (
          <>
            <label className="flex flex-col">
              Carat
              <input aria-label="carat" type="number" className="bg-bg p-2" value={carat}
                onChange={(e) => setCarat(e.target.value)} />
            </label>
            <label className="flex flex-col">
              Cut
              <input aria-label="cut" className="bg-bg p-2" value={cut}
                onChange={(e) => setCut(e.target.value)} />
            </label>
            <label className="flex flex-col">
              Color
              <input aria-label="color" className="bg-bg p-2" value={color}
                onChange={(e) => setColor(e.target.value)} />
            </label>
            <label className="flex flex-col">
              Clarity
              <input aria-label="clarity" className="bg-bg p-2" value={clarity}
                onChange={(e) => setClarity(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col">
              Metal
              <select aria-label="metal" className="bg-bg p-2" value={metal}
                onChange={(e) => setMetal(e.target.value)}>
                <option value="">—</option>
                {METALS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="flex flex-col">
              Weight (g)
              <input aria-label="weight" type="number" className="bg-bg p-2" value={weightG}
                onChange={(e) => setWeightG(e.target.value)} />
            </label>
          </>
        )}

        <div className="col-span-2 flex items-center justify-between md:col-span-3">
          <button className="rounded bg-gold p-2 text-black" type="submit" disabled={pending}>
            Add item
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-text/40">Add your first item to start tracking inventory.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 py-2">
              <span className="flex-1">{it.name}</span>
              <span className="text-text/50">{it.category}</span>
              <span className="text-text/60">×{it.quantity}</span>
              <span className="text-text/60">{it.status}</span>
              <span className="text-text/60">{formatCents(it.retailPriceCents)}</span>
              <button className="text-bad" onClick={() => remove(it.id)}
                aria-label={`delete ${it.name}`}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/inventory/InventoryAdmin.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/components/inventory/InventoryAdmin.tsx test/components/inventory/InventoryAdmin.test.tsx
git commit -m "feat(inventory): admin component (item form + list)"
```

---

### Task B2: Inventory admin page

**Files:**
- Create: `src/app/(admin)/inventory/page.tsx`

- [ ] **Step 1: Implement the server page.** Create `src/app/(admin)/inventory/page.tsx`:

```tsx
import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { InventoryAdmin, type InventoryRow } from "@/components/inventory/InventoryAdmin";
import { createInventoryItem, deleteInventoryItem } from "@/lib/inventory/actions";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const rows = await getDb()
    .select({
      id: inventoryItems.id,
      category: inventoryItems.category,
      name: inventoryItems.name,
      quantity: inventoryItems.quantity,
      status: inventoryItems.status,
      unitCostCents: inventoryItems.unitCostCents,
      retailPriceCents: inventoryItems.retailPriceCents,
    })
    .from(inventoryItems)
    .orderBy(desc(inventoryItems.updatedAt));

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <InventoryAdmin
        items={rows as InventoryRow[]}
        createAction={createInventoryItem}
        deleteAction={deleteInventoryItem}
      />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**
```bash
git add "src/app/(admin)/inventory/page.tsx"
git commit -m "feat(inventory): admin page at /inventory"
```

---

### Task B3: Inventory Overview panel

**Files:**
- Create: `src/components/dashboard/InventoryOverviewPanel.tsx`
- Test: `test/components/dashboard/InventoryOverviewPanel.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `test/components/dashboard/InventoryOverviewPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { InventoryOverviewPanel } from "@/components/dashboard/InventoryOverviewPanel";

const counts = {
  Rings: 1240, Necklaces: 980, Earrings: 870, Bracelets: 620, Pendants: 450,
  Chains: 320, "Watch Bands": 150, Diamonds: 2350, Gems: 1120,
};

it("renders a tile per category with its count, plus the total and provenance", () => {
  render(<InventoryOverviewPanel counts={counts} total={8100} updatedLabel="updated today" />);
  const rings = screen.getByTestId("inv-tile-Rings");
  expect(within(rings).getByText("Rings")).toBeInTheDocument();
  expect(within(rings).getByText("1,240")).toBeInTheDocument();
  expect(screen.getByText(/8,100/)).toBeInTheDocument();
  expect(screen.getByText(/updated today/)).toBeInTheDocument();
});

it("renders an honest empty state when there is no inventory", () => {
  const zero = {
    Rings: 0, Necklaces: 0, Earrings: 0, Bracelets: 0, Pendants: 0,
    Chains: 0, "Watch Bands": 0, Diamonds: 0, Gems: 0,
  };
  render(<InventoryOverviewPanel counts={zero} total={0} updatedLabel={null} />);
  expect(screen.getByText(/no inventory yet/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/dashboard/InventoryOverviewPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/components/dashboard/InventoryOverviewPanel.tsx`:

```tsx
import { Panel } from "@/components/Panel";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";

const NUM = new Intl.NumberFormat("en-US");

export function InventoryOverviewPanel({
  counts, total, updatedLabel,
}: {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedLabel: string | null;
}) {
  if (total === 0) {
    return (
      <Panel title="Inventory Overview" state="ready">
        <div className="py-6 text-center text-sm text-text/40">
          No inventory yet — add items in the Inventory section.
        </div>
      </Panel>
    );
  }
  return (
    <Panel
      title="Inventory Overview"
      state="ready"
      action={updatedLabel ? <span className="text-[10px] text-text/40">{updatedLabel}</span> : undefined}
    >
      <div className="grid grid-cols-3 gap-2">
        {INVENTORY_CATEGORIES.map((c) => (
          <div
            key={c}
            data-testid={`inv-tile-${c}`}
            className="rounded-lg border border-border bg-surface-2/40 px-2 py-2 text-center"
          >
            <div className="font-mono text-base text-gold">{NUM.format(counts[c])}</div>
            <div className="text-[10px] uppercase tracking-wider text-text/50">{c}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right text-xs text-text/60">
        Total items: <span className="font-mono text-text">{NUM.format(total)}</span>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/dashboard/InventoryOverviewPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/components/dashboard/InventoryOverviewPanel.tsx test/components/dashboard/InventoryOverviewPanel.test.tsx
git commit -m "feat(dashboard): Inventory Overview panel (category tiles + total)"
```

---

### Task B4: Wire the panel into the dashboard

**Files:**
- Modify: `src/app/DashboardGrid.tsx`
- Modify: `src/app/page.tsx`
- Modify: `test/components/dashboard/Dashboard.test.tsx`

- [ ] **Step 1: Update the Dashboard test for the now-real panel.** In `test/components/dashboard/Dashboard.test.tsx`:
  - Remove `"panel-inventory-overview"` from the placeholder-id loop.
  - Update the `DashboardGrid` render to pass an `inventory` prop and assert the real panel renders.

Replace the test body's render + assertions so it reads:

```tsx
  it("renders the live panels and honest business placeholders", () => {
    const inventory = {
      counts: {
        Rings: 5, Necklaces: 0, Earrings: 0, Bracelets: 0, Pendants: 0,
        Chains: 0, "Watch Bands": 0, Diamonds: 10, Gems: 0,
      },
      total: 15,
      updatedLabel: "updated today",
    };
    render(<DashboardGrid inventory={inventory} />);
    // Live panels present:
    expect(screen.getByText("Market Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Price Trend Analytics")).toBeInTheDocument();
    expect(screen.getByText("Unit Converter (Advanced)")).toBeInTheDocument();
    // Inventory is now REAL (not a placeholder):
    expect(screen.getByTestId("inv-tile-Diamonds")).toBeInTheDocument();
    // Remaining business placeholders still honest:
    for (const id of [
      "panel-orders-pipeline", "panel-portfolio-snapshot", "panel-financial-overview",
      "panel-crypto-wallet", "panel-tradenet-exchange", "panel-ai-insights",
      "panel-todays-schedule", "panel-social-inbox",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/dashboard/Dashboard.test.tsx`
Expected: FAIL — `DashboardGrid` doesn't accept `inventory`; inventory still renders the placeholder.

- [ ] **Step 3: Update `DashboardGrid`.** In `src/app/DashboardGrid.tsx`:
  - Add the import: `import { InventoryOverviewPanel } from "@/components/dashboard/InventoryOverviewPanel";`
  - Add the import: `import type { InventoryCategory } from "@/lib/inventory/validation";`
  - Define a prop type and accept it:

```tsx
export interface InventoryView {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedLabel: string | null;
}

export function DashboardGrid({ inventory }: { inventory?: InventoryView }) {
```

  - Replace the inventory placeholder line:

```tsx
        <BusinessPlaceholder title="Inventory Overview" testid="panel-inventory-overview" />
```

  with:

```tsx
        {inventory ? (
          <InventoryOverviewPanel
            counts={inventory.counts}
            total={inventory.total}
            updatedLabel={inventory.updatedLabel}
          />
        ) : (
          <BusinessPlaceholder title="Inventory Overview" testid="panel-inventory-overview" />
        )}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/dashboard/Dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the server read in `page.tsx`.** Replace the contents of `src/app/page.tsx` with:

```tsx
import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { getDb } from "@/db/client";
import { getInventorySummary } from "@/db/inventory";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const summary = await getInventorySummary(getDb());
  const inventory = {
    counts: summary.counts,
    total: summary.total,
    updatedLabel: updatedAgo(summary.updatedAt),
  };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} />
      </Shell>
    </QuotesProvider>
  );
}
```

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit.**
```bash
git add src/app/DashboardGrid.tsx src/app/page.tsx test/components/dashboard/Dashboard.test.tsx
git commit -m "feat(dashboard): wire Inventory Overview panel to real data"
```

---

### Task B5: Link the Inventory nav entry

**Files:**
- Modify: `src/components/dashboard/Nav.tsx`
- Test: `test/components/dashboard/Nav.test.tsx`

- [ ] **Step 1: Add a failing assertion.** In `test/components/dashboard/Nav.test.tsx`, add inside the `describe`:

```ts
  it("links the Inventory section to /inventory", () => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Inventory" });
    expect(link).toHaveAttribute("href", "/inventory");
  });
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/dashboard/Nav.test.tsx`
Expected: FAIL — "Inventory" is a `<div>`, not a link.

- [ ] **Step 3: Implement.** In `src/components/dashboard/Nav.tsx`:
  - Add at the top: `import Link from "next/link";`
  - Add a route map above the component:

```tsx
const ROUTES: Record<string, string> = { Inventory: "/inventory" };
```

  - In the `SECTIONS.map(...)`, replace the rendered `<div … >{s}</div>` body so a section with a route renders a `<Link>`. The full map becomes:

```tsx
        {SECTIONS.map((s) => {
          const active = s === "Dashboard";
          const href = ROUTES[s];
          const className = `flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            active
              ? "border border-gold/30 bg-gold/10 text-gold"
              : "border border-transparent text-text/65 hover:bg-surface-2 hover:text-gold"
          }`;
          const dot = <span className={`h-1 w-1 rounded-full ${active ? "bg-gold" : "bg-text/20"}`} />;
          if (href) {
            return (
              <Link key={s} href={href} className={className}>
                {dot}
                {s}
              </Link>
            );
          }
          return (
            <div key={s} aria-current={active ? "page" : undefined} className={`${className} cursor-default`}>
              {dot}
              {s}
            </div>
          );
        })}
```

(Dashboard keeps `aria-current="page"`; routed entries render as links.)

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/dashboard/Nav.test.tsx`
Expected: PASS (3 tests — existing two + the new link test).

- [ ] **Step 5: Commit.**
```bash
git add src/components/dashboard/Nav.tsx test/components/dashboard/Nav.test.tsx
git commit -m "feat(dashboard): link Inventory nav entry to /inventory"
```

---

## Phase C — Verification

### Task C1: Full suite + typecheck + build + smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite.** Run: `npm test`
Expected: all suites PASS (new inventory tests + existing). If a pglite DB test times out under load, re-run that file alone to confirm it's a flake, not a regression.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Build.** Run: `rm -rf .next && npm run build`
Expected: success; routes list includes `/inventory`.

- [ ] **Step 4: Manual smoke.** `npm run dev`, log in, then:
  - `/inventory`: add a Ring (qty 3) and a Diamond (qty 10, with carat/color/clarity); confirm they list; confirm validation error on empty name.
  - `/`: Inventory Overview shows Rings 3, Diamonds 10, Total 13, "updated today"; the sidebar "Inventory" entry navigates to `/inventory`.
  - Delete an item; confirm the dashboard count updates after refresh.

- [ ] **Step 5: Commit any fixes** (skip if none).

---

## Done criteria

- All new tests green; full suite green; `tsc --noEmit` clean; build succeeds.
- `inventory_items` is org-scoped; counts derive correctly (exclude sold, zero-fill, per-org).
- Inventory Overview shows real derived counts with "updated Xd ago"; empty state is honest.
- Admin CRUD works behind the auth gate with surfaced (never silent) errors.
- Next: slice 1b-3 (diamond/gem price lists).
