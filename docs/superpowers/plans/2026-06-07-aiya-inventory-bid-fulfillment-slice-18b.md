# AIYA Slice 18b — Inventory Bid Fulfillment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the stock loop slice 18 §13 named as out of scope. Add `inventory_bids.quantity_requested` (INTEGER NOT NULL DEFAULT 1); extend `canBidOnItem` with a 6th precondition (`quantityRequested <= item.quantity` at post time); extend `acceptInventoryBid`'s existing locked-transaction body to decrement `inventory_items.quantity`, flip status to `'sold'` when quantity hits 0, and SELECTIVELY auto-reject ONLY the sibling pending bids that no longer fit. UI: PostInventoryBidForm gains a quantity input + available-stock hint; InventoryBidsTab shows `× N` per row + sold-out copy; TradeNetInventoryList shows a "Sold" badge that suppresses Place Bid.

**Architecture:** Slice 18b extends slice 18's `acceptInventoryBid` body — the `SELECT id FROM inventory_items WHERE id = $itemId FOR UPDATE` parent-row lock that landed in commit `293f3fd` is the load-bearing primitive. Every new UPDATE (stock decrement, selective sibling sweep) runs INSIDE that same locked region. The in-tx re-read SELECT — which slice 18 used only to verify the bid status — is extended to also read `inventory_items.quantity` so the over-subscribed-accept check has fresh, locked data. Postgres transaction semantics: if the over-subscribed branch throws Forbidden, the entire tx rolls back; the bid stays `pending`. No partial-apply of stock mutation.

**Tech Stack:** Drizzle ORM (pglite dev/test, Neon HTTP prod) · Next.js 15 App Router · React 19 Server Components + Server Actions · Zod · vitest (jsdom + node) · Testing Library · Tailwind (existing tokens).

**Branch:** `feature/slice-18b-inventory-bid-fulfillment` worktree at `.worktrees/slice-18b-inventory-bid-fulfillment`. See `docs/worktrees.md` for the convention. Implementer subagents work *only* in the worktree path — never in `/root`.

**Spec:** `docs/superpowers/specs/2026-06-07-aiya-inventory-bid-fulfillment-slice-18b-design.md`. Read it in full before starting.

---

## File Structure

**New files:**
- `drizzle/0014_*.sql` — generated migration (single ALTER TABLE)
- `test/components/inventory/PostInventoryBidForm.test.tsx` — dedicated quantity-input form test

**Modified files:**
- `src/db/schema.ts` — add `quantityRequested` to `inventoryBids`
- `src/db/inventoryBids.ts` — widen `InventoryBidView` + SELECT + mapper
- `src/lib/inventory/bidValidation.ts` — add `quantityRequested` to `postInventoryBidInput`
- `src/lib/inventory/actions.ts` — `canBidOnItem` 6th precondition; `postInventoryBid` passes quantity; `acceptInventoryBid` extends locked-tx body
- `src/components/inventory/PostInventoryBidForm.tsx` — quantity input, available-stock hint, over-stock guard
- `src/components/inventory/InventoryBidsTab.tsx` — `× N` per row, sold-out copy, thread availableQuantity to form
- `src/components/inventory/TradeNetInventoryList.tsx` — Sold badge + Place Bid suppression
- `src/app/(admin)/exchange/page.tsx` — thread item.quantity + item.status into drawer props
- `src/lib/demo/seed.ts` — backfill existing bids w/ quantityRequested=1; add 5-unit bid on item 603; flip item 603 bidMode to "history"
- `test/lib/inventory/bid-accept-atomicity.test.ts` — REVISE slice-18 baseline + concurrent-race; ADD partial-fill + sold-on-zero + over-subscribed tests
- `test/lib/inventory/bid-authz.test.ts` — ADD over-stock-bid cell
- `test/lib/inventory/bidValidation.test.ts` — ADD quantity Zod cells
- `test/db/inventory-bids.test.ts` — ADD quantity projection assertion
- `test/db/inventory-bids-migration-smoke.test.ts` — ADD column shape
- `test/components/inventory/InventoryBidsTab.test.tsx` — extend per spec §9.5
- `test/components/inventory/TradeNetInventoryList.test.tsx` — extend (Sold badge)
- `test/lib/demo/seed.test.ts` — extend (3-bid fixture, item 603 mode flip)

---

## Pre-flight

- [ ] **Pre-flight Step 1: Sync main + verify clean working tree**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git fetch origin --quiet
git pull --ff-only origin main
git status -sb
git log --oneline -3
```

Expected: `## main...origin/main`. Last commit on main is `60675a4 Merge slice 18: Inventory Bidding (cross-circle bid mechanic + parent-row lock race fix)` (or its descendant if slice 18c has merged something). No `M`/`A` lines — only the long-standing untracked personal files (`.md2pdf.py`, `FEMALE_AI_BOT.md`, `FEMALE_AI_BOT.pdf`, `training protocol/`) are acceptable.

- [ ] **Pre-flight Step 2: Cut the slice-18b worktree (per `docs/worktrees.md`)**

```bash
git worktree add .worktrees/slice-18b-inventory-bid-fulfillment -b feature/slice-18b-inventory-bid-fulfillment
cd .worktrees/slice-18b-inventory-bid-fulfillment
ln -sf ../../.env .env
ln -sf ../../node_modules node_modules
git branch --show-current
```

Expected: `feature/slice-18b-inventory-bid-fulfillment`. Symlinks present.

**All remaining steps run from `.worktrees/slice-18b-inventory-bid-fulfillment`, NOT from `/root`.** This is the failure mode `docs/worktrees.md` exists to prevent.

- [ ] **Pre-flight Step 3: Determine the next migration number**

```bash
ls -1 drizzle/ | grep -E '^[0-9]{4}_' | sort | tail -3
```

Expected: last on main is `0013_inventory_bidding.sql` (slice 18). The slice-18b migration will be `0014_*`. If slice 18c has merged a `0014_*`, slice 18b takes `0015_*` — adjust references accordingly. Call this `NNNN` for the rest of the plan.

- [ ] **Pre-flight Step 4: Confirm baseline test suite is green**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: zero failures. The baseline as of the spec date is slice-18's exit count plus any slice 18c additions if it landed first. If anything is failing on `main` before slice-18b edits, stop and fix that first.

- [ ] **Pre-flight Step 5: Confirm slice-18 primitives are present + the parent-row lock is intact**

```bash
grep -n "SELECT id FROM inventory_items WHERE id" src/lib/inventory/actions.ts
grep -n "canBidOnItem\|FOR UPDATE" src/lib/inventory/actions.ts
grep -n "inventoryBids\|quantityRequested" src/db/schema.ts src/db/inventoryBids.ts
```

Expected:
- `actions.ts` has exactly one `FOR UPDATE` line inside `acceptInventoryBid`.
- `canBidOnItem` is defined and accepts `(d, orgId, inventoryItemId)` — the new 4th arg is what this slice adds.
- `inventoryBids` table is defined in `schema.ts`; `quantityRequested` does NOT yet appear anywhere — Task A1 introduces it.

If any of those fail, the slice-18 base is incomplete and slice-18b cannot start.

- [ ] **Pre-flight Step 6: Re-read the spec**

```bash
wc -l docs/superpowers/specs/2026-06-07-aiya-inventory-bid-fulfillment-slice-18b-design.md
```

Read the spec in full before any task. The §4.4 Postgres-rollback subtlety in particular: the over-subscribed branch throws Forbidden and the bid STAYS pending — there is NO auto-reject side-effect on the failed path. The plan's Task B3 must verify this exact behavior.

---

## Phase A — Schema + canBidOnItem 6th precondition + demo seed

### Task A1: Add `quantityRequested` column to `inventoryBids` schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Locate the `inventoryBids` definition.**

`src/db/schema.ts:398` — slice 18 added this table. Slice 18b adds `quantityRequested` immediately after `notes` and before `status`.

- [ ] **Step 2: Add the `quantityRequested` column.**

Inside the `inventoryBids` `pgTable(...)` columns object, immediately after `notes: text("notes")`:

```ts
    // Slice 18b: quantity of units this bid is requesting. INTEGER NOT NULL
    // DEFAULT 1. The default preserves existing slice-18-seeded rows without
    // a data-fixup migration — they semantically interpret as "1 unit" which
    // matches the slice-18 mental model (every bid was implicitly singular).
    quantityRequested: integer("quantity_requested").notNull().default(1),
```

- [ ] **Step 3: Verify typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors (the column addition is referenced nowhere yet).

- [ ] **Step 4: Commit.**

```bash
git add src/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(schema): add inventory_bids.quantity_requested for slice 18b

Adds a quantity-aware field to inventory_bids. INTEGER NOT NULL
DEFAULT 1 — the default backfills existing slice-18 rows with the
semantically-correct "1 unit" interpretation. No CHECK constraint;
the action layer enforces quantity_requested <= item.quantity at
post time and again inside the locked accept transaction.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration + smoke test

**Files:**
- Create: `drizzle/NNNN_*.sql`
- Modify: `test/db/inventory-bids-migration-smoke.test.ts`

- [ ] **Step 1: Generate the migration.**

```bash
npm run db:generate 2>&1 | tail -10
ls -1 drizzle/ | grep -E '^[0-9]{4}_' | sort | tail -2
```

Expected: a new `0014_<adjective>_<character>.sql` (or `0015_*` if slice 18c took 0014). The generated file should contain a single ALTER:

```sql
ALTER TABLE "inventory_bids" ADD COLUMN "quantity_requested" integer DEFAULT 1 NOT NULL;
```

Critically: the column MUST have BOTH `NOT NULL` and `DEFAULT 1`. If drizzle-kit emits only `NOT NULL` without the default, the migration will fail on tables with existing rows (slice-18-seeded `inventory_bids` rows are present in dev DBs).

- [ ] **Step 2: Add the schema-only header to the migration.**

Edit the generated file. Prepend (with `--` SQL comments):

```sql
-- schema-only; no seed data in this migration.
-- inventory_bids.quantity_requested defaults to 1 — backfills slice-18
-- rows with the semantically-correct "1 unit" interpretation. Demo seeds
-- live in src/lib/demo/seed.ts and never touch the DB.
-- See docs/superpowers/plans/2026-06-07-aiya-inventory-bid-fulfillment-slice-18b.md.
```

- [ ] **Step 3: Extend the migration smoke test.**

Find the slice-18 assertions in `test/db/inventory-bids-migration-smoke.test.ts` (the file already exists). Add an `it()` block asserting:
- `inventory_bids.quantity_requested` column exists.
- Type is `integer`.
- `is_nullable === 'NO'`.
- Default is `1` (the catalog representation may be `'1'` or `1` depending on pglite — accept either; or query for the integer cast).

Use the same `pg_attribute` / `information_schema.columns` query pattern the slice-18 test already uses.

- [ ] **Step 4: Apply the migration to the test DB + run the smoke.**

```bash
npx vitest run test/db/inventory-bids-migration-smoke.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all slice-18 assertions stay green; the new quantity_requested assertion passes.

- [ ] **Step 5: Commit.**

```bash
git add drizzle/0014_*.sql test/db/inventory-bids-migration-smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(db): generate slice-18b migration — inventory_bids.quantity_requested

Single ALTER. NOT NULL with DEFAULT 1 — backfills slice-18-vintage
rows with the semantically-correct "1 unit" interpretation. Schema
smoke extended to assert column shape + nullability + default.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Widen `InventoryBidView` + extend the query layer

**Files:**
- Modify: `src/db/inventoryBids.ts`
- Modify: `test/db/inventory-bids.test.ts`

- [ ] **Step 1: Add `quantityRequested` to the `InventoryBidView` type.**

Edit `src/db/inventoryBids.ts` (currently 91 lines). The exported type:

```ts
export type InventoryBidView = {
  id: number;
  inventoryItemId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  quantityRequested: number;   // ← NEW (slice 18b)
  status: InventoryBidStatus;
  decidedAt: Date | null;
  createdAt: Date;
};
```

- [ ] **Step 2: Add the column to the SELECT projection.**

In `getInventoryBidsForItem`, extend the SQL projection list + the row mapper:

```ts
const res = await db.execute(sql`
  SELECT ib.id, ib.inventory_item_id, ib.bidder_org_id, ib.bidder_org_label,
         ib.price_cents, ib.currency, ib.notes,
         ib.quantity_requested,                                  -- ← NEW
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
  quantity_requested: number;       // ← NEW
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
  quantityRequested: r.quantity_requested,   // ← NEW
  status: r.status,
  decidedAt: …,
  createdAt: …,
}));
```

- [ ] **Step 3: Add a projection-presence test to `test/db/inventory-bids.test.ts`.**

Extend (don't replace) the slice-18 truth-table test file. Add:

```ts
it("projects quantityRequested for each visible bid", async () => {
  const [item] = await db.insert(inventoryItems).values({
    orgId: 1, category: "Diamonds", name: "x", quantity: 10,
    status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
    bidMode: "history",
  }).returning();
  await db.insert(inventoryBids).values({
    inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "X",
    priceCents: 100, quantityRequested: 7,
  });

  const rows = await getInventoryBidsForItem(db, 1, item.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].quantityRequested).toBe(7);
});

it("defaults quantityRequested to 1 when omitted on insert", async () => {
  const [item] = await db.insert(inventoryItems).values({
    orgId: 1, category: "Diamonds", name: "y", quantity: 10,
    status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
    bidMode: "history",
  }).returning();
  await db.insert(inventoryBids).values({
    inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "X",
    priceCents: 100,
    // quantityRequested omitted — DB DEFAULT 1 should apply
  });

  const rows = await getInventoryBidsForItem(db, 1, item.id);
  expect(rows[0].quantityRequested).toBe(1);
});
```

- [ ] **Step 4: Run.**

```bash
npx vitest run test/db/inventory-bids.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all slice-18 truth-table cells stay green + both new cases pass.

- [ ] **Step 5: Commit.**

```bash
git add src/db/inventoryBids.ts test/db/inventory-bids.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): project quantityRequested through getInventoryBidsForItem

Widens InventoryBidView with the new column. SQL projection +
row mapper updated. Two new test cases: (a) explicit value
flows through; (b) DEFAULT 1 applies when the field is omitted
on insert (backward compat for slice-18 callers).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Extend `canBidOnItem` with 6th precondition + Zod schema

**Files:**
- Modify: `src/lib/inventory/bidValidation.ts`
- Modify: `src/lib/inventory/actions.ts`
- Modify: `test/lib/inventory/bidValidation.test.ts`
- Modify: `test/lib/inventory/bid-authz.test.ts`

- [ ] **Step 1: Extend the Zod schema.**

Edit `src/lib/inventory/bidValidation.ts`:

```ts
export const postInventoryBidInput = z.object({
  inventoryItemId: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  currency: z.enum(["USD", "EUR", "INR", "JPY"]).default("USD"),
  notes: z.string().trim().max(500, "Notes too long").optional(),
  quantityRequested: z.number().int().positive().default(1),   // ← NEW
});
```

The `default(1)` makes the field optional from the wire — slice-18 callers (which don't pass it) still validate. Slice-18b's form will always pass a value; the default is back-compat + safety net.

- [ ] **Step 2: Add Zod truth-table cells.**

Edit `test/lib/inventory/bidValidation.test.ts`. ADD:

```ts
it("postInventoryBid defaults quantityRequested to 1 when omitted", () => {
  const parsed = postInventoryBidInput.parse({
    inventoryItemId: 1, priceCents: 100,
  });
  expect(parsed.quantityRequested).toBe(1);
});
it("postInventoryBid rejects quantityRequested = 0", () => {
  const parsed = postInventoryBidInput.safeParse({
    inventoryItemId: 1, priceCents: 100, quantityRequested: 0,
  });
  expect(parsed.success).toBe(false);
});
it("postInventoryBid rejects negative quantityRequested", () => {
  const parsed = postInventoryBidInput.safeParse({
    inventoryItemId: 1, priceCents: 100, quantityRequested: -5,
  });
  expect(parsed.success).toBe(false);
});
it("postInventoryBid rejects fractional quantityRequested", () => {
  const parsed = postInventoryBidInput.safeParse({
    inventoryItemId: 1, priceCents: 100, quantityRequested: 1.5,
  });
  expect(parsed.success).toBe(false);
});
it("postInventoryBid accepts large quantityRequested (no Zod cap)", () => {
  const parsed = postInventoryBidInput.parse({
    inventoryItemId: 1, priceCents: 100, quantityRequested: 1_000_000,
  });
  expect(parsed.quantityRequested).toBe(1_000_000);
});
```

- [ ] **Step 3: Run — expect new cells to pass + slice-18 cells to stay green.**

```bash
npx vitest run test/lib/inventory/bidValidation.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 4: Extend `canBidOnItem` with the 6th precondition.**

Edit `src/lib/inventory/actions.ts:161-195`. Modify the signature + body:

```ts
async function canBidOnItem(
  d: Db,
  orgId: number,
  inventoryItemId: number,
  quantityRequested: number,   // ← NEW arg
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
      quantity: inventoryItems.quantity,   // ← NEW projection
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
  if (quantityRequested > row.quantity) return { ok: false };  // ← NEW (6th)
  return {
    ok: true,
    ownerOrgId: row.ownerOrgId,
    bidMode: row.bidMode,
    visibilityCircleId: row.visibilityCircleId,
  };
}
```

The 6th check sits AFTER membership — order matters for the no-info-leak property (see spec §3.1).

- [ ] **Step 5: Update `postInventoryBid` to pass quantity through.**

In the same file, find `postInventoryBid` (slice-18 line ~197). Update both the `canBidOnItem` call AND the insert values:

```ts
export async function postInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(postInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    const access = await canBidOnItem(
      d, orgId, input.inventoryItemId, input.quantityRequested,  // ← NEW arg
    );
    if (!access.ok) throw new ForbiddenError("Forbidden");
    const label = await resolveOrgLabel(d, orgId);
    await d.insert(inventoryBids).values({
      inventoryItemId: input.inventoryItemId,
      bidderOrgId: orgId,
      bidderOrgLabel: label,
      priceCents: input.priceCents,
      currency: input.currency,
      notes: input.notes ?? null,
      quantityRequested: input.quantityRequested,   // ← NEW
    });
  });
}
```

- [ ] **Step 6: Extend the authz truth-table test.**

Edit `test/lib/inventory/bid-authz.test.ts`. ADD:

```ts
it("rejects postInventoryBid when quantityRequested > item.quantity", async () => {
  // Item has 3 units; bidder asks for 5.
  await db.insert(circles).values({ id: 5001, name: "C", slug: "c5001", ownerOrgId: 1 }).onConflictDoNothing();
  await db.insert(circleMembers).values([
    { circleId: 5001, orgId: 1 }, { circleId: 5001, orgId: 999 },
  ]).onConflictDoNothing();
  const [item] = await db.insert(inventoryItems).values({
    orgId: 1, category: "Diamonds", name: "small-parcel", quantity: 3,
    status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
    bidMode: "history", visibilityCircleId: 5001,
  }).returning();

  const { requireSession } = await import("@/lib/auth/requireSession");
  (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "x", orgId: 999 });

  const res = await postInventoryBid({
    inventoryItemId: item.id, priceCents: 100, quantityRequested: 5,
  });
  expect(res).toEqual({ ok: false, error: "Forbidden" });

  // Zero rows inserted
  const after = await db.select().from(inventoryBids).where(eq(inventoryBids.inventoryItemId, item.id));
  expect(after).toHaveLength(0);
});

it("accepts postInventoryBid when quantityRequested === item.quantity (boundary)", async () => {
  await db.insert(circles).values({ id: 5002, name: "C", slug: "c5002", ownerOrgId: 1 }).onConflictDoNothing();
  await db.insert(circleMembers).values([
    { circleId: 5002, orgId: 1 }, { circleId: 5002, orgId: 999 },
  ]).onConflictDoNothing();
  const [item] = await db.insert(inventoryItems).values({
    orgId: 1, category: "Diamonds", name: "exact-match", quantity: 7,
    status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
    bidMode: "history", visibilityCircleId: 5002,
  }).returning();

  const { requireSession } = await import("@/lib/auth/requireSession");
  (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "x", orgId: 999 });

  const res = await postInventoryBid({
    inventoryItemId: item.id, priceCents: 100, quantityRequested: 7,
  });
  expect(res).toEqual({ ok: true });
});
```

- [ ] **Step 7: Run.**

```bash
npx vitest run test/lib/inventory/bidValidation.test.ts test/lib/inventory/bid-authz.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: slice-18 cells stay green; the 6 new Zod + 2 new authz cells pass.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/inventory/bidValidation.ts src/lib/inventory/actions.ts test/lib/inventory/bidValidation.test.ts test/lib/inventory/bid-authz.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): canBidOnItem 6th precondition — quantity <= stock

Adds quantityRequested to the postInventoryBid Zod schema (default 1
for back-compat with slice-18 callers). Extends canBidOnItem with a
6th gate: quantityRequested <= item.quantity at post time. UX guard
only — the accept-side check inside the locked tx is the source of
truth (handled in Task B3). Authz truth table extended with over-
stock + equal-to-stock (boundary) cells.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Demo seed — annotate + add partial-fill scenario

**Files:**
- Modify: `src/lib/demo/seed.ts`
- Modify: `test/lib/demo/seed.test.ts`

- [ ] **Step 1: Widen `SeedInventoryBid` interface.**

Edit `src/lib/demo/seed.ts:539-548`. Add `quantityRequested: number`:

```ts
export interface SeedInventoryBid {
  inventoryItemId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  quantityRequested: number;   // ← NEW (slice 18b)
  status: "pending";
  createdAtOffsetMinutes: number;
}
```

- [ ] **Step 2: Backfill existing entries with `quantityRequested: 1`.**

Edit the two existing `DEMO_INVENTORY_BIDS` entries (lines ~556-575). Add `quantityRequested: 1` to each.

- [ ] **Step 3: Add the 3rd entry — partial-fill demo bid on item 603.**

Append after the existing two entries:

```ts
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
```

- [ ] **Step 4: Flip item 603's bidMode from null to "history".**

Edit `getSeedInventoryBidModes()`:

```ts
export function getSeedInventoryBidModes(): Map<number, "single" | "history" | null> {
  return new Map<number, "single" | "history" | null>([
    [601, "single"],
    [602, "history"],
    [603, "history"],   // ← was null
  ]);
}
```

- [ ] **Step 5: Extend the demo seed test.**

Edit `test/lib/demo/seed.test.ts`. Find the slice-18 assertions. Update + add:

```ts
it("DEMO_INVENTORY_BIDS has 3 entries (slice 18b)", () => {
  expect(DEMO_INVENTORY_BIDS).toHaveLength(3);
});
it("every DEMO_INVENTORY_BIDS entry has a quantityRequested", () => {
  for (const b of DEMO_INVENTORY_BIDS) {
    expect(b.quantityRequested).toBeGreaterThan(0);
    expect(Number.isInteger(b.quantityRequested)).toBe(true);
  }
});
it("the slice-18b item-603 bid is 5 units", () => {
  const b603 = DEMO_INVENTORY_BIDS.find((b) => b.inventoryItemId === 603);
  expect(b603?.quantityRequested).toBe(5);
});
it("getSeedInventoryBidModes() now has bidding on for item 603", () => {
  const modes = getSeedInventoryBidModes();
  expect(modes.get(603)).toBe("history");
});
```

The slice-18 assertion that asserted `modes.get(603) === null` MUST be removed or revised — find it via grep and replace.

- [ ] **Step 6: Run.**

```bash
npx vitest run test/lib/demo/seed.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 7: Commit.**

```bash
git add src/lib/demo/seed.ts test/lib/demo/seed.test.ts
git commit -m "$(cat <<'EOF'
feat(demo): annotate slice-18 bids + add partial-fill scenario on item 603

Backfills existing slice-18 seeded bids with quantityRequested=1
(semantic match). Adds a 3rd bid: AIYA wants 5 stones from the
Marathi 50-stone parcel — demonstrates the slice-18b partial-fill
mechanic in the canned demo. Item 603's bidMode flips from null to
"history" so the demo /exchange row shows the Place Bid button.

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

Expected: slice-18 baseline + Phase A additions (5 Zod cells + 2 authz cells + 2 query cells + 4 demo seed cells + 1 migration smoke = ~14 new test cases). Zero failures.

- [ ] **Step 2: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

Phase A done.

---

## Phase B — `acceptInventoryBid` quantity-aware accept

### Task B1: Import the `gt` operator

**Files:**
- Modify: `src/lib/inventory/actions.ts`

- [ ] **Step 1: Add `gt` to the drizzle-orm import line.**

Edit line 4 of `src/lib/inventory/actions.ts`:

```ts
import { and, eq, gt, ne, sql } from "drizzle-orm";
```

(was `and, eq, ne, sql`.)

- [ ] **Step 2: Verify typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors (the import is unused until Task B3 lands; that's fine — TS won't complain).

- [ ] **Step 3: Commit (or include with Task B3 — implementer's choice).**

Recommended: roll into Task B3's commit.

---

### Task B2: Write the failing tests FIRST (TDD)

**Files:**
- Modify: `test/lib/inventory/bid-accept-atomicity.test.ts`

This task lays down all the new tests + the revisions to the slice-18 cases. Tests run RED until Task B3 ships the implementation.

- [ ] **Step 1: REVISE the slice-18 baseline test.**

Find the test `accepts one bid, auto-rejects siblings, leaves inventory_items.status unchanged`. Per spec §9.2, the seeded bids in this test default to qty=1; accepting bid[1] leaves 9 units → the other two bids stay PENDING (still fit). Update the assertions:

```ts
expect(byId.get(insertedBids[0].id)?.status).toBe("pending");          // ← was "auto_rejected"
expect(byId.get(insertedBids[1].id)?.status).toBe("accepted");
expect(byId.get(insertedBids[2].id)?.status).toBe("pending");          // ← was "auto_rejected"
// decidedAt: only the accepted bid has it set
expect(byId.get(insertedBids[0].id)?.decidedAt).toBeNull();            // ← was not-null
expect(byId.get(insertedBids[1].id)?.decidedAt).not.toBeNull();
expect(byId.get(insertedBids[2].id)?.decidedAt).toBeNull();            // ← was not-null

expect(itemAfter.status).toBe("in_stock");                              // unchanged
expect(itemAfter.quantity).toBe(9);                                     // ← was 10
```

The test's name is now misleading — rename to `accepts one bid, decrements stock by 1, leaves smaller-fitting bids pending`.

- [ ] **Step 2: REVISE the slice-18 concurrent-accept race test.**

Find the test `two concurrent accepts on the same item — exactly one wins`. Per spec §9.2, change the seed to use `quantityRequested: 5` on BOTH bids so the original "exactly one wins" semantics survive (both bids want all the stock; only one can win):

```ts
const [bidA, bidB] = await db.insert(inventoryBids).values([
  { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "A", priceCents: 100, quantityRequested: 5 },
  { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "B", priceCents: 200, quantityRequested: 5 },
]).returning();
```

Update the post-state assertions:

```ts
// DB state: one accepted; the other was over-subscribed on the racing tx —
// stays PENDING (the failed tx rolled back its auto_reject UPDATE per
// Postgres tx semantics; see spec §4.4)
const accepted = after.filter((b) => b.status === "accepted");
const pending = after.filter((b) => b.status === "pending");
expect(accepted).toHaveLength(1);
expect(pending).toHaveLength(1);

expect(itemAfter.status).toBe("sold");   // ← was "in_stock"
expect(itemAfter.quantity).toBe(0);      // ← was 5
```

The race-correctness invariant is preserved: no double-decrement, no two accepts. The OTHER bid is left pending — owner will manually reject it on the next page render. The test's name is still accurate ("exactly one wins").

- [ ] **Step 3: ADD the partial-fill marquee test.**

Append after the existing tests:

```ts
it("partial accept leaves smaller bids pending, rejects oversubscribed bids", async () => {
  // Item with quantity 10, bidding enabled
  const [item] = await db.insert(inventoryItems).values({
    orgId: 1, category: "Diamonds", name: "parcel", quantity: 10,
    status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
    bidMode: "history",
  }).returning();

  await db.insert(orgs).values([
    { id: 777, name: "Bidder777", slug: "bidder-777" },
  ]).onConflictDoNothing();

  // Three pending bids: A wants 3, B wants 7, C wants 11
  const [bidA, bidB, bidC] = await db.insert(inventoryBids).values([
    { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "A", priceCents: 100, quantityRequested: 3 },
    { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "B", priceCents: 200, quantityRequested: 7 },
    { inventoryItemId: item.id, bidderOrgId: 777, bidderOrgLabel: "C", priceCents: 300, quantityRequested: 11 },
  ]).returning();

  // Accept B (7 units)
  const res = await acceptInventoryBid({ bidId: bidB.id });
  expect(res).toEqual({ ok: true });

  const after = await db.select().from(inventoryBids).orderBy(inventoryBids.id);
  const byId = new Map(after.map((b) => [b.id, b]));
  expect(byId.get(bidA.id)?.status).toBe("pending");          // 3 ≤ 3 remaining
  expect(byId.get(bidB.id)?.status).toBe("accepted");
  expect(byId.get(bidC.id)?.status).toBe("auto_rejected");    // 11 > 3 remaining

  expect(byId.get(bidA.id)?.decidedAt).toBeNull();
  expect(byId.get(bidB.id)?.decidedAt).not.toBeNull();
  expect(byId.get(bidC.id)?.decidedAt).not.toBeNull();

  const [itemAfter] = await db
    .select({ status: inventoryItems.status, quantity: inventoryItems.quantity })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, item.id));
  expect(itemAfter.status).toBe("in_stock");
  expect(itemAfter.quantity).toBe(3);     // 10 - 7 = 3
});
```

- [ ] **Step 4: ADD the sold-on-zero test.**

```ts
it("sold-on-zero flips inventory_items.status to 'sold'", async () => {
  const [item] = await db.insert(inventoryItems).values({
    orgId: 1, category: "Diamonds", name: "single-stone", quantity: 5,
    status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
    bidMode: "single",
  }).returning();

  const [bidA, bidB] = await db.insert(inventoryBids).values([
    { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "A", priceCents: 100, quantityRequested: 2 },
    { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "B", priceCents: 200, quantityRequested: 5 },
  ]).returning();

  const res = await acceptInventoryBid({ bidId: bidB.id });
  expect(res).toEqual({ ok: true });

  const [itemAfter] = await db.select({
    status: inventoryItems.status,
    quantity: inventoryItems.quantity,
  }).from(inventoryItems).where(eq(inventoryItems.id, item.id));
  expect(itemAfter.status).toBe("sold");
  expect(itemAfter.quantity).toBe(0);

  // Sold-out branch: all siblings auto-rejected, no matter their size
  const [bidAAfter] = await db.select({ status: inventoryBids.status })
    .from(inventoryBids).where(eq(inventoryBids.id, bidA.id));
  expect(bidAAfter.status).toBe("auto_rejected");
});
```

- [ ] **Step 5: ADD the over-subscribed accept test.**

```ts
it("over-subscribed accept returns Forbidden and leaves bid pending", async () => {
  // Item has 3 units; bid asks for 5 (item shrank since post time)
  const [item] = await db.insert(inventoryItems).values({
    orgId: 1, category: "Diamonds", name: "shrunk", quantity: 3,
    status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
    bidMode: "history",
  }).returning();
  const [bid] = await db.insert(inventoryBids).values({
    inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "X",
    priceCents: 100, quantityRequested: 5,
  }).returning();

  const res = await acceptInventoryBid({ bidId: bid.id });
  expect(res).toEqual({ ok: false, error: "Forbidden" });

  // Post-state: tx rolled back; bid still pending (NOT auto_rejected)
  const [bidAfter] = await db.select({ status: inventoryBids.status, decidedAt: inventoryBids.decidedAt })
    .from(inventoryBids).where(eq(inventoryBids.id, bid.id));
  expect(bidAfter.status).toBe("pending");
  expect(bidAfter.decidedAt).toBeNull();

  // Item untouched
  const [itemAfter] = await db.select({
    status: inventoryItems.status,
    quantity: inventoryItems.quantity,
  }).from(inventoryItems).where(eq(inventoryItems.id, item.id));
  expect(itemAfter.status).toBe("in_stock");
  expect(itemAfter.quantity).toBe(3);
});
```

- [ ] **Step 6: Run — expect failures on the 3 NEW tests + the revised slice-18 cases.**

```bash
npx vitest run test/lib/inventory/bid-accept-atomicity.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: the test file shows red on the revised slice-18 cases (because slice-18 logic still unconditionally auto-rejects siblings and doesn't touch stock) + red on the 3 new cases. This is the TDD red phase.

- [ ] **Step 7: Do NOT commit yet — wait for Task B3 implementation.**

---

### Task B3: Implement quantity-aware `acceptInventoryBid`

**Files:**
- Modify: `src/lib/inventory/actions.ts`

- [ ] **Step 1: Locate the existing `acceptInventoryBid` body.**

`src/lib/inventory/actions.ts:214-281`. The pre-tx SELECT + the `db.transaction(async (tx) => { … })` block. The `SELECT id FROM inventory_items WHERE id = $ FOR UPDATE` line + the in-tx re-read of bid status + the two UPDATEs are all there from slice 18.

- [ ] **Step 2: Extend the in-tx re-read to also fetch `quantity_requested` + `item.quantity`.**

Replace the existing in-tx re-read SELECT (the `SELECT status FROM inventory_bids WHERE id = $bidId` line):

```ts
const fresh = await tx.execute(sql`
  SELECT ib.status AS bid_status,
         ib.quantity_requested AS bid_qty,
         i.quantity AS item_qty
  FROM inventory_bids ib
  JOIN inventory_items i ON i.id = ib.inventory_item_id
  WHERE ib.id = ${input.bidId}
`);
const freshRows = (fresh as unknown as {
  rows: { bid_status: string; bid_qty: number; item_qty: number }[];
}).rows;
if (freshRows.length === 0) throw new ForbiddenError("Forbidden");
const f = freshRows[0];
if (f.bid_status !== "pending") throw new ForbiddenError("Forbidden");
```

- [ ] **Step 3: Add the over-subscribed accept guard.**

Immediately after the re-read:

```ts
// Slice 18b: bid asks for more than's currently available — throw Forbidden.
// Postgres tx semantics: the throw rolls back the entire tx; the bid stays
// pending. Owner can manually reject it on the next page render. See
// spec §4.4 for the exact rollback semantics.
if (f.bid_qty > f.item_qty) {
  throw new ForbiddenError("Forbidden");
}
```

- [ ] **Step 4: Insert the stock-decrement UPDATE after the accept UPDATE.**

The accept UPDATE (`update inventoryBids set status='accepted'`) stays. Immediately after it, BEFORE the sibling sweep:

```ts
// Slice 18b: decrement item.quantity; flip status to 'sold' on zero.
// Defense-in-depth: AND eq(orgId, sessionOrgId) — slice-3 verbatim.
const newQuantity = f.item_qty - f.bid_qty;
await tx
  .update(inventoryItems)
  .set({
    quantity: newQuantity,
    status: newQuantity === 0 ? "sold" : undefined,
    updatedAt: now,
  })
  .where(and(
    eq(inventoryItems.id, row.inventoryItemId),
    eq(inventoryItems.orgId, orgId),
  ));
```

The `status: undefined` semantic in Drizzle is "do not include this key in the SET clause" — status stays whatever it was when stock remains. Verify behavior: if the test for the partial-fill path expects `status === "in_stock"` post-accept and the column was already "in_stock", `undefined` correctly leaves it alone.

- [ ] **Step 5: Replace the unconditional sibling sweep with a selective one.**

The existing sibling sweep:

```ts
await tx
  .update(inventoryBids)
  .set({ status: "auto_rejected", decidedAt: now })
  .where(and(
    eq(inventoryBids.inventoryItemId, row.inventoryItemId),
    eq(inventoryBids.status, "pending"),
    ne(inventoryBids.id, input.bidId),
  ));
```

Replace with:

```ts
// Slice 18b: selective sibling sweep.
//  - If stock remains (newQuantity > 0): auto-reject only siblings whose
//    quantityRequested exceeds newQuantity. Bids that still fit stay pending.
//  - If sold-out (newQuantity === 0): unconditional auto-reject (slice-18 shape).
if (newQuantity > 0) {
  await tx
    .update(inventoryBids)
    .set({ status: "auto_rejected", decidedAt: now })
    .where(and(
      eq(inventoryBids.inventoryItemId, row.inventoryItemId),
      eq(inventoryBids.status, "pending"),
      ne(inventoryBids.id, input.bidId),
      gt(inventoryBids.quantityRequested, newQuantity),
    ));
} else {
  await tx
    .update(inventoryBids)
    .set({ status: "auto_rejected", decidedAt: now })
    .where(and(
      eq(inventoryBids.inventoryItemId, row.inventoryItemId),
      eq(inventoryBids.status, "pending"),
      ne(inventoryBids.id, input.bidId),
    ));
}
```

- [ ] **Step 6: Remove the stale slice-18 NOTE comment.**

The slice-18 implementation has a comment block:

```
// NOTE: we do NOT touch inventory_items.status. Bidding is a price
// negotiation; stock-deduction is a separate concern (slice 18b).
// See spec §5.3.
```

That comment is now lying. Replace with:

```
// Slice 18b: stock decrement + sold-on-zero + selective sibling sweep
// all happen INSIDE the same locked region established by the FOR UPDATE
// on inventory_items above. See spec §4.1 for the full transaction body
// and §4.4 for the Postgres rollback semantics on the over-subscribed
// failure path.
```

- [ ] **Step 7: Verify typecheck + run the Task B2 tests.**

```bash
npx tsc --noEmit 2>&1 | tail -10
npx vitest run test/lib/inventory/bid-accept-atomicity.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: zero TS errors. ALL tests pass — slice-18 revised baseline + the 3 new partial-fill / sold-on-zero / over-subscribed cases + the concurrent-race test (now with updated assertions).

If the over-subscribed test fails with `bid.status === "auto_rejected"` (i.e. the tx didn't roll back), inspect Drizzle's transaction handling — possibly the wrapper swallows the throw and commits. If that's the case, add a try/catch wrapping the tx body that re-throws on Forbidden but rolls back any updates explicitly (or use `tx.rollback()` if Drizzle exposes it). The §11.6 PR-review-checklist grep is the regression guard.

- [ ] **Step 8: Run the full inventory action test suite.**

```bash
npx vitest run test/lib/inventory/ test/db/inventory-bids.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: all inventory tests pass — withdraw, mode-toggle, authz (now with Task A4 additions), accept-atomicity (all cases), query layer.

- [ ] **Step 9: Commit.**

```bash
git add src/lib/inventory/actions.ts test/lib/inventory/bid-accept-atomicity.test.ts
git commit -m "$(cat <<'EOF'
feat(inventory): acceptInventoryBid decrements stock + selective sibling sweep

Slice 18b's marquee mechanic. Extends slice-18's locked-tx body
(commit 293f3fd):

  - In-tx re-read now also fetches quantity_requested + item.quantity
  - Over-subscribed branch: throw Forbidden, tx rolls back, bid stays
    pending (Postgres tx semantics — see spec §4.4)
  - Decrement item.quantity by bid.quantity_requested
  - When newQuantity hits 0, flip item.status to 'sold' (canonical
    slice-1b-1 sold-out value)
  - Selective sibling sweep: when stock remains, auto-reject only
    bids whose quantity_requested exceeds newQuantity. Bids that
    still fit STAY pending. When sold-out, sweep unconditionally
    (slice-18 shape).

The slice-18 baseline + concurrent-accept tests are REVISED to
reflect the new selective-sweep behavior. Three new tests:
partial-fill (the marquee mechanic), sold-on-zero (status flip),
and over-subscribed accept (Forbidden + bid stays pending).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Phase B green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: Phase A green-bar baseline + 3 new accept tests = up by ~17 since slice-18 baseline. Zero failures.

- [ ] **Step 2: Build.**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 3: Defense-in-depth grep.**

```bash
grep -n -A 12 "update(inventoryItems)" src/lib/inventory/actions.ts | grep -B 1 -A 6 "newQuantity"
```

Expected: shows the new UPDATE block including `eq(inventoryItems.orgId, orgId)`. Visual confirmation that the slice-3 invariant holds on the new mutation site.

- [ ] **Step 4: Parent-row lock grep.**

```bash
grep -n "FOR UPDATE" src/lib/inventory/actions.ts
```

Expected: exactly ONE line. The slice-18b extension must not duplicate the lock; it must not remove the lock.

Phase B done.

---

## Phase C — UI: quantity input + sold-out badge

### Task C1: `PostInventoryBidForm` quantity input

**Files:**
- Modify: `src/components/inventory/PostInventoryBidForm.tsx`
- Create: `test/components/inventory/PostInventoryBidForm.test.tsx`

- [ ] **Step 1: Write the failing tests first (TDD).**

Create `test/components/inventory/PostInventoryBidForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PostInventoryBidForm } from "@/components/inventory/PostInventoryBidForm";

describe("PostInventoryBidForm — slice 18b", () => {
  it("renders an 'Available: N units' hint", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={5}
        postInventoryBid={vi.fn()}
      />,
    );
    expect(screen.getByText(/available: 5 units/i)).toBeTruthy();
  });

  it("pluralizes 1 unit correctly", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={1}
        postInventoryBid={vi.fn()}
      />,
    );
    expect(screen.getByText(/available: 1 unit$/i)).toBeTruthy();
  });

  it("disables submit when quantity exceeds available stock", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={5}
        postInventoryBid={vi.fn()}
      />,
    );
    const qty = screen.getByLabelText("quantity") as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "100" } });
    const submit = screen.getByRole("button", { name: /place bid/i });
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toMatch(/cannot bid for more than 5/i);
  });

  it("passes quantityRequested through to the action", async () => {
    const post = vi.fn(async () => ({ ok: true as const }));
    render(
      <PostInventoryBidForm
        inventoryItemId={42}
        availableQuantity={10}
        postInventoryBid={post}
      />,
    );
    fireEvent.change(screen.getByLabelText("quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /place bid/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      inventoryItemId: 42,
      priceCents: 10000,
      quantityRequested: 3,
    }));
  });

  it("defaults quantity to 1", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={5}
        postInventoryBid={vi.fn()}
      />,
    );
    const qty = screen.getByLabelText("quantity") as HTMLInputElement;
    expect(qty.value).toBe("1");
  });

  it("has max attribute set to availableQuantity", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={50}
        postInventoryBid={vi.fn()}
      />,
    );
    const qty = screen.getByLabelText("quantity") as HTMLInputElement;
    expect(qty.max).toBe("50");
  });
});
```

- [ ] **Step 2: Run — expect prop-mismatch failures.**

```bash
npx vitest run test/components/inventory/PostInventoryBidForm.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: tests fail because the form doesn't yet accept `availableQuantity` and doesn't render a quantity input.

- [ ] **Step 3: Update `PostInventoryBidForm.tsx`.**

Edit `src/components/inventory/PostInventoryBidForm.tsx` per spec §7.1. Add the `availableQuantity` prop, the `quantity` state (default `"1"`), the `qty` derived value, the `overStock` boolean, the new input, the "Available: N units" hint, the over-stock alert, the submit disabling, and `quantityRequested: qty` on the action call. Reset `quantity` to `"1"` on success.

```tsx
"use client";

import { useState, useTransition } from "react";
import type { PostInventoryBidInput } from "@/lib/inventory/bidValidation";
import type { ActionResult } from "@/lib/inventory/actions";

export function PostInventoryBidForm({
  inventoryItemId,
  availableQuantity,
  postInventoryBid,
}: {
  inventoryItemId: number;
  availableQuantity: number;
  postInventoryBid: (input: PostInventoryBidInput) => Promise<ActionResult>;
}) {
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<"USD" | "EUR" | "INR" | "JPY">("USD");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cents = (() => {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  })();

  const qty = (() => {
    const n = Number(quantity);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return 0;
    return n;
  })();

  const overStock = qty > availableQuantity;

  function submit() {
    setError(null);
    if (overStock) return;
    start(async () => {
      const res = await postInventoryBid({
        inventoryItemId,
        priceCents: cents,
        currency,
        notes: notes.trim() ? notes.trim() : undefined,
        quantityRequested: qty,
      });
      if (res.ok) {
        setPrice("");
        setNotes("");
        setQuantity("1");
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
      <p className="text-[10px] text-text/40">
        Available: {availableQuantity} unit{availableQuantity === 1 ? "" : "s"}
      </p>
      <div className="flex gap-2">
        <input
          aria-label="quantity"
          type="number"
          min={1}
          max={availableQuantity}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Qty"
          className="w-16 bg-bg p-1 text-sm"
        />
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
      {overStock && (
        <p role="alert" className="text-xs text-bad">
          Cannot bid for more than {availableQuantity} units.
        </p>
      )}
      <button
        type="submit"
        disabled={pending || cents === 0 || qty === 0 || overStock}
        className="rounded border border-gold/40 px-3 py-1 text-xs uppercase tracking-wider text-gold/80 disabled:opacity-40"
      >
        {pending ? "Submitting…" : "Place Bid"}
      </button>
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Run.**

```bash
npx vitest run test/components/inventory/PostInventoryBidForm.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: all 6 cases pass.

- [ ] **Step 5: Commit.**

```bash
git add src/components/inventory/PostInventoryBidForm.tsx test/components/inventory/PostInventoryBidForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(inventory): PostInventoryBidForm quantity input + available-stock hint

Adds a quantity input (default 1, max=availableQuantity) and a
"Available: N units" hint above the price input. Submitting is
disabled when the typed quantity exceeds available stock; a
visible alert explains why. The form passes quantityRequested
through to postInventoryBid; the action layer's canBidOnItem
6th precondition (Task A4) is the security gate.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: `InventoryBidsTab` — quantity column + sold-out copy + thread availableQuantity

**Files:**
- Modify: `src/components/inventory/InventoryBidsTab.tsx`
- Modify: `test/components/inventory/InventoryBidsTab.test.tsx`

- [ ] **Step 1: Update the Props type.**

Edit `src/components/inventory/InventoryBidsTab.tsx`. The Props type widens:

```ts
type Props = {
  inventoryItem: {
    id: number;
    name: string;
    ownerOrgId: number;
    bidMode: "single" | "history" | null;
    quantity: number;                            // ← NEW (slice 18b)
    status: "in_stock" | "reserved" | "sold";    // ← NEW (slice 18b)
  };
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
```

- [ ] **Step 2: Render quantityRequested per bid row.**

In the `<li>` block (slice-18 line ~79), insert a `× N` span between price and status badge:

```tsx
<span className="font-mono text-text/70">{fmt(b.priceCents, b.currency)}</span>
<span className="text-[10px] uppercase tracking-wider text-text/40">
  × {b.quantityRequested}
</span>
<span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_CLASS[b.status]}`}>{b.status}</span>
```

- [ ] **Step 3: Add the sold-out copy + hide form when sold.**

Replace the existing form-rendering block. Slice-18 had two render points (lines 69-74 and 120-122). Consolidate to one:

```tsx
{inventoryItem.bidMode !== null && !isOwner && inventoryItem.status !== "sold" && (
  <PostInventoryBidForm
    inventoryItemId={inventoryItem.id}
    availableQuantity={inventoryItem.quantity}
    postInventoryBid={actions.postInventoryBid}
  />
)}

{inventoryItem.status === "sold" && (
  <p className="text-xs text-text/40">This item is sold out — no further bids accepted.</p>
)}
```

- [ ] **Step 4: Extend the test file.**

Edit `test/components/inventory/InventoryBidsTab.test.tsx`. ADD:

```tsx
it("renders quantityRequested as '× N' per bid row", () => {
  render(<InventoryBidsTab
    inventoryItem={{ id: 1, name: "x", ownerOrgId: 999, bidMode: "history", quantity: 10, status: "in_stock" }}
    viewerOrgId={999}
    bids={[{ …baseBid, quantityRequested: 7 }]}
    actions={…}
    onClose={() => {}}
  />);
  expect(screen.getByText(/× 7/)).toBeTruthy();
});

it("hides the form when inventoryItem.status === 'sold'", () => {
  render(<InventoryBidsTab
    inventoryItem={{ id: 1, name: "x", ownerOrgId: 999, bidMode: "history", quantity: 0, status: "sold" }}
    viewerOrgId={1}
    bids={[]}
    actions={…}
    onClose={() => {}}
  />);
  expect(screen.queryByLabelText("price")).toBeNull();
  expect(screen.queryByLabelText("quantity")).toBeNull();
  expect(screen.getByText(/sold out/i)).toBeTruthy();
});

it("passes availableQuantity to PostInventoryBidForm equal to inventoryItem.quantity", () => {
  render(<InventoryBidsTab
    inventoryItem={{ id: 1, name: "x", ownerOrgId: 999, bidMode: "history", quantity: 12, status: "in_stock" }}
    viewerOrgId={1}
    bids={[]}
    actions={…}
    onClose={() => {}}
  />);
  expect(screen.getByText(/available: 12 units/i)).toBeTruthy();
});
```

ALSO update any slice-18 tests that pass `inventoryItem` props — they'll need `quantity` + `status` fields added to satisfy the widened Props type. Find via:

```bash
grep -n "ownerOrgId" test/components/inventory/InventoryBidsTab.test.tsx
```

- [ ] **Step 5: Run.**

```bash
npx vitest run test/components/inventory/InventoryBidsTab.test.tsx --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 6: Commit.**

```bash
git add src/components/inventory/InventoryBidsTab.tsx test/components/inventory/InventoryBidsTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(inventory): InventoryBidsTab — quantity column + sold-out copy

Renders `× N` per bid row showing how many units each bid is
requesting. When inventoryItem.status === 'sold', the form is
hidden and a "This item is sold out" line replaces it. Threads
availableQuantity through to PostInventoryBidForm so the
"Available: N units" hint + max-cap on the quantity input
reflect the current item state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C3: `TradeNetInventoryList` — Sold badge + Place Bid suppression

**Files:**
- Modify: `src/components/inventory/TradeNetInventoryList.tsx`
- Modify: `test/components/inventory/TradeNetInventoryList.test.tsx`

- [ ] **Step 1: Update `TradeNetInventoryList.tsx`.**

Find the existing Place Bid render block (slice-18 lines 38-50). Wrap with a status-check branch:

```tsx
{it.status === "sold" ? (
  <span
    aria-label="sold badge"
    className="rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300"
  >
    Sold
  </span>
) : (
  it.bidMode !== null && it.orgId !== viewerOrgId && (
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
  )
)}
```

The `it.status === "sold"` short-circuits before checking bidMode + viewer-not-owner. `SharedInventoryRow` already projects `status` (slice 15) — no wire-shape change.

- [ ] **Step 2: Extend the test file.**

Edit `test/components/inventory/TradeNetInventoryList.test.tsx`. ADD:

```tsx
it("renders Sold badge when item.status === 'sold'", () => {
  render(<TradeNetInventoryList
    items={[{
      id: 1, orgId: 999, ownerOrgLabel: "X", category: "Diamonds",
      name: "stone", quantity: 0, status: "sold",
      visibilityCircleId: 100, bidMode: "single", updatedAt: new Date(),
    }]}
    circleNamesById={new Map([[100, "Circle"]])}
    viewerOrgId={1}
    bidsByItemId={new Map()}
    onPlaceBid={() => {}}
  />);
  expect(screen.getByLabelText(/sold badge/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /place bid/i })).toBeNull();
});

it("hides Place Bid when item.status === 'sold' even if bidMode is set", () => {
  // Belt-and-suspenders test for the slice-18b regression
  render(<TradeNetInventoryList
    items={[{
      id: 1, orgId: 999, ownerOrgLabel: "X", category: "Diamonds",
      name: "stone", quantity: 0, status: "sold",
      visibilityCircleId: 100, bidMode: "history", updatedAt: new Date(),
    }]}
    circleNamesById={new Map([[100, "Circle"]])}
    viewerOrgId={1}
    bidsByItemId={new Map([[1, [{ status: "pending" } as never]]])}
    onPlaceBid={() => {}}
  />);
  expect(screen.queryByRole("button", { name: /place bid/i })).toBeNull();
});
```

- [ ] **Step 3: Run.**

```bash
npx vitest run test/components/inventory/TradeNetInventoryList.test.tsx --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 4: Commit.**

```bash
git add src/components/inventory/TradeNetInventoryList.tsx test/components/inventory/TradeNetInventoryList.test.tsx
git commit -m "$(cat <<'EOF'
feat(inventory): /exchange row Sold badge + Place Bid suppression

When item.status === 'sold', renders a zinc-pill "Sold" badge in
place of the Place Bid button. The status branch short-circuits
before the bidMode + viewer-not-owner check — so even if the
owner forgot to disable bidding on the sold-out item, no Place
Bid button renders.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C4: `/exchange` page threads availableQuantity into the drawer

**Files:**
- Modify: `src/app/(admin)/exchange/page.tsx`

- [ ] **Step 1: Audit current drawer prop flow.**

```bash
grep -n -A 20 "InventoryBidsTab" src/app/\(admin\)/exchange/page.tsx 2>/dev/null || true
grep -rn "InventoryBidsTab" src/app/ src/components/inventory/
```

If the drawer is opened by a client-side state on the page (slice-18 shape — `TradeNetInventoryList` calls `onPlaceBid(item)` which sets a state on the page; the page renders `<InventoryBidsTab inventoryItem={…} … />` conditionally), then the inventory row needs to flow through `quantity` + `status` already (both are on `SharedInventoryRow`).

If the page does NOT yet pass `quantity` + `status` to the drawer's `inventoryItem` prop (slice-18 may have only passed `{ id, name, ownerOrgId, bidMode }`), this task adds those two fields.

- [ ] **Step 2: Extend the `inventoryItem` prop on the drawer.**

In `src/app/(admin)/exchange/page.tsx`, find the line that constructs the `inventoryItem` prop for `<InventoryBidsTab … />`. Widen:

```tsx
inventoryItem={{
  id: item.id,
  name: item.name,
  ownerOrgId: item.orgId,
  bidMode: item.bidMode,
  quantity: item.quantity,     // ← NEW
  status: item.status,         // ← NEW
}}
```

- [ ] **Step 3: Verify typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors. The widened Props type from Task C2 now matches the call site.

- [ ] **Step 4: Build smoke.**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build (the Next.js RSC route /exchange compiles).

- [ ] **Step 5: Commit.**

```bash
git add src/app/\(admin\)/exchange/page.tsx
git commit -m "$(cat <<'EOF'
feat(exchange): thread item.quantity + item.status into BidsTab drawer

Slice 18b's PostInventoryBidForm needs availableQuantity; the
InventoryBidsTab drawer needs item.status to render sold-out
copy. Both fields are already on SharedInventoryRow (slice 15) —
just plumbing.

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

Expected: Phase A + Phase B baseline + Phase C (6 form + 3 tab + 2 list = 11 new UI tests). Zero failures.

- [ ] **Step 2: Build.**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean. Next.js RSC route /exchange smokes.

- [ ] **Step 3: Typecheck.**

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

Expected: pre-slice-18b baseline + Phase A (14) + Phase B (3 new, ~2 revised) + Phase C (11) ≈ **+28 net new tests passing**. Zero failures.

- [ ] **Step 2: Lint.**

```bash
npm run lint 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: PR-review checklist greps (spec §11.6).**

```bash
# (a) No orgId fields on the wire schemas (still — slice 18b adds quantityRequested only)
grep -rn "orgId\|bidderOrgId\|ownerOrgId" src/lib/inventory/bidValidation.ts || echo "PASS: no orgId on wire"

# (b) Exactly one FOR UPDATE — the slice-18 lock; slice 18b must not duplicate
test "$(grep -c 'FOR UPDATE' src/lib/inventory/actions.ts)" -eq 1 && echo "PASS: single parent-row lock"

# (c) acceptInventoryBid still uses db.transaction (slice 18 invariant preserved)
grep -n -A 60 "export async function acceptInventoryBid" src/lib/inventory/actions.ts | grep -q "transaction" && echo "PASS: tx wrapper intact"

# (d) New inventory_items UPDATE has the slice-3 defense-in-depth clause
grep -n -A 12 "update(inventoryItems)" src/lib/inventory/actions.ts | grep -q "inventoryItems.orgId" && echo "PASS: slice-3 invariant preserved on the stock UPDATE"

# (e) quantity_requested column is NOT NULL DEFAULT 1
grep -n "quantity_requested" drizzle/0014_*.sql
# Expected: line includes both `DEFAULT 1` and `NOT NULL`

# (f) Sold-on-zero path actually sets status='sold'
grep -n -A 5 "newQuantity === 0" src/lib/inventory/actions.ts | grep -q '"sold"' && echo "PASS: sold-on-zero reaches status='sold'"

# (g) Selective sibling sweep uses gt() on quantityRequested
grep -n "gt(inventoryBids.quantityRequested" src/lib/inventory/actions.ts && echo "PASS: selective sweep uses gt"

# (h) Both sibling sweep UPDATEs filter ne(inventoryBids.id, input.bidId) to avoid self-reject
test "$(grep -c 'ne(inventoryBids.id, input.bidId)' src/lib/inventory/actions.ts)" -ge 2 && echo "PASS: both sibling sweeps protect the just-accepted row"
```

Each grep returns the expected PASS marker. Mismatches block ship.

- [ ] **Step 4: Slice-15 + slice-16 + slice-18 regression check.**

```bash
npm test -- --run test/db/inventory.test.ts test/db/inventory-bids.test.ts test/db/bids.test.ts test/lib/deals/ test/lib/inventory/ 2>&1 | tail -10
```

Expected: zero failures. Slice-15 visibility tests, slice-16 deal-bid tests, slice-18 withdraw + mode-toggle + (revised) accept-atomicity all stay green.

- [ ] **Step 5: Manual demo smoke.**

```bash
npm run dev
```

Then in another terminal:

```bash
open http://localhost:3000/exchange
```

Verify in browser:
- Item 603 (Marathi parcel) shows the "Place Bid · 1 pending" button.
- Clicking opens the drawer.
- Bid list shows "× 5" next to the existing AIYA bid.
- Form shows "Available: 50 units"; typing 51 in the quantity input shows the over-stock alert and disables submit.
- Typing 5 + a price + clicking Place Bid returns the demo-mode-disabled error.

- [ ] **Step 6: Whole-suite final.**

```bash
npm test -- --run 2>&1 | tail -10
```

Confirm zero failures.

---

### Task D2: Land + final commit

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin feature/slice-18b-inventory-bid-fulfillment
```

- [ ] **Step 2: Open PR via `gh`.**

```bash
gh pr create --title "feat(inventory): slice 18b — quantity-aware bid fulfillment" --body "$(cat <<'EOF'
## Summary

Closes the stock loop slice 18 §13 named as out of scope. Slice 18 accepted bids without touching `inventory_items.quantity` / `status`; slice 18b decrements stock and flips to `'sold'` on zero, atomically inside the slice-18 parent-row-locked transaction.

- New column `inventory_bids.quantity_requested INTEGER NOT NULL DEFAULT 1`. Migration is additive; existing rows backfill semantically as "1 unit" bids.
- `canBidOnItem` gains a 6th precondition: `quantityRequested <= item.quantity` at post time (UX guard; the locked re-read is the source of truth).
- `acceptInventoryBid` extends slice-18's locked tx body:
  - In-tx re-read joins `inventory_items` and reads `quantity_requested` + `item.quantity`
  - Throws `Forbidden` if the bid is over-subscribed (bid stays pending — Postgres tx rolls back)
  - Decrements `item.quantity` by `bid.quantity_requested`
  - Flips `item.status` to `'sold'` when newQuantity hits 0 (canonical slice-1b-1 sold-out value)
  - Selective sibling sweep: when stock remains, only auto-rejects bids whose `quantity_requested > newQuantity`. Bids that still fit STAY pending. When sold-out, sweeps unconditionally (slice-18 shape).
- UI: `PostInventoryBidForm` gains a quantity input + "Available: N units" hint + over-stock client-side guard; `InventoryBidsTab` shows `× N` per bid row + sold-out copy; `TradeNetInventoryList` shows a "Sold" badge in place of Place Bid when status === 'sold'.
- Demo seed: existing slice-18 bids annotated with `quantityRequested: 1`; new partial-fill bid for 5 units on the Marathi 50-stone parcel (item 603); item 603's bidMode flips to "history".
- Migration `drizzle/0014_*.sql` — single ALTER; additive only.

Spec: `docs/superpowers/specs/2026-06-07-aiya-inventory-bid-fulfillment-slice-18b-design.md`
Plan: `docs/superpowers/plans/2026-06-07-aiya-inventory-bid-fulfillment-slice-18b.md`

## Test plan

- [ ] `npm test` — pre-slice baseline + ~28 net new tests
- [ ] `npm run build` — clean
- [ ] `npm run lint` — clean
- [ ] PR-review checklist greps from spec §11.6 each return PASS
- [ ] Manual /exchange smoke: item 603 shows the partial-fill scenario; over-stock client-side guard works; sold items show the "Sold" badge
- [ ] Slice-18 regression: withdraw + mode-toggle + (revised) accept-atomicity all stay green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI; address review.**

After merge, run the worktree teardown:

```bash
cd /
git -C "/Users/claytonhillyard/Downloads/dashboard project /root" worktree remove .worktrees/slice-18b-inventory-bid-fulfillment
```

---

## Out-of-scope reminders (do not implement this slice)

- Counter-offer linkage → future
- Bid expiration cron → future
- Audit log of stock decrements → tenancy audit slice
- Email/push notifications on bid arrival → slice 20 (Resend)
- "Today's Inventory Bids" right-rail panel → slice 18c
- Owner UX showing "5 units reserved by pending bids" → slice 18d / polish
- `'reserved'` intermediate status (sold but not shipped) → future fulfillment slice
- Bulk accept (accept N bids at once) → out of scope
- Cross-item concurrency (different items by different orgs) → naturally serialized by the per-item parent-row lock; no test needed

If a subagent finds themselves writing any of the above, stop and re-read the spec §13.

---

## Key risk + verification flowdown

| Step | Risk | Verification |
|---|---|---|
| A1 schema | Migration adds NOT NULL without DEFAULT → fails on existing rows | Task A2 step 1 inspects the generated SQL |
| A4 canBidOnItem | 6th precondition leaks ordering info (e.g. tells bidder "you'd be over-stock" before checking circle) | Spec §3.1 — the 6th check is AFTER membership; truth-table test in A4 step 6 covers boundary cases |
| B3 over-subscribed | Pre-throw UPDATE survives the throw (Postgres semantics misread) | Task B2 step 5 over-subscribed test asserts `bid.status === "pending"` AFTER the failed accept |
| B3 selective sweep | Wrong comparison operator (>= instead of >) auto-rejects bids that would still exactly fit | Task B2 step 3 partial-fill test asserts A=pending where A.qty === newQuantity (3 ≤ 3 stays pending) |
| B3 sold-on-zero | Drizzle `status: undefined` in SET silently writes NULL on some adapters | Visual SQL grep on the generated query in dev; if it writes NULL, fall back to two separate UPDATE statements (one for quantity-only, one for status if newQuantity === 0) |
| C1 form | Submit fires before client-side guard catches over-stock → unnecessary action call | Task C1 step 1 test 3 asserts submit is disabled when overStock |
| D1 step 3(c) | tx wrapper deleted by a careless refactor → atomicity gone | Grep confirms `db.transaction` survives |
| D1 step 3(d) | New inventory_items UPDATE lacks the slice-3 orgId clause | Grep confirms `inventoryItems.orgId` is on the new UPDATE |
| D1 step 3(g) | gt operator missing on selective sweep → reverts to slice-18 unconditional sweep | Grep confirms `gt(inventoryBids.quantityRequested` is present |
