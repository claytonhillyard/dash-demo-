# AIYA Dashboard — Slice 18c: Today's Inventory Bids panel — Design

**Date:** 2026-06-07
**Status:** Approved (design); implementation plan companion at `docs/superpowers/plans/2026-06-07-aiya-todays-inventory-bids-slice-18c.md`
**Builds on:**
- **Slice 18 Inventory Bidding** — the `inventory_bids` table, `bidder_org_label` denorm, the slice-18 query module `src/db/inventoryBids.ts`, and the owner-perspective SQL visibility predicate (`inventory_items.org_id = $viewerOrgId`) that gates the new read.
- **Slice 18b Inventory Bid Fulfillment** — the `inventory_bids.quantity_requested` column (INTEGER NOT NULL DEFAULT 1) the panel renders alongside price. Slice 18b just merged; this slice is the third leg of the inventory-bidding trilogy 18 + 18b explicitly named as out-of-scope-but-queued.
- **Slice 16 Bidding** — the architectural template. Slice 16 shipped `TodaysBidsPanel` + `getTodaysBidsForOwner` for the Deal Room. Slice 18c mirrors that pattern verbatim for the inventory side, including:
  - The load-bearing UTC-midnight trailing-tz fix in the WHERE clause (`date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'` — applied to `getTodaysBidsForOwner` during slice 17 Phase A and documented at `src/db/bids.ts:166-172`).
  - The `PanelEntry` + `PanelCtx` registration shape in `src/lib/layout/registry.tsx` and `src/lib/layout/types.ts`.
  - The `useTransition` + alert-on-error UI scaffold from `TodaysBidsPanel`.
  - The shared formatters in `src/lib/format/bids.ts` (`formatPrice`, `relativeTime`, `truncate`) — reused as-is, no new copy.

**Numbering note:** Slice 18 landed at `60675a4`; slice 18b landed at `3befe3c`. Slice 18c is queued in both prior specs' §13 ("Today's Inventory Bids" → "Slice 18c — parallel — already named"). Closes the trilogy.

---

## 1. Overview & Goals

Slice 18 made shared inventory items biddable. Slice 18b made the accept flow quantity-aware. Slice 18c adds the **dashboard-panel-mirror** for the inventory side — the right-rail aggregate feed of "incoming pending inventory bids today on items you own."

The panel is the owner's command-center view: a glance at today's bids on shared inventory, sortable by recency (already DESC), with inline Accept / Reject affordances. It is the symmetric counterpart to slice-16's `TodaysBidsPanel` — the only difference is `inventory_items.name` instead of `deals.subject` and `× N` (quantity) appearing in the row body.

**Goals:**

- New read function `getTodaysInventoryBidsForOwner(db, viewerOrgId)` in `src/db/inventoryBids.ts` returning `TodaysInventoryBidView[]`.
- New view type `TodaysInventoryBidView` (parallel to slice-16's `TodaysBidView`).
- New `TodaysInventoryBidsView` server-passed prop type in `src/lib/layout/types.ts` (parallel to slice-16's `TodaysBidsView`).
- New `TodaysInventoryBidsPanel` client component in `src/components/dashboard/TodaysInventoryBidsPanel.tsx`.
- New panel registration `todays-inventory-bids` in `src/lib/layout/registry.tsx`.
- RSC wiring in `src/app/page.tsx`: the page calls `getTodaysInventoryBidsForOwner` + threads `{acceptInventoryBid, rejectInventoryBid}` actions through `DashboardGrid` → `PanelCtx`.
- Truth-table tests for the read function (4 cases), component tests (5 cases), and one panel-registration smoke test.

**Non-goals (each has a named home):**

- "All my inventory bids" detail view → polish follow-up.
- Filtering / sorting controls on the panel → polish follow-up.
- Real-time updates (websocket / polling) → future infra slice.
- Notification dot on the panel header → slice 20 (Resend / activity feed).
- Outgoing-inventory-bids panel (bidder's "my pending offers across all items" view) → polish follow-up; mirror of this slice from the bidder POV. Already named in slice 18b §13.
- Demo-mode rendering of seeded bids inside the panel → see §6: the read function short-circuits to `[]` in demo mode per the slice-16 + slice-18 convention; rendering seeded bids in the panel is a future demo-shim concern.

---

## 2. Read function

### 2.1 Signature + projection

In `src/db/inventoryBids.ts`, append after the existing `getInventoryBidsForItem` definition:

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
 * Mirror of slice-16's getTodaysBidsForOwner — the inventory-side aggregate
 * read for the right-rail dashboard panel.
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
): Promise<TodaysInventoryBidView[]>;
```

### 2.2 SQL

```sql
SELECT ib.id              AS bid_id,
       i.id               AS inventory_item_id,
       i.name             AS inventory_item_name,
       ib.bidder_org_label,
       ib.price_cents,
       ib.currency,
       ib.quantity_requested,
       ib.created_at
FROM inventory_bids ib
JOIN inventory_items i ON i.id = ib.inventory_item_id
WHERE i.org_id = ${viewerOrgId}
  AND ib.status = 'pending'
  -- The trailing "AT TIME ZONE 'UTC'" re-wraps the truncated value as a
  -- timestamptz. Without it, the RHS is a timestamp WITHOUT time zone and
  -- the comparison with ib.created_at (timestamptz) uses the SESSION TZ to
  -- reinterpret it. Under a non-UTC session (e.g. PDT), the cutoff slides
  -- by the offset and bids between 00:00 UTC and session-tz-midnight are
  -- wrongly excluded. See the matching fix in getTodaysBidsForOwner
  -- (src/db/bids.ts:166-172, slice-17 Phase A regression).
  AND ib.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
ORDER BY ib.created_at DESC
LIMIT 30
```

The trailing `AT TIME ZONE 'UTC'` is **load-bearing**. The implementation MUST include the explanatory comment block above the `AND ib.created_at >= …` line, copied verbatim from `src/db/bids.ts`. The slice-16 / slice-17 regression history is the reason it exists.

### 2.3 Mapping (snake_case → camelCase)

The result mapper follows the existing slice-18 `rowsOf<T>` + `r.field instanceof Date ? r.field : new Date(r.field)` pattern (matches `getInventoryBidsForItem` lines 64-95 verbatim). No new helper.

### 2.4 Demo-mode short-circuit

The very first executable line of the function:

```ts
if (isDemoMode()) return [];
```

Identical to `getInventoryBidsForItem` (line 52) and `getTodaysBidsForOwner` (line 147). The panel will render its empty state ("No inventory bids today yet") under the Netlify demo. Rendering authored seed bids in demo mode is **out of scope** — see §6.

---

## 3. View type (layout-level)

In `src/lib/layout/types.ts`, after the existing `TodaysBidsView` interface (line 94), add:

```ts
import type { TodaysInventoryBidView } from "@/db/inventoryBids";

export interface TodaysInventoryBidsView {
  bids: TodaysInventoryBidView[];
  actions: {
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
}
```

The action signature is intentionally **identical** to slice-16's `TodaysBidsView.actions`. The two panels' actions occupy disjoint id-spaces (deal bids vs. inventory bids) so the shared signature is safe — the wiring in `src/app/page.tsx` passes the inventory variants (`acceptInventoryBid`, `rejectInventoryBid`) into this slot, while the slice-16 panel keeps its `acceptBid`, `rejectBid` (deal variants).

Then extend `PanelCtx` (line 107-115):

```ts
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
  providerStatus?: ProviderStatusView; // slice 11
  todaysBids?: TodaysBidsView;          // slice 16
  todaysInventoryBids?: TodaysInventoryBidsView; // slice 18c
  tradenetInventory?: TradeNetInventoryView; // slice 15
}
```

`DashboardGrid` (in `src/app/DashboardGrid.tsx`) also gains a `todaysInventoryBids?: TodaysInventoryBidsView` prop in both the type and the `useMemo(ctx, …)` deps array — same shape as `todaysBids`.

---

## 4. Panel component + registration

### 4.1 `TodaysInventoryBidsPanel`

New file: `src/components/dashboard/TodaysInventoryBidsPanel.tsx`. Mirrors `TodaysBidsPanel` verbatim with three substitutions:

| Slice 16 `TodaysBidsPanel` | Slice 18c `TodaysInventoryBidsPanel` |
|---|---|
| `aria-label="todays bids panel"` | `aria-label="todays inventory bids panel"` |
| `<h3>Today's Bids</h3>` | `<h3>Today's Inventory Bids</h3>` |
| `<p>No bids today yet</p>` | `<p>No inventory bids today yet</p>` |
| Row body: `{label} bid {price} on "{dealSubject}"` | Row body: `{label} bid {price} × {qty} on "{itemName}"` |
| `aria-label="todays bid row"` | `aria-label="todays inventory bid row"` |
| Uses `formatPrice`, `relativeTime`, `truncate` from `@/lib/format/bids` | Same — reuse the existing module |

Full component shape (~75 lines, mirroring `src/components/dashboard/TodaysBidsPanel.tsx`):

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

Note the **aria-label disambiguation**: every accessible identifier on this panel is prefixed `inventory` (`todays inventory bids panel`, `todays inventory bid row`, `accept inventory bid <id>`, `reject inventory bid <id>`). This is load-bearing for the `DealRoomPanel` + `TodaysBidsPanel` siblings — if both panels render on the same page, the slice-16 component tests' `screen.getByLabelText(/accept bid 42/)` selector must not collide with slice-18c's `accept inventory bid 42`. The `/accept bid /` regex must not match `/accept inventory bid /` — chosen wording satisfies this (`accept bid` ≠ `accept inventory bid`).

### 4.2 Registration in `src/lib/layout/registry.tsx`

Add import after the existing `TodaysBidsPanel` import (line 10):

```ts
import { TodaysInventoryBidsPanel } from "@/components/dashboard/TodaysInventoryBidsPanel";
```

Add a new `PanelEntry` immediately after the existing `todays-bids` entry (around line 139):

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

Placement: directly after `todays-bids`. This is the right adjacency — both panels are right-rail incoming-bid aggregators. The `defaultLayout()` derives ordering from `PANEL_REGISTRY` insertion order, so the registry edit is the only place that controls "new panel appears after Today's Bids."

---

## 5. RSC wiring

In `src/app/page.tsx`:

### 5.1 Imports

Add the new query + the inventory bid actions next to the existing slice-16 imports:

```ts
import { getTodaysInventoryBidsForOwner } from "@/db/inventoryBids";
import { acceptInventoryBid, rejectInventoryBid } from "@/lib/inventory/actions";
```

### 5.2 Query call

Inside the existing `await Promise.all([…])` block (lines 67-81) that already runs `getTodaysBidsForOwner` in parallel, add a 6th sibling call:

```ts
const [
  unreadByDealId,
  threadsResults,
  threadModeResults,
  bidsResults,
  bidModeResults,
  todaysBids,
  todaysInventoryBids,  // ← new
] = await Promise.all([
  getUnreadCountsForOrg(db, orgId, dealIds),
  Promise.all(dealIds.map((id) => getDealMessages(db, orgId, id))),
  Promise.all(dealIds.map((id) => getDealThreadModeForOwner(db, orgId, id))),
  Promise.all(dealIds.map((id) => getBidsForDeal(db, orgId, id))),
  Promise.all(dealIds.map((id) => getDealBidModeForOwner(db, orgId, id))),
  getTodaysBidsForOwner(db, orgId),
  getTodaysInventoryBidsForOwner(db, orgId),  // ← new
]);
```

### 5.3 View construction

After the existing `todaysBidsView` declaration (lines 196-199), add:

```ts
const todaysInventoryBidsView = {
  bids: todaysInventoryBids,
  actions: {
    acceptBid: acceptInventoryBid,
    rejectBid: rejectInventoryBid,
  },
};
```

### 5.4 Pass-through to `DashboardGrid`

Extend the existing `<DashboardGrid … />` JSX (line 204) with one new prop:

```tsx
<DashboardGrid
  inventory={inventory}
  diamond={diamond}
  deals={deals}
  website={website}
  providerStatus={providerStatus}
  todaysBids={todaysBidsView}
  todaysInventoryBids={todaysInventoryBidsView}
  tradenetInventory={tradenetInventory}
/>
```

(Formatting may stay on the existing single line per the file's prevailing style — the example above is wrapped for readability.)

### 5.5 `DashboardGrid` type extension

In `src/app/DashboardGrid.tsx`:
- Add `TodaysInventoryBidsView` to the existing `import type { … } from "@/lib/layout/types"` block (line 11).
- Add to the existing re-export `export type { … } from "@/lib/layout/types"` (line 19).
- Add `todaysInventoryBids?: TodaysInventoryBidsView` to the props type (line 31).
- Add to the destructured argument list + the `useMemo` ctx object + deps array (lines 24, 43-46).

The pattern matches `todaysBids` exactly — replace `todaysBids` with `todaysInventoryBids` in the same five locations.

---

## 6. Demo mode

### 6.1 Read function short-circuits to `[]`

Per the slice-16 + slice-18 convention, `getTodaysInventoryBidsForOwner` checks `isDemoMode()` first and returns `[]`. The panel renders its empty state in the live Netlify demo. This is consistent with how `getTodaysBidsForOwner` behaves (the slice-16 panel also shows "No bids today yet" under demo mode, even though `DEMO_BIDS` exists as an authored constant).

### 6.2 No demo-shim helper required

Slice 16's `DEMO_BIDS` constant is authored-only and never reaches the `TodaysBidsPanel` — the panel always receives `[]` in demo mode. Slice 18c follows the **same** shape: no `getSeedTodaysInventoryBidsForOwner(orgId)` helper is added in this slice.

Rationale:
- Slice 18 already has `DEMO_INVENTORY_BIDS` (3 bids — items 601, 602, 603) authored in `src/lib/demo/seed.ts:562-596`. If a future "demo-shim" slice adds inline rendering, the constant is the source of truth.
- Adding the helper now (without a renderer that consumes it) is YAGNI and contradicts the slice-16 convention this trilogy mirrors.
- The panel still **renders** in demo mode — it just shows the empty state. This is enough for the Netlify reviewer to see the panel exists, that it has a title, and that the right-rail layout includes it.

If a future slice adds demo-mode rendering of the seeded bids, the implementation will be:
1. Add `getSeedTodaysInventoryBidsForOwner(orgId): TodaysInventoryBidView[]` to `src/lib/demo/seed.ts` filtering `DEMO_INVENTORY_BIDS` by owner.
2. Change the RSC wiring in `src/app/page.tsx` to branch on `isDemoMode()` and use the seed helper. (Symmetric change in slice 16 would happen at the same time.)

Out of scope for slice 18c. The TODO note at `src/lib/demo/seed.ts:553-560` already records the convention.

---

## 7. Tests

### 7.1 Truth-table for `getTodaysInventoryBidsForOwner`

New describe block appended to `test/db/inventory-bids.test.ts`:

```ts
describe("getTodaysInventoryBidsForOwner (slice 18c)", () => {
  it("returns today's pending bids on the viewer's items, joined with item.name", async () => {
    const myItemId = await seedItem(1);              // owner=1
    const othersItemId = await seedItem(999);        // owner=999
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

Test count: **4 cases**.

### 7.2 Component test for `TodaysInventoryBidsPanel`

New file `test/components/dashboard/TodaysInventoryBidsPanel.test.tsx`. Mirrors `test/components/dashboard/TodaysBidsPanel.test.tsx` (which has 6 cases) with one extra case for the `× N` quantity rendering:

1. Empty state renders "No inventory bids today yet".
2. Populated state renders one `<li aria-label="todays inventory bid row">` per bid.
3. Accept button click fires `acceptBid({ bidId })`.
4. Reject button click fires `rejectBid({ bidId })`.
5. Long `inventoryItemName` truncates to 40 chars + ellipsis.
6. Failure path renders `<p role="alert">` with the error message.
7. **New for 18c:** `quantityRequested` renders as `× N` in the row body (e.g. `× 5`).

Test count: **7 cases**.

### 7.3 No new migration smoke test

Slice 18c adds **no** schema changes — pure read + UI slice. The existing `test/db/inventory-bids-migration-smoke.test.ts` (slice 18 + 18b) already asserts the columns `getTodaysInventoryBidsForOwner` consumes (`bidder_org_label`, `price_cents`, `quantity_requested`, `created_at`).

### 7.4 No registry smoke test

The existing layout `Dashboard.test.tsx` is already responsible for the `getEffectiveLayout()` round-trip. Adding `todays-inventory-bids` to `PANEL_REGISTRY` is covered by the registry-level test that asserts every entry has `{id, title, defaultSize, render}` (if it exists). If the project doesn't have one, no new test — the registration is a 12-line addition with no branching and is exercised by every page render.

**Total new tests: 4 + 7 = 11 cases.**

---

## 8. File plan

### New files

| Path | Purpose |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/TodaysInventoryBidsPanel.tsx` | The new right-rail panel component |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/dashboard/TodaysInventoryBidsPanel.test.tsx` | 7 component cases per §7.2 |

### Modified files

| Path | Reason |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/inventoryBids.ts` | Append `TodaysInventoryBidView` + `getTodaysInventoryBidsForOwner` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/types.ts` | Add `TodaysInventoryBidsView` + `PanelCtx.todaysInventoryBids` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/registry.tsx` | Add `todays-inventory-bids` entry + import |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/DashboardGrid.tsx` | Add `todaysInventoryBids` prop + ctx threading |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/page.tsx` | Call `getTodaysInventoryBidsForOwner`, construct view, pass to `DashboardGrid` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/db/inventory-bids.test.ts` | Append 4 truth-table cases per §7.1 |

### Removed files

None.

### Migration

None. Slice 18c is a pure read + UI slice. `inventory_bids.quantity_requested` already shipped in slice 18b's migration.

---

## 9. Out of Scope (explicit, named)

| Feature | Assigned to |
|---|---|
| "All my inventory bids" detail view (paginated, cross-item) | Polish follow-up |
| Filter / sort controls on the panel (by price, by bidder, by item) | Polish follow-up |
| Real-time updates (websocket / SSE / polling refresh) | Future infra slice |
| Notification dot on the panel header ("N new since you last looked") | Slice 20 (Resend) or notification-state slice |
| Outgoing-inventory-bids panel (bidder's "my pending offers" cross-item view) | Polish follow-up — mirror of slice 18c from bidder POV (already named in slice 18b §13) |
| Demo-mode rendering of seeded `DEMO_INVENTORY_BIDS` inside the panel | Future demo-shim slice (would update both slice 16 + slice 18c at once for parity) |
| Quantity-aware visual badge (e.g. "5 / 50 available") in the panel row | Polish — current row text shows `× 5` quantity but not the item's remaining stock |
| Per-bid notes preview in the panel row | Polish — current row hides `notes`; click-through to InventoryBidsTab to read |
| Click-through to open the item's BidsTab drawer | Polish — currently buttons are inline-only; no navigation |
| Cross-tenant aggregation ("today's bids across all my orgs") | Out of scope — multi-org per user is not in the auth model |
| Currency normalization / FX | Polish — same posture as slice 16 (notes deferred this) |

---

## Design summary table

| Concern | Choice |
|---|---|
| Read function | `getTodaysInventoryBidsForOwner(db, orgId)` in `src/db/inventoryBids.ts` |
| Visibility predicate | SQL-enforced `inventory_items.org_id = $viewerOrgId` (owner-only by construction) |
| Time-window | UTC start-of-day; trailing `AT TIME ZONE 'UTC'` is load-bearing (slice-17 regression history) |
| LIMIT | 30 — same as slice 16 |
| Quantity field | `quantityRequested` rendered as `× N` in the row body |
| Demo mode | `isDemoMode()` short-circuits to `[]` at the top of the read function |
| Panel id | `todays-inventory-bids` (registered immediately after `todays-bids`) |
| Action wire-up | Reuses `acceptInventoryBid` + `rejectInventoryBid` from slice 18; ZERO new server actions |
| Aria disambiguation | All accessible labels prefixed `inventory` to avoid colliding with slice-16's `TodaysBidsPanel` selectors |
| Migration | None — pure read + UI |
| Tests | 4 query cases + 7 component cases = 11 new test cases |
| Security posture | Identical to slice 18 — owner-only by SQL predicate; defense-in-depth not needed (read-only path) |
