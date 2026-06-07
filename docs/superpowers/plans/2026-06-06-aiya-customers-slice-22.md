# AIYA Slice 22 — Customers + CRM panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single org-scoped `customers` table with admin CRUD (`/customers` route + table + form), three `runWithUser`-wrapped server actions, two SQL-tenant-filtered query helpers, and an authored demo seed. Foundation for slices 24/25/26-30.

**Architecture:** One new table (`customers`) with `name` + optional `business_name` + a `jsonb` address + two future-proofing nullable columns (`external_ref`, `first_seen_at`) for slice 26's WinJewel import. Three actions (`createCustomer`, `updateCustomer`, `deleteCustomer`) all wrapped in slice-3's `runWithUser` + Zod and gated by owner-only authz with defense-in-depth `eq(orgId)` WHEREs. Two queries (`getCustomers`, `getCustomerById`) with SQL `WHERE org_id = $viewer`. New `/customers` admin route mirrors `/inventory`. JSONB address validation via a Zod transform that normalizes `{}` to `undefined` so we never store empty objects.

**Tech Stack:** Drizzle ORM (pglite dev/test, Neon HTTP prod) · Next.js 15 App Router + Server Actions · React 19 · Zod · vitest (jsdom + node) · Testing Library · Tailwind (existing tokens).

**Branch:** `feature/slice-22-customers` worktree at `.worktrees/slice-22-customers`. See `docs/worktrees.md`.

---

## File Structure

**New files:**
- `src/db/customers.ts` — query layer (`getCustomers`, `getCustomerById`, types `CustomerView`, `CustomerAddress`)
- `src/lib/customers/validation.ts` — Zod schemas (`addressInput`, `createCustomerInput`, `updateCustomerInput`, `deleteCustomerInput`)
- `src/lib/customers/actions.ts` — 3 server actions wrapped via `runWithUser`
- `src/app/customers/page.tsx` — list view RSC
- `src/app/customers/new/page.tsx` — create form RSC
- `src/app/customers/[id]/edit/page.tsx` — edit form RSC
- `src/components/admin/CustomersTable.tsx` — list table + search input + per-row actions
- `src/components/admin/CustomerForm.tsx` — create + edit form
- `drizzle/NNNN_*.sql` + `drizzle/meta/NNNN_snapshot.json` (NNNN = next sequential — read `_journal.json` at execution time; likely `0013_*`)
- `test/db/customers.test.ts`
- `test/db/migration-customers-smoke.test.ts`
- `test/lib/customers/customer-authz.test.ts`
- `test/lib/customers/customer-validation.test.ts`
- `test/components/admin/CustomersTable.test.tsx`
- `test/components/admin/CustomerForm.test.tsx`

**Modified files:**
- `src/db/schema.ts` — add `customers` table
- `src/lib/demo/seed.ts` — append `SeedCustomer` type + `DEMO_CUSTOMERS` constant
- `src/components/dashboard/Nav.tsx` (or wherever the admin nav links live — `grep -rn "/inventory" src/components/` to find) — add `Customers` link
- `test/lib/demo/seed.test.ts` — assert `DEMO_CUSTOMERS` shape

---

## Pre-flight

- [ ] **Pre-flight Step 1: Verify clean working tree on `main`**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git fetch origin --quiet
git pull --ff-only origin main
git status -sb
git log --oneline -1
```

Expected: `## main...origin/main`, no `M`/`A`/`?? ` lines beyond the unrelated `.md2pdf.py` / `FEMALE_AI_BOT.*` / `training protocol/` files. HEAD should be at `84e4259` (the slice-22 spec commit) or a descendant.

- [ ] **Pre-flight Step 2: Cut feature worktree**

```bash
git worktree add .worktrees/slice-22-customers -b feature/slice-22-customers
cd .worktrees/slice-22-customers
ln -sf ../../.env .env
ln -sf ../../node_modules node_modules
git branch --show-current
```

Expected: `feature/slice-22-customers`. Symlinks present.

**All remaining steps run from `.worktrees/slice-22-customers`, NOT from `/root`.**

- [ ] **Pre-flight Step 3: Determine the next migration number**

```bash
ls -1 drizzle/ | grep -E '^[0-9]{4}_' | sort | tail -3
```

Expected: lists the highest-numbered migration on `main`. Slice 22's migration is the next sequential number (e.g. if the latest is `0012_*`, slice-22 generates `0013_*`). Call this `NNNN` for the rest of the plan. **Keep the auto-name** — match the parallel-agent convention.

- [ ] **Pre-flight Step 4: Confirm baseline test suite is green**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: a "Test Files N passed (N) / Tests M passed (M)" summary with zero failures. If anything fails, stop and fix that first.

---

## Phase A — DB foundation + query layer

### Task A1: Add `customers` table to `src/db/schema.ts`

**Files:** Modify: `src/db/schema.ts`

- [ ] **Step 1: Locate where to add the table.**

Open `src/db/schema.ts`. Find the existing `inventoryItems` block (slice-1b-1). Append the `customers` block immediately after it (file ordering is cosmetic; pglite resolves FK order from references).

- [ ] **Step 2: Confirm `jsonb` is imported.**

At the top of `src/db/schema.ts`, look at the existing `import { … } from "drizzle-orm/pg-core";` line. Slice-5's `website_snapshots` already uses `jsonb`, so it's likely already imported. If not, add it.

- [ ] **Step 3: Append the table.**

```ts
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
```

> If `uniqueIndex` isn't already imported from `drizzle-orm/pg-core` (slice-17 added it), add it.

- [ ] **Step 4: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 5: Commit.**

```bash
git add src/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): customers table (slice 22 schema)

Org-scoped. Required: name. Optional: business_name, email, phone,
address (jsonb), notes. Two future-proofing nullable columns
(external_ref, first_seen_at) for slice 26's WinJewel import.

Indexes: (org_id, created_at DESC) for the list path + partial unique
on (org_id, external_ref) WHERE external_ref IS NOT NULL so WinJewel
re-imports are idempotent without forbidding NULL duplicates on
directly-created rows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration + smoke test

- [ ] **Step 1: Generate.**

```bash
npx drizzle-kit generate
ls -1 drizzle/NNNN_*.sql | tail -1
cat drizzle/NNNN_*.sql
```

Replace `NNNN` with the actual number. Expect `CREATE TABLE customers`, FK on `org_id`, `customers_org_created_idx`, and `customers_org_external_ref_unique` (UNIQUE INDEX with partial WHERE).

- [ ] **Step 2: Write `test/db/migration-customers-smoke.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { sql } from "drizzle-orm";

describe("migration NNNN — customers (slice 22)", () => {
  it("creates the customers table and partial-unique on external_ref", async () => {
    const { db, close } = await createTestDb();
    try {
      const tables = await db.execute(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'customers'
      `);
      expect(
        (tables as unknown as { rows: { tablename: string }[] }).rows.map((r) => r.tablename),
      ).toEqual(["customers"]);

      const cols = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'customers'
        ORDER BY ordinal_position
      `);
      const colMap = new Map(
        (cols as unknown as { rows: { column_name: string; is_nullable: "YES" | "NO" }[] }).rows.map(
          (r) => [r.column_name, r.is_nullable],
        ),
      );
      expect(colMap.get("id")).toBe("NO");
      expect(colMap.get("org_id")).toBe("NO");
      expect(colMap.get("name")).toBe("NO");
      expect(colMap.get("business_name")).toBe("YES");
      expect(colMap.get("email")).toBe("YES");
      expect(colMap.get("phone")).toBe("YES");
      expect(colMap.get("address")).toBe("YES");
      expect(colMap.get("notes")).toBe("YES");
      expect(colMap.get("external_ref")).toBe("YES");
      expect(colMap.get("first_seen_at")).toBe("YES");

      // Need an org to insert into customers (FK)
      await db.execute(sql`INSERT INTO orgs (id, name, slug) VALUES (1, 'AIYA', 'aiya') ON CONFLICT (id) DO NOTHING`);

      // Partial unique fires on duplicate non-null external_ref:
      await db.execute(sql`
        INSERT INTO customers (org_id, name, external_ref)
        VALUES (1, 'Alice', 'wj-1')
      `);
      await expect(
        db.execute(sql`
          INSERT INTO customers (org_id, name, external_ref)
          VALUES (1, 'Bob', 'wj-1')
        `),
      ).rejects.toThrow();

      // Partial unique allows multiple NULL external_ref (direct-create customers):
      await db.execute(sql`INSERT INTO customers (org_id, name) VALUES (1, 'NoRef1')`);
      await db.execute(sql`INSERT INTO customers (org_id, name) VALUES (1, 'NoRef2')`);
      const dupNulls = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM customers WHERE org_id = 1 AND external_ref IS NULL
      `);
      const nullCount = (dupNulls as unknown as { rows: { n: number }[] }).rows[0].n;
      expect(nullCount).toBeGreaterThanOrEqual(2);
    } finally {
      await close();
    }
  });
});
```

- [ ] **Step 3: Run the smoke test.**

```bash
npx vitest run test/db/migration-customers-smoke.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: `1 passed`.

- [ ] **Step 4: Commit.**

```bash
git add drizzle/ test/db/migration-customers-smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(db): generate NNNN migration (customers table)

Smoke test asserts the table exists with expected column nullability,
that the partial unique on (org_id, external_ref) fires on duplicate
non-null inserts, and that it permits multiple NULL external_ref
rows (direct-create customers).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Create `src/db/customers.ts` + `getCustomers`

- [ ] **Step 1: Write the failing test at `test/db/customers.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { customers } from "@/db/schema";
import { getCustomers } from "@/db/customers";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

async function seedRow(orgId: number, name: string, extras: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(customers)
    .values({ orgId, name, ...extras })
    .returning();
  return row.id;
}

describe("getCustomers — cross-org isolation", () => {
  it("returns only the viewer's org rows", async () => {
    await seedRow(1, "Alice");
    await seedRow(1, "Bob");
    await seedRow(999, "Charlie");
    expect(await getCustomers(db, 1)).toHaveLength(2);
    expect(await getCustomers(db, 999)).toHaveLength(1);
    expect(await getCustomers(db, 888)).toEqual([]);
  });

  it("orders by name ASC, then created_at DESC tiebreak", async () => {
    await seedRow(1, "Charlie");
    await seedRow(1, "Alice");
    await seedRow(1, "Bob");
    const rows = await getCustomers(db, 1);
    expect(rows.map((r) => r.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("filters by free-text search across name, business_name, email, phone", async () => {
    await seedRow(1, "Priya Mehta", { businessName: "Mehta Diamonds" });
    await seedRow(1, "Other", { email: "Other@MEHTA.com" });
    await seedRow(1, "Phone-Match", { phone: "555-mehta" });
    await seedRow(1, "Unrelated");
    const rows = await getCustomers(db, 1, { search: "mehta" });
    expect(rows.map((r) => r.name).sort()).toEqual(["Other", "Phone-Match", "Priya Mehta"]);
  });

  it("honors the limit parameter (default 50, max 200)", async () => {
    for (let i = 0; i < 10; i++) await seedRow(1, `Cust ${i.toString().padStart(2, "0")}`);
    expect(await getCustomers(db, 1, { limit: 3 })).toHaveLength(3);
    // Cap at 200 — request a huge limit, ensure no SQL error
    const big = await getCustomers(db, 1, { limit: 9999 });
    expect(big.length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run — expect compile failure (module not found).**

```bash
npx vitest run test/db/customers.test.ts --reporter=verbose 2>&1 | tail -10
```

- [ ] **Step 3: Create `src/db/customers.ts`.**

```ts
import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

export type CustomerAddress = {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

export type CustomerView = {
  id: number;
  name: string;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  address: CustomerAddress | null;
  notes: string | null;
  externalRef: string | null;
  firstSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Returns customers in the viewer's org. Search is a free-text ILIKE across
 * name, business_name, email, phone. Ordered by (name ASC, created_at DESC).
 *
 * Demo mode short-circuits to DEMO_CUSTOMERS filtered by org (slice 22 spec §3.4)
 * — the RSC reads the constant directly rather than depending on this branch,
 * but it's here for symmetry and as a safety net.
 */
export async function getCustomers(
  db: Db,
  viewerOrgId: number,
  opts: { search?: string; limit?: number } = {},
): Promise<CustomerView[]> {
  if (isDemoMode()) {
    const { DEMO_CUSTOMERS } = await import("@/lib/demo/seed");
    return DEMO_CUSTOMERS.filter((c) => c.orgId === viewerOrgId).map((c) => ({
      id: c.id,
      name: c.name,
      businessName: c.businessName,
      email: c.email,
      phone: c.phone,
      address: c.address,
      notes: c.notes,
      externalRef: null,
      firstSeenAt: null,
      createdAt: new Date(Date.now() - c.createdAtOffsetMinutes * 60_000),
      updatedAt: new Date(Date.now() - c.createdAtOffsetMinutes * 60_000),
    }));
  }

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const search = opts.search?.trim() ?? null;

  const res = await db.execute(sql`
    SELECT id, name, business_name, email, phone, address, notes,
           external_ref, first_seen_at, created_at, updated_at
    FROM customers
    WHERE org_id = ${viewerOrgId}
      AND (
        ${search}::text IS NULL
        OR name ILIKE '%' || ${search}::text || '%'
        OR business_name ILIKE '%' || ${search}::text || '%'
        OR email ILIKE '%' || ${search}::text || '%'
        OR phone ILIKE '%' || ${search}::text || '%'
      )
    ORDER BY name ASC, created_at DESC
    LIMIT ${limit}
  `);

  const rows = rowsOf<{
    id: number;
    name: string;
    business_name: string | null;
    email: string | null;
    phone: string | null;
    address: CustomerAddress | null;
    notes: string | null;
    external_ref: string | null;
    first_seen_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    businessName: r.business_name,
    email: r.email,
    phone: r.phone,
    address: r.address,
    notes: r.notes,
    externalRef: r.external_ref,
    firstSeenAt:
      r.first_seen_at === null
        ? null
        : r.first_seen_at instanceof Date
        ? r.first_seen_at
        : new Date(r.first_seen_at),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
  }));
}
```

- [ ] **Step 4: Run — expect `4 passed`.**

```bash
npx vitest run test/db/customers.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/db/customers.ts test/db/customers.test.ts
git commit -m "$(cat <<'EOF'
feat(db): getCustomers — org-scoped list with free-text search

SQL WHERE org_id = $viewer enforces tenancy; no application-layer
filtering. Free-text search ILIKE across name, business_name, email,
phone. Default limit 50; cap 200. Demo-mode short-circuits to
DEMO_CUSTOMERS filtered by org so the live demo renders a populated
CRM without requiring real DB rows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Add `getCustomerById`

- [ ] **Step 1: Append failing tests to `test/db/customers.test.ts`.**

```ts
import { getCustomerById } from "@/db/customers";

describe("getCustomerById", () => {
  it("returns the customer for the owner", async () => {
    const id = await seedRow(1, "Alice", { email: "a@x.com" });
    const row = await getCustomerById(db, 1, id);
    expect(row?.name).toBe("Alice");
    expect(row?.email).toBe("a@x.com");
  });

  it("returns null when the customer is in a different org", async () => {
    const id = await seedRow(999, "Hidden");
    expect(await getCustomerById(db, 1, id)).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    expect(await getCustomerById(db, 1, 9_999_999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Append to `src/db/customers.ts`.**

```ts
/**
 * Returns one customer if it exists in the viewer's org. Returns null when
 * the row doesn't exist OR exists in a different org — caller has no way to
 * distinguish the two cases. By design.
 */
export async function getCustomerById(
  db: Db,
  viewerOrgId: number,
  id: number,
): Promise<CustomerView | null> {
  if (isDemoMode()) {
    const { DEMO_CUSTOMERS } = await import("@/lib/demo/seed");
    const c = DEMO_CUSTOMERS.find((x) => x.id === id && x.orgId === viewerOrgId);
    if (!c) return null;
    return {
      id: c.id,
      name: c.name,
      businessName: c.businessName,
      email: c.email,
      phone: c.phone,
      address: c.address,
      notes: c.notes,
      externalRef: null,
      firstSeenAt: null,
      createdAt: new Date(Date.now() - c.createdAtOffsetMinutes * 60_000),
      updatedAt: new Date(Date.now() - c.createdAtOffsetMinutes * 60_000),
    };
  }

  const res = await db.execute(sql`
    SELECT id, name, business_name, email, phone, address, notes,
           external_ref, first_seen_at, created_at, updated_at
    FROM customers
    WHERE id = ${id} AND org_id = ${viewerOrgId}
    LIMIT 1
  `);

  const [r] = rowsOf<{
    id: number;
    name: string;
    business_name: string | null;
    email: string | null;
    phone: string | null;
    address: CustomerAddress | null;
    notes: string | null;
    external_ref: string | null;
    first_seen_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(res);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    businessName: r.business_name,
    email: r.email,
    phone: r.phone,
    address: r.address,
    notes: r.notes,
    externalRef: r.external_ref,
    firstSeenAt:
      r.first_seen_at === null
        ? null
        : r.first_seen_at instanceof Date
        ? r.first_seen_at
        : new Date(r.first_seen_at),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
  };
}
```

- [ ] **Step 4: Run — expect 7 passed in this file (4 + 3 new).**

- [ ] **Step 5: Commit.**

```bash
git add src/db/customers.ts test/db/customers.test.ts
git commit -m "feat(db): getCustomerById — owner-only single-row fetch

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task A5: Phase A green-bar verification

- [ ] Step 1: Full suite. `npm test -- --run 2>&1 | tail -10`. Zero failures.
- [ ] Step 2: tsc. `npx tsc --noEmit 2>&1 | tail -10`. Zero errors.

---

## Phase B — Server actions + validation

### Task B1: Zod schemas in `src/lib/customers/validation.ts`

- [ ] **Step 1: Create the file.**

```ts
import { z } from "zod";

/** JSONB address shape. All sub-fields optional. Empty object → null at write. */
export const addressInput = z
  .object({
    street1: z.string().trim().max(200).optional(),
    street2: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    zip: z.string().trim().max(20).optional(),
    country: z.string().trim().length(2).optional(),
  })
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const hasAny = Object.values(v).some((s) => s !== undefined && s !== "");
    return hasAny ? v : undefined;
  });

export const createCustomerInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  businessName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email("Invalid email").optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  address: addressInput,
  notes: z.string().trim().min(1).max(2000).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerInput>;

export const updateCustomerInput = createCustomerInput.extend({
  id: z.number().int().positive(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerInput>;

export const deleteCustomerInput = z.object({
  id: z.number().int().positive(),
});
export type DeleteCustomerInput = z.infer<typeof deleteCustomerInput>;
```

- [ ] **Step 2: Typecheck + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -5
git add src/lib/customers/validation.ts
git commit -m "$(cat <<'EOF'
feat(customers): Zod schemas for slice-22 actions

addressInput normalizes empty objects to undefined so we never store
address: {} rows. Country enforced as ISO-2 (length 2). Notes capped
at 2000 chars; trim()ed everywhere.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Validation edge-case tests

- [ ] **Step 1: Write `test/lib/customers/customer-validation.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import { createCustomerInput, addressInput } from "@/lib/customers/validation";

describe("addressInput Zod transform", () => {
  it("normalizes {} to undefined", () => {
    const r = addressInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeUndefined();
  });

  it("normalizes all-empty-string fields to undefined", () => {
    const r = addressInput.safeParse({ street1: "", city: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeUndefined();
  });

  it("keeps non-empty addresses intact", () => {
    const r = addressInput.safeParse({ city: "Mumbai", country: "IN" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ city: "Mumbai", country: "IN" });
  });

  it("rejects country codes that aren't ISO-2", () => {
    const r = addressInput.safeParse({ country: "USA" });
    expect(r.success).toBe(false);
  });
});

describe("createCustomerInput", () => {
  it("requires name", () => {
    const r = createCustomerInput.safeParse({ name: "" });
    expect(r.success).toBe(false);
  });

  it("rejects malformed email", () => {
    const r = createCustomerInput.safeParse({ name: "Alice", email: "not-an-email" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.message).toMatch(/email/i);
  });

  it("rejects notes longer than 2000 chars", () => {
    const r = createCustomerInput.safeParse({ name: "X", notes: "z".repeat(2001) });
    expect(r.success).toBe(false);
  });

  it("trims surrounding whitespace on every text field", () => {
    const r = createCustomerInput.safeParse({
      name: "  Alice  ",
      businessName: "  Acme  ",
      email: "  a@x.com  ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Alice");
      expect(r.data.businessName).toBe("Acme");
      expect(r.data.email).toBe("a@x.com");
    }
  });
});
```

- [ ] **Step 2: Run + commit.**

```bash
npx vitest run test/lib/customers/customer-validation.test.ts --reporter=verbose 2>&1 | tail -15
git add test/lib/customers/customer-validation.test.ts
git commit -m "test(customers): Zod validation edge cases (empty address, email, notes cap, trim)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B3: Implement `createCustomer` + authz test

- [ ] **Step 1: Write the failing test at `test/lib/customers/customer-authz.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { customers } from "@/db/schema";
import { createCustomer, __setTestDb } from "@/lib/customers/actions";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

describe("createCustomer", () => {
  it("creates a row in the caller's org (org_id from session, not wire)", async () => {
    const res = await createCustomer({ name: "Priya Mehta", businessName: "Mehta Diamonds" });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(customers);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
    expect(rows[0].name).toBe("Priya Mehta");
    expect(rows[0].businessName).toBe("Mehta Diamonds");
    // Future-proofing columns remain null at create time
    expect(rows[0].externalRef).toBeNull();
    expect(rows[0].firstSeenAt).toBeNull();
  });

  it("normalizes empty address to null at write", async () => {
    await createCustomer({ name: "X", address: {} });
    const [row] = await db.select().from(customers);
    expect(row.address).toBeNull();
  });

  it("stores non-empty address as JSONB object", async () => {
    await createCustomer({
      name: "X",
      address: { city: "Mumbai", country: "IN" },
    });
    const [row] = await db.select().from(customers);
    expect(row.address).toMatchObject({ city: "Mumbai", country: "IN" });
  });

  it("returns Zod error for invalid input", async () => {
    const res = await createCustomer({ name: "", email: "not-an-email" });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Create `src/lib/customers/actions.ts`.**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { customers } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import { firstZodError } from "@/lib/deals/validation";
import {
  createCustomerInput,
  updateCustomerInput,
  deleteCustomerInput,
  type CreateCustomerInput,
  type UpdateCustomerInput,
  type DeleteCustomerInput,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Demo-guard, session re-assert, validate, run, revalidate; never throw to UI. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<void>,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, orgId);
    revalidatePath("/");
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "Forbidden" };
    console.error("[customers action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "customers-action" } });
    return { ok: false, error: "Database error" };
  }
}

export async function createCustomer(raw: unknown): Promise<ActionResult> {
  return run(createCustomerInput, raw, async (input: CreateCustomerInput, orgId) => {
    await db().insert(customers).values({
      orgId,
      name: input.name,
      businessName: input.businessName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      // external_ref + first_seen_at remain NULL on direct creates.
    });
  });
}
```

- [ ] **Step 4: Run — expect all 4 cases pass.**

```bash
npx vitest run test/lib/customers/customer-authz.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/customers/actions.ts test/lib/customers/customer-authz.test.ts
git commit -m "$(cat <<'EOF'
feat(customers): createCustomer — org-scoped insert with address normalization

org_id is set from session, never from the wire — no cross-org-create
surface. addressInput's Zod transform turns empty objects into
undefined so we never store address: {} rows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Implement `updateCustomer` + tests

- [ ] **Step 1: Append to `test/lib/customers/customer-authz.test.ts`.**

```ts
import { updateCustomer } from "@/lib/customers/actions";
import { requireSession } from "@/lib/auth/requireSession";

describe("updateCustomer", () => {
  it("allows the owner to update their own customer", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "Old name" })
      .returning();
    const res = await updateCustomer({ id: r.id, name: "New name" });
    expect(res).toEqual({ ok: true });
    const [after] = await db.select().from(customers).where(eq(customers.id, r.id));
    expect(after.name).toBe("New name");
  });

  it("forbids updating a customer in a different org", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 999, name: "Untouchable" })
      .returning();
    const res = await updateCustomer({ id: r.id, name: "PWNED" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [after] = await db.select().from(customers).where(eq(customers.id, r.id));
    expect(after.name).toBe("Untouchable");
  });

  it("forbids updating a non-existent id", async () => {
    const res = await updateCustomer({ id: 9_999_999, name: "X" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Append to `src/lib/customers/actions.ts`.**

```ts
export async function updateCustomer(raw: unknown): Promise<ActionResult> {
  return run(updateCustomerInput, raw, async (input: UpdateCustomerInput, orgId) => {
    const d = db();
    // Pre-flight: confirm the row exists in caller's org.
    const [existing] = await d
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, input.id), eq(customers.orgId, orgId)))
      .limit(1);
    if (!existing) throw new ForbiddenError();

    await d
      .update(customers)
      .set({
        name: input.name,
        businessName: input.businessName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, input.id), eq(customers.orgId, orgId)));
  });
}
```

- [ ] **Step 4: Run — expect 7 passed total in this file.**

- [ ] **Step 5: Commit.**

```bash
git add src/lib/customers/actions.ts test/lib/customers/customer-authz.test.ts
git commit -m "feat(customers): updateCustomer — owner-only with defense-in-depth WHERE

Pre-flight SELECT confirms row exists in caller's org. UPDATE WHERE
includes eq(orgId, callerOrgId) so a TOCTOU race can never write
to a row in another org.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B5: Implement `deleteCustomer` + tests

- [ ] **Step 1: Append to `test/lib/customers/customer-authz.test.ts`.**

```ts
import { deleteCustomer } from "@/lib/customers/actions";

describe("deleteCustomer", () => {
  it("allows the owner to delete their own customer", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "Bye" })
      .returning();
    expect(await deleteCustomer({ id: r.id })).toEqual({ ok: true });
    const rows = await db.select().from(customers).where(eq(customers.id, r.id));
    expect(rows).toHaveLength(0);
  });

  it("returns ok but does not delete a different org's row (zero rows affected)", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 999, name: "Survives" })
      .returning();
    expect(await deleteCustomer({ id: r.id })).toEqual({ ok: true });
    const rows = await db.select().from(customers).where(eq(customers.id, r.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Survives");
  });
});
```

> Note: The `deleteCustomer` action returns `{ok:true}` even when zero rows match — the defense-in-depth `eq(orgId)` in the WHERE clause silently filters out cross-org IDs. Caller has no way to learn the row didn't exist; that's intentional (no enumeration via timing or response variance).

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Append to `src/lib/customers/actions.ts`.**

```ts
export async function deleteCustomer(raw: unknown): Promise<ActionResult> {
  return run(deleteCustomerInput, raw, async (input: DeleteCustomerInput, orgId) => {
    await db()
      .delete(customers)
      .where(and(eq(customers.id, input.id), eq(customers.orgId, orgId)));
  });
}
```

- [ ] **Step 4: Run — expect 9 passed in this file.**

- [ ] **Step 5: Commit.**

```bash
git add src/lib/customers/actions.ts test/lib/customers/customer-authz.test.ts
git commit -m "feat(customers): deleteCustomer — owner-only hard delete

WHERE includes defense-in-depth eq(orgId, callerOrgId) so cross-org
IDs silently affect zero rows. Caller can't enumerate other orgs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B6: Phase B green-bar verification

- [ ] Step 1: Full suite. Expect zero failures.
- [ ] Step 2: tsc clean.

---

## Phase C — Demo seed + UI

### Task C1: `DEMO_CUSTOMERS` constant in `src/lib/demo/seed.ts`

- [ ] **Step 1: Read the existing demo-seed structure** to find where slice-17's `DEMO_DEAL_ATTACHMENTS` lives. The new constant goes after it.

```bash
grep -nE "DEMO_DEAL_ATTACHMENTS|DEMO_AIYA_ORG_ID" src/lib/demo/seed.ts | head -10
```

- [ ] **Step 2: Append type + constant.**

```ts
// --- Slice 22 demo seed: authored-only customers ---
// Same pattern as DEMO_DEAL_ATTACHMENTS — TS constants, not inserted at
// runtime. The query layer reads this in demo mode.
export type SeedCustomer = {
  id: number;
  orgId: number;
  name: string;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  address: {
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  } | null;
  notes: string | null;
  createdAtOffsetMinutes: number;
};

export const DEMO_CUSTOMERS: SeedCustomer[] = [
  {
    id: 2201,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Priya Mehta",
    businessName: "Mehta Diamonds Pvt Ltd",
    email: "priya@mehtadiamonds.in",
    phone: "+91 22 5555 1100",
    address: { street1: "12 Opera House", city: "Mumbai", state: "MH", zip: "400004", country: "IN" },
    notes: "Long-time wholesale partner; prefers wire transfer.",
    createdAtOffsetMinutes: 60 * 24 * 30,
  },
  {
    id: 2202,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Jean-Marc Auclair",
    businessName: "Saint-Cloud Atelier",
    email: "jm@saintcloud.fr",
    phone: "+33 1 42 60 11 22",
    address: { street1: "8 Rue de Rivoli", city: "Paris", zip: "75001", country: "FR" },
    notes: "Boutique buyer — small lots, high quality.",
    createdAtOffsetMinutes: 60 * 24 * 14,
  },
  {
    id: 2203,
    orgId: DEMO_AIYA_ORG_ID,
    name: "Anita Sharma",
    businessName: null,
    email: "anita.sharma@example.com",
    phone: "+1 415 555 0177",
    address: { street1: "1500 Fillmore St", city: "San Francisco", state: "CA", zip: "94115", country: "US" },
    notes: null,
    createdAtOffsetMinutes: 60 * 24 * 5,
  },
];
```

- [ ] **Step 3: Add test to `test/lib/demo/seed.test.ts`.**

```ts
import { DEMO_CUSTOMERS } from "@/lib/demo/seed";

describe("DEMO_CUSTOMERS — slice-22 authored seed", () => {
  it("exports 3 customers on AIYA with a mix of business and individual", () => {
    expect(DEMO_CUSTOMERS).toHaveLength(3);
    expect(DEMO_CUSTOMERS.every((c) => c.orgId === DEMO_AIYA_ORG_ID)).toBe(true);
    const byName = new Map(DEMO_CUSTOMERS.map((c) => [c.name, c]));
    expect(byName.get("Priya Mehta")?.businessName).toBe("Mehta Diamonds Pvt Ltd");
    expect(byName.get("Jean-Marc Auclair")?.businessName).toBe("Saint-Cloud Atelier");
    expect(byName.get("Anita Sharma")?.businessName).toBeNull();
  });
});
```

- [ ] **Step 4: Run + commit.**

```bash
npx vitest run test/lib/demo/seed.test.ts --reporter=verbose 2>&1 | tail -10
git add src/lib/demo/seed.ts test/lib/demo/seed.test.ts
git commit -m "feat(demo): DEMO_CUSTOMERS — slice-22 authored seed (3 entries on AIYA)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C2: `CustomersTable` component

- [ ] **Step 1: Create `src/components/admin/CustomersTable.tsx`.**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { CustomerView } from "@/db/customers";

export type CustomersTableProps = {
  customers: CustomerView[];
  search: string;
  actions: {
    deleteCustomer: (input: { id: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function CustomersTable(props: CustomersTableProps) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  return (
    <div aria-label="customers table">
      <form method="get" className="mb-3 flex gap-2">
        <input
          aria-label="search customers"
          name="q"
          defaultValue={props.search}
          placeholder="Search name, business, email, phone…"
          className="flex-1 bg-zinc-800 text-zinc-100 px-2 py-1 rounded text-sm"
        />
        <button type="submit" className="text-xs px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-100">
          Search
        </button>
        <a
          href="/customers/new"
          className="text-xs px-3 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-900 rounded"
        >
          + Add customer
        </a>
      </form>

      {actionError && (
        <p role="alert" className="text-xs text-rose-400 mb-2">{actionError}</p>
      )}

      {props.customers.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No customers yet. Add your first customer or import from WinJewel (coming soon).
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-400 text-xs border-b border-zinc-700">
              <th className="py-1">Customer</th>
              <th className="py-1">Email</th>
              <th className="py-1">Phone</th>
              <th className="py-1">Created</th>
              <th className="py-1 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.customers.map((c) => (
              <tr key={c.id} aria-label="customer row" className="border-b border-zinc-800">
                <td className="py-1">
                  <div className="font-semibold text-zinc-100">{c.businessName ?? c.name}</div>
                  {c.businessName && (
                    <div className="text-xs text-zinc-400">{c.name}</div>
                  )}
                </td>
                <td className="py-1 text-zinc-300">{c.email ?? "—"}</td>
                <td className="py-1 text-zinc-300">{c.phone ?? "—"}</td>
                <td className="py-1 text-xs text-zinc-400">{relativeTime(c.createdAt)}</td>
                <td className="py-1 text-right">
                  <a href={`/customers/${c.id}/edit`} className="text-xs text-amber-300 hover:text-amber-200 mr-2">
                    Edit
                  </a>
                  <button
                    aria-label={`delete customer ${c.id}`}
                    type="button"
                    className="text-xs text-zinc-500 hover:text-rose-400"
                    onClick={() => setConfirmId(c.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirmId !== null && (
        <div aria-label="delete confirm" role="dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/80">
          <div className="bg-zinc-900 border border-zinc-700 rounded p-4 max-w-sm">
            <p className="text-sm text-zinc-100 mb-3">Delete this customer? This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="text-xs px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-100"
                onClick={() => setConfirmId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                aria-label="confirm delete"
                disabled={pending}
                className="text-xs px-3 py-1 bg-rose-600 hover:bg-rose-500 rounded text-zinc-100"
                onClick={() => {
                  setActionError(null);
                  const id = confirmId;
                  setConfirmId(null);
                  startTransition(async () => {
                    const res = await props.actions.deleteCustomer({ id });
                    if (!res.ok) setActionError(res.error);
                  });
                }}
              >
                {pending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/components/admin/CustomersTable.tsx
git commit -m "feat(customers): CustomersTable — search + table + delete confirm

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C3: `CustomerForm` component

- [ ] **Step 1: Create `src/components/admin/CustomerForm.tsx`.**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerView, CustomerAddress } from "@/db/customers";

export type CustomerFormProps = {
  initial?: CustomerView;
  actions: {
    createCustomer: (input: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
    updateCustomer: (input: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

const ISO2_COUNTRIES = [
  ["US", "United States"], ["IN", "India"], ["FR", "France"], ["GB", "United Kingdom"],
  ["JP", "Japan"], ["AE", "United Arab Emirates"], ["SG", "Singapore"], ["HK", "Hong Kong"],
  ["IT", "Italy"], ["DE", "Germany"], ["CH", "Switzerland"], ["BR", "Brazil"],
  ["MX", "Mexico"], ["CA", "Canada"], ["AU", "Australia"], ["TR", "Türkiye"],
  ["TH", "Thailand"], ["ZA", "South Africa"], ["ES", "Spain"], ["NL", "Netherlands"],
];

export function CustomerForm(props: CustomerFormProps) {
  const router = useRouter();
  const i = props.initial;

  const [name, setName] = useState(i?.name ?? "");
  const [businessName, setBusinessName] = useState(i?.businessName ?? "");
  const [email, setEmail] = useState(i?.email ?? "");
  const [phone, setPhone] = useState(i?.phone ?? "");
  const [notes, setNotes] = useState(i?.notes ?? "");

  const a: CustomerAddress = i?.address ?? {};
  const [street1, setStreet1] = useState(a.street1 ?? "");
  const [street2, setStreet2] = useState(a.street2 ?? "");
  const [city, setCity] = useState(a.city ?? "");
  const [state, setState] = useState(a.state ?? "");
  const [zip, setZip] = useState(a.zip ?? "");
  const [country, setCountry] = useState(a.country ?? "");

  const hasAddress = Boolean(a.street1 || a.city || a.state || a.zip || a.country);
  const [addrOpen, setAddrOpen] = useState(hasAddress);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = () => {
    setError(null);
    const payload = {
      ...(i ? { id: i.id } : {}),
      name: name.trim(),
      businessName: businessName.trim() === "" ? undefined : businessName.trim(),
      email: email.trim() === "" ? undefined : email.trim(),
      phone: phone.trim() === "" ? undefined : phone.trim(),
      address: {
        street1: street1.trim() || undefined,
        street2: street2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        zip: zip.trim() || undefined,
        country: country.trim() || undefined,
      },
      notes: notes.trim() === "" ? undefined : notes.trim(),
    };
    startTransition(async () => {
      const res = i
        ? await props.actions.updateCustomer(payload)
        : await props.actions.createCustomer(payload);
      if (res.ok) router.push("/customers");
      else setError(res.error);
    });
  };

  return (
    <div aria-label="customer form" className="flex flex-col gap-3 max-w-xl">
      <label className="text-xs text-zinc-400">
        Name<span className="text-rose-400">*</span>
        <input
          aria-label="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1"
        />
      </label>

      <label className="text-xs text-zinc-400">
        Business name (optional)
        <input
          aria-label="business name"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1"
        />
      </label>

      <label className="text-xs text-zinc-400">
        Email
        <input
          aria-label="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1"
        />
      </label>

      <label className="text-xs text-zinc-400">
        Phone
        <input
          aria-label="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1"
        />
      </label>

      <button
        type="button"
        aria-label="toggle address"
        onClick={() => setAddrOpen((v) => !v)}
        className="text-xs text-zinc-300 self-start"
      >
        {addrOpen ? "▾" : "▸"} Address
      </button>
      {addrOpen && (
        <div aria-label="address fields" className="grid grid-cols-2 gap-2 pl-2 border-l-2 border-zinc-800">
          <label className="text-xs text-zinc-400 col-span-2">
            Street 1
            <input aria-label="street1" value={street1} onChange={(e) => setStreet1(e.target.value)}
                   className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1" />
          </label>
          <label className="text-xs text-zinc-400 col-span-2">
            Street 2
            <input aria-label="street2" value={street2} onChange={(e) => setStreet2(e.target.value)}
                   className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1" />
          </label>
          <label className="text-xs text-zinc-400">
            City
            <input aria-label="city" value={city} onChange={(e) => setCity(e.target.value)}
                   className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1" />
          </label>
          <label className="text-xs text-zinc-400">
            State
            <input aria-label="state" value={state} onChange={(e) => setState(e.target.value)}
                   className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1" />
          </label>
          <label className="text-xs text-zinc-400">
            ZIP
            <input aria-label="zip" value={zip} onChange={(e) => setZip(e.target.value)}
                   className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1" />
          </label>
          <label className="text-xs text-zinc-400">
            Country
            <select aria-label="country" value={country} onChange={(e) => setCountry(e.target.value)}
                    className="block w-full bg-zinc-800 text-zinc-100 px-2 py-1 rounded mt-1">
              <option value="">(none)</option>
              {ISO2_COUNTRIES.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="text-xs text-zinc-400">
        Notes
        <textarea
          aria-label="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={4}
          className="block w-full bg-zinc-800 text-zinc-100 text-xs p-2 rounded mt-1 font-mono"
        />
      </label>

      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          aria-label="submit"
          onClick={handleSubmit}
          disabled={pending || name.trim() === ""}
          className="text-xs px-3 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-900 rounded disabled:opacity-50"
        >
          {pending ? "Saving..." : i ? "Save" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/customers")}
          className="text-xs px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/components/admin/CustomerForm.tsx
git commit -m "feat(customers): CustomerForm — create + edit with address + notes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C4: Admin route — list view + create + edit pages

- [ ] **Step 1: Create `src/app/customers/page.tsx` (list view RSC).**

```tsx
import { ensureDbReady, getDb } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getCustomers } from "@/db/customers";
import { CustomersTable } from "@/components/admin/CustomersTable";
import { deleteCustomer } from "@/lib/customers/actions";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const { q } = await searchParams;
  const customers = await getCustomers(getDb(), orgId, { search: q });

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold text-zinc-100 mb-4">Customers</h1>
      <CustomersTable
        customers={customers}
        search={q ?? ""}
        actions={{ deleteCustomer }}
      />
    </main>
  );
}
```

- [ ] **Step 2: Create `src/app/customers/new/page.tsx`.**

```tsx
import { CustomerForm } from "@/components/admin/CustomerForm";
import { createCustomer, updateCustomer } from "@/lib/customers/actions";

export default function CustomerCreatePage() {
  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-zinc-100 mb-4">New customer</h1>
      <CustomerForm actions={{ createCustomer, updateCustomer }} />
    </main>
  );
}
```

- [ ] **Step 3: Create `src/app/customers/[id]/edit/page.tsx`.**

```tsx
import { notFound } from "next/navigation";
import { ensureDbReady, getDb } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getCustomerById } from "@/db/customers";
import { CustomerForm } from "@/components/admin/CustomerForm";
import { createCustomer, updateCustomer } from "@/lib/customers/actions";

export const dynamic = "force-dynamic";

export default async function CustomerEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) notFound();
  const customer = await getCustomerById(getDb(), orgId, idNum);
  if (!customer) notFound();

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-zinc-100 mb-4">Edit customer</h1>
      <CustomerForm initial={customer} actions={{ createCustomer, updateCustomer }} />
    </main>
  );
}
```

- [ ] **Step 4: Add the "Customers" link to the sidebar.**

```bash
grep -rn "/inventory" src/components/ src/app/ 2>/dev/null | grep -E "(Nav|nav|sidebar|Sidebar)" | head -5
```

Find the nav component that lists the admin links. Add a sibling `<Link href="/customers">Customers</Link>` next to the Inventory/Diamonds/Website entries. Match the visual treatment (className, icon if any).

- [ ] **Step 5: tsc + build smoke + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
npm run build 2>&1 | tail -15
git add src/app/customers src/components/dashboard/Nav.tsx 2>/dev/null || git add src/app/customers $(git diff --name-only)
git commit -m "feat(customers): /customers admin route + sidebar Nav entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C5: `CustomersTable` component test

- [ ] **Step 1: Create `test/components/admin/CustomersTable.test.tsx`.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomersTable } from "@/components/admin/CustomersTable";
import type { CustomerView } from "@/db/customers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const noopActions = {
  deleteCustomer: vi.fn(async (_i: { id: number }) => ({ ok: true as const })),
};

function cust(over: Partial<CustomerView>): CustomerView {
  return {
    id: 1, name: "Alice", businessName: null, email: null, phone: null,
    address: null, notes: null, externalRef: null, firstSeenAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

describe("CustomersTable", () => {
  it("renders empty state when there are no customers", () => {
    render(<CustomersTable customers={[]} search="" actions={noopActions} />);
    expect(screen.getByText(/no customers yet/i)).toBeInTheDocument();
  });

  it("renders one row per customer; business name takes the headline", () => {
    render(<CustomersTable
      customers={[
        cust({ id: 1, name: "Priya Mehta", businessName: "Mehta Diamonds" }),
        cust({ id: 2, name: "Anita Sharma" }),
      ]}
      search=""
      actions={noopActions}
    />);
    expect(screen.getAllByLabelText("customer row")).toHaveLength(2);
    expect(screen.getByText("Mehta Diamonds")).toBeInTheDocument();
    expect(screen.getByText("Priya Mehta")).toBeInTheDocument(); // sub-line under business
    expect(screen.getByText("Anita Sharma")).toBeInTheDocument(); // headline since no business
  });

  it("Delete opens a confirm dialog; confirming fires deleteCustomer", async () => {
    const actions = { deleteCustomer: vi.fn(async () => ({ ok: true as const })) };
    render(<CustomersTable
      customers={[cust({ id: 42, name: "Bye" })]}
      search=""
      actions={actions}
    />);
    fireEvent.click(screen.getByLabelText("delete customer 42"));
    expect(screen.getByLabelText("delete confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("confirm delete"));
    await waitFor(() => expect(actions.deleteCustomer).toHaveBeenCalledWith({ id: 42 }));
  });

  it("search input default value reflects the current search prop", () => {
    render(<CustomersTable customers={[]} search="mehta" actions={noopActions} />);
    expect(screen.getByLabelText("search customers")).toHaveValue("mehta");
  });

  it("renders alert when delete fails", async () => {
    const actions = {
      deleteCustomer: vi.fn(async () => ({ ok: false as const, error: "Forbidden" })),
    };
    render(<CustomersTable
      customers={[cust({ id: 99, name: "X" })]}
      search=""
      actions={actions}
    />);
    fireEvent.click(screen.getByLabelText("delete customer 99"));
    fireEvent.click(screen.getByLabelText("confirm delete"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/forbidden/i));
  });
});
```

- [ ] **Step 2: Run + commit.**

```bash
npx vitest run test/components/admin/CustomersTable.test.tsx --reporter=verbose 2>&1 | tail -15
git add test/components/admin/CustomersTable.test.tsx
git commit -m "test(customers): CustomersTable — empty, render, delete confirm, alert

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C6: `CustomerForm` component test

- [ ] **Step 1: Create `test/components/admin/CustomerForm.test.tsx`.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerForm } from "@/components/admin/CustomerForm";
import type { CustomerView } from "@/db/customers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const noopActions = {
  createCustomer: vi.fn(async (_i: unknown) => ({ ok: true as const })),
  updateCustomer: vi.fn(async (_i: unknown) => ({ ok: true as const })),
};

function existing(over: Partial<CustomerView> = {}): CustomerView {
  return {
    id: 99,
    name: "Priya Mehta",
    businessName: "Mehta Diamonds",
    email: "priya@example.com",
    phone: "+91",
    address: { city: "Mumbai", country: "IN" },
    notes: "Long-time partner",
    externalRef: null,
    firstSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe("CustomerForm", () => {
  it("create mode: empty initial state; submit fires createCustomer with parsed payload", async () => {
    const actions = {
      ...noopActions,
      createCustomer: vi.fn(async () => ({ ok: true as const })),
    };
    render(<CustomerForm actions={actions} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText("email"), { target: { value: "a@x.com" } });
    fireEvent.click(screen.getByLabelText("submit"));
    await waitFor(() => expect(actions.createCustomer).toHaveBeenCalledTimes(1));
    expect(actions.createCustomer.mock.calls[0][0]).toMatchObject({
      name: "Alice",
      email: "a@x.com",
    });
  });

  it("edit mode: pre-fills with the supplied customer and dispatches updateCustomer", async () => {
    const actions = {
      ...noopActions,
      updateCustomer: vi.fn(async () => ({ ok: true as const })),
    };
    render(<CustomerForm initial={existing()} actions={actions} />);
    expect((screen.getByLabelText("name") as HTMLInputElement).value).toBe("Priya Mehta");
    fireEvent.click(screen.getByLabelText("submit"));
    await waitFor(() => expect(actions.updateCustomer).toHaveBeenCalledTimes(1));
    expect(actions.updateCustomer.mock.calls[0][0]).toMatchObject({ id: 99 });
  });

  it("address fields open by default in edit mode when initial has any address field", () => {
    render(<CustomerForm initial={existing()} actions={noopActions} />);
    expect(screen.getByLabelText("address fields")).toBeInTheDocument();
  });

  it("address fields closed by default in create mode", () => {
    render(<CustomerForm actions={noopActions} />);
    expect(screen.queryByLabelText("address fields")).toBeNull();
  });

  it("renders alert when action returns ok:false", async () => {
    const actions = {
      ...noopActions,
      createCustomer: vi.fn(async () => ({ ok: false as const, error: "Demo mode" })),
    };
    render(<CustomerForm actions={actions} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Z" } });
    fireEvent.click(screen.getByLabelText("submit"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/demo/i));
  });
});
```

- [ ] **Step 2: Run + commit.**

```bash
npx vitest run test/components/admin/CustomerForm.test.tsx --reporter=verbose 2>&1 | tail -15
git add test/components/admin/CustomerForm.test.tsx
git commit -m "test(customers): CustomerForm — create, edit, address toggle, error alert

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C7: Phase C green-bar verification

- [ ] Step 1: Full suite. `npm test -- --run 2>&1 | tail -10`. Zero failures.
- [ ] Step 2: tsc clean.
- [ ] Step 3: Build. `npm run build 2>&1 | tail -15`. Success.

---

## Phase D — Final verify + merge + deploy

### Task D1: Lint, full verify, dev smoke

- [ ] Step 1: Full suite — green.
- [ ] Step 2: tsc — clean.
- [ ] Step 3: Build — success.
- [ ] Step 4: Demo-mode smoke check.

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:3000/customers -o /tmp/slice22-customers.html
grep -oE "(Mehta Diamonds|Saint-Cloud|Anita Sharma|No customers yet)" /tmp/slice22-customers.html | sort -u
kill $DEV_PID 2>/dev/null
```

Expected: at least 2 of the 3 demo customer names appear (proving the demo seed flows through `getCustomers`).

### Task D2: Merge feature branch into main + push + verify Netlify

- [ ] Step 1: From `.worktrees/slice-22-customers`, confirm commit history.

```bash
git log --oneline main..HEAD | wc -l
```

Expected: ~18-22 commits.

- [ ] Step 2: Switch to `/root`, sync, merge, push.

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git fetch origin --quiet
git pull --ff-only origin main
git merge --no-ff feature/slice-22-customers -m "$(cat <<'EOF'
Merge feature/slice-22-customers: Customers + CRM panel (slice 22)

New customers table (org-scoped) with name + optional business_name +
jsonb address + Zod-validated email + ≤2000-char notes. Two
future-proofing nullable columns (external_ref, first_seen_at) for
slice 26's WinJewel import. Three runWithUser-wrapped actions
(create/update/delete) with owner-only writes + defense-in-depth
org_id WHEREs. SQL-tenant-filtered queries (getCustomers with
free-text ILIKE search + getCustomerById). New /customers admin
route mirroring /inventory + /diamonds. Demo seed renders 3
customers on AIYA.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] Step 3: Poll Netlify until the deploy lands. Marker: the page title or a stable customer name.

```bash
(
  url="https://idesign-dash-demo.netlify.app/customers"
  marker="Mehta Diamonds"
  start=$(date +%s)
  deadline=$((start + 360))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(curl -sL --max-time 15 "$url" 2>/dev/null || true)
    if echo "$body" | grep -qi "$marker"; then
      echo "SLICE_22_LIVE after $(( $(date +%s) - start ))s"
      exit 0
    fi
    sleep 20
  done
  echo "TIMEOUT — '$marker' not found"
  exit 1
)
```

- [ ] Step 4: Tear down worktree + delete branch.

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree remove .worktrees/slice-22-customers
git branch -d feature/slice-22-customers
git push origin --delete feature/slice-22-customers 2>/dev/null || true
```

Slice 22 done.

---

## Self-Review Notes

**1. Spec coverage:**
- §3 schema → A1, A2 ✓
- §4 authz rules → B3 (create), B4 (update), B5 (delete), reads via SQL in A3/A4 ✓
- §5 server actions → B1 (Zod), B3-B5 (3 actions) ✓
- §6 query layer → A3, A4 ✓
- §7 UI → C2 (table), C3 (form), C4 (routes + nav), C5/C6 (component tests) ✓
- §8 testing → 7 listed files all mapped to tasks ✓
- §9 migration & rollout → A2 (generate), D1 (build), D2 (deploy) ✓

**2. Placeholder scan:** None. Migration number `NNNN` has explicit "read at execution time" instructions in Pre-flight Step 3. Sidebar nav link insertion (Task C4 Step 4) has a `grep` instruction to find the right file rather than hardcoding a path that might have shifted.

**3. Type consistency:**
- `CustomerView`, `CustomerAddress` defined once in A3 and reused across A4, B3-B5, C2, C3, C5, C6.
- `CreateCustomerInput`, `UpdateCustomerInput`, `DeleteCustomerInput` defined once in B1 and reused.
- `SeedCustomer` defined in C1 and consumed by the demo query short-circuit in A3.
- Action signatures: `(raw: unknown) => Promise<ActionResult>` consistent across all 3 actions.

Plan is ready.
