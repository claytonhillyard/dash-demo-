# AIYA Slice 18 — Inventory Bidding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured price-offer bidding on shared `inventory_items` — the inventory mirror of slice 16's Deal Room bidding. New `inventory_bids` table with a `pending → accepted / rejected / withdrawn / auto_rejected` lifecycle; new nullable `inventory_items.bid_mode` column (null = bidding off, opt-in only); five `runWithUser`-wrapped server actions; one query helper; "Place Bid" button on `/exchange` rows + new `InventoryBidsTab` drawer + per-row Bidding selector on `/inventory` admin; demo seed of 2 pending bids from AIYA on partner items.

**Architecture:** Visibility (bidder OR item-owner) is SQL-enforced inside `getInventoryBidsForItem`, decoupled from `inventory_items.visibility_circle_id` (circle members can see the ITEM but NOT bids on it). Write-side authz routes through a new `canBidOnItem` helper that combines slice-15 visibility (`isOrgMemberOfCircle`) + slice-16 self-bid block + slice-18 bid_mode-non-null gate. `acceptInventoryBid` wraps both UPDATEs in a single `db.transaction`. `inventory_items.status` is INTENTIONALLY untouched by accept (no stock-deduction primitive this slice — see spec §5.3).

**Tech Stack:** Drizzle ORM (pglite dev/test, Neon HTTP prod) · Next.js 15 App Router · React 19 Server Components + Server Actions · Zod · vitest (jsdom + node) · Testing Library · Tailwind (existing tokens).

**Branch:** `feature/slice-18-inventory-bidding` worktree at `.worktrees/slice-18-inventory-bidding`. See `docs/worktrees.md` for the convention. Implementer subagents work *only* in the worktree path — never in `/root`.

**Spec:** `docs/superpowers/specs/2026-06-07-aiya-inventory-bidding-slice-18-design.md`. Read it in full before starting.

---

## File Structure

**New files:**
- `src/lib/inventory/bidValidation.ts` — Zod schemas for the 5 actions
- `src/lib/auth/orgLabel.ts` — shared `resolveOrgLabel(db, orgId)` (lifted from `src/lib/deals/actions.ts`; needed cross-subsystem)
- `src/components/inventory/InventoryBidsTab.tsx` — drawer with bid form + bid list + owner accept/reject
- `src/components/inventory/PostInventoryBidForm.tsx` — sub-component inside `InventoryBidsTab`
- `drizzle/0012_*.sql` — generated migration
- `test/db/inventory-bids.test.ts` — query-layer truth-table
- `test/db/inventory-bids-migration-smoke.test.ts` — schema-shape smoke
- `test/lib/inventory/bidValidation.test.ts` — Zod truth-table
- `test/lib/inventory/bid-authz.test.ts` — write-side truth-table including self-bid + bidding-disabled cells
- `test/lib/inventory/bid-accept-atomicity.test.ts` — atomic accept + sibling sweep
- `test/lib/inventory/bid-withdraw.test.ts` — withdraw lifecycle + idempotency
- `test/lib/inventory/bid-mode-toggle.test.ts` — setInventoryItemBidMode authz + no-mutation regression
- `test/components/inventory/InventoryBidsTab.test.tsx` — drawer state matrix

**Modified files:**
- `src/db/schema.ts` — add `inventoryBids` table + `bidMode` column on `inventoryItems`
- `src/db/inventory.ts` — add `getInventoryBidsForItem`; widen `SharedInventoryRow` with `bidMode`; extend `getSharedInventoryForOrg` projection
- `src/lib/inventory/actions.ts` — append 5 new actions + `canBidOnItem` helper
- `src/lib/deals/actions.ts` — re-route `resolveOrgLabel` import to new shared helper (zero behavior change)
- `src/components/inventory/TradeNetInventoryList.tsx` — Place Bid button + pending-bid count badge
- `src/components/dashboard/TradeNetInventoryPanel.tsx` — widened row type (no new UI)
- `src/components/inventory/InventoryAdmin.tsx` — per-row Bidding selector + badge
- `src/app/(admin)/exchange/page.tsx` — fetch `bidsByItemId` map; thread to list
- `src/app/(admin)/inventory/page.tsx` — extend projection with `bidMode`; thread `setInventoryItemBidMode`
- `src/lib/demo/seed.ts` — `DEMO_INVENTORY_BIDS` + `getSeedInventoryBidModes` + widened `SeedSharedInventoryRow`
- `test/lib/demo/seed.test.ts` — bid-seed assertions
- `test/components/inventory/TradeNetInventoryList.test.tsx` — Place Bid button visibility matrix
- `test/components/inventory/InventoryAdmin.test.tsx` — Bidding selector assertions

---

## Pre-flight

- [ ] **Pre-flight Step 1: Sync main + verify clean working tree**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git fetch origin --quiet
git pull --ff-only origin main
git status -sb
git log --oneline -1
```

Expected: `## main...origin/main`, last commit is the slice-18 spec commit (or its descendant if the slice-17 parallel agent merged something). No `M`/`A` lines — only the long-standing untracked personal files (`.md2pdf.py`, `FEMALE_AI_BOT.md`, `FEMALE_AI_BOT.pdf`, `training protocol/`) are acceptable.

- [ ] **Pre-flight Step 2: Cut the slice-18 worktree (per `docs/worktrees.md`)**

```bash
git worktree add .worktrees/slice-18-inventory-bidding -b feature/slice-18-inventory-bidding
cd .worktrees/slice-18-inventory-bidding
ln -sf ../../.env .env
ln -sf ../../node_modules node_modules
git branch --show-current
```

Expected: `feature/slice-18-inventory-bidding`. Symlinks present.

**All remaining steps run from `.worktrees/slice-18-inventory-bidding`, NOT from `/root`.** This is the failure mode `docs/worktrees.md` exists to prevent.

- [ ] **Pre-flight Step 3: Determine the next migration number**

```bash
ls -1 drizzle/ | grep -E '^[0-9]{4}_' | sort | tail -3
```

Expected: last on main is `0011_giant_bishop.sql` (slice 15). The slice-18 migration will be `0012_*`. If the slice-17 parallel agent has merged a `0012_*`, slice 18 takes `0013_*` — adjust references accordingly. Call this `NNNN` for the rest of the plan.

- [ ] **Pre-flight Step 4: Confirm baseline test suite is green**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: `Test Files N passed (N) / Tests M passed (M)` with zero failures. The baseline as of the spec date is **827/827** (slice 15 + slice 16 + timezone-fix all landed). If anything is failing on `main` before slice-18 edits, stop and fix that first.

- [ ] **Pre-flight Step 5: Confirm slice-15 + slice-16 helpers are present**

```bash
grep -n "isOrgMemberOfCircle\|getSharedInventoryForOrg\|resolveOrgLabel\|canBidOn\b\|ForbiddenError" src/lib/circles/membership.ts src/db/inventory.ts src/lib/deals/actions.ts src/lib/auth/errors.ts 2>&1 | head -20
```

Expected: `isOrgMemberOfCircle` exported from `src/lib/circles/membership.ts`; `getSharedInventoryForOrg` exported from `src/db/inventory.ts`; `resolveOrgLabel` defined inside `src/lib/deals/actions.ts` (private — Task A0 will lift it); `ForbiddenError` exported from `src/lib/auth/errors.ts`. All four are slice-18 dependencies — if any is missing, stop.

---

## Phase A — DB foundation + query layer

### Task A0: Lift `resolveOrgLabel` to a shared module

**Files:**
- Create: `src/lib/auth/orgLabel.ts`
- Modify: `src/lib/deals/actions.ts`

Slice 16 hid `resolveOrgLabel` as a private helper inside `src/lib/deals/actions.ts`. Slice 18 needs the same helper from `src/lib/inventory/actions.ts`; importing across subsystem boundaries from a different "actions" file is awkward. Lift the helper to a shared module FIRST, with zero behavior change, before adding any new logic.

- [ ] **Step 1: Read the existing `resolveOrgLabel` implementation.**

```bash
grep -n -A 12 "async function resolveOrgLabel" src/lib/deals/actions.ts
```

Capture the exact body — it's a single-row SELECT against `orgs.name` falling back to a default label. The slice-18 implementation must be byte-identical.

- [ ] **Step 2: Create `src/lib/auth/orgLabel.ts`.**

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orgs } from "@/db/schema";

/** Resolve the human-readable label for an org, used for denormalized
 *  *_org_label snapshot columns (deal_messages, bids, inventory_bids).
 *  Falls back to a deterministic placeholder if the org has no name set.
 *
 *  Slice 18 lifted this from src/lib/deals/actions.ts (slice 16) so the
 *  inventory action layer can share it without importing across
 *  subsystem boundaries. Behavior is byte-identical to slice 16. */
export async function resolveOrgLabel(d: Db, orgId: number): Promise<string> {
  const [row] = await d
    .select({ name: orgs.name })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  return row?.name ?? `Org #${orgId}`;
}
```

Paste the exact body from Step 1 into the function. Match the fallback label string exactly — the slice-10 + slice-16 tests rely on it.

- [ ] **Step 3: Replace the inline `resolveOrgLabel` in `src/lib/deals/actions.ts` with an import.**

```ts
// near the top of src/lib/deals/actions.ts
import { resolveOrgLabel } from "@/lib/auth/orgLabel";
```

Delete the local `async function resolveOrgLabel` definition. All call sites stay the same identifier; the import substitutes for the local function.

- [ ] **Step 4: Verify zero behavior change.**

```bash
npx tsc --noEmit 2>&1 | tail -10
npm test -- --run test/lib/deals/ 2>&1 | tail -10
```

Expected: zero TS errors. Slice 10 + slice 16 tests stay green.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/orgLabel.ts src/lib/deals/actions.ts
git commit -m "$(cat <<'EOF'
refactor(auth): lift resolveOrgLabel to src/lib/auth/orgLabel.ts

Slice 18 needs the helper from the inventory action layer; importing
across "actions" subsystems is awkward, so promote it to a shared
location with zero behavior change. Slice-16 callers keep the same
identifier via import.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A1: Add `inventory_bids` table + `inventory_items.bid_mode` column to schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Locate the `inventoryItems` definition.**

`src/db/schema.ts:162` — slice 15 added `visibilityCircleId` as the last business column before timestamps. Slice 18 adds `bidMode` immediately after it.

- [ ] **Step 2: Add the `bidMode` column to `inventoryItems`.**

Inside the `inventoryItems` `pgTable(...)` columns object, immediately after `visibilityCircleId`:

```ts
    bidMode: text("bid_mode", { enum: ["single", "history"] }), // NULLABLE — null = bidding off
```

**Do NOT add `.notNull()` or `.default(...)`.** The column must be nullable with no default — null means "bidding off" by construction; existing rows must read as null without migration noise. See spec §2.2.

- [ ] **Step 3: Locate the existing `bids` table.**

`src/db/schema.ts:334` — slice 16's table. The new `inventoryBids` table goes immediately below it (file ordering is cosmetic; pglite resolves FK order from `.references()`).

- [ ] **Step 4: Add the `inventoryBids` table.**

```ts
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
```

> The partial index `pendingByItemIdx` mirrors slice 16's `bids_pending_by_deal_idx`. It supports the accept-atomicity sweep: `UPDATE inventory_bids SET status='auto_rejected' WHERE inventory_item_id = ? AND status = 'pending' AND id != ?`.

**NOTE:** No `bid_mode` snapshot column on `inventory_bids` (slice 16 had one for audit; slice 18 deliberately omits it — spec §2.1).

- [ ] **Step 5: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 6: Commit.**

```bash
git add src/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): inventory_bids table + inventory_items.bid_mode (slice 18)

inventory_items.bid_mode is NULLABLE text — null = bidding disabled.
Every existing row lands at null. Opt-in only — never a destructive
default. inventory_bids mirrors the slice-16 bids table shape minus
the bid_mode snapshot column (deliberate, see spec §2.1).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration + smoke test

**Files:**
- Create: `drizzle/NNNN_*.sql` (NNNN = next sequential, typically 0012)
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/NNNN_snapshot.json`
- Create: `test/db/inventory-bids-migration-smoke.test.ts`

- [ ] **Step 1: Generate the migration.**

```bash
npx drizzle-kit generate
ls -1 drizzle/ | grep -E '^[0-9]{4}_' | tail -2
```

Expected: a new migration `NNNN_<auto_suffix>.sql` appears. Inspect it:

```bash
cat drizzle/NNNN_*.sql
```

Expected SQL includes:
```sql
CREATE TABLE IF NOT EXISTS "inventory_bids" ( … );
ALTER TABLE "inventory_items" ADD COLUMN "bid_mode" text;
CREATE INDEX … "inventory_bids_item_created_idx" …
CREATE INDEX … "inventory_bids_bidder_created_idx" …
CREATE INDEX … "inventory_bids_pending_by_item_idx" … WHERE … status = 'pending' …
```

Critically: the `ALTER TABLE inventory_items ADD COLUMN bid_mode` line MUST NOT include `NOT NULL` or `DEFAULT`. If drizzle-kit emits one, stop and revisit Task A1 step 2 (the schema declaration must be plain `text("bid_mode", { enum: […] })` with no `.notNull()` / no `.default(...)`).

- [ ] **Step 2: Keep the auto-generated migration name.**

The slice-15 + slice-16 + slice-17 (parallel) merges all keep auto-names (`0011_giant_bishop.sql`). Slice 18 follows suit — no rename.

- [ ] **Step 3: Write the smoke test at `test/db/inventory-bids-migration-smoke.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { sql } from "drizzle-orm";

describe("migration NNNN — inventory bidding (slice 18)", () => {
  it("creates inventory_bids and inventory_items.bid_mode without error", async () => {
    const { db, close } = await createTestDb();
    try {
      // Table exists
      const tables = await db.execute(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'inventory_bids'
      `);
      const tableRows = (tables as unknown as { rows: { tablename: string }[] }).rows;
      expect(tableRows.map((r) => r.tablename)).toEqual(["inventory_bids"]);

      // inventory_items.bid_mode is nullable text with no default
      const cols = await db.execute(sql`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'inventory_items' AND column_name = 'bid_mode'
      `);
      const colRows = (cols as unknown as {
        rows: { column_name: string; data_type: string; is_nullable: "YES" | "NO"; column_default: string | null }[];
      }).rows;
      expect(colRows).toHaveLength(1);
      expect(colRows[0].data_type).toBe("text");
      expect(colRows[0].is_nullable).toBe("YES");
      expect(colRows[0].column_default).toBeNull();

      // inventory_bids column shape
      const bidCols = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'inventory_bids'
        ORDER BY ordinal_position
      `);
      const bidColRows = (bidCols as unknown as {
        rows: { column_name: string; is_nullable: "YES" | "NO" }[];
      }).rows;
      const bidColMap = new Map(bidColRows.map((r) => [r.column_name, r.is_nullable]));
      expect(bidColMap.get("id")).toBe("NO");
      expect(bidColMap.get("inventory_item_id")).toBe("NO");
      expect(bidColMap.get("bidder_org_id")).toBe("NO");
      expect(bidColMap.get("price_cents")).toBe("NO");
      expect(bidColMap.get("notes")).toBe("YES");
      expect(bidColMap.get("decided_at")).toBe("YES");
    } finally {
      await close();
    }
  });
});
```

- [ ] **Step 4: Run the smoke test.**

```bash
npx vitest run test/db/inventory-bids-migration-smoke.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: `1 passed`.

- [ ] **Step 5: Commit.**

```bash
git add drizzle/ test/db/inventory-bids-migration-smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(db): generate NNNN migration (inventory_bids + bid_mode)

Smoke test asserts inventory_bids exists with the expected
nullable/non-nullable columns and that inventory_items.bid_mode is
nullable text with no default — existing rows land at NULL (bidding
off) without migration noise.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Implement `getInventoryBidsForItem` + truth-table test

**Files:**
- Modify: `src/db/inventory.ts`
- Create: `test/db/inventory-bids.test.ts`

- [ ] **Step 1: Write the failing test at `test/db/inventory-bids.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { inventoryItems, inventoryBids, circles, circleMembers, orgs } from "@/db/schema";
import { getInventoryBidsForItem } from "@/db/inventory";

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

async function seedItem(ownerOrgId: number, opts: {
  visibilityCircleId?: number | null;
  bidMode?: "single" | "history" | null;
} = {}) {
  const [row] = await db
    .insert(inventoryItems)
    .values({
      orgId: ownerOrgId,
      category: "Diamonds",
      name: "test-item",
      quantity: 1,
      status: "in_stock",
      unitCostCents: 100_000,
      retailPriceCents: 200_000,
      visibilityCircleId: opts.visibilityCircleId ?? null,
      bidMode: opts.bidMode ?? null,
    })
    .returning();
  return row.id;
}

async function ensureOrg(orgId: number, name: string) {
  await db.insert(orgs).values({ id: orgId, name, slug: `${name}-${orgId}` }).onConflictDoNothing();
}

async function ensureCircleWithMembers(name: string, slug: string, ownerOrgId: number, members: number[]) {
  const [c] = await db.insert(circles).values({ name, slug, ownerOrgId }).returning();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId: c.id, orgId }).onConflictDoNothing();
  }
  return c.id;
}

describe("getInventoryBidsForItem — visibility truth table", () => {
  it("returns the bid to its bidder", async () => {
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 12_300_00,
    });
    const rows = await getInventoryBidsForItem(db, 999, itemId);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(12_300_00);
    expect(rows[0].status).toBe("pending");
  });

  it("returns the bid to the item owner", async () => {
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 12_300_00,
    });
    const rows = await getInventoryBidsForItem(db, 1, itemId);
    expect(rows).toHaveLength(1);
  });

  it("hides the bid from a third party in the same circle", async () => {
    await ensureOrg(888, "third");
    const circleId = await ensureCircleWithMembers("c1", "c1", 1, [1, 999, 888]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: "single" });
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 12_300_00,
    });
    const rows = await getInventoryBidsForItem(db, 888, itemId);
    expect(rows).toEqual([]);
  });

  it("hides the bid from a stranger", async () => {
    await ensureOrg(888, "stranger");
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1,
    });
    const rows = await getInventoryBidsForItem(db, 888, itemId);
    expect(rows).toEqual([]);
  });

  it("orders bids newest-first", async () => {
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values([
      { inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta", priceCents: 1100, createdAt: new Date(Date.now() - 60_000) },
      { inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta", priceCents: 1200, createdAt: new Date() },
    ]);
    const rows = await getInventoryBidsForItem(db, 1, itemId);
    expect(rows.map((r) => r.priceCents)).toEqual([1200, 1100]);
  });

  it("returns [] in demo mode regardless of viewer", async () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const itemId = await seedItem(1);
      await db.insert(inventoryBids).values({
        inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
        priceCents: 1,
      });
      expect(await getInventoryBidsForItem(db, 1, itemId)).toEqual([]);
      expect(await getInventoryBidsForItem(db, 999, itemId)).toEqual([]);
    } finally {
      process.env.NEXT_PUBLIC_DEMO_MODE = prev;
    }
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

```bash
npx vitest run test/db/inventory-bids.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 3: Add `getInventoryBidsForItem` + types to `src/db/inventory.ts`.**

Append below the existing `getSharedInventoryForOrg`:

```ts
export type InventoryBidStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "auto_rejected";

export type InventoryBidView = {
  id: number;
  inventoryItemId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  status: InventoryBidStatus;
  decidedAt: Date | null;
  createdAt: Date;
};

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

/**
 * Slice 18: bids on a single inventory item visible to `viewerOrgId`,
 * ordered newest-first.
 *
 * Visibility is SQL-enforced (NEVER application-layer filtering):
 *   bidder_org_id = viewer OR inventory_items.org_id = viewer
 *
 * ⚠ VISIBILITY PREDICATE — INTENTIONALLY decoupled from
 *   inventory_items.visibility_circle_id. Circle members can see the
 *   ITEM (via slice 15) but NOT bids on it. Same posture as slice
 *   16's getBidsForDeal vs. deals.thread_mode.
 *
 * If you change the OR, update canBidOnItem in src/lib/inventory/actions.ts
 * at the same time.
 *
 * Demo mode short-circuits to [].
 */
export async function getInventoryBidsForItem(
  db: Db,
  viewerOrgId: number,
  inventoryItemId: number,
): Promise<InventoryBidView[]> {
  if (isDemoMode()) return [];
  const res = await db.execute(sql`
    SELECT ib.id, ib.inventory_item_id, ib.bidder_org_id, ib.bidder_org_label,
           ib.price_cents, ib.currency, ib.notes,
           ib.status, ib.decided_at, ib.created_at
    FROM inventory_bids ib
    JOIN inventory_items i ON i.id = ib.inventory_item_id
    WHERE ib.inventory_item_id = ${inventoryItemId}
      AND (ib.bidder_org_id = ${viewerOrgId} OR i.org_id = ${viewerOrgId})
    ORDER BY ib.created_at DESC
  `);
  const rows = rowsOf<{
    id: number;
    inventory_item_id: number;
    bidder_org_id: number;
    bidder_org_label: string;
    price_cents: number;
    currency: string;
    notes: string | null;
    status: InventoryBidStatus;
    decided_at: Date | string | null;
    created_at: Date | string;
  }>(res);
  return rows.map((r) => ({
    id: r.id,
    inventoryItemId: r.inventory_item_id,
    bidderOrgId: r.bidder_org_id,
    bidderOrgLabel: r.bidder_org_label,
    priceCents: r.price_cents,
    currency: r.currency,
    notes: r.notes,
    status: r.status,
    decidedAt:
      r.decided_at === null
        ? null
        : r.decided_at instanceof Date
        ? r.decided_at
        : new Date(r.decided_at),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}
```

Make sure `inventoryBids` is imported from `@/db/schema` and `sql` from `drizzle-orm`.

- [ ] **Step 4: Run — expect `6 passed`.**

```bash
npx vitest run test/db/inventory-bids.test.ts --reporter=verbose 2>&1 | tail -10
```

- [ ] **Step 5: Commit.**

```bash
git add src/db/inventory.ts test/db/inventory-bids.test.ts
git commit -m "$(cat <<'EOF'
feat(db): getInventoryBidsForItem — SQL-enforced bidder|owner visibility

Mirrors slice 16's getBidsForDeal. Visibility decoupled from
inventory_items.visibility_circle_id — bids are structured trade
negotiations, not browseable inventory data. JSDoc carries the
divergence warning so a future "unify with slice 15 visibility"
refactor doesn't accidentally widen visibility.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Widen `SharedInventoryRow` projection with `bidMode`

**Files:**
- Modify: `src/db/inventory.ts`
- Modify: `test/db/inventory.test.ts` (existing slice-15 tests need a minor type-shape update only)

The `/exchange` row component needs `bidMode` to decide whether to show the "Place Bid" button. Slice 18 widens the projection at the query layer — no second fetch.

- [ ] **Step 1: Widen `SharedInventoryRow`.**

In `src/db/inventory.ts`:

```ts
export interface SharedInventoryRow {
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
```

- [ ] **Step 2: Extend the `getSharedInventoryForOrg` SELECT projection.**

Add `bidMode: inventoryItems.bidMode` next to `visibilityCircleId` in the `.select({...})` call. The downstream `.where(...)` and `.orderBy(...)` chain stays unchanged. The `rows as SharedInventoryRow[]` cast at the bottom now requires the new field; drizzle threads it through correctly because the column type is already enum-narrowed.

- [ ] **Step 3: Verify the existing slice-15 visibility test still passes.**

```bash
npx vitest run test/db/inventory.test.ts --reporter=verbose 2>&1 | tail -10
```

The existing tests don't assert the `bidMode` field; type widening alone should not break anything. If a test seeds `SharedInventoryRow` literally (rather than going through the helper), update it to include `bidMode: null`.

- [ ] **Step 4: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

- [ ] **Step 5: Commit.**

```bash
git add src/db/inventory.ts test/db/inventory.test.ts
git commit -m "$(cat <<'EOF'
feat(db): SharedInventoryRow.bidMode — thread bid_mode through /exchange

The /exchange row component needs bid_mode to render the Place Bid
button. Project it from the query layer so the RSC has it for free.
Existing slice-15 visibility tests stay green — the new field is
additive.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Demo seed — `DEMO_INVENTORY_BIDS` + `getSeedInventoryBidModes`

**Files:**
- Modify: `src/lib/demo/seed.ts`
- Modify: `test/lib/demo/seed.test.ts`

- [ ] **Step 1: Append the demo-bid constant + bid-mode helper to `src/lib/demo/seed.ts`.**

Place immediately after `getSeedSharedInventoryForOrg` (the slice-15 helper):

```ts
// --- Slice 18 demo seed: inventory bids + per-item bid-mode ---

export interface SeedInventoryBid {
  inventoryItemId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  status: "pending";
  createdAtOffsetMinutes: number;
}

/** Two pending bids from AIYA on partner items. The bids never enter pglite
 *  (the Netlify demo is in-memory); they exist as fixture data the eventual
 *  /exchange demo-shim can render. The real query getInventoryBidsForItem
 *  returns [] in demo mode per slice-16 convention; rendering them is the
 *  component's responsibility (consume the constant directly). */
export const DEMO_INVENTORY_BIDS: SeedInventoryBid[] = [
  {
    inventoryItemId: 601, // Mehta Round 2.51ct (slice 15 seed)
    bidderOrgId: DEMO_AIYA_ORG_ID,
    bidderOrgLabel: "AIYA Designs",
    priceCents: 168_500_00,
    currency: "USD",
    notes: "Firm. 7-day inspection window.",
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
    status: "pending",
    createdAtOffsetMinutes: 12,
  },
];

/** Which seeded inventory items have bidding enabled, and in which mode.
 *  Item 601 has bidding ON in single mode so the demo /exchange row shows
 *  the Place Bid button. 602 + 603 stay null (bidding off) to demonstrate
 *  the opt-in-only default. */
export function getSeedInventoryBidModes(): Map<number, "single" | "history" | null> {
  return new Map<number, "single" | "history" | null>([
    [601, "single"],
    [602, null],
    [603, null],
  ]);
}
```

- [ ] **Step 2: Widen `SeedSharedInventoryRow` with `bidMode`.**

In the same file:

```ts
export interface SeedSharedInventoryRow {
  // … existing fields …
  bidMode: "single" | "history" | null; // slice 18
}
```

- [ ] **Step 3: Update `getSeedSharedInventoryRows` and `getSeedSharedInventoryForOrg`.**

`getSeedSharedInventoryRows`: add `bidMode: null` to each of the three returned rows (the per-row mode is determined at composition time via `getSeedInventoryBidModes`, but the base rows need the field for type-shape consistency).

`getSeedSharedInventoryForOrg`:

```ts
export function getSeedSharedInventoryForOrg(orgId: number): SeedSharedInventoryRow[] {
  const circleIds = new Set(getSeedCircleIdsForOrg(orgId));
  if (circleIds.size === 0) return [];
  const modes = getSeedInventoryBidModes();
  return getSeedSharedInventoryRows()
    .filter((r) => r.orgId !== orgId && circleIds.has(r.visibilityCircleId))
    .map((r) => ({ ...r, bidMode: modes.get(r.id) ?? null }));
}
```

- [ ] **Step 4: Extend `test/lib/demo/seed.test.ts`.**

Add:

```ts
import { DEMO_INVENTORY_BIDS, getSeedInventoryBidModes, getSeedSharedInventoryForOrg, DEMO_AIYA_ORG_ID } from "@/lib/demo/seed";

describe("slice 18 demo seed: DEMO_INVENTORY_BIDS", () => {
  it("exposes exactly 2 pending bids from AIYA on items 601 + 602", () => {
    expect(DEMO_INVENTORY_BIDS).toHaveLength(2);
    expect(DEMO_INVENTORY_BIDS.every((b) => b.bidderOrgId === DEMO_AIYA_ORG_ID)).toBe(true);
    expect(DEMO_INVENTORY_BIDS.map((b) => b.inventoryItemId).sort()).toEqual([601, 602]);
    expect(DEMO_INVENTORY_BIDS.every((b) => b.status === "pending")).toBe(true);
  });

  it("getSeedInventoryBidModes enables bidding only on item 601", () => {
    const modes = getSeedInventoryBidModes();
    expect(modes.get(601)).toBe("single");
    expect(modes.get(602)).toBeNull();
    expect(modes.get(603)).toBeNull();
  });

  it("getSeedSharedInventoryForOrg threads bidMode through to AIYA's view", () => {
    const rows = getSeedSharedInventoryForOrg(DEMO_AIYA_ORG_ID);
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.id, r.bidMode]));
    expect(byId.get(601)).toBe("single");
    expect(byId.get(602)).toBeNull();
    expect(byId.get(603)).toBeNull();
  });
});
```

- [ ] **Step 5: Run + commit.**

```bash
npx vitest run test/lib/demo/seed.test.ts --reporter=verbose 2>&1 | tail -15
git add src/lib/demo/seed.ts test/lib/demo/seed.test.ts
git commit -m "$(cat <<'EOF'
feat(demo): slice 18 inventory-bid seeds + bid_mode map

DEMO_INVENTORY_BIDS: 2 pending bids from AIYA on partner items 601
(Mehta Round) and 602 (Saint-Cloud Cushion). getSeedInventoryBidModes
turns bidding ON for item 601 only — the demo /exchange row shows the
Place Bid button while 602+603 stay null (bidding off) to demonstrate
the opt-in default.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: Phase A green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: pre-Phase-A baseline (827) + 7 new test cases (1 migration smoke + 6 visibility) + 3 new demo seed cases = 837. Zero failures.

- [ ] **Step 2: tsc.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

Phase A done.

---

## Phase B — Server actions + truth-table tests

### Task B1: Zod schemas in `src/lib/inventory/bidValidation.ts`

**Files:**
- Create: `src/lib/inventory/bidValidation.ts`
- Create: `test/lib/inventory/bidValidation.test.ts`

- [ ] **Step 1: Create `src/lib/inventory/bidValidation.ts`.**

```ts
import { z } from "zod";

export const postInventoryBidInput = z.object({
  inventoryItemId: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  currency: z.enum(["USD", "EUR", "INR", "JPY"]).default("USD"),
  notes: z.string().trim().max(500, "Notes too long").optional(),
});
export type PostInventoryBidInput = z.infer<typeof postInventoryBidInput>;

export const acceptInventoryBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type AcceptInventoryBidInput = z.infer<typeof acceptInventoryBidInput>;

export const rejectInventoryBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type RejectInventoryBidInput = z.infer<typeof rejectInventoryBidInput>;

export const withdrawInventoryBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type WithdrawInventoryBidInput = z.infer<typeof withdrawInventoryBidInput>;

export const setInventoryItemBidModeInput = z.object({
  inventoryItemId: z.number().int().positive(),
  mode: z.enum(["single", "history"]).nullable(),
});
export type SetInventoryItemBidModeInput = z.infer<typeof setInventoryItemBidModeInput>;
```

- [ ] **Step 2: Create `test/lib/inventory/bidValidation.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import {
  postInventoryBidInput,
  acceptInventoryBidInput,
  setInventoryItemBidModeInput,
} from "@/lib/inventory/bidValidation";

describe("postInventoryBidInput", () => {
  it("accepts valid input", () => {
    expect(postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: 100 }).success).toBe(true);
  });
  it("rejects zero or negative prices", () => {
    expect(postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: 0 }).success).toBe(false);
    expect(postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: -1 }).success).toBe(false);
  });
  it("rejects notes > 500 chars", () => {
    expect(
      postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: 1, notes: "x".repeat(501) }).success,
    ).toBe(false);
  });
  it("rejects unknown currency", () => {
    expect(
      postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: 1, currency: "AUD" }).success,
    ).toBe(false);
  });
  it("rejects zero inventoryItemId", () => {
    expect(postInventoryBidInput.safeParse({ inventoryItemId: 0, priceCents: 1 }).success).toBe(false);
  });
});

describe("acceptInventoryBidInput", () => {
  it("accepts positive bidId", () => {
    expect(acceptInventoryBidInput.safeParse({ bidId: 7 }).success).toBe(true);
  });
});

describe("setInventoryItemBidModeInput", () => {
  it("accepts null mode (disable bidding)", () => {
    expect(setInventoryItemBidModeInput.safeParse({ inventoryItemId: 1, mode: null }).success).toBe(true);
  });
  it("accepts 'single' and 'history'", () => {
    expect(setInventoryItemBidModeInput.safeParse({ inventoryItemId: 1, mode: "single" }).success).toBe(true);
    expect(setInventoryItemBidModeInput.safeParse({ inventoryItemId: 1, mode: "history" }).success).toBe(true);
  });
  it("rejects bogus mode strings", () => {
    expect(setInventoryItemBidModeInput.safeParse({ inventoryItemId: 1, mode: "off" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run + commit.**

```bash
npx vitest run test/lib/inventory/bidValidation.test.ts --reporter=verbose 2>&1 | tail -15
git add src/lib/inventory/bidValidation.ts test/lib/inventory/bidValidation.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): Zod schemas for slice-18 inventory-bidding actions

Wire fields strictly enforced — no orgId / bidderOrgId / ownerOrgId
columns accepted from the client. priceCents positive int (cents).
notes optional, ≤500 chars, trimmed. setInventoryItemBidMode.mode
accepts null (disable) or the two enum values.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: `postInventoryBid` + `canBidOnItem` helper + truth-table test

**Files:**
- Modify: `src/lib/inventory/actions.ts`
- Create: `test/lib/inventory/bid-authz.test.ts` (first describe — postInventoryBid only)

- [ ] **Step 1: Write the failing test at `test/lib/inventory/bid-authz.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems, inventoryBids, circles, circleMembers, orgs } from "@/db/schema";
import { postInventoryBid, __setTestDb } from "@/lib/inventory/actions";
import { requireSession } from "@/lib/auth/requireSession";

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

async function ensureOrg(orgId: number, name: string) {
  await db.insert(orgs).values({ id: orgId, name, slug: `${name}-${orgId}` }).onConflictDoNothing();
}

async function seedItem(ownerOrgId: number, opts: {
  visibilityCircleId?: number | null;
  bidMode?: "single" | "history" | null;
} = {}) {
  const [row] = await db
    .insert(inventoryItems)
    .values({
      orgId: ownerOrgId,
      category: "Diamonds",
      name: "x",
      quantity: 1,
      status: "in_stock",
      unitCostCents: 100,
      retailPriceCents: 200,
      visibilityCircleId: opts.visibilityCircleId ?? null,
      bidMode: opts.bidMode ?? null,
    })
    .returning();
  return row.id;
}

async function ensureCircleWithMembers(name: string, slug: string, ownerOrgId: number, members: number[]) {
  const [c] = await db.insert(circles).values({ name, slug, ownerOrgId }).returning();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId: c.id, orgId }).onConflictDoNothing();
  }
  return c.id;
}

describe("postInventoryBid — authz", () => {
  it("allows an in-circle partner to bid on a circle-shared item with bidding enabled", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pib1", 1, [1, 999]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: "single" });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 12_300_00 });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(inventoryBids);
    expect(rows).toHaveLength(1);
    expect(rows[0].bidderOrgId).toBe(999);
    expect(rows[0].priceCents).toBe(12_300_00);
    expect(rows[0].status).toBe("pending");
  });

  it("forbids the item owner from bidding on their own item (self-bid block)", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pib2", 1, [1, 999]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: "single" });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(inventoryBids)).toHaveLength(0);
  });

  it("forbids bidding when bid_mode is null (bidding disabled)", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pib3", 1, [1, 999]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: null });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(inventoryBids)).toHaveLength(0);
  });

  it("forbids bidding when item is private (no visibility_circle_id)", async () => {
    const itemId = await seedItem(1, { visibilityCircleId: null, bidMode: "single" });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(inventoryBids)).toHaveLength(0);
  });

  it("forbids bidding when the bidder is NOT in the item's circle", async () => {
    await ensureOrg(888, "stranger");
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pib4", 1, [1, 999]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: "single" });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 888 });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(inventoryBids)).toHaveLength(0);
  });

  it("forbids bidding on a non-existent item id (defense against id-guessing)", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await postInventoryBid({ inventoryItemId: 99999, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

```bash
npx vitest run test/lib/inventory/bid-authz.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 3: Add `canBidOnItem` + `postInventoryBid` to `src/lib/inventory/actions.ts`.**

Imports (add to the top of the file alongside existing imports):

```ts
import { inventoryBids } from "@/db/schema";
import { resolveOrgLabel } from "@/lib/auth/orgLabel";
import {
  postInventoryBidInput,
  acceptInventoryBidInput,
  rejectInventoryBidInput,
  withdrawInventoryBidInput,
  setInventoryItemBidModeInput,
  type PostInventoryBidInput,
  type AcceptInventoryBidInput,
  type RejectInventoryBidInput,
  type WithdrawInventoryBidInput,
  type SetInventoryItemBidModeInput,
} from "./bidValidation";
import { ne } from "drizzle-orm"; // for the auto-reject sibling sweep in B3
```

Append below `deleteInventoryItem`:

```ts
/** Slice-18 write-side gate: can the caller bid on this inventory item?
 *  Five preconditions, evaluated in order. ALL must pass:
 *    1. Item exists.
 *    2. Caller is NOT the item owner (self-bid block).
 *    3. Item's bid_mode is non-null (owner has enabled bidding).
 *    4. Item has a visibility_circle_id (private items are non-biddable
 *       except by owner — but owner is rejected at step 2; combination is
 *       Forbidden by construction).
 *    5. Caller is a member of the item's visibility circle.
 *
 *  ⚠ Mirrors getInventoryBidsForItem's bidder|owner SQL visibility, with
 *  the added "no self-bidding" + "bid_mode non-null" + "must be circle
 *  member" rules. If you change visibility in either place, change both. */
async function canBidOnItem(
  d: Db,
  orgId: number,
  inventoryItemId: number,
): Promise<
  | {
      ok: true;
      ownerOrgId: number;
      bidMode: "single" | "history";
      visibilityCircleId: number;
    }
  | { ok: false }
> {
  const [row] = await d
    .select({
      ownerOrgId: inventoryItems.orgId,
      bidMode: inventoryItems.bidMode,
      visibilityCircleId: inventoryItems.visibilityCircleId,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, inventoryItemId))
    .limit(1);
  if (!row) return { ok: false };
  if (row.ownerOrgId === orgId) return { ok: false };
  if (row.bidMode === null) return { ok: false };
  if (row.visibilityCircleId === null) return { ok: false };
  const isMember = await isOrgMemberOfCircle(d, orgId, row.visibilityCircleId);
  if (!isMember) return { ok: false };
  return {
    ok: true,
    ownerOrgId: row.ownerOrgId,
    bidMode: row.bidMode,
    visibilityCircleId: row.visibilityCircleId,
  };
}

export async function postInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(postInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    const access = await canBidOnItem(d, orgId, input.inventoryItemId);
    if (!access.ok) throw new ForbiddenError("Forbidden");
    const label = await resolveOrgLabel(d, orgId);
    await d.insert(inventoryBids).values({
      inventoryItemId: input.inventoryItemId,
      bidderOrgId: orgId,
      bidderOrgLabel: label,
      priceCents: input.priceCents,
      currency: input.currency,
      notes: input.notes ?? null,
    });
  });
}
```

`run` is the existing slice-15 wrapper — it already handles demo-mode + session-failure + `ForbiddenError → { ok: false, error: "Forbidden" }` mapping. No changes needed.

- [ ] **Step 4: Run — expect 6 passed.**

```bash
npx vitest run test/lib/inventory/bid-authz.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/inventory/actions.ts test/lib/inventory/bid-authz.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): postInventoryBid + canBidOnItem (slice 18)

canBidOnItem combines slice-15 visibility (isOrgMemberOfCircle) +
slice-16 self-bid block + slice-18 bid_mode-non-null gate. Five
preconditions all enforced before INSERT — every rejection cell is
zero-DB-write by construction. Truth-table covers self-bid, bidding
disabled, private item, out-of-circle, non-existent id.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: `acceptInventoryBid` + atomicity test

**Files:**
- Modify: `src/lib/inventory/actions.ts`
- Create: `test/lib/inventory/bid-accept-atomicity.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems, inventoryBids, circles, circleMembers, orgs } from "@/db/schema";
import { acceptInventoryBid, __setTestDb } from "@/lib/inventory/actions";
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

describe("acceptInventoryBid — atomicity", () => {
  it("accepts one bid, auto-rejects siblings, leaves inventory_items.status unchanged", async () => {
    // Seed item owned by org 1, bidding enabled
    const [item] = await db
      .insert(inventoryItems)
      .values({
        orgId: 1, category: "Diamonds", name: "x", quantity: 10,
        status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
        bidMode: "single",
      })
      .returning();
    // Three pending bids
    await db.insert(orgs).values([
      { id: 777, name: "Bidder777", slug: "bidder-777" },
    ]).onConflictDoNothing();
    const insertedBids = await db.insert(inventoryBids).values([
      { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "Bidder999", priceCents: 100 },
      { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "Bidder888", priceCents: 200 },
      { inventoryItemId: item.id, bidderOrgId: 777, bidderOrgLabel: "Bidder777", priceCents: 300 },
    ]).returning();

    // Accept the second bid as owner
    const res = await acceptInventoryBid({ bidId: insertedBids[1].id });
    expect(res).toEqual({ ok: true });

    const after = await db.select().from(inventoryBids).orderBy(inventoryBids.id);
    const byId = new Map(after.map((b) => [b.id, b]));
    expect(byId.get(insertedBids[0].id)?.status).toBe("auto_rejected");
    expect(byId.get(insertedBids[1].id)?.status).toBe("accepted");
    expect(byId.get(insertedBids[2].id)?.status).toBe("auto_rejected");
    expect(byId.get(insertedBids[0].id)?.decidedAt).not.toBeNull();
    expect(byId.get(insertedBids[1].id)?.decidedAt).not.toBeNull();
    expect(byId.get(insertedBids[2].id)?.decidedAt).not.toBeNull();

    // inventory_items.status UNCHANGED — slice 18 doesn't touch stock
    const [itemAfter] = await db
      .select({ status: inventoryItems.status, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(itemAfter.status).toBe("in_stock");
    expect(itemAfter.quantity).toBe(10);
  });

  it("non-owner cannot accept", async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({ orgId: 1, category: "Diamonds", name: "x", quantity: 1, status: "in_stock", unitCostCents: 100, retailPriceCents: 200, bidMode: "single" })
      .returning();
    const [bid] = await db.insert(inventoryBids).values({
      inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "B", priceCents: 1,
    }).returning();

    const { requireSession } = await import("@/lib/auth/requireSession");
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "x", orgId: 999 });

    const res = await acceptInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [after] = await db.select({ status: inventoryBids.status }).from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    expect(after.status).toBe("pending");
  });

  it("cannot accept a non-pending bid", async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({ orgId: 1, category: "Diamonds", name: "x", quantity: 1, status: "in_stock", unitCostCents: 100, retailPriceCents: 200, bidMode: "single" })
      .returning();
    const [bid] = await db.insert(inventoryBids).values({
      inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "B", priceCents: 1, status: "withdrawn", decidedAt: new Date(),
    }).returning();

    const res = await acceptInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Append `acceptInventoryBid` to `src/lib/inventory/actions.ts`.**

```ts
export async function acceptInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(acceptInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidId: inventoryBids.id,
        bidStatus: inventoryBids.status,
        inventoryItemId: inventoryBids.inventoryItemId,
        itemOwnerOrgId: inventoryItems.orgId,
      })
      .from(inventoryBids)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryBids.inventoryItemId))
      .where(eq(inventoryBids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError("Forbidden");
    if (row.itemOwnerOrgId !== orgId) throw new ForbiddenError("Forbidden");
    if (row.bidStatus !== "pending") throw new ForbiddenError("Forbidden");

    const now = new Date();
    await d.transaction(async (tx) => {
      await tx
        .update(inventoryBids)
        .set({ status: "accepted", decidedAt: now })
        .where(and(
          eq(inventoryBids.id, input.bidId),
          eq(inventoryBids.status, "pending"),
        ));
      await tx
        .update(inventoryBids)
        .set({ status: "auto_rejected", decidedAt: now })
        .where(and(
          eq(inventoryBids.inventoryItemId, row.inventoryItemId),
          eq(inventoryBids.status, "pending"),
          ne(inventoryBids.id, input.bidId),
        ));
      // NOTE: we do NOT touch inventory_items.status. Bidding is a price
      // negotiation; stock-deduction is a separate concern (slice 18b).
      // See spec §5.3.
    });
  });
}
```

- [ ] **Step 4: Run — expect 3 passed.**

```bash
npx vitest run test/lib/inventory/bid-accept-atomicity.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/inventory/actions.ts test/lib/inventory/bid-accept-atomicity.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): acceptInventoryBid — atomic accept + sibling auto-reject

Mirrors slice-16 acceptBid; the entire two-UPDATE flow runs inside
db.transaction. Critically does NOT mutate inventory_items.status —
slice 18 is a price-negotiation surface, not a stock-mutation
primitive (see spec §5.3). The regression test asserts the item
quantity + status are unchanged after accept.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: `rejectInventoryBid` + `withdrawInventoryBid` + tests

**Files:**
- Modify: `src/lib/inventory/actions.ts`
- Create: `test/lib/inventory/bid-withdraw.test.ts`

- [ ] **Step 1: Write the failing test for withdraw + reject.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems, inventoryBids } from "@/db/schema";
import { withdrawInventoryBid, rejectInventoryBid, __setTestDb } from "@/lib/inventory/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { vi.clearAllMocks(); await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

async function seed() {
  const [item] = await db.insert(inventoryItems).values({
    orgId: 1, category: "Diamonds", name: "x", quantity: 1, status: "in_stock",
    unitCostCents: 100, retailPriceCents: 200, bidMode: "single",
  }).returning();
  const [bid] = await db.insert(inventoryBids).values({
    inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "B", priceCents: 1,
  }).returning();
  return { item, bid };
}

describe("withdrawInventoryBid", () => {
  it("bidder can withdraw their own pending bid", async () => {
    const { bid } = await seed();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await withdrawInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: true });
    const [after] = await db.select().from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    expect(after.status).toBe("withdrawn");
    expect(after.decidedAt).not.toBeNull();
  });

  it("is idempotent (double-withdraw returns ok with no further changes)", async () => {
    const { bid } = await seed();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: "p", orgId: 999 });
    const first = await withdrawInventoryBid({ bidId: bid.id });
    expect(first).toEqual({ ok: true });
    const [snap1] = await db.select().from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    const second = await withdrawInventoryBid({ bidId: bid.id });
    expect(second).toEqual({ ok: true });
    const [snap2] = await db.select().from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    expect(snap2.status).toBe("withdrawn");
    expect(snap2.decidedAt?.getTime()).toBe(snap1.decidedAt?.getTime()); // unchanged on second call
  });

  it("forbids withdraw by non-bidder", async () => {
    const { bid } = await seed();
    const res = await withdrawInventoryBid({ bidId: bid.id }); // session orgId = 1 (owner, not bidder)
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids withdraw on accepted bid", async () => {
    const { bid } = await seed();
    await db.update(inventoryBids).set({ status: "accepted", decidedAt: new Date() }).where(eq(inventoryBids.id, bid.id));
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await withdrawInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});

describe("rejectInventoryBid", () => {
  it("owner can reject a pending bid", async () => {
    const { bid } = await seed();
    const res = await rejectInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: true });
    const [after] = await db.select().from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    expect(after.status).toBe("rejected");
    expect(after.decidedAt).not.toBeNull();
  });

  it("non-owner cannot reject", async () => {
    const { bid } = await seed();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 888 });
    const res = await rejectInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("cannot reject an already-decided bid", async () => {
    const { bid } = await seed();
    await db.update(inventoryBids).set({ status: "withdrawn", decidedAt: new Date() }).where(eq(inventoryBids.id, bid.id));
    const res = await rejectInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Append `rejectInventoryBid` + `withdrawInventoryBid` to `src/lib/inventory/actions.ts`.**

```ts
export async function rejectInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(rejectInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidStatus: inventoryBids.status,
        itemOwnerOrgId: inventoryItems.orgId,
      })
      .from(inventoryBids)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryBids.inventoryItemId))
      .where(eq(inventoryBids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError("Forbidden");
    if (row.itemOwnerOrgId !== orgId) throw new ForbiddenError("Forbidden");
    if (row.bidStatus !== "pending") throw new ForbiddenError("Forbidden");
    await d
      .update(inventoryBids)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(and(
        eq(inventoryBids.id, input.bidId),
        eq(inventoryBids.status, "pending"),
      ));
  });
}

export async function withdrawInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(withdrawInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidderOrgId: inventoryBids.bidderOrgId,
        status: inventoryBids.status,
      })
      .from(inventoryBids)
      .where(eq(inventoryBids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError("Forbidden");
    if (row.bidderOrgId !== orgId) throw new ForbiddenError("Forbidden");
    if (row.status === "withdrawn") return; // idempotent
    if (row.status !== "pending") throw new ForbiddenError("Forbidden");
    await d
      .update(inventoryBids)
      .set({ status: "withdrawn", decidedAt: new Date() })
      .where(and(
        eq(inventoryBids.id, input.bidId),
        eq(inventoryBids.bidderOrgId, orgId),
        eq(inventoryBids.status, "pending"),
      ));
  });
}
```

- [ ] **Step 4: Run — expect 7 passed in this file.**

- [ ] **Step 5: Commit.**

```bash
git add src/lib/inventory/actions.ts test/lib/inventory/bid-withdraw.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): rejectInventoryBid + withdrawInventoryBid (slice 18)

withdraw is idempotent (double-call on a withdrawn row returns ok),
mirroring slice-16's deleteDealMessage / withdrawBid pattern. Reject
is owner-only single UPDATE. Both include defense-in-depth WHERE
clauses (status='pending' + bidder/owner check) so a TOCTOU drift
results in zero updates rather than a wrong row mutation.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: `setInventoryItemBidMode` + bid-mode toggle test

**Files:**
- Modify: `src/lib/inventory/actions.ts`
- Create: `test/lib/inventory/bid-mode-toggle.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems, inventoryBids } from "@/db/schema";
import { setInventoryItemBidMode, __setTestDb } from "@/lib/inventory/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { vi.clearAllMocks(); await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

async function seedItem(ownerOrgId: number, bidMode: "single" | "history" | null = null) {
  const [row] = await db.insert(inventoryItems).values({
    orgId: ownerOrgId, category: "Diamonds", name: "x", quantity: 1, status: "in_stock",
    unitCostCents: 100, retailPriceCents: 200, bidMode,
  }).returning();
  return row.id;
}

describe("setInventoryItemBidMode", () => {
  it("owner can toggle null -> single -> history -> null", async () => {
    const itemId = await seedItem(1, null);
    expect((await setInventoryItemBidMode({ inventoryItemId: itemId, mode: "single" })).ok).toBe(true);
    expect((await db.select({ m: inventoryItems.bidMode }).from(inventoryItems).where(eq(inventoryItems.id, itemId)))[0].m).toBe("single");
    expect((await setInventoryItemBidMode({ inventoryItemId: itemId, mode: "history" })).ok).toBe(true);
    expect((await db.select({ m: inventoryItems.bidMode }).from(inventoryItems).where(eq(inventoryItems.id, itemId)))[0].m).toBe("history");
    expect((await setInventoryItemBidMode({ inventoryItemId: itemId, mode: null })).ok).toBe(true);
    expect((await db.select({ m: inventoryItems.bidMode }).from(inventoryItems).where(eq(inventoryItems.id, itemId)))[0].m).toBeNull();
  });

  it("non-owner toggle is a silent no-op (no mutation)", async () => {
    const itemId = await seedItem(1, "single");
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "x", orgId: 999 });
    const res = await setInventoryItemBidMode({ inventoryItemId: itemId, mode: null });
    expect(res).toEqual({ ok: true }); // slice-15 convention — silent no-op
    const [after] = await db.select({ m: inventoryItems.bidMode }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
    expect(after.m).toBe("single"); // unchanged
  });

  it("toggling bid_mode to null does NOT mutate existing bid rows", async () => {
    const itemId = await seedItem(1, "single");
    await db.insert(inventoryBids).values([
      { inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "B1", priceCents: 100 },
      { inventoryItemId: itemId, bidderOrgId: 888, bidderOrgLabel: "B2", priceCents: 200 },
    ]);
    await setInventoryItemBidMode({ inventoryItemId: itemId, mode: null });
    const bids = await db.select().from(inventoryBids);
    expect(bids).toHaveLength(2);
    expect(bids.every((b) => b.status === "pending")).toBe(true);
    expect(bids.every((b) => b.decidedAt === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Append `setInventoryItemBidMode` to `src/lib/inventory/actions.ts`.**

```ts
export async function setInventoryItemBidMode(raw: unknown): Promise<ActionResult> {
  return run(setInventoryItemBidModeInput, raw, async (input, orgId) => {
    // Defense-in-depth: slice-3 verbatim — UPDATE scoped to the session org.
    // If the row doesn't exist or belongs to another org, zero rows update
    // and the call returns { ok: true } silently — matches the slice-15
    // updateInventoryItem convention.
    await db()
      .update(inventoryItems)
      .set({ bidMode: input.mode, updatedAt: new Date() })
      .where(and(
        eq(inventoryItems.id, input.inventoryItemId),
        eq(inventoryItems.orgId, orgId),
      ));
  });
}
```

- [ ] **Step 4: Run — expect 3 passed.**

- [ ] **Step 5: Commit.**

```bash
git add src/lib/inventory/actions.ts test/lib/inventory/bid-mode-toggle.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): setInventoryItemBidMode — owner-only bidding toggle

Owner can flip null/single/history. Defense-in-depth WHERE clause
gates on the session org id (slice-3 verbatim). Non-owner attempts
are silent no-ops — slice-15 convention. CRITICALLY: toggling
bid_mode to null does NOT cascade-mutate existing inventory_bids;
pending bids stay pending and the owner can still accept/reject them.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B6: Phase B green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: pre-Phase-B baseline + 6 postInventoryBid + 3 acceptInventoryBid + 4 withdrawInventoryBid + 3 rejectInventoryBid + 3 setInventoryItemBidMode + a handful of bidValidation cases. Zero failures.

- [ ] **Step 2: tsc.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Phase B done.

---

## Phase C — UI

### Task C1: Place Bid button on `TradeNetInventoryList`

**Files:**
- Modify: `src/components/inventory/TradeNetInventoryList.tsx`
- Modify: `test/components/inventory/TradeNetInventoryList.test.tsx` (extend or create)

- [ ] **Step 1: Widen the props.**

```tsx
type Props = {
  items: SharedInventoryRow[]; // now includes bidMode
  circleNamesById: Map<number, string>;
  viewerOrgId: number;
  bidsByItemId: Map<number, InventoryBidView[]>; // pending counts come from here
  onPlaceBid: (item: SharedInventoryRow) => void; // opens the InventoryBidsTab drawer
};
```

`viewerOrgId` + `onPlaceBid` are new. The component remains stateless — drawer lifting is the page's job.

- [ ] **Step 2: Render the Place Bid button conditionally.**

Inside each row, after the existing badge, add:

```tsx
{it.bidMode !== null && it.orgId !== viewerOrgId && (
  <button
    type="button"
    onClick={() => onPlaceBid(it)}
    className="rounded border border-gold/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold/80 hover:bg-gold/10"
  >
    Place Bid
    {(() => {
      const pending = (bidsByItemId.get(it.id) ?? []).filter((b) => b.status === "pending").length;
      return pending > 0 ? ` · ${pending} pending` : "";
    })()}
  </button>
)}
```

- [ ] **Step 3: Write or extend `test/components/inventory/TradeNetInventoryList.test.tsx`.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeNetInventoryList } from "@/components/inventory/TradeNetInventoryList";

function makeItem(overrides: Partial<Parameters<typeof TradeNetInventoryList>[0]["items"][number]> = {}) {
  return {
    id: 1, orgId: 999, ownerOrgLabel: "Mehta", category: "Diamonds" as const,
    name: "x", quantity: 1, status: "in_stock" as const, visibilityCircleId: 201,
    bidMode: "single" as const, updatedAt: new Date(),
    ...overrides,
  };
}

describe("TradeNetInventoryList — Place Bid button visibility", () => {
  it("shows the button when bidMode !== null AND viewer !== owner", () => {
    render(<TradeNetInventoryList
      items={[makeItem()]}
      circleNamesById={new Map([[201, "Trusted"]])}
      viewerOrgId={1}
      bidsByItemId={new Map()}
      onPlaceBid={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: /Place Bid/i })).toBeInTheDocument();
  });

  it("hides the button when viewer === owner (self-bid UX guard)", () => {
    render(<TradeNetInventoryList
      items={[makeItem({ orgId: 1 })]}
      circleNamesById={new Map([[201, "Trusted"]])}
      viewerOrgId={1}
      bidsByItemId={new Map()}
      onPlaceBid={vi.fn()}
    />);
    expect(screen.queryByRole("button", { name: /Place Bid/i })).not.toBeInTheDocument();
  });

  it("hides the button when bidMode === null", () => {
    render(<TradeNetInventoryList
      items={[makeItem({ bidMode: null })]}
      circleNamesById={new Map([[201, "Trusted"]])}
      viewerOrgId={1}
      bidsByItemId={new Map()}
      onPlaceBid={vi.fn()}
    />);
    expect(screen.queryByRole("button", { name: /Place Bid/i })).not.toBeInTheDocument();
  });

  it("shows pending count when bidsByItemId has pending entries", () => {
    const bids = new Map([[1, [
      { id: 10, inventoryItemId: 1, bidderOrgId: 1, bidderOrgLabel: "AIYA", priceCents: 1, currency: "USD", notes: null, status: "pending" as const, decidedAt: null, createdAt: new Date() },
      { id: 11, inventoryItemId: 1, bidderOrgId: 1, bidderOrgLabel: "AIYA", priceCents: 1, currency: "USD", notes: null, status: "pending" as const, decidedAt: null, createdAt: new Date() },
    ]]]);
    render(<TradeNetInventoryList
      items={[makeItem()]}
      circleNamesById={new Map([[201, "Trusted"]])}
      viewerOrgId={1}
      bidsByItemId={bids}
      onPlaceBid={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: /Place Bid · 2 pending/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run + commit.**

```bash
npx vitest run test/components/inventory/TradeNetInventoryList.test.tsx --reporter=verbose 2>&1 | tail -15
git add src/components/inventory/TradeNetInventoryList.tsx test/components/inventory/TradeNetInventoryList.test.tsx
git commit -m "$(cat <<'EOF'
feat(exchange): Place Bid button per row + pending-bid count

Visible only when bidMode !== null AND viewer !== owner — both
conditions enforced at the UI as defense-in-depth on top of the
canBidOnItem server check. Pending count derived from bidsByItemId
the page pre-fetched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: `InventoryBidsTab` drawer + `PostInventoryBidForm`

**Files:**
- Create: `src/components/inventory/InventoryBidsTab.tsx`
- Create: `src/components/inventory/PostInventoryBidForm.tsx`
- Create: `test/components/inventory/InventoryBidsTab.test.tsx`

The drawer renders against props (server-fetched bids + actions). It is a "use client" component because of the controlled form + useTransition.

- [ ] **Step 1: Create `PostInventoryBidForm`.**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { PostInventoryBidInput } from "@/lib/inventory/bidValidation";
import type { ActionResult } from "@/lib/inventory/actions";

export function PostInventoryBidForm({
  inventoryItemId,
  postInventoryBid,
}: {
  inventoryItemId: number;
  postInventoryBid: (input: PostInventoryBidInput) => Promise<ActionResult>;
}) {
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<"USD" | "EUR" | "INR" | "JPY">("USD");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cents = (() => {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  })();

  function submit() {
    setError(null);
    start(async () => {
      const res = await postInventoryBid({
        inventoryItemId,
        priceCents: cents,
        currency,
        notes: notes.trim() ? notes.trim() : undefined,
      });
      if (res.ok) {
        setPrice("");
        setNotes("");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="space-y-2 border-t border-text/10 pt-3"
    >
      <div className="flex gap-2">
        <input
          aria-label="price"
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Price"
          className="flex-1 bg-bg p-1 text-sm"
        />
        <select
          aria-label="currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value as "USD" | "EUR" | "INR" | "JPY")}
          className="bg-bg p-1 text-sm"
        >
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="INR">INR</option>
          <option value="JPY">JPY</option>
        </select>
      </div>
      <textarea
        aria-label="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional, ≤500 chars)"
        maxLength={500}
        className="w-full bg-bg p-1 text-xs"
        rows={2}
      />
      <button
        type="submit"
        disabled={pending || cents === 0}
        className="rounded border border-gold/40 px-3 py-1 text-xs uppercase tracking-wider text-gold/80 disabled:opacity-40"
      >
        {pending ? "Submitting…" : "Place Bid"}
      </button>
      {error && <p className="text-xs text-bad">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Create `InventoryBidsTab`.**

```tsx
"use client";

import { useTransition } from "react";
import type { InventoryBidView } from "@/db/inventory";
import type {
  PostInventoryBidInput,
  AcceptInventoryBidInput,
  RejectInventoryBidInput,
  WithdrawInventoryBidInput,
} from "@/lib/inventory/bidValidation";
import type { ActionResult } from "@/lib/inventory/actions";
import { PostInventoryBidForm } from "./PostInventoryBidForm";
import { timeAgo } from "@/lib/company/format";

function fmt(cents: number, ccy: string) {
  return `${ccy} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

const STATUS_CLASS: Record<InventoryBidView["status"], string> = {
  pending: "bg-amber-500/20 text-amber-200",
  accepted: "bg-emerald-500/20 text-emerald-200",
  rejected: "bg-zinc-500/20 text-zinc-300",
  withdrawn: "bg-zinc-500/20 text-zinc-300",
  auto_rejected: "bg-zinc-500/20 text-zinc-300",
};

type Props = {
  inventoryItem: { id: number; name: string; ownerOrgId: number; bidMode: "single" | "history" | null };
  viewerOrgId: number;
  bids: InventoryBidView[];
  actions: {
    postInventoryBid: (input: PostInventoryBidInput) => Promise<ActionResult>;
    acceptInventoryBid: (input: AcceptInventoryBidInput) => Promise<ActionResult>;
    rejectInventoryBid: (input: RejectInventoryBidInput) => Promise<ActionResult>;
    withdrawInventoryBid: (input: WithdrawInventoryBidInput) => Promise<ActionResult>;
  };
  onClose: () => void;
};

export function InventoryBidsTab({ inventoryItem, viewerOrgId, bids, actions, onClose }: Props) {
  const [pending, start] = useTransition();
  const isOwner = viewerOrgId === inventoryItem.ownerOrgId;
  const myBids = bids.filter((b) => b.bidderOrgId === viewerOrgId);

  function on(act: () => Promise<ActionResult>) {
    start(async () => { await act(); });
  }

  return (
    <aside aria-label="bids" className="border border-text/10 bg-bg p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-gold/80">Bids · {inventoryItem.name}</h2>
        <button onClick={onClose} aria-label="close" className="text-xs text-text/40">Close</button>
      </header>

      {inventoryItem.bidMode === null && (
        <p className="text-xs text-text/50">Bidding is not enabled on this item.</p>
      )}

      {inventoryItem.bidMode !== null && bids.length === 0 && !isOwner && (
        <>
          <p className="text-xs text-text/50">No bids yet — submit one below.</p>
          <PostInventoryBidForm inventoryItemId={inventoryItem.id} postInventoryBid={actions.postInventoryBid} />
        </>
      )}

      {inventoryItem.bidMode !== null && (isOwner || bids.length > 0) && (
        <ul className="divide-y divide-text/10 text-sm">
          {(isOwner ? bids : myBids).map((b) => (
            <li key={b.id} className="flex items-center gap-2 py-2">
              <span className="flex-1 text-text/80">{isOwner ? b.bidderOrgLabel : "You"}</span>
              <span className="font-mono text-text/70">{fmt(b.priceCents, b.currency)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_CLASS[b.status]}`}>{b.status}</span>
              <span className="text-[10px] text-text/40">{timeAgo(b.createdAt)}</span>
              {isOwner && b.status === "pending" && (
                <>
                  <button onClick={() => on(() => actions.acceptInventoryBid({ bidId: b.id }))} disabled={pending} className="text-xs text-emerald-300">Accept</button>
                  <button onClick={() => on(() => actions.rejectInventoryBid({ bidId: b.id }))} disabled={pending} className="text-xs text-bad">Reject</button>
                </>
              )}
              {!isOwner && b.bidderOrgId === viewerOrgId && b.status === "pending" && (
                <button onClick={() => on(() => actions.withdrawInventoryBid({ bidId: b.id }))} disabled={pending} className="text-xs text-text/60">Withdraw</button>
              )}
              {b.notes && <p className="basis-full whitespace-pre-wrap pt-1 text-xs text-text/60">{b.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      {inventoryItem.bidMode !== null && !isOwner && (
        <PostInventoryBidForm inventoryItemId={inventoryItem.id} postInventoryBid={actions.postInventoryBid} />
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Write `test/components/inventory/InventoryBidsTab.test.tsx`.**

Cover the state matrix: bidding-disabled banner; empty bidder; single-mode owner view; history-mode owner view; accept/reject/withdraw button wiring; status badge per enum; XSS guard on `notes`. Mirrors the slice-16 `DealBidsTab.test.tsx` shape — see `test/components/deals/DealBidsTab.test.tsx` for the canonical structure.

```bash
ls test/components/deals/DealBidsTab.test.tsx
```

Use the slice-16 file as a structural template; substitute `inventory_bids` / `InventoryBidView` / `InventoryBidsTab` accordingly. Keep the same test names where possible so cross-slice grep is useful.

- [ ] **Step 4: Run + commit.**

```bash
npx vitest run test/components/inventory/InventoryBidsTab.test.tsx --reporter=verbose 2>&1 | tail -20
git add src/components/inventory/InventoryBidsTab.tsx src/components/inventory/PostInventoryBidForm.tsx test/components/inventory/InventoryBidsTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(inventory): InventoryBidsTab drawer + PostInventoryBidForm

Drawer is the slice-18 counterpart of slice-16 DealBidsTab. Three
render paths: bidding-disabled banner, bidder view (own bids +
form), owner view (all bids + accept/reject). Status badges use
the same amber/emerald/zinc palette as slice 16. XSS-safe — notes
render as text children, not innerHTML.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C3: `/exchange` RSC fetches `bidsByItemId` + opens the drawer

**Files:**
- Modify: `src/app/(admin)/exchange/page.tsx`
- Create or modify: a thin client-component wrapper (`/exchange` is RSC; the drawer is client-only; needs an island)

- [ ] **Step 1: Refactor `/exchange/page.tsx` to fetch bids per item.**

```tsx
import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getSharedInventoryForOrg, getInventoryBidsForItem, type InventoryBidView } from "@/db/inventory";
import { getCircleNamesForOrg } from "@/lib/circles/queries";
import { TradeNetInventoryListIsland } from "@/components/inventory/TradeNetInventoryListIsland";

export const dynamic = "force-dynamic";

export default async function ExchangePage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [items, circleNamesById] = await Promise.all([
    getSharedInventoryForOrg(db, orgId, null),
    getCircleNamesForOrg(db, orgId),
  ]);
  // Pre-fetch bids per biddable item (bid_mode !== null). Parallel — cheap.
  const biddable = items.filter((it) => it.bidMode !== null);
  const perItemBids = await Promise.all(
    biddable.map(async (it) => [it.id, await getInventoryBidsForItem(db, orgId, it.id)] as const),
  );
  const bidsByItemId = new Map<number, InventoryBidView[]>(perItemBids);
  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">TradeNet Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <TradeNetInventoryListIsland
        items={items}
        circleNamesById={circleNamesById}
        viewerOrgId={orgId}
        bidsByItemId={bidsByItemId}
      />
    </main>
  );
}
```

- [ ] **Step 2: Create the client island `TradeNetInventoryListIsland`.**

```tsx
// src/components/inventory/TradeNetInventoryListIsland.tsx
"use client";

import { useState } from "react";
import type { SharedInventoryRow, InventoryBidView } from "@/db/inventory";
import { TradeNetInventoryList } from "./TradeNetInventoryList";
import { InventoryBidsTab } from "./InventoryBidsTab";
import {
  postInventoryBid,
  acceptInventoryBid,
  rejectInventoryBid,
  withdrawInventoryBid,
} from "@/lib/inventory/actions";

export function TradeNetInventoryListIsland({
  items, circleNamesById, viewerOrgId, bidsByItemId,
}: {
  items: SharedInventoryRow[];
  circleNamesById: Map<number, string>;
  viewerOrgId: number;
  bidsByItemId: Map<number, InventoryBidView[]>;
}) {
  const [open, setOpen] = useState<SharedInventoryRow | null>(null);
  return (
    <>
      <TradeNetInventoryList
        items={items}
        circleNamesById={circleNamesById}
        viewerOrgId={viewerOrgId}
        bidsByItemId={bidsByItemId}
        onPlaceBid={(it) => setOpen(it)}
      />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4">
          <div className="w-full max-w-lg">
            <InventoryBidsTab
              inventoryItem={{ id: open.id, name: open.name, ownerOrgId: open.orgId, bidMode: open.bidMode }}
              viewerOrgId={viewerOrgId}
              bids={bidsByItemId.get(open.id) ?? []}
              actions={{
                postInventoryBid,
                acceptInventoryBid,
                rejectInventoryBid,
                withdrawInventoryBid,
              }}
              onClose={() => setOpen(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Typecheck + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/app/\(admin\)/exchange/page.tsx src/components/inventory/TradeNetInventoryListIsland.tsx
git commit -m "$(cat <<'EOF'
feat(exchange): wire InventoryBidsTab drawer via client island

/exchange RSC pre-fetches bidsByItemId for every biddable item
in parallel. The new TradeNetInventoryListIsland holds the open-
drawer state on the client side; clicking Place Bid swaps the
drawer in over the row list. Server actions are imported directly
in the island — Next.js threads the right action wiring.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C4: Bidding selector on `/inventory` admin

**Files:**
- Modify: `src/components/inventory/InventoryAdmin.tsx`
- Modify: `src/app/(admin)/inventory/page.tsx`
- Modify: `test/components/inventory/InventoryAdmin.test.tsx`

- [ ] **Step 1: Extend `InventoryAdmin` props.**

Add `setBidModeAction` to the action props passed to the component:

```tsx
type Props = {
  // … existing fields …
  setBidModeAction: (input: { inventoryItemId: number; mode: "single" | "history" | null }) => Promise<ActionResult>;
};
```

And widen the `InventoryRow` type to include `bidMode: "single" | "history" | null`.

- [ ] **Step 2: Render the per-row selector.**

Next to the existing "Share with circle" dropdown, add:

```tsx
<select
  aria-label={`bidding mode for ${it.name}`}
  className="bg-bg p-1 text-xs"
  value={it.bidMode ?? ""}
  onChange={(e) =>
    setBidModeAction({
      inventoryItemId: it.id,
      mode: e.target.value === "" ? null : (e.target.value as "single" | "history"),
    })
  }
>
  <option value="">Bidding off</option>
  <option value="single">Bidding: Single</option>
  <option value="history">Bidding: History</option>
</select>
{it.bidMode !== null && (
  <span className="rounded-full border border-text/20 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-text/60">
    Bidding · {it.bidMode}
  </span>
)}
```

- [ ] **Step 3: Update `/inventory/page.tsx` projection.**

In the inline `select(...)` for `inventoryItems`, add `bidMode: inventoryItems.bidMode`. Pass `setBidModeAction={setInventoryItemBidMode}` into `<InventoryAdmin … />`.

- [ ] **Step 4: Extend `test/components/inventory/InventoryAdmin.test.tsx`.**

Add tests asserting:
- The bidding selector renders with the right default per row's `bidMode`.
- Selecting Off / Single / History fires `setBidModeAction` with the matching mode (`null` / `"single"` / `"history"`).
- The "Bidding · single" badge renders when `bidMode === "single"`.

- [ ] **Step 5: Run + commit.**

```bash
npx vitest run test/components/inventory/InventoryAdmin.test.tsx --reporter=verbose 2>&1 | tail -15
git add src/components/inventory/InventoryAdmin.tsx src/app/\(admin\)/inventory/page.tsx test/components/inventory/InventoryAdmin.test.tsx
git commit -m "$(cat <<'EOF'
feat(inventory): per-row Bidding selector + status badge on /inventory

Selector binds to inventory_items.bid_mode; on change fires
setInventoryItemBidMode. "Off" (null) / "Single" / "History" —
mirrors the slice-15 "Share with circle" dropdown idiom on the
same row. Adjacent "Bidding · {mode}" badge for the on state,
silver pill to distinguish from slice-15's gold "Shared via"
badge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C5: Phase C green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: Phase A + Phase B baseline + ~10 new UI tests (4 list visibility + drawer matrix + admin selector). Zero failures.

- [ ] **Step 2: Build.**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build with no TS errors and no missing-module errors. The Next.js build also smoke-tests the `/exchange` RSC route.

- [ ] **Step 3: tsc.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Phase C done.

---

## Phase D — Verify + ship

### Task D1: Whole-slice verification

- [ ] **Step 1: Full test suite + count delta.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: pre-slice baseline (827) + Phase A (10) + Phase B (~19) + Phase C (~10) ≈ **866 tests passing**. Slight variance is acceptable; zero failures is mandatory.

- [ ] **Step 2: Lint.**

```bash
npm run lint 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: PR-review checklist greps (spec §11.10).**

```bash
# (a) No orgId fields on the wire schemas
grep -rn "orgId\|bidderOrgId\|ownerOrgId" src/lib/inventory/bidValidation.ts || echo "PASS: no orgId on wire"

# (b) No raw inventoryBids queries outside the inventory subsystem
grep -rn "from(inventoryBids)" src/ | grep -v "src/db/inventory.ts" | grep -v "src/lib/inventory/actions.ts" || echo "PASS: inventoryBids access confined"

# (c) acceptInventoryBid uses db.transaction
grep -n -A 30 "export async function acceptInventoryBid" src/lib/inventory/actions.ts | grep -q "transaction" && echo "PASS: acceptInventoryBid uses transaction"

# (d) inventory_items.bid_mode is nullable in the migration
grep -n "bid_mode" drizzle/0012_*.sql
# Expected: line says `ADD COLUMN "bid_mode" text` — NO `NOT NULL`, NO `DEFAULT`.
```

Each grep returns the expected PASS marker or empty match. Mismatches block ship.

- [ ] **Step 4: Defense-in-depth grep — slice-3 invariant preserved.**

```bash
grep -n "WHERE.*orgId\|eq(inventoryItems.orgId, orgId)" src/lib/inventory/actions.ts | head -20
```

Expected: every UPDATE on `inventory_items` (including `setInventoryItemBidMode`) includes the `eq(inventoryItems.orgId, orgId)` clause. Visual grep confirmation.

- [ ] **Step 5: Slice-15 + slice-16 regression check.**

```bash
npm test -- --run test/db/inventory.test.ts test/db/bids.test.ts test/lib/deals/ test/lib/inventory/ 2>&1 | tail -10
```

Expected: zero failures. Slice-15 visibility tests and slice-16 deal-bid tests stay green.

---

### Task D2: Land + final commit

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin feature/slice-18-inventory-bidding
```

- [ ] **Step 2: Open PR via `gh`.**

```bash
gh pr create --title "feat(inventory): slice 18 — Inventory Bidding" --body "$(cat <<'EOF'
## Summary

- New `inventory_bids` table (5-state lifecycle) + nullable `inventory_items.bid_mode` (null = bidding off, opt-in only).
- 5 server actions: `postInventoryBid` / `acceptInventoryBid` / `rejectInventoryBid` / `withdrawInventoryBid` / `setInventoryItemBidMode`. All `runWithUser`-wrapped.
- One new query helper: `getInventoryBidsForItem` (SQL-enforced bidder OR item-owner visibility; decoupled from circle membership).
- `acceptInventoryBid` wraps the accept + sibling auto-reject in a single `db.transaction`. Does NOT mutate `inventory_items.status` — see spec §5.3.
- UI: Place Bid button on `/exchange` rows + new `InventoryBidsTab` drawer + per-row Bidding selector on `/inventory` admin.
- Demo seed: 2 pending bids from AIYA on items 601 + 602; item 601's `bid_mode = "single"` so the demo `/exchange` row shows the Place Bid button.
- Migration `drizzle/NNNN_*.sql` — additive only; existing rows get `bid_mode = NULL`.

Spec: `docs/superpowers/specs/2026-06-07-aiya-inventory-bidding-slice-18-design.md`
Plan: `docs/superpowers/plans/2026-06-07-aiya-inventory-bidding-slice-18.md`

## Test plan

- [ ] `npm test` — pre-slice baseline (827) + ~39 new tests
- [ ] `npm run build` — clean
- [ ] `npm run lint` — clean
- [ ] Manually: log in as AIYA in demo mode → /exchange → click Place Bid on Mehta Round 2.51ct → submit → see demo-disabled error
- [ ] Manually: as item owner, toggle Bidding selector on /inventory → verify SQL persists across page reloads

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI; address review.**

After merge, run the worktree teardown:

```bash
cd /
git -C "/Users/claytonhillyard/Downloads/dashboard project /root" worktree remove .worktrees/slice-18-inventory-bidding
```

---

## Out-of-scope reminders (do not implement this slice)

- "Today's Inventory Bids" right-rail panel → slice 18c
- Stock-deduction on accept (mutate `inventory_items.status`) → slice 18b
- Counter-offer linkage → future
- Bid expiration cron → future
- Email/push notifications on bid arrival → slice 20 (Resend)
- Per-circle bid visibility (circle members see each others' bids) → explicitly rejected; same posture as slice 16

If a subagent finds themselves writing any of the above, stop and re-read the spec §13.
