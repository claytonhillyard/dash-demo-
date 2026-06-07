# AIYA Slice 18c — Today's Inventory Bids panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the inventory-bidding trilogy (18 + 18b + 18c). Add a new right-rail "Today's Inventory Bids" panel that mirrors slice-16's `TodaysBidsPanel` for the inventory side. One new read function (`getTodaysInventoryBidsForOwner`), one new client component (`TodaysInventoryBidsPanel`), one new `PanelEntry` registration (`todays-inventory-bids`), one new layout view type (`TodaysInventoryBidsView`), and the RSC wiring through `src/app/page.tsx` + `DashboardGrid`. Reuses the existing slice-18 `acceptInventoryBid` + `rejectInventoryBid` server actions. ZERO new server actions, ZERO schema changes, ZERO migration. Small slice.

**Architecture:** Slice 18c is the direct mirror of slice-16's `getTodaysBidsForOwner` + `TodaysBidsPanel` pair. The load-bearing primitives — both inherited from slice 16:
1. The trailing `AT TIME ZONE 'UTC'` in the WHERE clause (re-wraps the truncated value back into timestamptz; without it, a non-UTC session would silently slide the cutoff). See `src/db/bids.ts:166-172` for the explanatory comment block that must be copied verbatim into the new function.
2. The aria-label disambiguation: every accessible identifier on the new panel is prefixed `inventory` (`todays inventory bids panel`, `todays inventory bid row`, `accept inventory bid <id>`, `reject inventory bid <id>`). This prevents `screen.getByLabelText(/accept bid 42/)` in slice-16's test from accidentally matching slice-18c's row.

**Tech Stack:** Drizzle ORM (pglite dev/test, Neon HTTP prod) · Next.js 15 App Router · React 19 Server Components + Server Actions · Zod · vitest (jsdom + node) · Testing Library · Tailwind (existing tokens).

**Branch:** `feature/slice-18c-todays-inventory-bids` worktree at `.worktrees/slice-18c-todays-inventory-bids`. See `docs/worktrees.md` for the convention. Implementer subagents work *only* in the worktree path — never in `/root`.

**Spec:** `docs/superpowers/specs/2026-06-07-aiya-todays-inventory-bids-slice-18c-design.md`. Read it in full before starting.

---

## File Structure

**New files:**
- `src/components/dashboard/TodaysInventoryBidsPanel.tsx`
- `test/components/dashboard/TodaysInventoryBidsPanel.test.tsx`

**Modified files:**
- `src/db/inventoryBids.ts` — append `TodaysInventoryBidView` type + `getTodaysInventoryBidsForOwner` function
- `src/lib/layout/types.ts` — add `TodaysInventoryBidsView` interface + extend `PanelCtx`
- `src/lib/layout/registry.tsx` — add `todays-inventory-bids` `PanelEntry`
- `src/app/DashboardGrid.tsx` — thread `todaysInventoryBids` prop into `PanelCtx`
- `src/app/page.tsx` — call `getTodaysInventoryBidsForOwner`, construct view, pass to `DashboardGrid`
- `test/db/inventory-bids.test.ts` — append truth-table for the new read

**Removed files:** None.
**Migration:** None.

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

Expected: `## main...origin/main`. Last commit on main is `3befe3c Merge slice 18b: Inventory Bid Fulfillment (quantity-aware accept + stock decrement + selective sibling sweep)` (or its descendant if something else merged). No `M`/`A` lines — only the long-standing untracked personal files (`.md2pdf.py`, `FEMALE_AI_BOT.md`, `FEMALE_AI_BOT.pdf`, `training protocol/`) are acceptable.

- [ ] **Pre-flight Step 2: Cut the slice-18c worktree (per `docs/worktrees.md`)**

```bash
git worktree add .worktrees/slice-18c-todays-inventory-bids -b feature/slice-18c-todays-inventory-bids
cd .worktrees/slice-18c-todays-inventory-bids
ln -sf ../../.env .env
ln -sf ../../node_modules node_modules
git branch --show-current
```

Expected: `feature/slice-18c-todays-inventory-bids`. Symlinks present.

**All remaining steps run from `.worktrees/slice-18c-todays-inventory-bids`, NOT from `/root`.** This is the failure mode `docs/worktrees.md` exists to prevent.

- [ ] **Pre-flight Step 3: Confirm baseline test suite is green**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: zero failures. The baseline as of the spec date is slice 18b's exit count. If anything is failing on `main` before slice-18c edits, stop and fix that first.

- [ ] **Pre-flight Step 4: Confirm slice 16's panel + slice 18 + 18b primitives are present**

```bash
grep -n "TodaysBidsPanel\|getTodaysBidsForOwner\|AT TIME ZONE 'UTC'" src/db/bids.ts | head -10
grep -n "acceptInventoryBid\|rejectInventoryBid\|inventory_bids" src/lib/inventory/actions.ts src/db/inventoryBids.ts | head -10
grep -n "quantity_requested\|quantityRequested" src/db/schema.ts src/db/inventoryBids.ts | head -10
grep -n "todays-bids\|TodaysBidsPanel" src/lib/layout/registry.tsx
grep -n "TodaysBidsView\|TodaysBidView" src/lib/layout/types.ts
```

Expected:
- `src/db/bids.ts`: defines `getTodaysBidsForOwner` AND the comment block at lines 166-172 explaining the trailing `AT TIME ZONE 'UTC'` fix exists.
- `src/lib/inventory/actions.ts`: exports `acceptInventoryBid` + `rejectInventoryBid`.
- `src/db/inventoryBids.ts`: exports `getInventoryBidsForItem` + `InventoryBidView` (with `quantityRequested`).
- `src/db/schema.ts`: `inventoryBids` table has `quantityRequested: integer("quantity_requested").notNull().default(1)` (slice 18b).
- `src/lib/layout/registry.tsx`: has the `todays-bids` `PanelEntry` registered.
- `src/lib/layout/types.ts`: defines `TodaysBidsView` (line ~94) and `PanelCtx.todaysBids` (line ~113).

If any of these are missing, stop — the prerequisite slices aren't all merged. Re-confirm `git log --oneline main..` shows nothing.

- [ ] **Pre-flight Step 5: Skim the spec + the slice-16 template files**

```bash
sed -n '1,100p' docs/superpowers/specs/2026-06-07-aiya-todays-inventory-bids-slice-18c-design.md
sed -n '1,80p' src/components/dashboard/TodaysBidsPanel.tsx
sed -n '90,200p' src/db/bids.ts
sed -n '85,130p' src/lib/layout/types.ts
sed -n '125,145p' src/lib/layout/registry.tsx
```

You are mirroring these files verbatim with the substitutions in spec §4.1. Read them once before starting Phase A.

---

## Phase A — Read function + truth-table tests

### Task A1: Append `TodaysInventoryBidView` type + `getTodaysInventoryBidsForOwner` to `src/db/inventoryBids.ts`

**Files:**
- Modify: `src/db/inventoryBids.ts`

- [ ] **Step 1: Open `src/db/inventoryBids.ts`.**

The file currently ends at line 95 (`getInventoryBidsForItem` closing brace). Append a new section after it. The mapper pattern follows `getInventoryBidsForItem` lines 77-94 verbatim.

- [ ] **Step 2: Append the type and function.**

Add at the end of the file (after the closing brace of `getInventoryBidsForItem`):

```ts
export type TodaysInventoryBidView = {
  bidId: number;
  inventoryItemId: number;
  inventoryItemName: string;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  quantityRequested: number;
  createdAt: Date;
};

/**
 * Slice 18c: today's PENDING inventory bids on items owned by `viewerOrgId`.
 * Mirror of slice-16's getTodaysBidsForOwner for the inventory side.
 *
 * "Today" = `created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
 *           AT TIME ZONE 'UTC'`. LIMIT 30.
 *
 * ⚠ VISIBILITY PREDICATE — mirrors the owner-side of getInventoryBidsForItem.
 * If you change "inventory_items.org_id = viewer" here, update
 * getInventoryBidsForItem + canBidOnItem (src/lib/inventory/actions.ts) at
 * the same time.
 *
 * Demo mode short-circuits to [].
 */
export async function getTodaysInventoryBidsForOwner(
  db: Db,
  viewerOrgId: number,
): Promise<TodaysInventoryBidView[]> {
  if (isDemoMode()) return [];

  // The "today UTC" cutoff is computed in three steps so both sides of the
  // >= comparison are timestamptz (never a bare timestamp). The trailing
  // `AT TIME ZONE 'UTC'` is LOAD-BEARING — don't remove it as "redundant":
  //   1. `now()`                                     → timestamptz (current UTC instant)
  //   2. `... AT TIME ZONE 'UTC'`                    → timestamp (UTC wall-clock, bare)
  //   3. `date_trunc('day', ...)`                    → timestamp (midnight UTC, bare)
  //   4. `... AT TIME ZONE 'UTC'`                    → timestamptz (midnight UTC instant)
  // Without step 4, PG implicitly converts the bare timestamp using the
  // SESSION timezone for the comparison — which can be ±12h off on a
  // non-UTC machine, silently filtering or admitting bids by the wrong day.
  // See the matching fix in src/db/bids.ts:166-172 (slice-17 Phase A
  // regression) — this is the same primitive.
  const res = await db.execute(sql`
    SELECT ib.id            AS bid_id,
           i.id             AS inventory_item_id,
           i.name           AS inventory_item_name,
           ib.bidder_org_label,
           ib.price_cents,
           ib.currency,
           ib.quantity_requested,
           ib.created_at
    FROM inventory_bids ib
    JOIN inventory_items i ON i.id = ib.inventory_item_id
    WHERE i.org_id = ${viewerOrgId}
      AND ib.status = 'pending'
      AND ib.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ORDER BY ib.created_at DESC
    LIMIT 30
  `);

  const rows = rowsOf<{
    bid_id: number;
    inventory_item_id: number;
    inventory_item_name: string;
    bidder_org_label: string;
    price_cents: number;
    currency: string;
    quantity_requested: number;
    created_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    bidId: r.bid_id,
    inventoryItemId: r.inventory_item_id,
    inventoryItemName: r.inventory_item_name,
    bidderOrgLabel: r.bidder_org_label,
    priceCents: r.price_cents,
    currency: r.currency,
    quantityRequested: r.quantity_requested,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}
```

- [ ] **Step 3: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit.**

```bash
git add src/db/inventoryBids.ts
git commit -m "$(cat <<'EOF'
feat(db): getTodaysInventoryBidsForOwner — owner-perspective inventory-bid query

Slice-18c mirror of slice-16's getTodaysBidsForOwner. Trailing
"AT TIME ZONE 'UTC'" preserved (slice-17-Phase-A regression
prevention). LIMIT 30, ORDER BY created_at DESC. Demo mode
short-circuits to []. Includes inventoryItemName + quantityRequested
in the projection so the panel can render rows without a second fetch.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Truth-table tests for `getTodaysInventoryBidsForOwner`

**Files:**
- Modify: `test/db/inventory-bids.test.ts`

- [ ] **Step 1: Read the existing file structure.**

```bash
sed -n '1,55p' test/db/inventory-bids.test.ts
wc -l test/db/inventory-bids.test.ts
```

Note the existing `seedItem(ownerOrgId, opts?)` helper at lines 19-38. We will reuse it as-is. No new helper needed.

- [ ] **Step 2: Append the new describe block.**

Add a new import at the top:

```ts
import { getInventoryBidsForItem, getTodaysInventoryBidsForOwner } from "@/db/inventoryBids";
```

(Replace the existing single-name import line. If `getInventoryBidsForItem` is currently imported on its own line, expand it into the multi-name import shown above.)

At the bottom of the file, after the last `describe(...)` block's closing brace, append:

```ts
describe("getTodaysInventoryBidsForOwner (slice 18c)", () => {
  it("returns today's pending bids on the viewer's items, joined with item.name", async () => {
    const myItemId = await seedItem(1);
    const othersItemId = await seedItem(999);
    // Today, pending, my item → INCLUDED
    await db.insert(inventoryBids).values({
      inventoryItemId: myItemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 12_300_00, quantityRequested: 1, status: "pending",
      createdAt: new Date(),
    });
    // Today, pending, OTHERS' item → EXCLUDED (not my org)
    await db.insert(inventoryBids).values({
      inventoryItemId: othersItemId, bidderOrgId: 1, bidderOrgLabel: "Me",
      priceCents: 1, quantityRequested: 1, status: "pending",
      createdAt: new Date(),
    });
    // Today, accepted, my item → EXCLUDED (status != pending)
    await db.insert(inventoryBids).values({
      inventoryItemId: myItemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1, quantityRequested: 1, status: "accepted",
      decidedAt: new Date(), createdAt: new Date(),
    });
    // 36h ago, pending, my item → EXCLUDED (not today)
    await db.insert(inventoryBids).values({
      inventoryItemId: myItemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 2, quantityRequested: 1, status: "pending",
      createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000),
    });

    const rows = await getTodaysInventoryBidsForOwner(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(12_300_00);
    expect(rows[0].bidderOrgLabel).toBe("Mehta");
    expect(rows[0].inventoryItemName).toBe("test-item");
    expect(rows[0].quantityRequested).toBe(1);
  });

  it("returns an empty array when there are no qualifying bids", async () => {
    expect(await getTodaysInventoryBidsForOwner(db, 1)).toEqual([]);
  });

  it("respects the LIMIT 30 cap on a busy day", async () => {
    const itemId = await seedItem(1);
    const rows = Array.from({ length: 35 }, (_, i) => ({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: `B${i}`,
      priceCents: 1000 + i, quantityRequested: 1, status: "pending" as const,
      createdAt: new Date(Date.now() - i * 1000),
    }));
    await db.insert(inventoryBids).values(rows);
    const out = await getTodaysInventoryBidsForOwner(db, 1);
    expect(out).toHaveLength(30);
  });

  it("returns rows newest-first", async () => {
    const itemId = await seedItem(1);
    const now = Date.now();
    await db.insert(inventoryBids).values([
      { inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "old",
        priceCents: 1, quantityRequested: 1, status: "pending",
        createdAt: new Date(now - 5 * 60_000) },
      { inventoryItemId: itemId, bidderOrgId: 888, bidderOrgLabel: "new",
        priceCents: 2, quantityRequested: 1, status: "pending",
        createdAt: new Date(now) },
    ]);
    const out = await getTodaysInventoryBidsForOwner(db, 1);
    expect(out.map((r) => r.bidderOrgLabel)).toEqual(["new", "old"]);
  });
});
```

- [ ] **Step 3: Run — expect 4 new passes.**

```bash
npx vitest run test/db/inventory-bids.test.ts --reporter=verbose 2>&1 | tail -25
```

Expected: pre-existing test count + 4 new "passed" lines under the `getTodaysInventoryBidsForOwner (slice 18c)` describe. Total file passes increases by exactly 4.

If the LIMIT-30 test fails because all 35 rows have the same `createdAt` instant and the LIMIT cut excludes a different bidder than expected: the test asserts `.toHaveLength(30)` only — there is no ordering assertion on tied timestamps, so a stable-sort assumption is not required. If it still fails, log `out.length` to confirm whether pglite is returning all 35 (would indicate the LIMIT was dropped) or some other count.

- [ ] **Step 4: Commit.**

```bash
git add test/db/inventory-bids.test.ts
git commit -m "$(cat <<'EOF'
test(db): getTodaysInventoryBidsForOwner — owner/status/today/limit truth table

Four cells per slice 18c §7.1: owner-filter, empty, LIMIT 30, newest-first.
Mirrors the slice-16 getTodaysBidsForOwner test shape with the inventory
schema substitutions (inventory_items.org_id, quantity_requested, item.name).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Phase A green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: pre-Phase-A baseline + 4 new test cases. Zero failures.

- [ ] **Step 2: tsc.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

Phase A done.

---

## Phase B — Panel component + registration + RSC wiring

### Task B1: Add `TodaysInventoryBidsView` to layout types + extend `PanelCtx`

**Files:**
- Modify: `src/lib/layout/types.ts`

- [ ] **Step 1: Read the current file.**

```bash
sed -n '1,15p' src/lib/layout/types.ts
sed -n '85,120p' src/lib/layout/types.ts
```

Note: the existing import on line 7 already pulls `BidView` + `TodaysBidView` from `@/db/bids`. We add a parallel import for the inventory equivalent.

- [ ] **Step 2: Add the import.**

Edit the import block near the top of the file. Find the existing line:

```ts
import type { BidView, TodaysBidView } from "@/db/bids";
```

Add this new import immediately after it:

```ts
import type { TodaysInventoryBidView } from "@/db/inventoryBids";
```

- [ ] **Step 3: Add the `TodaysInventoryBidsView` interface.**

Find the existing `TodaysBidsView` interface (currently lines 94-100):

```ts
export interface TodaysBidsView {
  bids: TodaysBidView[];
  actions: {
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
}
```

Add the new interface immediately after it (before `TradeNetInventoryView`):

```ts
export interface TodaysInventoryBidsView {
  bids: TodaysInventoryBidView[];
  actions: {
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
}
```

- [ ] **Step 4: Extend `PanelCtx`.**

Find the existing `PanelCtx` interface (currently lines 107-115):

```ts
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
  providerStatus?: ProviderStatusView; // slice 11
  todaysBids?: TodaysBidsView; // slice 16
  tradenetInventory?: TradeNetInventoryView; // slice 15
}
```

Add the new field right after `todaysBids`:

```ts
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
  providerStatus?: ProviderStatusView; // slice 11
  todaysBids?: TodaysBidsView; // slice 16
  todaysInventoryBids?: TodaysInventoryBidsView; // slice 18c
  tradenetInventory?: TradeNetInventoryView; // slice 15
}
```

- [ ] **Step 5: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -20
```

Expected: zero errors. (No file consumes `todaysInventoryBids` yet — it's optional — so this is the smallest possible standalone edit.)

- [ ] **Step 6: Commit.**

```bash
git add src/lib/layout/types.ts
git commit -m "$(cat <<'EOF'
feat(layout): TodaysInventoryBidsView + PanelCtx slot (slice 18c)

New interface mirrors TodaysBidsView's action shape exactly so the
panel + registry don't need a divergent action contract. PanelCtx
gains an optional todaysInventoryBids slot the page can populate;
panels render a BusinessPlaceholder fallback when absent.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Create `TodaysInventoryBidsPanel` component

**Files:**
- Create: `src/components/dashboard/TodaysInventoryBidsPanel.tsx`

- [ ] **Step 1: Read the slice-16 template.**

```bash
sed -n '1,75p' src/components/dashboard/TodaysBidsPanel.tsx
```

Slice 18c mirrors this verbatim with the substitutions from spec §4.1.

- [ ] **Step 2: Create the new component.**

Write `src/components/dashboard/TodaysInventoryBidsPanel.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import type { TodaysInventoryBidView } from "@/db/inventoryBids";
import { formatPrice, relativeTime, truncate } from "@/lib/format/bids";

export type TodaysInventoryBidsPanelProps = {
  bids: TodaysInventoryBidView[];
  actions: {
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

export function TodaysInventoryBidsPanel(props: TodaysInventoryBidsPanelProps) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div aria-label="todays inventory bids panel" className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">Today&apos;s Inventory Bids</h3>
      {actionError && (
        <p role="alert" className="text-xs text-rose-400 mb-2">{actionError}</p>
      )}
      {props.bids.length === 0 ? (
        <p className="text-xs text-zinc-500">No inventory bids today yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.bids.map((b) => (
            <li key={b.bidId} aria-label="todays inventory bid row" className="text-xs">
              <p className="text-zinc-300">
                <span className="font-semibold">{b.bidderOrgLabel}</span>
                {" bid "}<span className="text-amber-300">{formatPrice(b.priceCents, b.currency)}</span>
                {" × "}<span className="text-zinc-200">{b.quantityRequested}</span>
                {" on "}<span className="text-zinc-200">&quot;{truncate(b.inventoryItemName, 40)}&quot;</span>
              </p>
              <p className="text-zinc-500">{relativeTime(b.createdAt)}</p>
              <div className="flex gap-1 mt-1">
                <button
                  aria-label={`accept inventory bid ${b.bidId}`}
                  className="text-xs px-2 py-0.5 bg-emerald-500/80 hover:bg-emerald-500 text-zinc-900 rounded"
                  disabled={pending}
                  onClick={() => {
                    setActionError(null);
                    startTransition(async () => {
                      const res = await props.actions.acceptBid({ bidId: b.bidId });
                      if (!res.ok) setActionError(res.error);
                    });
                  }}
                >
                  Accept
                </button>
                <button
                  aria-label={`reject inventory bid ${b.bidId}`}
                  className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded"
                  disabled={pending}
                  onClick={() => {
                    setActionError(null);
                    startTransition(async () => {
                      const res = await props.actions.rejectBid({ bidId: b.bidId });
                      if (!res.ok) setActionError(res.error);
                    });
                  }}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

> **Aria-label disambiguation** — every accessible identifier on this panel is prefixed `inventory`:
> - `todays inventory bids panel` (vs. slice-16's `todays bids panel`)
> - `todays inventory bid row` (vs. slice-16's `todays bid row`)
> - `accept inventory bid <id>` (vs. slice-16's `accept bid <id>`)
> - `reject inventory bid <id>` (vs. slice-16's `reject bid <id>`)
>
> If a future test uses `screen.getByLabelText(/accept bid 42/)`, that regex matches slice-16's row by design and does NOT match slice-18c's `accept inventory bid 42` — because the slice-16 regex includes `"accept bid "` (with a trailing space before the digit), which is not a substring of `"accept inventory bid 42"`. Keep this property when extending tests. The slice-18c selectors use `/accept inventory bid /`.

- [ ] **Step 3: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 4: Commit.**

```bash
git add src/components/dashboard/TodaysInventoryBidsPanel.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): TodaysInventoryBidsPanel — right-rail inventory-bid panel

Mirror of TodaysBidsPanel for the inventory side. Row body shows
"$X × N on item-name". All aria-labels prefixed with "inventory" to
keep them disjoint from the slice-16 panel selectors when both render
on the same page. Reuses formatPrice / relativeTime / truncate from
lib/format/bids — no new helpers.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Register `todays-inventory-bids` in the panel registry

**Files:**
- Modify: `src/lib/layout/registry.tsx`

- [ ] **Step 1: Read the existing registry.**

```bash
sed -n '1,15p' src/lib/layout/registry.tsx
sed -n '125,145p' src/lib/layout/registry.tsx
```

The current `todays-bids` entry is at lines 126-139 (approximately). We add the new entry right after it.

- [ ] **Step 2: Add the import.**

Find the existing line:

```ts
import { TodaysBidsPanel } from "@/components/dashboard/TodaysBidsPanel";
```

Add this immediately after it:

```ts
import { TodaysInventoryBidsPanel } from "@/components/dashboard/TodaysInventoryBidsPanel";
```

- [ ] **Step 3: Add the `PanelEntry`.**

Find the existing `todays-bids` `PanelEntry` block (approximately lines 127-139):

```ts
  {
    id: "todays-bids",
    title: "Today's Bids",
    defaultSize: 1,
    render: (ctx) =>
      ctx.todaysBids ? (
        <TodaysBidsPanel
          bids={ctx.todaysBids.bids}
          actions={ctx.todaysBids.actions}
        />
      ) : (
        <BusinessPlaceholder title="Today's Bids" testid="panel-todays-bids" />
      ),
  },
```

Insert the new entry **directly after** the closing `},` of `todays-bids` (before `orders-pipeline`):

```ts
  {
    id: "todays-inventory-bids",
    title: "Today's Inventory Bids",
    defaultSize: 1,
    render: (ctx) =>
      ctx.todaysInventoryBids ? (
        <TodaysInventoryBidsPanel
          bids={ctx.todaysInventoryBids.bids}
          actions={ctx.todaysInventoryBids.actions}
        />
      ) : (
        <BusinessPlaceholder title="Today's Inventory Bids" testid="panel-todays-inventory-bids" />
      ),
  },
```

- [ ] **Step 4: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/layout/registry.tsx
git commit -m "$(cat <<'EOF'
feat(layout): register todays-inventory-bids PanelEntry (slice 18c)

Placed immediately after todays-bids — both are right-rail
incoming-bid aggregators. defaultSize 1 matches the slice-16
sibling. BusinessPlaceholder fallback for when the RSC hasn't
provided ctx.todaysInventoryBids.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Thread `todaysInventoryBids` through `DashboardGrid`

**Files:**
- Modify: `src/app/DashboardGrid.tsx`

- [ ] **Step 1: Read the existing grid.**

```bash
sed -n '1,50p' src/app/DashboardGrid.tsx
```

Note the exact spots where `todaysBids` appears: import (line 11), re-export (line 19), destructured arg (line 24), props type (line 31), useMemo body (line 44), useMemo deps (line 45). Each spot gets a parallel `todaysInventoryBids` mention.

- [ ] **Step 2: Extend the type import.**

Find:

```ts
import type { PanelSize, InventoryView, DiamondView, DealView, WebsiteOverviewView, ProviderStatusView, TodaysBidsView, TradeNetInventoryView } from "@/lib/layout/types";
```

Replace with (adds `TodaysInventoryBidsView`):

```ts
import type { PanelSize, InventoryView, DiamondView, DealView, WebsiteOverviewView, ProviderStatusView, TodaysBidsView, TodaysInventoryBidsView, TradeNetInventoryView } from "@/lib/layout/types";
```

- [ ] **Step 3: Extend the re-export.**

Find:

```ts
export type { InventoryView, DiamondView, DealView, WebsiteOverviewView, ProviderStatusView, TodaysBidsView, TradeNetInventoryView } from "@/lib/layout/types";
```

Replace with:

```ts
export type { InventoryView, DiamondView, DealView, WebsiteOverviewView, ProviderStatusView, TodaysBidsView, TodaysInventoryBidsView, TradeNetInventoryView } from "@/lib/layout/types";
```

- [ ] **Step 4: Extend the destructured argument list.**

Find:

```ts
export function DashboardGrid({
  inventory, diamond, deals, website, providerStatus, todaysBids, tradenetInventory,
}: {
```

Replace with:

```ts
export function DashboardGrid({
  inventory, diamond, deals, website, providerStatus, todaysBids, todaysInventoryBids, tradenetInventory,
}: {
```

- [ ] **Step 5: Extend the props type.**

Find:

```ts
  todaysBids?: TodaysBidsView;
  tradenetInventory?: TradeNetInventoryView;
```

Replace with:

```ts
  todaysBids?: TodaysBidsView;
  todaysInventoryBids?: TodaysInventoryBidsView;
  tradenetInventory?: TradeNetInventoryView;
```

- [ ] **Step 6: Extend the useMemo body + deps.**

Find:

```ts
  const ctx = useMemo(
    () => ({ inventory, diamond, deals, website, providerStatus, todaysBids, tradenetInventory }),
    [inventory, diamond, deals, website, providerStatus, todaysBids, tradenetInventory],
  );
```

Replace with:

```ts
  const ctx = useMemo(
    () => ({ inventory, diamond, deals, website, providerStatus, todaysBids, todaysInventoryBids, tradenetInventory }),
    [inventory, diamond, deals, website, providerStatus, todaysBids, todaysInventoryBids, tradenetInventory],
  );
```

- [ ] **Step 7: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 8: Commit.**

```bash
git add src/app/DashboardGrid.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): thread todaysInventoryBids through DashboardGrid (slice 18c)

Six surgical spots — import, re-export, destructure, props type,
useMemo body, useMemo deps — mirror the existing todaysBids
threading exactly. No behavioral change yet (RSC wiring lands in
the next task).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: Wire the RSC fetch + view + pass-through in `src/app/page.tsx`

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Read the existing wiring.**

```bash
sed -n '1,50p' src/app/page.tsx
sed -n '60,90p' src/app/page.tsx
sed -n '190,210p' src/app/page.tsx
```

The four spots we edit:
1. Imports block (lines ~18-44).
2. `Promise.all([...])` block (lines ~67-81) — we add a 6th sibling.
3. View construction (lines ~196-199).
4. `<DashboardGrid …/>` JSX (line ~204).

- [ ] **Step 2: Add the imports.**

Find the existing block:

```ts
import {
  getBidsForDeal,
  getDealBidModeForOwner,
  getTodaysBidsForOwner,
  type BidView,
} from "@/db/bids";
```

Add a new import immediately after it:

```ts
import { getTodaysInventoryBidsForOwner } from "@/db/inventoryBids";
```

Then find the existing inventory-action import surface. There is currently no top-level import of `acceptInventoryBid` / `rejectInventoryBid` in `page.tsx` (the slice-18b page wires its actions on the `/exchange` route, not here). Add a NEW import line after the existing `@/lib/deals/actions` import:

```ts
import { acceptInventoryBid, rejectInventoryBid } from "@/lib/inventory/actions";
```

Verify the path is correct:

```bash
grep -n "export async function acceptInventoryBid\|export async function rejectInventoryBid" src/lib/inventory/actions.ts
```

Expected: both exports exist (slice 18 added them).

- [ ] **Step 3: Extend the `Promise.all([…])` call.**

Find the existing block:

```ts
const [
  unreadByDealId,
  threadsResults,
  threadModeResults,
  bidsResults,
  bidModeResults,
  todaysBids,
] = await Promise.all([
  getUnreadCountsForOrg(db, orgId, dealIds),
  Promise.all(dealIds.map((id) => getDealMessages(db, orgId, id))),
  Promise.all(dealIds.map((id) => getDealThreadModeForOwner(db, orgId, id))),
  Promise.all(dealIds.map((id) => getBidsForDeal(db, orgId, id))),
  Promise.all(dealIds.map((id) => getDealBidModeForOwner(db, orgId, id))),
  getTodaysBidsForOwner(db, orgId),
]);
```

Replace with:

```ts
const [
  unreadByDealId,
  threadsResults,
  threadModeResults,
  bidsResults,
  bidModeResults,
  todaysBids,
  todaysInventoryBids,
] = await Promise.all([
  getUnreadCountsForOrg(db, orgId, dealIds),
  Promise.all(dealIds.map((id) => getDealMessages(db, orgId, id))),
  Promise.all(dealIds.map((id) => getDealThreadModeForOwner(db, orgId, id))),
  Promise.all(dealIds.map((id) => getBidsForDeal(db, orgId, id))),
  Promise.all(dealIds.map((id) => getDealBidModeForOwner(db, orgId, id))),
  getTodaysBidsForOwner(db, orgId),
  getTodaysInventoryBidsForOwner(db, orgId),
]);
```

- [ ] **Step 4: Construct the view object.**

Find:

```ts
  const todaysBidsView = {
    bids: todaysBids,
    actions: { acceptBid, rejectBid },
  };
  const tradenetInventory = { items: sharedInventory };
```

Replace with:

```ts
  const todaysBidsView = {
    bids: todaysBids,
    actions: { acceptBid, rejectBid },
  };
  const todaysInventoryBidsView = {
    bids: todaysInventoryBids,
    actions: {
      acceptBid: acceptInventoryBid,
      rejectBid: rejectInventoryBid,
    },
  };
  const tradenetInventory = { items: sharedInventory };
```

- [ ] **Step 5: Pass the view to `DashboardGrid`.**

Find the existing JSX:

```tsx
<DashboardGrid inventory={inventory} diamond={diamond} deals={deals} website={website} providerStatus={providerStatus} todaysBids={todaysBidsView} tradenetInventory={tradenetInventory} />
```

Replace with (single line preserved to match the file's existing style):

```tsx
<DashboardGrid inventory={inventory} diamond={diamond} deals={deals} website={website} providerStatus={providerStatus} todaysBids={todaysBidsView} todaysInventoryBids={todaysInventoryBidsView} tradenetInventory={tradenetInventory} />
```

- [ ] **Step 6: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 7: Build smoke.**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds. The home page now fetches the new query on every render — confirm Next.js doesn't complain about a dynamic-only function on a `force-dynamic` page (it shouldn't; the existing slice-16 `getTodaysBidsForOwner` runs in the same block and the page is already marked `export const dynamic = "force-dynamic"`).

- [ ] **Step 8: Commit.**

```bash
git add src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wire getTodaysInventoryBidsForOwner into RSC (slice 18c)

The 6th sibling of the slice-16 Promise.all parallelizes the new read
alongside the existing five per-deal fetches + slice-16 todaysBids
read. View object wires the slice-18 acceptInventoryBid +
rejectInventoryBid actions into the panel's action slot. Page-level
contract unchanged for all other panels.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B6: Component test `TodaysInventoryBidsPanel.test.tsx`

**Files:**
- Create: `test/components/dashboard/TodaysInventoryBidsPanel.test.tsx`

- [ ] **Step 1: Read the slice-16 template.**

```bash
sed -n '1,66p' test/components/dashboard/TodaysBidsPanel.test.tsx
```

Slice 18c adds one new case (quantity rendering) for a total of 7.

- [ ] **Step 2: Create the test file.**

Write `test/components/dashboard/TodaysInventoryBidsPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TodaysInventoryBidsPanel } from "@/components/dashboard/TodaysInventoryBidsPanel";
import type { TodaysInventoryBidView } from "@/db/inventoryBids";

const noopActions = {
  acceptBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  rejectBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
};

function row(over: Partial<TodaysInventoryBidView>): TodaysInventoryBidView {
  return {
    bidId: 1,
    inventoryItemId: 100,
    inventoryItemName: "Mehta Round 2.51ct",
    bidderOrgLabel: "AIYA Designs",
    priceCents: 168_500_00,
    currency: "USD",
    quantityRequested: 1,
    createdAt: new Date(),
    ...over,
  };
}

describe("TodaysInventoryBidsPanel", () => {
  it("renders empty state when there are no bids", () => {
    render(<TodaysInventoryBidsPanel bids={[]} actions={noopActions} />);
    expect(screen.getByText(/no inventory bids today yet/i)).toBeInTheDocument();
  });

  it("renders one row per incoming bid", () => {
    render(<TodaysInventoryBidsPanel
      bids={[
        row({ bidId: 1 }),
        row({ bidId: 2, bidderOrgLabel: "Saint-Cloud", priceCents: 42_000_00, inventoryItemName: "Padparadscha cushion" }),
      ]}
      actions={noopActions}
    />);
    expect(screen.getAllByLabelText("todays inventory bid row")).toHaveLength(2);
    expect(screen.getByText(/AIYA Designs/)).toBeInTheDocument();
    expect(screen.getByText(/Saint-Cloud/)).toBeInTheDocument();
  });

  it("Accept button click fires acceptBid", async () => {
    const actions = { ...noopActions, acceptBid: vi.fn(async () => ({ ok: true as const })) };
    render(<TodaysInventoryBidsPanel bids={[row({ bidId: 42 })]} actions={actions} />);
    fireEvent.click(screen.getByLabelText(/accept inventory bid 42/));
    await waitFor(() => expect(actions.acceptBid).toHaveBeenCalledWith({ bidId: 42 }));
  });

  it("Reject button click fires rejectBid", async () => {
    const actions = { ...noopActions, rejectBid: vi.fn(async () => ({ ok: true as const })) };
    render(<TodaysInventoryBidsPanel bids={[row({ bidId: 99 })]} actions={actions} />);
    fireEvent.click(screen.getByLabelText(/reject inventory bid 99/));
    await waitFor(() => expect(actions.rejectBid).toHaveBeenCalledWith({ bidId: 99 }));
  });

  it("truncates long item names to 40 chars", () => {
    const longName = "A".repeat(60);
    render(<TodaysInventoryBidsPanel bids={[row({ inventoryItemName: longName })]} actions={noopActions} />);
    expect(screen.getByText(/A{39}…/)).toBeInTheDocument();
  });

  it("renders alert when Accept fails", async () => {
    const actions = {
      ...noopActions,
      acceptBid: vi.fn(async () => ({ ok: false as const, error: "Forbidden — not your item" })),
    };
    render(<TodaysInventoryBidsPanel bids={[row({ bidId: 55 })]} actions={actions} />);
    fireEvent.click(screen.getByLabelText(/accept inventory bid 55/));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toMatch(/forbidden/i);
  });

  it("renders quantityRequested as × N in the row body (slice 18c)", () => {
    render(<TodaysInventoryBidsPanel
      bids={[row({ bidId: 1, quantityRequested: 5, inventoryItemName: "Marathi Princess parcel" })]}
      actions={noopActions}
    />);
    const li = screen.getByLabelText("todays inventory bid row");
    // The row body contains "× 5" between the price and "on …"
    expect(li.textContent || "").toMatch(/×\s*5/);
    expect(li.textContent || "").toMatch(/Marathi Princess parcel/);
  });
});
```

- [ ] **Step 3: Run — expect 7 passes.**

```bash
npx vitest run test/components/dashboard/TodaysInventoryBidsPanel.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: `7 passed`. If the `× 5` matcher fails due to non-breaking space or different unicode, log the row's `textContent` and adjust the regex to match the literal rendered characters.

- [ ] **Step 4: Commit.**

```bash
git add test/components/dashboard/TodaysInventoryBidsPanel.test.tsx
git commit -m "$(cat <<'EOF'
test(dashboard): TodaysInventoryBidsPanel — empty + populated + actions + truncate + alert + qty

Seven cases per slice 18c §7.2. Mirrors the slice-16 panel test
structure with the inventory aria-label prefixes; the new 7th case
covers the × N quantity rendering that's unique to slice 18c.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B7: Phase B green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -15
```

Expected: Phase A baseline + 7 new component cases = +11 cases total over pre-slice-18c baseline. Zero regressions.

- [ ] **Step 2: tsc + lint + build.**

```bash
npx tsc --noEmit 2>&1 | tail -10
npm run lint 2>&1 | tail -15
npm run build 2>&1 | tail -20
```

Expected: tsc clean; lint zero errors; build succeeds.

- [ ] **Step 3: Local demo-mode smoke check.**

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run dev &
DEV_PID=$!
# Wait for the dev server to come up. Avoid long leading sleeps — poll instead.
until curl -sf http://localhost:3000/ -o /dev/null 2>/dev/null; do sleep 2; done
curl -s http://localhost:3000/ -o /tmp/slice18c-home.html
grep -oE "Today's Bids|Today's Inventory Bids|No bids today yet|No inventory bids today yet" /tmp/slice18c-home.html | sort -u
kill $DEV_PID 2>/dev/null
```

Expected output includes both:
- `Today's Bids`
- `Today's Inventory Bids`

And both empty-state strings (`No bids today yet`, `No inventory bids today yet`) — demo mode short-circuits both reads to `[]`, so both panels render their empty states. If only one panel header appears, the registry or DashboardGrid threading is broken.

Phase B done.

---

## Phase D — Final verify + merge + deploy

(No Phase C — A + B together handle data + UI for this small slice.)

### Task D1: Full suite + lint + typecheck + build

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -20
```

Expected: pre-slice-18c baseline + 11 new cases (4 query + 7 component). Zero failures.

- [ ] **Step 2: tsc.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: Lint.**

```bash
npm run lint 2>&1 | tail -15
```

Expected: zero errors.

- [ ] **Step 4: Build.**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 5: Commit-history sanity.**

```bash
git log --oneline main..HEAD
```

Expected: ~6-8 commits (one per Phase A + Phase B task, plus optional phase-verification commits if any partial fixups happened).

---

### Task D2: Merge feature branch into main + push + verify Netlify

- [ ] **Step 1: From `.worktrees/slice-18c-todays-inventory-bids`, confirm commit history is clean.**

```bash
git log --oneline main..HEAD | wc -l
git log --oneline main..HEAD
```

Expected: ≥6 commits, none reverted.

- [ ] **Step 2: Switch to `/root` (the main worktree) and pull latest main.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git fetch origin --quiet
git pull --ff-only origin main
```

Expected: clean pull. If main has advanced past slice 18b's merge while you were implementing, the merge below will need to resolve any conflicts — they should be limited to `src/lib/layout/types.ts` and `src/app/page.tsx` if a parallel agent touched them.

- [ ] **Step 3: Merge.**

```bash
git merge --no-ff feature/slice-18c-todays-inventory-bids -m "$(cat <<'EOF'
Merge slice 18c: Today's Inventory Bids dashboard panel

Closes the inventory bidding trilogy (18 + 18b + 18c). New right-rail
panel mirrors slice-16's TodaysBidsPanel for the inventory side: shows
today's pending incoming inventory bids on items the viewer owns, with
inline Accept / Reject actions. Reuses slice-18's acceptInventoryBid +
rejectInventoryBid server actions; zero new actions, zero schema
changes, zero migrations. The trailing AT TIME ZONE 'UTC' UTC-midnight
fix is preserved verbatim (slice-17 Phase A regression history).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push.**

```bash
git push origin main
```

- [ ] **Step 5: Poll Netlify until the deploy lands.**

The slice-18c deploy is mostly server-side; the visible UI marker is the `Today's Inventory Bids` panel header which the right rail will now render in addition to slice-16's `Today's Bids`. Use it:

```bash
(
  url="https://idesign-dash-demo.netlify.app/"
  marker="Today's Inventory Bids"
  start=$(date +%s)
  deadline=$((start + 360))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(curl -sL --max-time 15 "$url" 2>/dev/null || true)
    if echo "$body" | grep -q "$marker"; then
      echo "SLICE_18C_LIVE after $(( $(date +%s) - start ))s"
      exit 0
    fi
    sleep 20
  done
  echo "TIMEOUT — slice-18c marker '$marker' not found in 6 min"
  exit 1
)
```

Run in background using the project's standard polling pattern (Monitor or `run_in_background`). Expected: marker found within ~2-3 minutes of push.

- [ ] **Step 6: Tear down the worktree + delete the feature branch.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree remove .worktrees/slice-18c-todays-inventory-bids
git branch -d feature/slice-18c-todays-inventory-bids
git push origin --delete feature/slice-18c-todays-inventory-bids 2>/dev/null || true
git worktree list
```

Expected: only the main worktree at `/root` (plus any unrelated active worktrees).

Slice 18c done. Inventory-bidding trilogy (18 + 18b + 18c) complete.

---

## Self-Review Notes (filled during writing-plans skill)

**1. Spec coverage check:**
- §2 read function → A1, A2 ✓
- §3 view type → B1 ✓
- §4 panel component + registration → B2, B3 ✓
- §5 RSC wiring → B4 (DashboardGrid prop thread), B5 (page.tsx) ✓
- §6 demo mode → A1 (`if (isDemoMode()) return [];` is the first executable line of the function) ✓
- §7 tests → A2 (4 query cases), B6 (7 component cases) ✓
- §8 file plan → 2 new files + 6 modified files exactly match the spec ✓
- §9 out-of-scope → not implemented (correct) ✓

**2. Placeholder scan:** None. Every step has either an exact command, a complete code block, or an exact textual diff instruction. No `NNNN` migration placeholder — slice 18c is migration-free.

**3. Type consistency:**
- `TodaysInventoryBidView` defined once in A1, imported in B1 (layout types), B2 (component), B6 (test).
- `TodaysInventoryBidsView` defined once in B1, consumed in B3 (registry), B4 (DashboardGrid), B5 (page.tsx).
- Action signature `{ bidId: number } → Promise<{ok:true}|{ok:false,error:string}>` is identical to slice-16's — reused exactly so the panel + registry + view types don't need a divergent action contract.

**4. Risk surface:**
- **Highest-risk implementation step:** Task A1 Step 2 — the SQL block. The trailing `AT TIME ZONE 'UTC'` is the single load-bearing primitive in this entire slice. If implementers paraphrase it ("looks redundant, removing"), the panel will silently mis-window bids by up to ±12 hours under a non-UTC session. The plan step includes the full explanatory comment block verbatim from `src/db/bids.ts:166-172` to make removal feel like a deliberate destructive edit.
- **Second risk:** Task B6 — the `× 5` quantity matcher (last test case) depends on the exact unicode multiplication sign `×` (U+00D7) the component emits. If a future renderer change inserts `<wbr>` between `×` and the digit, the regex `/×\s*5/` still matches because `\s` covers HTML whitespace; but if the literal character is replaced (e.g. with `x` or `*`), the test fails loudly. That's the intended behavior — the test is a visual contract.
- **Third risk:** Task B5 Step 3 — the action import path. `acceptInventoryBid` + `rejectInventoryBid` are in `@/lib/inventory/actions`, NOT `@/lib/deals/actions`. The verify-grep in Step 2 catches a wrong path before the typecheck does.

Plan is ready.
