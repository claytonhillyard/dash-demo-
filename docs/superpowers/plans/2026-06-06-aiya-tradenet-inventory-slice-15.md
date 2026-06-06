# AIYA Slice 15 — TradeNet Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the per-org inventory ledger into a circle-shareable surface. Add a nullable `inventory_items.visibility_circle_id` column with a partial index, a new `getSharedInventoryForOrg(db, orgId)` query helper, server-side membership validation on `updateInventoryItem` + `createInventoryItem` for the `visibilityCircleId` field, an inline "Share with circle" dropdown on `InventoryAdmin`, a new `TradeNetInventoryPanel` dashboard panel + new `/exchange` admin route, and demo seed extensions so AIYA sees 3 partner-org items shared into Trusted Partners.

**Architecture:** `inventory_items.visibility_circle_id` mirrors slice 4's `deals.visibility_circle_id` exactly — nullable, `ON DELETE SET NULL`, partial-NULL-filtered index. `getSharedInventoryForOrg(db, orgId)` is the new widened-read helper, using slice 4's `getCircleIdsForOrg` as input and explicit zero-circles early return. `updateInventoryItem` + `createInventoryItem` membership pre-check uses slice 4's `isOrgMemberOfCircle`. `getInventorySummary` is INTENTIONALLY NOT widened — it stays single-org (count of "what I own"). `formatInventoryVisibility` is the slice-4-equivalent foreign-id name-leak guard.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind · Drizzle ORM · pglite (test) · Neon (prod) · jose (JWT) · Zod · Vitest · existing slice-3 `getCurrentOrgId()` seam · slice-4 `circles` / `circle_members` / `isOrgMemberOfCircle` / `getCircleIdsForOrg` / `getCirclesForOrg` / `getCircleNamesForOrg` / `formatDealVisibility` shape · slice-4c `addOrgToCircle`/`removeOrgFromCircle` membership-mutation primitives (consumed read-only).

**Spec:** `docs/superpowers/specs/2026-06-06-aiya-tradenet-inventory-slice-15-design.md`

**Conventions:**
- Run a single test file: `npx vitest run <path>`
- DB/action tests use `// @vitest-environment node` and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` + `__setTestDb` pattern from `test/helpers/shared-db.ts`.
- All inventory reads scope by **either** `eq(inventoryItems.orgId, currentOrgId)` (the slice-3 invariant) **or** `inArray(inventoryItems.visibilityCircleId, viewerCircleIds)` — never widen any further. The PR review confirms `getInventorySummary`'s left-and-only clause is byte-identical to slice 3.
- Action input schemas (Zod) accept `visibilityCircleId` as the **one** new optional field. They never accept `orgId`. Membership is verified server-side from `requireSession().orgId`, never from the wire.
- Commit after every green step.

> ## CRITICAL — Zero-circles SQL fallback (A3 load-bearing branch)
>
> `getSharedInventoryForOrg(db, viewer)` MUST early-return `[]` when `getCircleIdsForOrg(viewer)` returns `[]`. Do NOT fall through to `inArray(visibilityCircleId, [])`. Drizzle's `inArray(col, [])` and PG's `IN ()` are dialect-dependent — some bomb at parse, others silently reduce to `false` and drop every row. The slice-4 fix was an explicit early-return branch; slice 15 copies that discipline byte-for-byte. The A4 test "zero-circles regression guard" is the regression guard — it asserts both the empty return AND that `db.select` is NOT called when `circleIds.length === 0`.

> ## CRITICAL — `getInventorySummary` STAYS single-org
>
> `getInventorySummary(db, orgId)` is NOT widened by this slice. The cross-circle surface lives on the new `TradeNetInventoryPanel` and `/exchange` route. Widening the summary would conflate ownership ("what I have") with availability ("what I can see") and mislead the owner. See spec §3.1. The A4 test "getInventorySummary unaffected" reasserts the slice-3 isolation invariant against the slice-15 schema.

> ## CRITICAL — Membership pre-check in `updateInventoryItem` AND `createInventoryItem`
>
> The pattern is `if (input.visibilityCircleId != null) { if (!await isOrgMemberOfCircle(orgId, circleId)) throw ForbiddenError; } await db.update/insert(...)`. The check runs BEFORE the SQL mutation. Tests in B2/B3 assert row counts / column values — a rejected request writes zero changes. The check uses the **session** orgId, NEVER the wire.

> ## CRITICAL — `undefined visibilityCircleId` PRESERVES the existing value on UPDATE
>
> Editing qty on a shared row through the action MUST NOT silently un-share the item. The `values()` helper in `src/lib/inventory/actions.ts` is split so `visibilityCircleId` is only included in the SET clause when `input.visibilityCircleId !== undefined`. For INSERT, `undefined → null` (no default). The B3 test "omitted visibilityCircleId preserves existing value" is the regression guard. Without this, every existing slice-1b-1 UI flow that calls `updateInventoryItem` without the new field would clobber the column to NULL.

> ## CRITICAL — Foreign-circle-id name-leak guard
>
> `formatInventoryVisibility(visibilityCircleId, circleNamesById)` returns `kind: "private"` for any `visibilityCircleId` that is not in the viewer's `circleNamesById` map. The widened query (A3) makes this unreachable in well-formed code — you only see a foreign row whose `visibilityCircleId` is in your circle ids — but the defensive fallback prevents a future bug in the query path from surfacing a circle name to a viewer who shouldn't know it. The C2 test "foreign-id fallback" asserts this explicitly.

> ## CRITICAL — Migration order dependency on slices 3 and 4
>
> `drizzle/0011_*.sql` runs against a DB that already has `0004_*.sql` (slice 3 orgs + AIYA seed) and `0005_*.sql` (slice 4 circles) applied. The new FK `inventory_items.visibility_circle_id → circles.id` is referentially valid only because slice 4 already created `circles`. The migration is **schema-only** — no seed data — and must include a `-- schema-only; no seed data in this migration` SQL comment at the top.

---

## Task 0: Set up worktree

**Files:** none (environment setup)

- [ ] **Step 1: From repo root, create the worktree.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root" && git worktree add -b feature/aiya-tradenet-inventory-15 .worktrees/aiya-tradenet-inventory-15 main`
  Expected: new worktree directory at `.worktrees/aiya-tradenet-inventory-15`, branch `feature/aiya-tradenet-inventory-15` checked out there.

- [ ] **Step 2: Switch to the worktree and install.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-tradenet-inventory-15" && npm install`
  Expected: clean install; no errors.

- [ ] **Step 3: Verify baseline tests pass.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-tradenet-inventory-15" && npm test -- --run`
  Expected: full suite green (the post-slice-4c baseline). If anything fails, STOP — the baseline is broken, not your code.

- [ ] **Step 4: Confirm the relevant slice 4 / 4c primitives exist.**
  Run: `npx vitest run test/lib/circles/membership.test.ts test/lib/circles/queries.test.ts`
  Expected: PASS. `isOrgMemberOfCircle`, `getCircleIdsForOrg`, `getCirclesForOrg`, `getCircleNamesForOrg` all green — they're the building blocks slice 15 consumes.

(All subsequent `cd` commands in this plan reference the worktree path. Use `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-tradenet-inventory-15"` before any command.)

---

## Phase A — Foundation (schema + migration + visibility-clause + getSharedInventoryForOrg + demo seed)

Phase A lands the `inventory_items.visibility_circle_id` column, generates the migration, adds the new `getSharedInventoryForOrg` helper with the zero-circles regression guard, and extends the demo seed. **No write paths and no UI changes in Phase A.** Phase B is the action layer; Phase C is the UI.

### Task A1: Add `visibility_circle_id` column to `inventory_items` in schema

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `test/db/schema.test.ts`

- [ ] **Step 1: Failing schema assertions.** Append a new `it(...)` to the existing `describe("db schema", …)` in `test/db/schema.test.ts`:

```ts
  it("exports inventoryItems.visibilityCircleId as a nullable PgInteger", () => {
    expect(schema.inventoryItems.visibilityCircleId).toBeDefined();
    expect(schema.inventoryItems.visibilityCircleId.columnType).toBe("PgInteger");
    expect(schema.inventoryItems.visibilityCircleId.notNull).toBe(false);
  });
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/schema.test.ts`
Expected: FAIL — `schema.inventoryItems.visibilityCircleId` is undefined.

- [ ] **Step 3: Add the column + partial index to `inventoryItems`.** Open `src/db/schema.ts`. Locate the `inventoryItems` table (currently the columns end with `updatedAt`). Modify the table definition so it has:
  - A new column `visibilityCircleId: integer("visibility_circle_id").references(() => circles.id, { onDelete: "set null" }),` after `clarity` and before `createdAt`.
  - A second-argument `(t) => ({...})` callback adding `visibilityCircleIdx: index("inventory_items_visibility_circle_idx").on(t.visibilityCircleId, t.orgId).where(sql\`${t.visibilityCircleId} IS NOT NULL\`)`. The existing `inventoryItems` definition has no second argument today — adding one is fine; the call signature `pgTable("inventory_items", { … }, (t) => ({ … }))` is standard Drizzle.

Reference shape (slice 4 `deals.visibilityCircleId` is the exemplar):

```ts
export const inventoryItems = pgTable(
  "inventory_items",
  {
    // … existing columns unchanged …
    clarity: text("clarity"),
    visibilityCircleId: integer("visibility_circle_id").references(
      () => circles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    visibilityCircleIdx: index("inventory_items_visibility_circle_idx")
      .on(t.visibilityCircleId, t.orgId)
      .where(sql`${t.visibilityCircleId} IS NOT NULL`),
  }),
);
```

(`circles` is imported by the existing slice 4 column reference in the file; no new imports needed beyond what's already there. `sql` from `drizzle-orm` is also already imported at the top.)

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/db/schema.ts test/db/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): inventory_items.visibility_circle_id column + partial index

Nullable integer column references circles.id with ON DELETE SET NULL.
Partial index (visibility_circle_id, org_id) WHERE visibility_circle_id
IS NOT NULL serves the slice-15 widened-read hot path; the
partial-NULL filter keeps it tiny for the slice-1b-1 baseline (every
existing row is NULL).

Mirrors slice 4's deals.visibility_circle_id shape verbatim.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration `drizzle/0011_*.sql` + schema-only header + smoke test

**Files:**
- Create: `drizzle/0011_*.sql` (generated, then hand-edited with header)
- Modify: `drizzle/meta/_journal.json` + new snapshot (generated)
- Create: `test/db/tradenet-inventory-migration.test.ts`

- [ ] **Step 1: Generate the migration.** Run: `npm run db:generate`
Expected: a new `drizzle/0011_<name>.sql` appears. It should contain:
  - `ALTER TABLE "inventory_items" ADD COLUMN "visibility_circle_id" integer REFERENCES "circles"("id") ON DELETE SET NULL;`
  - `CREATE INDEX "inventory_items_visibility_circle_idx" ON "inventory_items" ("visibility_circle_id","org_id") WHERE "visibility_circle_id" IS NOT NULL;`

  If the command hangs waiting for input, report BLOCKED.

- [ ] **Step 2: Inspect the generated SQL.** Open `drizzle/0011_*.sql` and confirm:
  - The ADD COLUMN includes `ON DELETE SET NULL`.
  - The CREATE INDEX is a **partial** index (`WHERE "visibility_circle_id" IS NOT NULL`).
  - No seed INSERTs.

- [ ] **Step 3: Hand-edit the migration to add the schema-only header.** Open `drizzle/0011_*.sql` and prepend, before any SQL:

```sql
-- schema-only; no seed data in this migration.
-- inventory_items.visibility_circle_id starts NULL for every existing row;
-- the demo seed lives in src/lib/demo/seed.ts and never touches the DB.
-- See docs/superpowers/plans/2026-06-06-aiya-tradenet-inventory-slice-15.md for context.
```

- [ ] **Step 4: Smoke test.** Create `test/db/tradenet-inventory-migration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getSharedDb, closeSharedDb } from "../helpers/shared-db";

describe("slice 15 migration", () => {
  beforeAll(async () => { await getSharedDb(); });
  afterAll(async () => { await closeSharedDb(); });

  it("inventory_items has visibility_circle_id column", async () => {
    const db = await getSharedDb();
    const rows = await db.execute(
      sql`SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_name = 'inventory_items' AND column_name = 'visibility_circle_id'`,
    );
    expect(rows.rows.length).toBe(1);
    // Postgres returns 'YES' / 'NO' as strings for is_nullable.
    expect((rows.rows[0] as Record<string, unknown>).is_nullable).toBe("YES");
  });

  it("inventory_items_visibility_circle_idx exists and is partial", async () => {
    const db = await getSharedDb();
    const rows = await db.execute(
      sql`SELECT indexname, indexdef FROM pg_indexes
          WHERE tablename = 'inventory_items'
            AND indexname = 'inventory_items_visibility_circle_idx'`,
    );
    expect(rows.rows.length).toBe(1);
    const def = (rows.rows[0] as Record<string, unknown>).indexdef as string;
    expect(def.toLowerCase()).toContain("where (visibility_circle_id is not null)");
  });
});
```

- [ ] **Step 5: Run.** Run: `npx vitest run test/db/tradenet-inventory-migration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add drizzle/ test/db/tradenet-inventory-migration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): drizzle 0011 — inventory_items.visibility_circle_id migration

Schema-only migration adds the new column + partial NULL-filtered
index. Smoke test asserts the column is nullable and the index is
partial. Migration header documents the schema-only invariant.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Implement `inventoryVisibilityClause` + `getSharedInventoryForOrg` with zero-circles early return

**Files:**
- Modify: `src/db/inventory.ts`

- [ ] **Step 1: Read the existing module.** Open `src/db/inventory.ts`. It exports `InventorySummary` and `getInventorySummary`. The new code is additive — do NOT modify `getInventorySummary`'s body (spec §3.1).

- [ ] **Step 2: Add the new imports and types.** Extend the imports at the top:

```ts
import { and, eq, ne, or, sql, desc, inArray, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { inventoryItems, orgs } from "./schema";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";
import { isDemoMode } from "@/lib/demo/mode";
import {
  seedInventorySummary,
  getSeedSharedInventoryForOrg,
} from "@/lib/demo/seed";
import { getCircleIdsForOrg } from "@/lib/circles/queries";

export interface SharedInventoryRow {
  id: number;
  orgId: number;
  ownerOrgLabel: string;
  category: InventoryCategory;
  name: string;
  quantity: number;
  status: "in_stock" | "reserved" | "sold";
  visibilityCircleId: number;
  updatedAt: Date;
}
```

(Note: `getSeedSharedInventoryForOrg` doesn't exist yet — it lands in A4. Drizzle won't typecheck until A4 is done. That's intentional; complete A3 + A4 together, commit at A4 step 7.)

- [ ] **Step 3: Add `inventoryVisibilityClause`.** Append to `src/db/inventory.ts`:

```ts
/** Slice 15: build the OR clause for the widened read. When the viewer
 *  has zero circle memberships, callers should EARLY-RETURN before invoking
 *  this — the function is preserved here for parity with slice 4's
 *  visibilityClause but every consumer in slice 15 short-circuits before
 *  reaching it. Kept as a separate function so a future "include own items"
 *  variant of getSharedInventoryForOrg can reuse it. */
function inventoryVisibilityClause(orgId: number, circleIds: number[]): SQL {
  if (circleIds.length === 0) {
    return eq(inventoryItems.orgId, orgId);
  }
  return or(
    eq(inventoryItems.orgId, orgId),
    inArray(inventoryItems.visibilityCircleId, circleIds),
  )!;
}
```

- [ ] **Step 4: Add `getSharedInventoryForOrg`.** Append:

```ts
/** Slice 15: returns inventory items shared into a circle the viewer is in,
 *  EXCLUDING the viewer's own items. /exchange is "what partners are
 *  offering" — own items live on /inventory. Zero-circles short-circuits
 *  to [] without touching the DB. */
export async function getSharedInventoryForOrg(
  db: Db,
  orgId: number,
  limit: number | null = null,
): Promise<SharedInventoryRow[]> {
  if (isDemoMode()) {
    const rows = getSeedSharedInventoryForOrg(orgId);
    return limit != null ? rows.slice(0, limit) : rows;
  }
  const circleIds = await getCircleIdsForOrg(db, orgId);
  if (circleIds.length === 0) return [];
  const q = db
    .select({
      id: inventoryItems.id,
      orgId: inventoryItems.orgId,
      ownerOrgLabel: orgs.name,
      category: inventoryItems.category,
      name: inventoryItems.name,
      quantity: inventoryItems.quantity,
      status: inventoryItems.status,
      visibilityCircleId: inventoryItems.visibilityCircleId,
      updatedAt: inventoryItems.updatedAt,
    })
    .from(inventoryItems)
    .innerJoin(orgs, eq(orgs.id, inventoryItems.orgId))
    .where(
      and(
        ne(inventoryItems.orgId, orgId),
        inArray(inventoryItems.visibilityCircleId, circleIds),
        ne(inventoryItems.status, "sold"),
      ),
    )
    .orderBy(desc(inventoryItems.updatedAt));
  const rows = limit != null ? await q.limit(limit) : await q;
  return rows as SharedInventoryRow[];
}
```

(Leave `inventoryVisibilityClause` in place even though `getSharedInventoryForOrg` doesn't currently use it — it documents the parity with slice 4 and is a small future-proofing affordance. Lint-clean: the function is exported as needed; otherwise mark with a `// eslint-disable-next-line` if the project bans unused.)

- [ ] **Step 5: Defer running tests** until A4 (which adds the seed helper this code imports). Continue to A4.

---

### Task A4: Extend the demo seed with `getSeedSharedInventoryForOrg` + 3 partner-org rows

**Files:**
- Modify: `src/lib/demo/seed.ts`
- Modify: `test/lib/demo/seed.test.ts`

- [ ] **Step 1: Failing seed assertions.** Append to `test/lib/demo/seed.test.ts`:

```ts
  describe("slice 15 shared inventory seed", () => {
    it("getSeedSharedInventoryRows returns 3 partner-org rows", () => {
      const rows = getSeedSharedInventoryRows();
      expect(rows.map((r) => r.id).sort()).toEqual([601, 602, 603]);
      for (const r of rows) {
        expect(r.visibilityCircleId).toBe(DEMO_TRUSTED_PARTNERS_CIRCLE_ID);
        // No AIYA-owned rows in the partner seed — Option A in spec §6.2.
        expect(r.orgId).not.toBe(DEMO_AIYA_ORG_ID);
        // Honest "demo · simulated" provenance.
        expect(r.name).toMatch(/demo · simulated/);
      }
    });

    it("getSeedSharedInventoryForOrg(AIYA) returns the 3 partner rows", () => {
      const rows = getSeedSharedInventoryForOrg(DEMO_AIYA_ORG_ID);
      expect(rows.length).toBe(3);
    });

    it("getSeedSharedInventoryForOrg(999) returns [] (no circle memberships)", () => {
      expect(getSeedSharedInventoryForOrg(999)).toEqual([]);
    });

    it("getSeedSharedInventoryForOrg(MEHTA) returns 2 rows (excludes own)", () => {
      const rows = getSeedSharedInventoryForOrg(DEMO_PARTNER_ORG_IDS.MEHTA);
      // 601 is Mehta's own item — excluded by ne(orgId).
      expect(rows.map((r) => r.id).sort()).toEqual([602, 603]);
    });
  });
```

Update the file's existing imports to include `DEMO_AIYA_ORG_ID`, `DEMO_TRUSTED_PARTNERS_CIRCLE_ID`, `DEMO_PARTNER_ORG_IDS`, `getSeedSharedInventoryRows`, `getSeedSharedInventoryForOrg` from `@/lib/demo/seed`.

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: FAIL — the new exports don't exist.

- [ ] **Step 3: Add the seed shape + helpers to `src/lib/demo/seed.ts`.** Append below the existing slice-4 seed block:

```ts
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
  return getSeedSharedInventoryRows().filter(
    (r) => r.orgId !== orgId && circleIds.has(r.visibilityCircleId),
  );
}
```

(`InventoryCategory` is imported by the existing `seedInventorySummary` already; if missing, add `import { type InventoryCategory } from "@/lib/inventory/validation";`.)

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: PASS — all four new assertions green.

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean. `src/db/inventory.ts` (A3) now resolves its `getSeedSharedInventoryForOrg` import.

- [ ] **Step 6: Smoke-test the new `getSharedInventoryForOrg` against pglite.** Add a quick assertion at the bottom of `test/db/inventory.test.ts` (the full truth-table tests land in A5):

```ts
  it("getSharedInventoryForOrg returns [] for zero-circles org without touching DB (demo off)", async () => {
    const db = await getSharedDb();
    // Org 999 has zero circles in shared-db seed.
    const rows = await getSharedInventoryForOrg(db, 999);
    expect(rows).toEqual([]);
  });
```

  (Don't add the spy-based zero-circles assertion yet — that's the load-bearing A5 test.)

- [ ] **Step 7: Run.** Run: `npx vitest run test/db/inventory.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit A3 + A4 together.**
```bash
git add src/db/inventory.ts src/lib/demo/seed.ts test/db/inventory.test.ts test/lib/demo/seed.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): getSharedInventoryForOrg + demo seed for cross-circle reads

Slice 15 read-layer foundation. New SharedInventoryRow projection includes
denormalized ownerOrgLabel via inner-join on orgs.name (slice-10
*_org_label convention).

getInventorySummary is INTENTIONALLY unchanged — it stays single-org per
spec §3.1. /exchange and TradeNetInventoryPanel are the cross-circle
surface.

Zero-circles early return preserves slice-3 / slice-4 invariant: an org
in zero circles sees nothing on /exchange and the partial-index visibility
branch never runs.

Demo seed adds 3 partner-org rows (601/602/603) shared into Trusted
Partners (201). Mehta/Saint-Cloud/Marathi each contribute one item;
AIYA's own demo seed is unchanged (Option A in spec §6.2).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Visibility truth-table + zero-circles regression guard tests

**Files:**
- Modify: `test/db/inventory.test.ts`
- Create: `test/lib/inventory/visibility.test.ts`

- [ ] **Step 1: Add the truth-table cases to `test/db/inventory.test.ts`.** Append a new `describe("slice 15 — shared inventory visibility truth table", () => { … })` block that uses `getSharedDb` and seeds:
  - Three orgs: 1 (AIYA), 999, 888 (slice-4 shared-db extension already seeds 888).
  - One circle `C` with members `(1, C)` and `(888, C)`.
  - Four inventory rows:
    - `I1`: orgId 1, visibilityCircleId NULL (private to AIYA)
    - `I2`: orgId 1, visibilityCircleId C (AIYA-owned, shared)
    - `I3`: orgId 999, visibilityCircleId NULL (private to 999)
    - `I4`: orgId 888, visibilityCircleId C (888-owned, shared)
  - Assertions:
    - `getSharedInventoryForOrg(db, 1)` returns exactly one row whose id matches `I4`.
    - `getSharedInventoryForOrg(db, 999)` returns `[]` (999 in zero circles).
    - `getSharedInventoryForOrg(db, 888)` returns exactly one row whose id matches `I2`.
  - Multi-circle variant: orgs 1 in circles A and B, 999 in A only, 888 in B only; items IA (org 999, vis A) and IB (org 888, vis B). Assert `getSharedInventoryForOrg(db, 1)` returns both; `getSharedInventoryForOrg(db, 999)` returns `[]`; `getSharedInventoryForOrg(db, 888)` returns `[]`.
  - Sold-item exclusion: insert a row with `status='sold'` shared into C; assert it's NOT in the result of `getSharedInventoryForOrg(db, 1)`.
  - getInventorySummary unaffected: insert items into orgs 1 and 999; call `getInventorySummary(db, 1)` — see only org-1 counts; call with `db, 999` — see only org-999. Confirm the slice-15 schema didn't regress slice-1b-1.

  (Use the existing test helpers and `__setTestDb`-style discipline; mirror slice 4's `test/lib/deals/queries.test.ts` truth-table cases.)

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/db/inventory.test.ts`
Expected: PASS.

- [ ] **Step 3: Create the dedicated `visibility.test.ts` for the zero-circles regression guard (load-bearing).** Create `test/lib/inventory/visibility.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { getSharedInventoryForOrg } from "@/db/inventory";

// Demo mode must be OFF for these tests.
beforeAll(async () => {
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  await getSharedDb();
});
afterAll(async () => { await closeSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });

describe("slice 15 zero-circles regression guard", () => {
  it("returns [] for a viewer with zero memberships without issuing a SELECT", async () => {
    const db = await getSharedDb();
    // Spy on db.select to assert it's NOT called when circleIds is [].
    const spy = vi.spyOn(db, "select" as never);
    try {
      const rows = await getSharedInventoryForOrg(db, 999);
      expect(rows).toEqual([]);
      // The inventory SELECT must not be invoked.
      // (getCircleIdsForOrg DOES call select() — so we can't assert call count zero.
      // Instead, assert no .from(inventoryItems) call appears in the spy.)
      const fromCalls = spy.mock.results.flatMap((r) => {
        const builder = r.value as unknown as { _: unknown };
        // Drizzle's query builder doesn't expose .from() args at this surface;
        // a more robust assertion is: with the early return present, we never
        // BUILD a query against inventoryItems. The early-return contract is
        // checked structurally — see step 4 below.
        return builder ? [builder] : [];
      });
      // Soft: spy was called for the circle lookup (1 call); never twice.
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("structural — the early return precedes any .select on inventoryItems", async () => {
    // Read the source file and assert the early-return line precedes the
    // inventory SELECT line. This is a static guard against a future refactor
    // collapsing the `if (circleIds.length === 0) return []` branch.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/db/inventory.ts", "utf8");
    const earlyReturn = src.indexOf("if (circleIds.length === 0) return [];");
    const inventorySelect = src.indexOf(".from(inventoryItems)");
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(inventorySelect).toBeGreaterThan(-1);
    expect(earlyReturn).toBeLessThan(inventorySelect);
  });
});
```

- [ ] **Step 4: Run.** Run: `npx vitest run test/lib/inventory/visibility.test.ts`
Expected: PASS — both assertions green.

- [ ] **Step 5: Commit.**
```bash
git add test/db/inventory.test.ts test/lib/inventory/visibility.test.ts
git commit -m "$(cat <<'EOF'
test(inventory): slice 15 visibility truth table + zero-circles regression guard

test/db/inventory.test.ts: three-org one-circle truth table + multi-circle
viewer + sold-item exclusion + getInventorySummary-unaffected.

test/lib/inventory/visibility.test.ts: load-bearing zero-circles guard.
Structural assertion: the `if (circleIds.length === 0) return []` early
return MUST precede any .from(inventoryItems) call. A future refactor
collapsing the branch would fail this test, forcing the author to
reckon with the slice-3 / slice-4 invariant.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: Green-bar Phase A

- [ ] **Step 1: Full test suite.** Run: `npm test -- --run`
Expected: ALL PREVIOUS SLICES + the new Phase A tests pass. If anything regressed, STOP — likely culprit is the schema change or the inventory.ts import surface.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Lint.** Run: `npm run lint`
Expected: clean (or only pre-existing warnings).

- [ ] **Step 4: Phase A done.** No additional commit — the green bar is the gate.

---

## Phase B — Server actions (Zod + membership pre-check + truth-table tests)

Phase B extends `updateInventoryItem` and `createInventoryItem` with the optional `visibilityCircleId` field, the membership pre-check, the `ForbiddenError` mapping, and the "undefined preserves" UPDATE discipline. **No UI changes in Phase B.** Phase C is the UI.

### Task B1: Extend Zod schemas with `visibilityCircleId`

**Files:**
- Modify: `src/lib/inventory/validation.ts`

- [ ] **Step 1: Edit `src/lib/inventory/validation.ts`.** Add the new optional field to `inventoryItemInput`:

```ts
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
  visibilityCircleId: z.number().int().positive().nullable().optional(),
});
```

`inventoryItemUpdateInput` automatically inherits via `.extend({ id })`.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add src/lib/inventory/validation.ts
git commit -m "feat(inventory): Zod accepts visibilityCircleId (one new optional wire field)

The only new write field this slice. Validated for shape (positive int OR
null OR omitted); membership is verified separately in the action layer
against the session orgId — never against the wire.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B2: Extend `updateInventoryItem` with membership pre-check + Forbidden mapping

**Files:**
- Modify: `src/lib/inventory/actions.ts`

- [ ] **Step 1: Read `src/lib/inventory/actions.ts`** to confirm the existing `run` wrapper, `values()` helper, and three exported actions. Verify the file imports `Sentry`, `requireSession`, `isDemoMode`.

- [ ] **Step 2: Add imports.** At the top:

```ts
import { isOrgMemberOfCircle } from "@/lib/circles/membership";
import { ForbiddenError } from "@/lib/auth/errors";
```

(`ForbiddenError` already exists from slice 4. `isOrgMemberOfCircle` is the slice-4 authz primitive.)

- [ ] **Step 3: Extend `run`'s catch to map `ForbiddenError`.** The current catch only logs and returns Database error. Replace with:

```ts
  try {
    await fn(parsed.data, orgId);
    revalidatePath("/");
    revalidatePath("/inventory");
    revalidatePath("/exchange");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      console.warn(`[inventory] forbidden update by org=${orgId}: ${e.message}`);
      Sentry.captureException(e, { tags: { layer: "inventory-action", reason: "forbidden" } });
      return { ok: false, error: "Forbidden" };
    }
    console.error("[inventory action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "inventory-action" } });
    return { ok: false, error: "Database error" };
  }
```

- [ ] **Step 4: Split `values()` into two helpers** so UPDATE can omit `visibilityCircleId` when the input field is `undefined`:

```ts
function baseValues(input: InventoryItemInput, orgId: number) {
  return {
    orgId,
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

/** For UPDATE: only include visibilityCircleId in the SET clause when the
 *  input explicitly provided a value. Editing qty on a shared row must NOT
 *  silently un-share the item. */
function updateValues(input: InventoryItemInput, orgId: number) {
  const base = baseValues(input, orgId);
  if (input.visibilityCircleId === undefined) return base;
  return { ...base, visibilityCircleId: input.visibilityCircleId ?? null };
}

/** For INSERT: visibilityCircleId is always set (NULL if undefined or null). */
function insertValues(input: InventoryItemInput, orgId: number) {
  return {
    ...baseValues(input, orgId),
    visibilityCircleId: input.visibilityCircleId ?? null,
  };
}
```

(Delete or repurpose the old `values()` function; the two new helpers replace it.)

- [ ] **Step 5: Rewrite the three exported actions to use the new helpers + membership pre-check:**

```ts
async function ensureCanShare(orgId: number, visibilityCircleId: number | null | undefined): Promise<void> {
  if (visibilityCircleId === undefined || visibilityCircleId === null) return;
  const allowed = await isOrgMemberOfCircle(db(), orgId, visibilityCircleId);
  if (!allowed) throw new ForbiddenError("Forbidden");
}

export async function createInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemInput, raw, async (input, orgId) => {
    await ensureCanShare(orgId, input.visibilityCircleId);
    await db().insert(inventoryItems).values(insertValues(input, orgId));
  });
}

export async function updateInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemUpdateInput, raw, async (input, orgId) => {
    await ensureCanShare(orgId, input.visibilityCircleId);
    await db()
      .update(inventoryItems)
      .set({ ...updateValues(input, orgId), updatedAt: new Date() })
      .where(and(eq(inventoryItems.id, input.id), eq(inventoryItems.orgId, orgId)));
  });
}

export async function deleteInventoryItem(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid, orgId) => {
    await db()
      .delete(inventoryItems)
      .where(and(eq(inventoryItems.id, rid), eq(inventoryItems.orgId, orgId)));
  });
}
```

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/inventory/actions.ts
git commit -m "$(cat <<'EOF'
feat(inventory): updateInventoryItem + createInventoryItem visibility authz

Membership pre-check via slice-4 isOrgMemberOfCircle before any UPDATE
or INSERT. Rejected requests throw ForbiddenError, which the `run`
wrapper maps to { ok: false, error: 'Forbidden' } + console.warn audit
line + Sentry tag (reason='forbidden').

values() split into baseValues / updateValues / insertValues. The
UPDATE helper deliberately OMITS visibilityCircleId from the SET clause
when the wire field is undefined — editing qty on a shared row must
not silently un-share the item.

deleteInventoryItem unchanged — circle visibility does NOT widen
delete authority. Slice-3 WHERE org_id = currentOrg invariant
preserved verbatim.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Write-side truth-table tests (authorized / unauthorized / null / undefined / cross-org)

**Files:**
- Modify: `test/lib/inventory/actions.test.ts`

- [ ] **Step 1: Add the new describe block.** Append to `test/lib/inventory/actions.test.ts`:

```ts
describe("slice 15 — visibility authz truth table", () => {
  // The existing test file should set up requireSession mock + __setTestDb
  // + resetSharedDb in beforeEach. Mirror that pattern.

  it("authorized update sets visibilityCircleId", async () => {
    // Insert circle C + membership (1, C) + an item owned by 1.
    // Mock session as org 1.
    // Call updateInventoryItem({ id, ...fields, visibilityCircleId: C }).
    // Assert { ok: true } AND the row's visibility_circle_id === C.
  });

  it("unauthorized update rejects with Forbidden, zero writes", async () => {
    // Insert circle C + membership (999, C) — org 1 NOT in C.
    // Session = org 1, item owned by 1.
    // updateInventoryItem({ id, ..., visibilityCircleId: C }) returns
    // { ok: false, error: "Forbidden" }; re-select the row → visibility_circle_id IS NULL.
  });

  it("nonexistent circle id rejects with Forbidden", async () => {
    // updateInventoryItem({ id, ..., visibilityCircleId: 99999 })
    // returns { ok: false, error: "Forbidden" }.
  });

  it("null visibilityCircleId reverts a previously-shared item to private", async () => {
    // Pre-share the row to circle C (membership in place).
    // Call updateInventoryItem({ id, ..., visibilityCircleId: null }).
    // Returns { ok: true }; row's visibility_circle_id IS NULL.
    // (No membership check on the null path.)
  });

  it("omitted visibilityCircleId PRESERVES the existing value", async () => {
    // Pre-share the row to circle C.
    // Call updateInventoryItem({ id, ...newQtyAndStatus /* NO visibilityCircleId */ }).
    // Returns { ok: true }; row's visibility_circle_id IS STILL C.
    // (This is the load-bearing "undefined preserves" test — the spec invariant.)
  });

  it("slice-3 cross-org isolation preserved", async () => {
    // Session = org 999. Item owned by org 1.
    // updateInventoryItem({ id: org1ItemId, ... }) is a NO-OP — the
    // WHERE id = $1 AND org_id = 999 clause scopes the update.
    // Re-select the row → org-1 values unchanged.
  });

  it("createInventoryItem authz parity — unauthorized create rejects with zero inserts", async () => {
    // Session = org 1, no memberships.
    // createInventoryItem({ ..., visibilityCircleId: 99999 }) returns Forbidden.
    // Count rows in inventory_items WHERE org_id = 1 → unchanged from before the call.
  });

  it("demo guard precedes membership check", async () => {
    // Set NEXT_PUBLIC_DEMO_MODE=true.
    // updateInventoryItem({ ..., visibilityCircleId: 201 }) returns
    // { ok: false, error: "Demo mode — changes are disabled" }.
    // Membership check never runs (no DB call expected).
  });
});
```

(Implement each `it(...)` with the full setup. Mirror the slice-4 `test/lib/deals/actions.test.ts` style and the existing slice-1b-1 inventory actions tests; if those files use `__setTestDb` + shared-db, copy that wiring exactly.)

- [ ] **Step 2: Run.** Run: `npx vitest run test/lib/inventory/actions.test.ts`
Expected: PASS for all eight new cases plus existing slice-1b-1 / slice-3 cases.

- [ ] **Step 3: Commit.**
```bash
git add test/lib/inventory/actions.test.ts
git commit -m "test(inventory): slice 15 write-authz truth table

Eight new cases covering authorized share, unauthorized rejection (zero
writes), nonexistent-circle defense, null = un-share (no auth check),
undefined = preserve existing visibility, slice-3 cross-org isolation
preserved, create-action parity, and the demo-mode short-circuit
preceding the membership check.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B4: Green-bar Phase B

- [ ] **Step 1: Full suite.** Run: `npm test -- --run`
Expected: green.

- [ ] **Step 2: Typecheck + lint.** Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Phase B done.**

---

## Phase C — UI (formatter + InventoryAdmin dropdown + TradeNetInventoryPanel + /exchange route + Nav + middleware)

Phase C lights up the UI. **All UI changes are additive — existing slice-1b-1 / slice-4c flows continue to work without modification.** The new `/exchange` route and `TradeNetInventoryPanel` are net-new affordances.

### Task C1: `formatInventoryVisibility` helper + tests

**Files:**
- Create: `src/lib/inventory/format.ts`
- Create: `test/lib/inventory/format.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/inventory/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatInventoryVisibility } from "@/lib/inventory/format";

describe("formatInventoryVisibility", () => {
  it("returns kind: 'private' for null", () => {
    expect(formatInventoryVisibility(null, new Map())).toEqual({ kind: "private" });
  });

  it("returns kind: 'circle' with the circle name when the id is in the map", () => {
    const map = new Map([[7, "Trusted Partners"]]);
    expect(formatInventoryVisibility(7, map)).toEqual({
      kind: "circle",
      circleName: "Trusted Partners",
    });
  });

  it("foreign-id fallback: returns kind: 'private' for an id not in the map", () => {
    // Defense in depth: a future bug in the query path that returns a row
    // with a visibilityCircleId the viewer can't see must NOT surface the
    // raw id or render a name leak — the formatter says 'private'.
    expect(formatInventoryVisibility(999, new Map())).toEqual({ kind: "private" });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/inventory/format.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `src/lib/inventory/format.ts`:**

```ts
export interface InventoryVisibility {
  kind: "private" | "circle";
  circleName?: string;
}

/** Slice 15 — mirrors slice-4 formatDealVisibility byte-for-byte. The
 *  name-leak guard: unknown circle ids fall back to 'private'. */
export function formatInventoryVisibility(
  visibilityCircleId: number | null,
  circleNamesById: Map<number, string>,
): InventoryVisibility {
  if (visibilityCircleId === null) return { kind: "private" };
  const name = circleNamesById.get(visibilityCircleId);
  if (!name) return { kind: "private" };
  return { kind: "circle", circleName: name };
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/inventory/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/inventory/format.ts test/lib/inventory/format.test.ts
git commit -m "feat(inventory): formatInventoryVisibility — name-leak guard for badges

Mirrors slice-4 formatDealVisibility byte-for-byte: unknown circle ids
fall back to 'private' so a future query-path bug can't surface a
foreign circle name to a viewer who shouldn't know it.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C2: Extend `InventoryAdmin` with per-row "Share" dropdown + badge

**Files:**
- Modify: `src/components/inventory/InventoryAdmin.tsx`
- Modify: `src/app/(admin)/inventory/page.tsx`
- Create/Modify: `test/components/inventory/InventoryAdmin.test.tsx`

- [ ] **Step 1: Failing component test.** Create or extend `test/components/inventory/InventoryAdmin.test.tsx`:

```ts
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InventoryAdmin } from "@/components/inventory/InventoryAdmin";

const baseItem = {
  id: 1, category: "Diamonds" as const, name: "Round 1.02ct G/VS1",
  quantity: 1, status: "in_stock", unitCostCents: 0, retailPriceCents: 1240000,
  visibilityCircleId: null as number | null,
};

describe("InventoryAdmin slice 15", () => {
  it("renders the per-row Share dropdown with the right default", () => {
    render(<InventoryAdmin
      items={[{ ...baseItem, visibilityCircleId: 7 }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={vi.fn(async () => ({ ok: true as const }))}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[{ id: 7, name: "Trusted Partners" }]}
      circleNamesById={new Map([[7, "Trusted Partners"]])}
    />);
    const select = screen.getByLabelText(/share Round 1.02/i) as HTMLSelectElement;
    expect(select.value).toBe("7");
  });

  it("renders the Shared via [Circle] badge on shared rows", () => {
    render(<InventoryAdmin
      items={[{ ...baseItem, visibilityCircleId: 7 }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={vi.fn(async () => ({ ok: true as const }))}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[{ id: 7, name: "Trusted Partners" }]}
      circleNamesById={new Map([[7, "Trusted Partners"]])}
    />);
    expect(screen.getByText("Trusted Partners")).toBeInTheDocument();
  });

  it("XSS guard: circle name is rendered as text, never HTML", () => {
    const xss = "<script>alert(1)</script>";
    render(<InventoryAdmin
      items={[{ ...baseItem, visibilityCircleId: 7 }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={vi.fn(async () => ({ ok: true as const }))}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[{ id: 7, name: xss }]}
      circleNamesById={new Map([[7, xss]])}
    />);
    expect(screen.getByText(xss)).toBeInTheDocument();
    // No <script> element in the rendered DOM.
    expect(document.querySelector("script")).toBeNull();
  });

  it("name-leak guard: unknown circle id renders no badge", () => {
    const { container } = render(<InventoryAdmin
      items={[{ ...baseItem, visibilityCircleId: 999 }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={vi.fn(async () => ({ ok: true as const }))}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[]}
      circleNamesById={new Map()}
    />);
    expect(container.querySelector(".text-gold\\/80")).toBeNull();
  });

  it("changing the dropdown fires updateAction with the new visibilityCircleId", async () => {
    const updateAction = vi.fn(async () => ({ ok: true as const }));
    render(<InventoryAdmin
      items={[{ ...baseItem }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={updateAction}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[{ id: 7, name: "Trusted Partners" }]}
      circleNamesById={new Map([[7, "Trusted Partners"]])}
    />);
    const select = screen.getByLabelText(/share Round 1.02/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "7" } });
    // Wait microtask for the action call.
    await Promise.resolve();
    expect(updateAction).toHaveBeenCalledTimes(1);
    const arg = updateAction.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.id).toBe(1);
    expect(arg.visibilityCircleId).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/inventory/InventoryAdmin.test.tsx`
Expected: FAIL — component doesn't yet accept `updateAction`, `circles`, `circleNamesById`.

- [ ] **Step 3: Extend `InventoryRow` and `InventoryAdmin` props.** Open `src/components/inventory/InventoryAdmin.tsx`.

```ts
export interface InventoryRow {
  id: number;
  category: InventoryCategory;
  name: string;
  quantity: number;
  status: string;
  unitCostCents: number;
  retailPriceCents: number;
  visibilityCircleId: number | null;
}

export function InventoryAdmin({
  items,
  createAction,
  updateAction,
  deleteAction,
  circles,
  circleNamesById,
}: {
  items: InventoryRow[];
  createAction: (raw: unknown) => Promise<ActionResult>;
  updateAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
  circles: { id: number; name: string }[];
  circleNamesById: Map<number, string>;
}) {
```

- [ ] **Step 4: Add the `onShare` handler:**

```tsx
async function onShare(id: number, visibilityCircleId: number | null) {
  // Find the row so we can pass through the existing field values.
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const raw = {
    id,
    category: it.category,
    name: it.name,
    quantity: it.quantity,
    status: it.status,
    unitCostCents: it.unitCostCents,
    retailPriceCents: it.retailPriceCents,
    visibilityCircleId,
  };
  const res = await updateAction(raw);
  if (res.ok) router.refresh();
  else setError(res.error);
}
```

- [ ] **Step 5: Render the per-row dropdown + badge inside the `items.map(...)`** render block. Replace the existing row JSX:

```tsx
{items.map((it) => {
  const vis = formatInventoryVisibility(it.visibilityCircleId, circleNamesById);
  return (
    <li key={it.id} className="flex items-center justify-between gap-2 py-2">
      <span className="flex-1">{it.name}</span>
      <span className="text-text/50">{it.category}</span>
      <span className="text-text/60">×{it.quantity}</span>
      <span className="text-text/60">{it.status}</span>
      <select
        aria-label={`share ${it.name}`}
        className="bg-bg p-1 text-xs"
        value={it.visibilityCircleId ?? ""}
        onChange={(e) => onShare(it.id, e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Private</option>
        {circles.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {vis.kind === "circle" && (
        <span
          className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80"
          title={`Shared with ${vis.circleName}`}
        >
          {vis.circleName}
        </span>
      )}
      <span className="text-text/60">{formatCents(it.retailPriceCents)}</span>
      <button className="text-bad" onClick={() => remove(it.id)}
        aria-label={`delete ${it.name}`}>Delete</button>
    </li>
  );
})}
```

(Add the import `import { formatInventoryVisibility } from "@/lib/inventory/format";` at the top.)

- [ ] **Step 6: Update `/inventory` RSC.** Open `src/app/(admin)/inventory/page.tsx`. Change to:

```ts
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ensureDbReady } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { InventoryAdmin, type InventoryRow } from "@/components/inventory/InventoryAdmin";
import { createInventoryItem, updateInventoryItem, deleteInventoryItem } from "@/lib/inventory/actions";
import { getCirclesForOrg } from "@/lib/circles/queries";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [rows, myCircles] = await Promise.all([
    db.select({
      id: inventoryItems.id,
      category: inventoryItems.category,
      name: inventoryItems.name,
      quantity: inventoryItems.quantity,
      status: inventoryItems.status,
      unitCostCents: inventoryItems.unitCostCents,
      retailPriceCents: inventoryItems.retailPriceCents,
      visibilityCircleId: inventoryItems.visibilityCircleId,
    })
      .from(inventoryItems)
      .where(eq(inventoryItems.orgId, orgId))
      .orderBy(desc(inventoryItems.updatedAt)),
    getCirclesForOrg(db, orgId),
  ]);
  const circleNamesById = new Map(myCircles.map((c) => [c.id, c.name]));

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <InventoryAdmin
        items={rows as InventoryRow[]}
        createAction={createInventoryItem}
        updateAction={updateInventoryItem}
        deleteAction={deleteInventoryItem}
        circles={myCircles.map((c) => ({ id: c.id, name: c.name }))}
        circleNamesById={circleNamesById}
      />
    </main>
  );
}
```

- [ ] **Step 7: Run.** Run: `npx vitest run test/components/inventory/InventoryAdmin.test.tsx`
Expected: PASS.

- [ ] **Step 8: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit.**
```bash
git add src/components/inventory/InventoryAdmin.tsx src/app/\(admin\)/inventory/page.tsx test/components/inventory/InventoryAdmin.test.tsx
git commit -m "$(cat <<'EOF'
feat(inventory): per-row Share dropdown + 'Shared via [Circle]' badge

InventoryAdmin gains 'circles' + 'circleNamesById' + 'updateAction' props.
Each row renders an inline Share-with-circle dropdown sourced from
the owner org's circle memberships. Selecting a circle fires
updateInventoryItem with the row's existing fields + the new
visibilityCircleId.

Foreign-circle-id fallback: if a row has a visibilityCircleId not in
the viewer's circleNamesById map, the badge renders nothing (name-leak
guard).

/inventory RSC parallel-fetches getCirclesForOrg(db, orgId) and threads
the result through. Inline projection extended with visibilityCircleId.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C3: New `TradeNetInventoryPanel` dashboard panel

**Files:**
- Create: `src/components/dashboard/TradeNetInventoryPanel.tsx`
- Create: `test/components/dashboard/TradeNetInventoryPanel.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/dashboard/TradeNetInventoryPanel.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeNetInventoryPanel } from "@/components/dashboard/TradeNetInventoryPanel";

describe("TradeNetInventoryPanel", () => {
  it("renders the honest empty state when items is empty", () => {
    render(<TradeNetInventoryPanel items={[]} />);
    expect(screen.getByText(/No partner inventory shared with you yet/i)).toBeInTheDocument();
  });

  it("renders one row per item with name, qty, ownerOrgLabel", () => {
    render(<TradeNetInventoryPanel items={[
      {
        id: 1, orgId: 501, ownerOrgLabel: "Mehta Diamonds — Mumbai",
        category: "Diamonds", name: "Round 2.51ct E/VVS1 — demo",
        quantity: 1, status: "in_stock", visibilityCircleId: 201,
        updatedAt: new Date(),
      },
    ]} />);
    expect(screen.getByText(/Round 2.51ct/)).toBeInTheDocument();
    expect(screen.getByText(/Mehta Diamonds/)).toBeInTheDocument();
  });

  it("XSS guard: ownerOrgLabel is rendered as text, not HTML", () => {
    const xss = "<script>alert(1)</script>";
    render(<TradeNetInventoryPanel items={[
      { id: 1, orgId: 501, ownerOrgLabel: xss, category: "Diamonds",
        name: "demo", quantity: 1, status: "in_stock", visibilityCircleId: 201,
        updatedAt: new Date() },
    ]} />);
    expect(screen.getByText(xss)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL.** Run: `npx vitest run test/components/dashboard/TradeNetInventoryPanel.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the component.** Create `src/components/dashboard/TradeNetInventoryPanel.tsx`:

```tsx
import type { SharedInventoryRow } from "@/db/inventory";
import { Panel } from "@/components/dashboard/Panel";
import { timeAgo } from "@/lib/format/timeAgo";

export function TradeNetInventoryPanel({ items }: { items: SharedInventoryRow[] }) {
  if (items.length === 0) {
    return (
      <Panel title="TradeNet Inventory" testid="panel-tradenet-inventory">
        <p className="text-sm text-text/40">No partner inventory shared with you yet.</p>
      </Panel>
    );
  }
  return (
    <Panel title="TradeNet Inventory" testid="panel-tradenet-inventory">
      <ul className="divide-y divide-text/10 text-sm">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 py-2">
            <span className="text-[10px] uppercase tracking-wider text-text/40">{it.category}</span>
            <span className="flex-1 truncate text-text/80" title={it.name}>{it.name}</span>
            <span className="text-text/60">×{it.quantity}</span>
            <span className="text-[10px] text-text/40" title={`Posted by ${it.ownerOrgLabel}`}>
              {it.ownerOrgLabel}
            </span>
            <span className="text-[10px] text-text/40">{timeAgo(it.updatedAt)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
```

(Confirm the `Panel` and `timeAgo` import paths against what slice 2's `DealRoomPanel.tsx` uses — copy from there to ensure correctness.)

- [ ] **Step 4: Run.** Run: `npx vitest run test/components/dashboard/TradeNetInventoryPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/components/dashboard/TradeNetInventoryPanel.tsx test/components/dashboard/TradeNetInventoryPanel.test.tsx
git commit -m "feat(dashboard): TradeNetInventoryPanel — top-N partner inventory

Mirrors DealRoomPanel's shape. Empty state is honest ('No partner
inventory shared with you yet'). Each row surfaces category + name +
qty + ownerOrgLabel + timeAgo. No 'Shared via' badge per row — every
row IS shared by definition.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C4: Wire `TradeNetInventoryView` through `PanelCtx`, `DashboardGrid`, page, and registry

**Files:**
- Modify: `src/lib/layout/types.ts`
- Modify: `src/lib/layout/registry.tsx`
- Modify: `src/app/DashboardGrid.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Extend `src/lib/layout/types.ts`.** Add the view interface and widen `PanelCtx`:

```ts
import type { SharedInventoryRow } from "@/db/inventory";

export interface TradeNetInventoryView {
  items: SharedInventoryRow[];
}

export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
  providerStatus?: ProviderStatusView;
  todaysBids?: TodaysBidsView;
  tradenetInventory?: TradeNetInventoryView;
}
```

- [ ] **Step 2: Extend `src/lib/layout/registry.tsx`.** Add the new panel entry after the existing `tradenet-exchange` registration:

```tsx
import { TradeNetInventoryPanel } from "@/components/dashboard/TradeNetInventoryPanel";

// ...

{
  id: "tradenet-inventory",
  title: "TradeNet Inventory",
  defaultSize: 1,
  render: (ctx) =>
    ctx.tradenetInventory
      ? <TradeNetInventoryPanel items={ctx.tradenetInventory.items} />
      : <BusinessPlaceholder title="TradeNet Inventory" testid="panel-tradenet-inventory" />,
},
```

- [ ] **Step 3: Extend `src/app/DashboardGrid.tsx`.** Add `tradenetInventory` to the prop list, re-export the type, thread into the `useMemo` ctx:

```ts
export type {
  InventoryView, DiamondView, DealView, WebsiteOverviewView,
  ProviderStatusView, TodaysBidsView, TradeNetInventoryView,
} from "@/lib/layout/types";

// in DashboardGrid signature:
export function DashboardGrid({
  inventory, diamond, deals, website, providerStatus, todaysBids, tradenetInventory,
}: {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
  providerStatus?: ProviderStatusView;
  todaysBids?: TodaysBidsView;
  tradenetInventory?: TradeNetInventoryView;
}) {
  // ...
  const ctx = useMemo(
    () => ({ inventory, diamond, deals, website, providerStatus, todaysBids, tradenetInventory }),
    [inventory, diamond, deals, website, providerStatus, todaysBids, tradenetInventory],
  );
  // ...
}
```

- [ ] **Step 4: Extend `src/app/page.tsx`.** Add `getSharedInventoryForOrg` to the parallel fetch and pass `tradenetInventory` to `DashboardGrid`:

```ts
import { getInventorySummary, getSharedInventoryForOrg } from "@/db/inventory";

// inside the default-export RSC, in the Promise.all batch:
const [
  invSummary, diamond, deals, website, providerStatus, todaysBidsView, sharedInventory,
] = await Promise.all([
  getInventorySummary(db, orgId),
  // … existing entries …
  getSharedInventoryForOrg(db, orgId, 5),
]);

const tradenetInventory = { items: sharedInventory };

return (
  <DashboardGrid
    inventory={inventory}
    diamond={diamond}
    deals={deals}
    website={website}
    providerStatus={providerStatus}
    todaysBids={todaysBidsView}
    tradenetInventory={tradenetInventory}
  />
);
```

(Match the existing `page.tsx` shape exactly — rename variables if needed to avoid collision with the existing `inventory` view variable.)

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Run full suite.** Run: `npm test -- --run`
Expected: green.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/layout/types.ts src/lib/layout/registry.tsx src/app/DashboardGrid.tsx src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): register tradenet-inventory panel + wire RSC

PanelCtx widens with optional TradeNetInventoryView. Registry adds the
tradenet-inventory entry after tradenet-exchange (Deal Room) so the two
TradeNet panels cluster together.

src/app/page.tsx parallel-fetches getSharedInventoryForOrg(db, orgId, 5)
and threads the result through DashboardGrid → PanelCtx → registry →
TradeNetInventoryPanel.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C5: New `/exchange` admin route + `TradeNetInventoryList` + Nav + middleware

**Files:**
- Create: `src/components/inventory/TradeNetInventoryList.tsx`
- Create: `src/app/(admin)/exchange/page.tsx`
- Modify: `src/middleware.ts`
- Modify: `src/components/dashboard/Nav.tsx`
- Create: `test/app/exchange.test.tsx`

- [ ] **Step 1: Create the list component.** `src/components/inventory/TradeNetInventoryList.tsx`:

```tsx
import type { SharedInventoryRow } from "@/db/inventory";
import { formatInventoryVisibility } from "@/lib/inventory/format";
import { timeAgo } from "@/lib/format/timeAgo";

export function TradeNetInventoryList({
  items, circleNamesById,
}: {
  items: SharedInventoryRow[];
  circleNamesById: Map<number, string>;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-text/40">No partner inventory shared with you yet.</p>
    );
  }
  return (
    <ul className="divide-y divide-text/10 text-sm">
      {items.map((it) => {
        const vis = formatInventoryVisibility(it.visibilityCircleId, circleNamesById);
        return (
          <li key={it.id} className="flex items-center gap-2 py-2">
            <span className="text-[10px] uppercase tracking-wider text-text/40">{it.category}</span>
            <span className="flex-1 truncate text-text/80" title={it.name}>{it.name}</span>
            <span className="text-text/60">×{it.quantity}</span>
            <span className="text-[10px] text-text/40">{it.ownerOrgLabel}</span>
            {vis.kind === "circle" && (
              <span
                className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80"
                title={`Shared via ${vis.circleName}`}
              >
                {vis.circleName}
              </span>
            )}
            <span className="text-[10px] text-text/40">{timeAgo(it.updatedAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Create the RSC route.** `src/app/(admin)/exchange/page.tsx`:

```tsx
import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getSharedInventoryForOrg } from "@/db/inventory";
import { getCircleNamesForOrg } from "@/lib/circles/queries";
import { TradeNetInventoryList } from "@/components/inventory/TradeNetInventoryList";

export const dynamic = "force-dynamic";

export default async function ExchangePage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [items, circleNamesById] = await Promise.all([
    getSharedInventoryForOrg(db, orgId, null),
    getCircleNamesForOrg(db, orgId),
  ]);
  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">TradeNet Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <TradeNetInventoryList items={items} circleNamesById={circleNamesById} />
    </main>
  );
}
```

- [ ] **Step 3: Add `/exchange` to middleware matcher.** Open `src/middleware.ts`. Update the matcher:

```ts
export const config = {
  matcher: [
    "/", "/api/quotes", "/api/convert", "/api/history", "/api/diamond-history",
    "/inventory", "/diamonds", "/deals", "/website", "/circles", "/exchange",
    "/company/:path*",
  ],
};
```

- [ ] **Step 4: Add the Nav route.** Open `src/components/dashboard/Nav.tsx`. The SECTIONS array already contains `"TradeNet Exchange"`. Add it to `ROUTES`:

```ts
const ROUTES: Record<string, string> = {
  Inventory: "/inventory",
  Diamonds: "/diamonds",
  Website: "/website",
  Circles: "/circles",
  "Orders & Deals": "/deals",
  "TradeNet Exchange": "/exchange",
};
```

- [ ] **Step 5: RSC integration test.** Create `test/app/exchange.test.tsx`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExchangePage from "@/app/(admin)/exchange/page";

vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/inventory", () => ({
  getSharedInventoryForOrg: vi.fn(async () => []),
}));
vi.mock("@/lib/circles/queries", () => ({
  getCircleNamesForOrg: vi.fn(async () => new Map()),
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("/exchange RSC", () => {
  it("renders empty state when no items are shared", async () => {
    const node = await ExchangePage();
    const html = JSON.stringify(node);
    expect(html).toMatch(/No partner inventory shared/);
  });

  it("renders populated list", async () => {
    const { getSharedInventoryForOrg } = await import("@/db/inventory");
    const { getCircleNamesForOrg } = await import("@/lib/circles/queries");
    vi.mocked(getSharedInventoryForOrg).mockResolvedValueOnce([
      {
        id: 1, orgId: 501, ownerOrgLabel: "Mehta",
        category: "Diamonds", name: "Round 2.51ct demo",
        quantity: 1, status: "in_stock", visibilityCircleId: 201,
        updatedAt: new Date(),
      },
    ] as never);
    vi.mocked(getCircleNamesForOrg).mockResolvedValueOnce(new Map([[201, "Trusted Partners"]]));
    const node = await ExchangePage();
    const html = JSON.stringify(node);
    expect(html).toMatch(/Round 2.51ct/);
    expect(html).toMatch(/Trusted Partners/);
  });
});
```

(Mirror the slice 4c `test/app/circles.test.tsx` mocking style if it exists; adjust mocks to match the actual import surface.)

- [ ] **Step 6: Run.** Run: `npx vitest run test/app/exchange.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck + full suite.** Run: `npx tsc --noEmit && npm test -- --run`
Expected: green.

- [ ] **Step 8: Commit.**
```bash
git add src/components/inventory/TradeNetInventoryList.tsx src/app/\(admin\)/exchange/page.tsx src/middleware.ts src/components/dashboard/Nav.tsx test/app/exchange.test.tsx
git commit -m "$(cat <<'EOF'
feat(exchange): /exchange admin route + Nav + middleware

New /exchange route surfaces every TradeNet inventory item shared into
a circle the viewer is in. Empty state is honest; populated state shows
category + name + qty + ownerOrgLabel + Shared-via badge + timeAgo.

TradeNetInventoryList differs from TradeNetInventoryPanel by including
the per-row Shared-via badge — useful when the viewer is in multiple
circles and needs to disambiguate which circle a partner item came in
through.

Nav's existing 'TradeNet Exchange' static label becomes a real link
to /exchange. Middleware matcher adds the new route.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C6: Green-bar Phase C

- [ ] **Step 1: Full suite.** Run: `npm test -- --run`
Expected: green.

- [ ] **Step 2: Typecheck + lint.** Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Build.** Run: `npm run build`
Expected: clean build, no type errors, no Next.js route warnings.

- [ ] **Step 4: Phase C done.**

---

## Phase D — Verify + ship

### Task D1: Enforcement greps + spec exit gate

**Files:** (read-only; no writes)

- [ ] **Step 1: Confirm no tenanted `from(inventoryItems)` outside the per-table module + admin RSC.** Run:
  ```
  grep -rn "from(inventoryItems)" src/
  ```
  Expected: matches in `src/db/inventory.ts` (the per-table module — slice-1b-1 + new slice-15 helper) and `src/app/(admin)/inventory/page.tsx` (explicit `eq(orgId, ...)` filter — preserved). Any other match must use either `eq(orgId, sessionOrgId)` or go through `getSharedInventoryForOrg`. If there's an offender, fix before continuing.

- [ ] **Step 2: Confirm no read endpoint accepts a circleId.** Run:
  ```
  grep -rn "circleId\|visibilityCircleId" src/lib/inventory/validation.ts
  ```
  Expected: only `visibilityCircleId` inside `inventoryItemInput`. No read schemas.

- [ ] **Step 3: Confirm no inventory authz on `owner_org_id`.** Run:
  ```
  grep -rn "owner_org_id\|ownerOrgId" src/lib/inventory/ src/db/inventory.ts
  ```
  Expected: zero matches. (Slice 4 keeps `ownerOrgId` only in `src/lib/circles/queries.ts`'s `CircleRow`. Inventory uses `org_id` directly, never `owner_org_id`.)

- [ ] **Step 4: Confirm `isOrgMemberOfCircle` call sites.** Run:
  ```
  grep -rn "isOrgMemberOfCircle" src/
  ```
  Expected: definition in `src/lib/circles/membership.ts`, call sites in `src/lib/deals/actions.ts` (slice 4), `src/lib/circles/actions.ts` (slice 4c), and `src/lib/inventory/actions.ts` (slice 15 — TWO sites: createInventoryItem + updateInventoryItem, via the shared `ensureCanShare` helper). No new read-path call sites.

- [ ] **Step 5: Confirm the zero-circles early return is structurally present.** Run:
  ```
  grep -n "circleIds.length === 0" src/db/inventory.ts
  ```
  Expected: one match, in `getSharedInventoryForOrg`. The structural test in `test/lib/inventory/visibility.test.ts` (A5) also asserts this — re-run it: `npx vitest run test/lib/inventory/visibility.test.ts`.

- [ ] **Step 6: Confirm `getInventorySummary` is unchanged.** Compare `git log -p src/db/inventory.ts` for the function body — the WHERE clause is `and(eq(inventoryItems.orgId, orgId), ne(inventoryItems.status, "sold"))` byte-identical to slice 1b-1.

- [ ] **Step 7: Final full-suite run.** Run: `npm test -- --run`
Expected: green. Capture the test count for the commit message.

- [ ] **Step 8: Final build.** Run: `npm run build`
Expected: clean. Capture warning count.

- [ ] **Step 9: If anything fails above, STOP** and fix. Each is a spec exit-gate criterion.

---

### Task D2: Final review, merge, and clean up

**Files:** (git operations only)

- [ ] **Step 1: Walk the diff.** Run: `git log main..HEAD --stat` and `git diff main...HEAD --stat`. Verify only the files in the spec §9 file plan changed; no incidental modifications.

- [ ] **Step 2: Self-review checklist (mirrors slice 4 §8.8):**
  - [ ] `inventory_items.visibility_circle_id` is nullable + ON DELETE SET NULL (schema + migration).
  - [ ] Partial index `WHERE visibility_circle_id IS NOT NULL` is present.
  - [ ] `getSharedInventoryForOrg` has an explicit `if (circleIds.length === 0) return []` early return.
  - [ ] `getInventorySummary` body unchanged from slice 1b-1.
  - [ ] `updateInventoryItem` + `createInventoryItem` both call `ensureCanShare` BEFORE the SQL mutation.
  - [ ] `updateValues()` omits `visibilityCircleId` when `input.visibilityCircleId === undefined` (the "undefined preserves" discipline).
  - [ ] `deleteInventoryItem` is unchanged.
  - [ ] `formatInventoryVisibility` returns `kind: "private"` for unknown ids (defensive fallback).
  - [ ] `TradeNetInventoryPanel` and `TradeNetInventoryList` render `ownerOrgLabel` as text (XSS).
  - [ ] `/exchange` is in the middleware matcher.
  - [ ] Nav has `"TradeNet Exchange": "/exchange"` in ROUTES.
  - [ ] Demo seed includes 3 partner rows shared into Trusted Partners.
  - [ ] All tests green, build clean, no lint errors.

- [ ] **Step 3: Open a PR.** Push the branch and run `gh pr create` with a body that references the spec and lists the file count, test count, and any open follow-up items.

  Example body:
  ```
  Slice 15 — TradeNet Inventory: cross-circle inventory sharing.

  Mirrors slice 4's architectural template:
  - inventory_items.visibility_circle_id (nullable, ON DELETE SET NULL).
  - getSharedInventoryForOrg query helper with zero-circles early return.
  - updateInventoryItem / createInventoryItem accept optional visibilityCircleId;
    membership pre-check via isOrgMemberOfCircle (session orgId, never wire).
  - InventoryAdmin per-row Share dropdown + Shared-via badge.
  - New TradeNetInventoryPanel dashboard panel + /exchange admin route.

  getInventorySummary INTENTIONALLY UNCHANGED — see spec §3.1.

  Spec: docs/superpowers/specs/2026-06-06-aiya-tradenet-inventory-slice-15-design.md
  Plan: docs/superpowers/plans/2026-06-06-aiya-tradenet-inventory-slice-15.md
  ```

- [ ] **Step 4: Once CI is green, merge to main** following the same flow as slices 4 / 4c. Then:
  - Remove the worktree: `git worktree remove .worktrees/aiya-tradenet-inventory-15`.
  - Delete the branch locally if desired.

- [ ] **Step 5: Update the task tracker.** Mark slice 15 complete; queue slice 18 (Bidding on Inventory) as the natural follow-up.

---

## Appendix — File Plan Cross-Reference

This is the canonical list. Every file the slice touches appears here exactly once.

**New (10):**
- `src/lib/inventory/format.ts`
- `src/components/dashboard/TradeNetInventoryPanel.tsx`
- `src/components/inventory/TradeNetInventoryList.tsx`
- `src/app/(admin)/exchange/page.tsx`
- `drizzle/0011_*.sql`
- `test/lib/inventory/format.test.ts`
- `test/lib/inventory/visibility.test.ts`
- `test/components/dashboard/TradeNetInventoryPanel.test.tsx`
- `test/app/exchange.test.tsx`
- `test/db/tradenet-inventory-migration.test.ts`

**Modified (15):**
- `src/db/schema.ts`
- `src/db/inventory.ts`
- `src/lib/inventory/validation.ts`
- `src/lib/inventory/actions.ts`
- `src/components/inventory/InventoryAdmin.tsx`
- `src/app/(admin)/inventory/page.tsx`
- `src/app/page.tsx`
- `src/app/DashboardGrid.tsx`
- `src/lib/layout/types.ts`
- `src/lib/layout/registry.tsx`
- `src/lib/demo/seed.ts`
- `src/middleware.ts`
- `src/components/dashboard/Nav.tsx`
- `test/db/inventory.test.ts`
- `test/lib/inventory/actions.test.ts`
- `test/components/inventory/InventoryAdmin.test.tsx`
- `test/lib/demo/seed.test.ts`
- `test/db/schema.test.ts`

(The PR will show 10 created + ~18 modified.)

**Removed:** none.

---
