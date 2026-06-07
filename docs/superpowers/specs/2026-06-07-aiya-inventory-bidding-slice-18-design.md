# AIYA Dashboard — Slice 18: Inventory Bidding — Design

**Date:** 2026-06-07
**Status:** Approved (design); implementation plan companion at `docs/superpowers/plans/2026-06-07-aiya-inventory-bidding-slice-18.md`
**Builds on:**
- **Slice 16 Bidding** — `bids` table, the five `runWithUser`-wrapped bid actions (`postBid`, `acceptBid`, `rejectBid`, `withdrawBid`, `setDealBidMode`), the `BidView` projection shape, the atomic accept-+-auto-reject-siblings pattern, and the SQL-enforced bidder-OR-owner visibility predicate. This slice is the **inventory mirror** of slice 16.
- **Slice 15 TradeNet Inventory** — `inventory_items.visibility_circle_id`, the `getSharedInventoryForOrg` helper, the `/exchange` route + `TradeNetInventoryList` + `TradeNetInventoryPanel`, and the "what partners are offering" framing.
- **Slice 4 Circles** — `isOrgMemberOfCircle` (slice 4 §6 / now in `src/lib/circles/membership.ts`) is the load-bearing "can this org see this circle-shared inventory item?" primitive that slice 18 reuses for write authz.
- **Slice 3 Multi-Tenant Foundation** — every tenancy invariant is preserved verbatim: `orgId` is session-resolved (never wire), and every UPDATE includes a defense-in-depth `WHERE … AND <session-org-id> matches` clause.
- **Slice 10 Deal Reply Threads** — denormalized `*_org_label` snapshot convention; `runWithUser` + `ForbiddenError` pattern; the recent timezone-fix discipline on `getTodaysBidsForOwner` carries through (slice 18 does **not** ship a daily-bids panel — see §13).

**Numbering note:** Slice 17 (Deal Photos) ships on a parallel agent. Slice 18 touches inventory bidding only; the two slices intentionally land on different surfaces and share no schema or component dependencies.

---

## 1. Overview & Goals

Slice 15 turned each org's per-org inventory ledger into a circle-shareable surface — partners can see each other's inventory on `/exchange` and the `TradeNetInventoryPanel`. Slice 18 closes the trade loop by adding **structured price offers (bids) on shared inventory items** — the inventory mirror of slice 16's Deal Room bidding.

A partner who can see a shared inventory item can now submit a binding price for it; the owning org can accept (atomic transaction: bid → `accepted`, sibling pending bids → `auto_rejected`) or reject the offer. The item itself never moves — there's no stock-deduction primitive in this slice; **bidding is purely a price-negotiation surface**. Whether an accepted bid leads to inventory transfer / reservation / sale is a downstream concern (see §13 Out of Scope).

The slice ships:

- One new `inventory_bids` table with the full slice-16 lifecycle (`pending` / `accepted` / `rejected` / `withdrawn` / `auto_rejected`).
- One new column on `inventory_items` — `bid_mode` text NULL — owner's per-item bidding toggle. **Null means bidding is disabled** for the item; a non-null value (`"single"` / `"history"`) means bidding is on AND it doubles as a display-mode preference (mirrors slice-16's per-deal toggle). Default is `NULL` so every existing slice 1b-1 / 15 row has bidding off — opt-in only.
- Five `runWithUser`-wrapped server actions in `src/lib/inventory/actions.ts` (parallel to slice-16's deal actions, but on the inventory subsystem):
  - `postInventoryBid({ inventoryItemId, priceCents, currency?, notes? })`
  - `acceptInventoryBid({ bidId })` — atomic accept + sibling-bid sweep
  - `rejectInventoryBid({ bidId })`
  - `withdrawInventoryBid({ bidId })` — idempotent
  - `setInventoryItemBidMode({ inventoryItemId, mode })` — owner-only; `mode` is `"single"` | `"history"` | `null` (null disables bidding).
- One new read in `src/db/inventory.ts`: `getInventoryBidsForItem(db, viewerOrgId, inventoryItemId)` — SQL-enforced `bidder_org_id = viewer OR inventory_items.org_id = viewer` (the slice-16 visibility shape, ported to inventory).
- Two UI affordances on the inventory subsystem:
  - **`/exchange`** `TradeNetInventoryList` rows gain a **"Place Bid"** button when `bid_mode !== null` AND `inventoryItems.orgId !== viewerOrgId`.
  - A new **`InventoryBidsTab`** component (modal or drawer) lists bids visible to the viewer + owner/bidder actions. Mirrors slice-16's `DealBidsTab` in shape.
- One new owner toggle on **`/inventory`** admin per row — `Bidding: [Off | Single | History]` — calls `setInventoryItemBidMode`.
- Demo seed: 2 pending `inventory_bids` from AIYA on partner items 601 (Mehta Round) and 602 (Saint-Cloud Cushion); and item 601's `bid_mode` set to `"single"` so the demo `/exchange` row clearly shows the **Place Bid** button.

**Explicitly not in this slice:** "Today's Inventory Bids" right-rail panel (slice 18c), reverse-auction / Dutch-style flows, bid expiration cron, counter-offer linkage, per-circle bid visibility, audit log of bid acceptance.

**Goal posture:** every slice-3 tenancy invariant + every slice-15 visibility invariant + every slice-16 bidding invariant is preserved. The only NEW security risk is "can a partner bid on an item they can't see?" — answered by reusing slice-15's `getSharedInventoryForOrg`-style visibility predicate inside `canBidOnItem` (§4).

---

## 2. Schema

### 2.1 New table: `inventory_bids`

```ts
// src/db/schema.ts — append below the existing `bids` table definition
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

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `inventory_item_id` | int NOT NULL → `inventory_items.id` ON DELETE CASCADE | If the item is deleted, its bids vanish with it (same posture as `bids.deal_id` from slice 16). |
| `bidder_org_id` | int NOT NULL → `orgs.id` | |
| `bidder_org_label` | text NOT NULL | **Denormalized snapshot at send time** (slice-10 / slice-16 convention). The viewer sees the bidder's label as-of bid time, even if `orgs.name` later changes. |
| `price_cents` | int NOT NULL | Always positive (Zod-enforced); the action layer treats `0` as invalid. |
| `currency` | text NOT NULL default `'USD'` | Same short-enum-at-Zod-layer discipline as slice 16. |
| `notes` | text NULL | Optional, ≤500 chars (Zod-capped). Plain-text rendering only. |
| `status` | text NOT NULL default `'pending'` | enum `pending` \| `accepted` \| `rejected` \| `withdrawn` \| `auto_rejected`. |
| `decided_at` | timestamptz NULL | Set when status moves off `pending`. |
| `created_at` | timestamptz NOT NULL default `now()` | |

**No `bid_mode` snapshot column.** Slice 16 carries a per-row `bid_mode` snapshot (`single` / `history`) for audit ("which display mode was active when this row was sent?"); slice 18 deliberately omits it. Reasoning: per-item bid_mode is OWNER-controlled and ONLY affects rendering on the InventoryBidsTab. The snapshot in slice 16 was already audit-only (didn't affect render); slice 18 drops it as YAGNI — current `inventory_items.bid_mode` is the source of truth for render-time decisions, and historical "what was the mode when this bid was sent?" carries zero product value. If a future audit slice needs it, adding the column is purely additive.

### 2.2 New column on `inventory_items`: `bid_mode`

```ts
// modify the existing inventoryItems pgTable definition
export const inventoryItems = pgTable(
  "inventory_items",
  {
    // … existing columns unchanged …
    visibilityCircleId: integer("visibility_circle_id").references(
      () => circles.id,
      { onDelete: "set null" },
    ),
    bidMode: text("bid_mode", { enum: ["single", "history"] }), // NULLABLE — null = bidding off
    // … existing createdAt / updatedAt unchanged …
  },
  // … existing indexes unchanged; no new index on bid_mode (read paths
  // filter on inventoryItemId, not bid_mode; bid_mode is a render-time gate
  // only). …
);
```

| Column | Type | Notes |
|---|---|---|
| `bid_mode` | text NULLABLE, enum `'single'` \| `'history'` | `NULL` = **bidding disabled** for this item (the default for every existing row + every new row unless the owner explicitly enables). Non-null = bidding is on, and the value doubles as the InventoryBidsTab's display preference. |

**Why nullable instead of three-valued non-null enum (`'off' / 'single' / 'history'`)?** Two reasons:

1. **Defaulting is honest.** A NULLABLE column with no default makes every existing row's bidding state unambiguously "off" without picking a sentinel value. A `'off'` default would be a small lie ("the owner has explicitly opted out") — they haven't; they predate the column.
2. **Parallel construction with slice 15.** `inventory_items.visibility_circle_id` is also NULLABLE (null = private, non-null = shared into circle X). Slice 18's `bid_mode` mirrors that shape: null = disabled, non-null = enabled-with-mode. Two columns, both nullable, both expressing "off vs. one of N modes" in the same idiom. Future readers don't have to learn two patterns.

**Migration consequence:** every existing inventory row gets `NULL` (bidding off). No backfill needed. Opt-in only.

### 2.3 No CHECK constraint for the self-bid block

The brief raised "self-bid block: SQL-level CHECK vs. action-level — pick one". This spec **chooses action-level**. Reasoning:

- **CHECK constraints on cross-row predicates are painful in PG.** A CHECK that says "`inventory_bids.bidder_org_id !== inventory_items.org_id`" would require a subquery or a trigger; PG CHECK constraints don't accept subqueries directly. Triggers add operational surface for a single rule that's trivially enforced at the action layer.
- **The action layer already owns visibility + bid_mode gates.** Self-bid is one of three preconditions in `canBidOnItem`. Folding it into the same gate is more readable than a CHECK that asserts a subset of those preconditions.
- **Tests catch it the same way either way.** A truth-table test in §9 asserts the rejection with zero inserted rows. Whether the rejection mechanism is a Zod fail, a `ForbiddenError`, or a DB CHECK failure makes no operational difference to the test.

The action enforces the rule in `canBidOnItem` (§4.2). If a future bug bypasses `canBidOnItem` and tries to insert a self-bid row directly, defense-in-depth catches it at no other layer — but the slice-3-style `WHERE org_id = sessionOrgId` discipline doesn't apply here (the insert is into `inventory_bids`, not `inventory_items`; the row's bidder_org_id is the session org by construction). Acceptable. The test suite is the regression guard.

### 2.4 Migration `drizzle/0012_*.sql`

Generated by `npm run db:generate` after the schema edit. Expected file contents:

1. `CREATE TABLE "inventory_bids" ( … );`
2. `ALTER TABLE "inventory_items" ADD COLUMN "bid_mode" text;`
3. `CREATE INDEX "inventory_bids_item_created_idx" ON "inventory_bids" ("inventory_item_id", "created_at" DESC);`
4. `CREATE INDEX "inventory_bids_bidder_created_idx" ON "inventory_bids" ("bidder_org_id", "created_at" DESC);`
5. `CREATE INDEX "inventory_bids_pending_by_item_idx" ON "inventory_bids" ("inventory_item_id", "status") WHERE "status" = 'pending';`

**Schema-only header** (same convention as slices 4, 4c, 15, 16):

```sql
-- schema-only; no seed data in this migration.
-- inventory_items.bid_mode starts NULL for every existing row (bidding off).
-- Demo seeds live in src/lib/demo/seed.ts and never touch the DB.
-- See docs/superpowers/plans/2026-06-07-aiya-inventory-bidding-slice-18.md.
```

**Migration order dependency:** `0012_*.sql` runs against a DB that has `0004_*.sql` (orgs), `0005_*.sql` (circles), `0011_*.sql` (slice-15 inventory_items.visibility_circle_id) all applied. The new FK `inventory_bids.inventory_item_id → inventory_items.id` is referentially valid because slice 1b-1 long since created `inventory_items`.

**Rollback:** `DROP TABLE inventory_bids; ALTER TABLE inventory_items DROP COLUMN bid_mode;`. Safe; tenanted data untouched.

### 2.5 Demo seed deltas

Two pending `inventory_bids` rows appended to `src/lib/demo/seed.ts` after `DEMO_BIDS`:

```ts
export interface SeedInventoryBid {
  inventoryItemId: number;    // demo-only ids in the 601-603 range from slice 15
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  status: "pending";
  createdAtOffsetMinutes: number;
}

export const DEMO_INVENTORY_BIDS: SeedInventoryBid[] = [
  {
    inventoryItemId: 601, // Mehta Round 2.51ct
    bidderOrgId: DEMO_AIYA_ORG_ID,
    bidderOrgLabel: "AIYA Designs",
    priceCents: 168_500_00,
    currency: "USD",
    notes: "Firm. 7-day inspection window.",
    status: "pending",
    createdAtOffsetMinutes: 40,
  },
  {
    inventoryItemId: 602, // Saint-Cloud Cushion Padparadscha
    bidderOrgId: DEMO_AIYA_ORG_ID,
    bidderOrgLabel: "AIYA Designs",
    priceCents: 42_000_00,
    currency: "USD",
    notes: null,
    status: "pending",
    createdAtOffsetMinutes: 12,
  },
];

/** Demo-only: which inventory items have bidding enabled, and in which mode.
 *  Mirrors `getSeedSharedInventoryRows` in shape but expresses the bid-mode
 *  layer. Item 601 has bidding ON in single mode so the demo /exchange row
 *  shows the Place Bid button. The other two seed items stay null (bidding
 *  off) so the UI demonstrates the OPT-IN-only default. */
export function getSeedInventoryBidModes(): Map<number, "single" | "history" | null> {
  return new Map<number, "single" | "history" | null>([
    [601, "single"],
    [602, null],
    [603, null],
  ]);
}
```

Both bids `status: "pending"`. The seed helpers + bid_mode map are authored — see §6 of slice 15 for the analogous "authored-only" demo posture. The Netlify demo never boots pglite; reads short-circuit to seeds. Writes return `{ ok: false, error: "Demo mode — changes are disabled" }`.

---

## 3. Visibility model

A `inventory_bids` row is visible to exactly two orgs:

- The item owner — `inventory_items.org_id`
- The bidder — `inventory_bids.bidder_org_id`

This is true regardless of `inventory_items.visibility_circle_id`. **Bidding visibility is intentionally decoupled from circle visibility** — the same architectural choice slice 16 made for deal bids vs. `thread_mode`. Reasoning:

- Slice 15's circle visibility lets every member of the circle SEE the item exists. Surfacing a partner's price offer to other partners in the same circle would undermine the negotiation primitive bidding is designed to enable.
- The owner needs to see every bid (it's their item). The bidder needs to see their own bids (it's their offer history). No one else has a legitimate read.

Enforcement is in SQL inside `getInventoryBidsForItem`:

```sql
WHERE (ib.bidder_org_id = $viewerOrgId OR i.org_id = $viewerOrgId)
```

**No application-layer filtering.** This is a slice-3 / slice-4 / slice-16 invariant: the truth-table test in §9 covers the full {viewer = bidder, viewer = owner, viewer = third-party-in-circle, viewer = stranger} matrix and asserts the SQL filters correctly on every cell.

### 3.1 Display-mode rendering

`inventory_items.bid_mode` is the owner's CURRENT display preference AND the on/off switch.

- `NULL` → bidding disabled. The `InventoryBidsTab` doesn't render for the item; the "Place Bid" button does not appear on `/exchange`; `postInventoryBid` rejects with `Forbidden`.
- `"single"` → bidding enabled; owner view shows one row per bidder (latest pending), with `[Show history (N)]` disclosure.
- `"history"` → bidding enabled; owner view shows all bids chronologically.

The bidder view is mode-agnostic (bidders see only their own bids, always chronologically).

Mode-flip never mutates rows. Append-only data layer — same posture as slice 16. The `bid_mode` column controls **rendering**, not data. Flipping `bid_mode` from `"single"` to `null` (disable bidding) does **not** retroactively withdraw pending bids — they remain in the table; the owner can still accept or reject them; partners simply can't submit new ones. This decoupling avoids destructive UX (a thumb-fumble shouldn't auto-reject 5 pending bids). The §9 test asserts this.

---

## 4. Authz rules — server-enforced via `runWithUser`

All five actions live in `src/lib/inventory/actions.ts` alongside the existing slice 1b-1 / 15 actions, and route through the existing `run(...)` wrapper. The wrapper already maps `ForbiddenError → { ok: false, error: "Forbidden" }` (slice 15 added this), and already short-circuits in demo mode + on session failure. **The five new actions reuse `run` verbatim** — no new wrapper is needed.

### 4.1 `canBidOnItem(db, orgId, inventoryItemId)` — the load-bearing gate

The slice-18 counterpart of slice-16's `canBidOn(d, orgId, dealId)`. Three preconditions, evaluated in order. **All three must pass** before `postInventoryBid` inserts a row.

```ts
async function canBidOnItem(
  d: Db,
  orgId: number,
  inventoryItemId: number,
): Promise<
  | {
      ok: true;
      ownerOrgId: number;
      bidMode: "single" | "history"; // narrowed: known non-null on success
      visibilityCircleId: number | null;
    }
  | { ok: false }
> {
  // Single read: item ownership + bid_mode + visibility_circle_id in one shot.
  const [row] = await d
    .select({
      ownerOrgId: inventoryItems.orgId,
      bidMode: inventoryItems.bidMode,
      visibilityCircleId: inventoryItems.visibilityCircleId,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, inventoryItemId))
    .limit(1);
  if (!row) return { ok: false };                          // item doesn't exist
  if (row.ownerOrgId === orgId) return { ok: false };      // self-bid block
  if (row.bidMode === null) return { ok: false };          // bidding disabled
  // Visibility — viewer must be able to SEE the item per slice-15 visibility.
  // Own-org items already excluded by the self-bid check; only circle-shared
  // items remain. Null visibility_circle_id with non-owner viewer = unreachable
  // (item is private to owner; owner is excluded above; therefore Forbidden).
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
```

**Three rejection cells** (each Zero-DB-write by construction since rejection precedes the INSERT):

| Cell | Reason | Rejection |
|---|---|---|
| Item doesn't exist | `row` is undefined | `Forbidden` (defense against id-guessing; never leak existence via a different error) |
| Caller is the owner | `row.ownerOrgId === orgId` | `Forbidden` (self-bid block — you can't bid on your own item) |
| Bidding disabled | `row.bidMode === null` | `Forbidden` (owner hasn't opted in) |
| Item is private (no circle) | `row.visibilityCircleId === null` | `Forbidden` (can't see + can't bid; same as slice 15) |
| Viewer not in the item's circle | `isOrgMemberOfCircle` returns false | `Forbidden` (can't see → can't bid) |

**Order matters.** Self-bid check before bid-mode check before visibility check. A self-bidder gets the same `Forbidden` whether or not bidding is enabled — no information leak. A non-member of the circle gets the same `Forbidden` whether or not bid_mode is set — no information leak.

The slice-18 visibility predicate is stricter than slice-15's. Slice 15 lets every circle member SEE the item. Slice 18 requires `canBidOnItem` to confirm:
1. visibility (same as slice 15 — viewer is in the item's circle)
2. PLUS bid_mode is non-null
3. PLUS caller is not the owner

This is by design — every additional gate makes the "Place Bid" button on `/exchange` honest (it appears only when ALL three are satisfied).

### 4.2 Per-action authz table

| Action | Caller must be | Other preconditions | Effect |
|---|---|---|---|
| `postInventoryBid` | A non-owner who can see the item | `bid_mode !== null` AND `isOrgMemberOfCircle(caller, item.visibility_circle_id)` | INSERT `inventory_bids` row with `status='pending'` and the bidder's denormalized org label |
| `acceptInventoryBid` | The item owner | Bid status is `pending` | **Atomic transaction:** this bid → `accepted`; sibling pending bids on the same item → `auto_rejected`. The item itself is untouched (no stock-deduction primitive this slice). |
| `rejectInventoryBid` | The item owner | Bid status is `pending` | This bid → `rejected`, `decided_at = now()`. |
| `withdrawInventoryBid` | The bid's bidder | None on already-withdrawn rows (idempotent); otherwise must be pending | If already `withdrawn`, return `{ ok: true }` no-op. Otherwise pending → `withdrawn`. **Forbidden** if status is anything other than `pending` or `withdrawn`. |
| `setInventoryItemBidMode` | The item owner | None | UPDATE `inventory_items.bid_mode` to `null` (off) / `"single"` / `"history"`. Does NOT mutate `inventory_bids`. |

All five actions throw `ForbiddenError` inside the `run` callback on authz failure. The wrapper maps to `{ ok: false, error: "Forbidden" }` with zero unintended row mutations.

**Defense-in-depth on UPDATEs.** Every UPDATE includes `AND <session-org-id matches the row's owning org>`:
- `acceptInventoryBid` / `rejectInventoryBid` — the UPDATE on `inventory_bids` is gated by the prior SELECT confirming the bid's parent item is owned by the session org; the UPDATE itself also includes the bid id + status='pending' for atomicity. The sibling-rejection UPDATE includes `inventoryItemId = …` so it can't bleed across items.
- `withdrawInventoryBid` — UPDATE includes `AND bidder_org_id = $orgId` (defense against TOCTOU).
- `setInventoryItemBidMode` — UPDATE includes `AND org_id = $orgId` (the slice-3 verbatim pattern; slice-15's `updateInventoryItem` already uses it for the same table).

This mirrors slice 16 §6 verbatim. Test §9 asserts these defense-in-depth clauses by attempting a session-mismatch update and verifying zero rows change.

---

## 5. Server actions

All five actions appended to `src/lib/inventory/actions.ts` next to the existing slice 1b-1 / 15 `createInventoryItem` / `updateInventoryItem` / `deleteInventoryItem`. Schemas live in a new file `src/lib/inventory/bidValidation.ts` (parallel to `src/lib/deals/bidValidation.ts`).

**Wire fields:** `inventoryItemId`, `bidId`, `priceCents`, `currency` (optional), `notes` (optional), `mode`. **No `orgId`, no `bidderOrgLabel`** — both are server-computed from `requireSession()`. Slice-3 invariant preserved.

### 5.1 Zod schemas — `src/lib/inventory/bidValidation.ts` (new)

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

Same currency-enum-at-Zod choice as slice 16. The DB column is unconstrained `text`; the form enforces a short list for slice 18.

### 5.2 `postInventoryBid` — visibility-gated insert

```ts
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
      // status defaults to 'pending'
    });
  });
}
```

`resolveOrgLabel` is the same helper slice 10 / slice 16 use (in `src/lib/deals/actions.ts`). Slice 18 will **lift it to a shared location** (see §12 File plan) so the inventory action can import it without depending on `deals/actions.ts`. Recommended location: `src/lib/auth/orgLabel.ts`.

### 5.3 `acceptInventoryBid` — atomic accept + sibling sweep

```ts
export async function acceptInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(acceptInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    // One read: bid + parent item ownership + statuses.
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
      // negotiation; whether the accept event triggers a stock-deduction or
      // reservation is a separate concern (see §13 Out of Scope).
    });
  });
}
```

**No `inventory_items.status` mutation.** Slice 16's `acceptBid` flips the parent deal to `Filled`. Slice 18 does NOT flip `inventory_items.status` to `sold` or `reserved`. The reason: inventory items have quantity > 1 in the general case (Marathi's 50-stone parcel; AIYA's 1,240 rings); an "accept" doesn't tell us "how much was sold" without more state. A future "fulfill bid" primitive can take an accepted bid and reserve / deduct / sell against the item — but that's a separate slice (provisionally "Slice 18b — Inventory Bid Fulfillment", outside scope). The accept event lives in `inventory_bids.status` only; the inventory row is unchanged.

The defense-in-depth `AND eq(inventoryItems.orgId, sessionOrgId)` clause is **already implicit** — the parent item's `org_id` was confirmed equal to `orgId` in the preceding SELECT, and the UPDATE on `inventory_bids` filters by `inventoryItemId` which transitively scopes to the same parent. No additional clause is needed because we're not updating `inventory_items` in this action.

### 5.4 `rejectInventoryBid` — single reject

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
```

### 5.5 `withdrawInventoryBid` — bidder-only, idempotent

```ts
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
    if (row.status === "withdrawn") return; // idempotent no-op
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

Idempotent re-call discipline mirrors slice 16 §10.4. A double-withdraw on an already-withdrawn row returns `{ ok: true }` rather than `Forbidden` — the caller is in a state they're allowed to reach.

### 5.6 `setInventoryItemBidMode` — owner-only

```ts
export async function setInventoryItemBidMode(raw: unknown): Promise<ActionResult> {
  return run(setInventoryItemBidModeInput, raw, async (input, orgId) => {
    const d = db();
    // Defense-in-depth: the SET is gated on AND eq(orgId, sessionOrgId).
    // If the item doesn't exist or belongs to another org, the UPDATE matches
    // zero rows. We could throw Forbidden on a row-count-0 result, but the
    // slice-15 `updateInventoryItem` convention is "silent no-op" — match that.
    await d
      .update(inventoryItems)
      .set({ bidMode: input.mode, updatedAt: new Date() })
      .where(and(
        eq(inventoryItems.id, input.inventoryItemId),
        eq(inventoryItems.orgId, orgId),
      ));
  });
}
```

Mode flip never mutates `inventory_bids`. Pending bids stay pending; the owner can still accept or reject them; partners simply can't submit new ones while `bid_mode` is null.

---

## 6. Query layer — `src/db/inventory.ts`

### 6.1 `getInventoryBidsForItem(db, viewerOrgId, inventoryItemId)`

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

/** Slice 18: bids on a single inventory item visible to `viewerOrgId`.
 *  Visibility = SQL-enforced bidder OR item-owner (mirrors slice 16's
 *  getBidsForDeal). Decoupled from inventory_items.visibility_circle_id —
 *  bids are private trade negotiations. Demo mode short-circuits to []. */
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
  // … (Date-normalization + camelCase mapping, same shape as bids.ts) …
}
```

**Critical invariants:**

1. **SQL-enforced visibility.** The `WHERE` clause is the security gate. The truth-table test in §9 covers each cell.
2. **Demo-mode short-circuit.** `if (isDemoMode()) return [];` — same convention as `getBidsForDeal`. The demo UI doesn't render the bids list (it renders a placeholder or the seed data via a separate path), so returning `[]` is honest.
3. **Mode-aware rendering happens in TS**, not SQL. The component (§7) decides which rows to show based on the parent item's `bid_mode`. Querying everything visible and filtering client-side keeps the disclosure UX cheap (no refetch on disclosure expand). Same as slice 16 §8.

### 6.2 No "Today's Inventory Bids" panel

Explicitly deferred to **slice 18c**. The brief says so directly. The §6 of the slice-16 spec has the `getTodaysBidsForOwner` query (with the recently-landed timezone-fix discipline). Slice 18c will mirror that pattern for `inventory_bids`. Slice 18 ships no daily-bids surface.

---

## 7. UI

### 7.1 `/exchange` row gains a "Place Bid" button — `TradeNetInventoryList`

The slice-15 `TradeNetInventoryList` component (`src/components/inventory/TradeNetInventoryList.tsx`) gains:

- A **"Place Bid"** button on each row, visible only when `it.bidMode !== null` AND `it.orgId !== viewerOrgId`.
- A **bid count badge** next to the button (e.g. `Place Bid · 2 pending`) when there are any pending bids on the row that the viewer can see — useful both for owners (showing they have unread offers) and bidders (showing their own pending offer exists). The count is derived from `getInventoryBidsForItem` results, which the page or panel pre-fetches keyed by `inventoryItemId`.

**Wire shape change.** `SharedInventoryRow` already projects from the DB; slice 18 extends `getSharedInventoryForOrg` to additionally project `bid_mode` so the row component can render the button without a second fetch. This is a one-column projection delta (`inventoryItems.bidMode`); the existing `SharedInventoryRow` type widens to:

```ts
export interface SharedInventoryRow {
  // … existing fields …
  bidMode: "single" | "history" | null;
}
```

Same row shape on the dashboard `TradeNetInventoryPanel`. The panel renders no button (panel rows are read-only summaries), but the column travels through for future affordances.

**Self-bid suppression at the UI layer.** The button is *also* hidden when `it.orgId === viewerOrgId`. The action layer rejects self-bids regardless (`canBidOnItem`), so this is purely UX hygiene — the page never offers an action that would be rejected. Defense-in-depth means both layers enforce.

### 7.2 `InventoryBidsTab` component — `src/components/inventory/InventoryBidsTab.tsx` (new)

Slice 18 ships this as a **modal / drawer** triggered by the "Place Bid" or "View Bids" button (not as a row-inline accordion — `TradeNetInventoryList` is too tight for inline expansion). Two render paths:

- **Bidder view** (the most common surface on `/exchange`): a form for submitting a bid + a list of the viewer's own pending/past bids on this item, with a `[Withdraw]` button on pending rows.
- **Owner view** (reachable when an owner clicks the row from `/exchange` while it's their own item — never happens with the self-bid filter — or from `/inventory` admin if a future iteration links there): the full bid list per `bid_mode` (single vs. history), with `[Accept] [Reject]` buttons on pending rows.

Props:

```ts
type InventoryBidsTabProps = {
  inventoryItem: { id: number; name: string; ownerOrgId: number; bidMode: "single" | "history" | null; };
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

States rendered:

- **Bidding disabled** (`bidMode === null`) — banner: "Bidding is not enabled on this item." No form. (This state is reachable only if the owner toggles bidding off after a bidder opened the drawer; defensive copy.)
- **No bids, bidder view** — placeholder + bid form.
- **Owner view, single mode** — group rows by `bidder_org_id`; render latest pending row per bidder + `[Show history (N)]` disclosure + `[Accept] [Reject]` buttons.
- **Owner view, history mode** — flat chronological list + status badges + accept/reject on pending rows.
- **Bidder view** — only the bidder's own rows, chronological, with `[Withdraw]` on pending rows.

Each row carries the same fields as slice-16's `DealBidsTab`: bidder label, currency-formatted price, relative time, status badge (`pending=amber`, `accepted=emerald`, others=zinc), plain-text notes (XSS-safe via React text children).

### 7.3 `PostInventoryBidForm` — sub-component inside `InventoryBidsTab`

Inputs identical to slice-16's `PostBidForm`: `price` (decimal → cents on submit), `currency` (short enum), `notes` (textarea, ≤500). Submit calls `postInventoryBid({ inventoryItemId, priceCents, currency, notes })` via `useTransition`. On success, the form clears and the bids list re-fetches (or — since the drawer is rendered with server-side props — `revalidatePath("/exchange")` from the action triggers a fresh RSC render).

### 7.4 `/inventory` admin gains a per-row Bidding toggle

The slice-1b-1 / 15 `InventoryAdmin` component (`src/components/inventory/InventoryAdmin.tsx`) gains a third per-row control next to the "Share with circle" dropdown:

- A `Bidding: [Off | Single | History]` `<select>` (or radio group, depending on space) bound to the row's `bid_mode`.
- On change → fires `setInventoryItemBidMode({ inventoryItemId, mode })`.

Visible only to the row's owning org — which is always the viewer on `/inventory` (the admin page already scopes to `eq(orgId, sessionOrg)`).

A small "Bidding · Single" or "Bidding · History" badge renders next to the row name when bidding is on. Mirrors the gold-pill "Shared via [Circle]" badge slice 15 added — same component-internal idiom, different color (silver / mid-gray to distinguish from the slice-15 gold).

### 7.5 No new dashboard panel this slice

Confirmed by the brief. The slice-15 `TradeNetInventoryPanel` already surfaces the cross-circle inventory; slice 18 enriches the row data with `bid_mode` (so panels can show a small "Bid · open" hint badge) but does not introduce a new panel. A future "Today's Inventory Bids" panel = slice 18c.

### 7.6 No new routes, no middleware changes

`/exchange` is already wired through middleware (slice 15 C5). Slice 18 modifies that route's RSC props (extra `bidMode` field on each row + a `bidsByItemId` map for the drawer), but adds no new path.

---

## 8. Demo seed

### 8.1 Authored seeds (already specified in §2.5)

- `DEMO_INVENTORY_BIDS` — two pending bids from AIYA (`DEMO_AIYA_ORG_ID`) on Mehta item 601 and Saint-Cloud item 602.
- `getSeedInventoryBidModes()` — sets item 601 to `"single"` mode (bidding enabled) so the demo `/exchange` row visibly shows the **Place Bid** button. Items 602 and 603 stay null (bidding off) — demonstrating the opt-in default.

### 8.2 Demo seam in queries

`getInventoryBidsForItem(db, orgId, inventoryItemId)` short-circuits to `[]` in demo mode (matches slice 10 / slice 16 convention).

`getSharedInventoryForOrg(db, orgId, limit)` is extended to thread `bidMode` through. In demo mode, the function now consults `getSeedInventoryBidModes()` and stamps each returned seed row with the corresponding `bidMode`:

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

The `SeedSharedInventoryRow` interface widens to include `bidMode: "single" | "history" | null` (so the demo seed matches the widened `SharedInventoryRow` projection). The seed-test fixture in §9 asserts the widened shape.

### 8.3 Demo writes — all return `{ ok: false, error: "Demo mode — changes are disabled" }`

The `run(...)` wrapper short-circuits demo writes for `postInventoryBid` / `acceptInventoryBid` / `rejectInventoryBid` / `withdrawInventoryBid` / `setInventoryItemBidMode` — same posture as slice 15.

The visible-but-not-clickable "Place Bid" button is acceptable demo UX (clicking opens the drawer; the form submit returns the demo-disabled error and the form surfaces it). Alternative — gating the button on `isDemoMode()` — adds a client-side check the team avoided in slices 15 and 16; we keep parity.

---

## 9. Tests (TDD discipline)

All under `test/db/`, `test/lib/inventory/`, `test/components/inventory/`. Mirrors slice 16 §10 in structure.

### 9.1 `test/db/inventory-bids.test.ts` (new) — query-layer truth table

Test fixtures: org 1, 999, 888 (seeded by `shared-db.ts`); a single shared inventory item I owned by 999, shared into circle C with members `{1, 999}`. A `inventory_bids` row from org 1 on item I.

Truth table for `getInventoryBidsForItem`:

| Viewer | Expected |
|---|---|
| Bidder (org 1) | `[I]` (sees their own bid) |
| Item owner (org 999) | `[I]` (sees the incoming bid) |
| Third party in circle C (org 888 — added by extending the membership for this test) | `[]` (no read; bid visibility decoupled from circle membership) |
| Stranger out of circle C (org 888 without membership) | `[]` |

Plus:
- Ordering: newest-first by `created_at`.
- Demo mode: short-circuits to `[]` regardless of viewer.

### 9.2 `test/lib/inventory/bid-authz.test.ts` (new) — write-side truth table

Matrix: `{owner, eligible-bidder, in-circle-but-bidding-off, out-of-circle, stranger}` × `{postInventoryBid, acceptInventoryBid, rejectInventoryBid, withdrawInventoryBid, setInventoryItemBidMode}`.

Asserts each cell returns either `{ ok: true }` or `{ ok: false, error: "Forbidden" }` AND that the side-effects match (zero unintended writes for every rejection cell; re-select the relevant rows after each call and confirm column values).

**Self-bid cell** — explicitly asserted: deal owner calls `postInventoryBid({ inventoryItemId, priceCents })` on their own item → `Forbidden` AND `SELECT count(*) FROM inventory_bids` returns 0.

**Bidding-disabled cell** — item with `bid_mode = NULL`. Caller in-circle. `postInventoryBid` → `Forbidden` AND zero rows.

**Mode-toggle authz cell** — non-owner calls `setInventoryItemBidMode({ inventoryItemId, mode: "single" })` on someone else's item → no error (silent no-op, slice-15 convention) AND `inventoryItems.bidMode` for that row is unchanged in a re-select.

### 9.3 `test/lib/inventory/bid-accept-atomicity.test.ts` (new)

Slice 16 §10.3's structure, ported to inventory.

- Seed item I owned by org 1, bidding enabled. Three pending bids from orgs 999, 888, 777.
- Owner (org 1) calls `acceptInventoryBid({ bidId: bid1Id })`.
- Assert in a single post-action snapshot:
  - `bid1.status === 'accepted'`, `bid1.decidedAt` set
  - `bid2.status === 'auto_rejected'`, `bid3.status === 'auto_rejected'`, both `decidedAt` set
  - `inventoryItems.status` for item I is **unchanged** (no stock-deduction primitive this slice; the test is the regression guard for §5.3's design choice)
- Concurrent-accept safety: two `acceptInventoryBid` calls on different bids of the same item racing — exactly one succeeds; the other returns `Forbidden` because the first transaction left it `auto_rejected` (so its `bidStatus !== 'pending'` precondition fails).

### 9.4 `test/lib/inventory/bid-withdraw.test.ts` (new)

- Pending → withdrawn allowed (bidder only).
- Already-withdrawn → returns `{ ok: true }` (idempotent — re-call is a no-op).
- Accepted → withdraw `Forbidden` (status must be pending or withdrawn).
- Owner attempting to withdraw a partner's bid → `Forbidden`.

### 9.5 `test/lib/inventory/bid-mode-toggle.test.ts` (new)

- Owner toggles `bid_mode` `null → 'single' → 'history' → null` — each step returns `{ ok: true }`; the column persists the change.
- Toggling does NOT mutate `inventory_bids` rows — seed 3 pending bids, toggle `bid_mode → null`, assert all 3 remain `pending` with unchanged `decidedAt`.
- Non-owner toggle → silent no-op (no error, no mutation). Re-select confirms unchanged `bidMode`.

### 9.6 `test/lib/inventory/bidValidation.test.ts` (new)

Zod truth table: positive prices accepted, zero/negative rejected, notes > 500 rejected, currency restricted to short enum, `mode` accepts `null` for `setInventoryItemBidMode`.

### 9.7 `test/components/inventory/InventoryBidsTab.test.tsx` (new)

- Bidding-disabled banner renders when `bidMode === null`.
- Empty bidder state renders placeholder + bid form.
- Single-mode owner view groups bids by bidder + disclosure.
- History-mode owner view renders chronologically.
- Accept button click fires `acceptInventoryBid`.
- Withdraw button only on bidder's own pending rows.
- Status badge color/text matches each enum value.
- XSS sanity: `notes: "<script>alert(1)</script>"` renders as visible text.

### 9.8 `test/components/inventory/TradeNetInventoryList.test.tsx` (extended)

- "Place Bid" button visible when `item.bidMode !== null` AND `item.orgId !== viewerOrgId`.
- "Place Bid" button HIDDEN when `item.orgId === viewerOrgId` (self-bid UX guard).
- "Place Bid" button HIDDEN when `item.bidMode === null`.
- Pending-bid count badge renders when `bidsByItemId.get(item.id)?.length > 0` AND any are pending.

### 9.9 `test/components/inventory/InventoryAdmin.test.tsx` (extended)

- Bidding mode selector renders with the correct default per row.
- Selecting "Off" / "Single" / "History" fires `setInventoryItemBidMode` with the matching mode (`null` / `"single"` / `"history"`).
- "Bidding · Single" badge renders when `it.bidMode === "single"`.

### 9.10 Demo seed tests — `test/lib/demo/seed.test.ts` (extended)

- `DEMO_INVENTORY_BIDS` has exactly 2 entries; bidder is AIYA on both; items 601 + 602.
- `getSeedInventoryBidModes()` returns `{ 601 → "single", 602 → null, 603 → null }`.
- `getSeedSharedInventoryForOrg(DEMO_AIYA_ORG_ID)` returns 3 rows; the row for item 601 has `bidMode === "single"`; the rows for 602 + 603 have `bidMode === null`.

### 9.11 Migration smoke test — `test/db/inventory-bids-migration-smoke.test.ts` (new)

Mirrors `test/db/migration-bidding-smoke.test.ts` (slice 16) — asserts the `inventory_bids` table exists with the expected nullable/non-nullable columns, and that `inventory_items.bid_mode` is nullable text.

### 9.12 Existing tests stay green

- Slice 15 `test/db/inventory.test.ts` truth-table (zero-circles, multi-circle, sold-excluded) — must pass without modification.
- Slice 16 `test/db/bids.test.ts` + `test/lib/deals/*` — slice 18 touches neither `bids` nor `deals/actions.ts`; these stay green.
- Slice 1b-1 / slice 3 cross-org isolation tests on `inventory_items` — must pass without modification.

---

## 10. Migration plan

- New drizzle migration `0012_*.sql` (next sequential — last on main is `0011_giant_bishop.sql`).
- Schema-only; additive. Existing rows: every `inventory_items.bid_mode` lands at `NULL`. Zero new `inventory_bids` rows on real DBs (the demo seed is in-memory).
- `outputFileTracingIncludes` already covers `./drizzle/**/*` — no Netlify config change.
- No env vars added. No Sentry tag additions beyond the existing `layer: "inventory-action"` tag (which already covers slice 15 — the new slice-18 actions inherit it).
- Demo seed runs on every cold pglite boot — slice 18 demo bids appear automatically on the dev DB.

**Rollout sequence:** schema → migration + smoke → query helper → server actions + tests → UI (button, drawer, admin toggle) → demo seed → verify + ship. Same phase-A/B/C/D structure as slice 16's plan.

---

## 11. Security & threat model

This section mirrors slice 16 §11 and slice 15 §8 verbatim where applicable. The risk surface is exactly: **a cross-org write or read on `inventory_bids` that the membership-and-bid-mode graph would not authorize**.

### 11.1 Tenancy preserved

Slice-3 invariant: every read scoped via session orgId; every write gated on session-resolved `orgId` (never wire). Confirmed by:
- The five action input schemas (§5.1) accept ZERO `orgId` / `bidderOrgId` / `ownerOrgId` fields. The bidder's org is server-resolved.
- The query layer (§6.1) accepts a `viewerOrgId` argument that the RSC resolves via `getCurrentOrgId()` — never URL search params or request body.

### 11.2 Self-bid block

Enforced at the action layer in `canBidOnItem` (§4.1). The §9.2 truth-table cell explicitly asserts zero rows are inserted when the owner attempts to bid on their own item. SQL-level CHECK would be more defensive but adds operational surface for a single rule already covered by tests — see §2.3 for the design tradeoff.

### 11.3 Visibility predicate SQL-enforced

`getInventoryBidsForItem`'s `WHERE` clause is the gate. Application-layer filtering is forbidden (slice-3 invariant). The §9.1 truth-table covers every cell.

### 11.4 Atomicity

`acceptInventoryBid` wraps both `inventory_bids` UPDATEs in a single `db.transaction(...)`. Mirrors slice 16's pattern. The §9.3 concurrent-accept test asserts that two racing accepts on the same item result in exactly one success — the other observes the sibling row's status change inside the failed precondition check and returns `Forbidden`.

### 11.5 Decoupled circle visibility

A bid visible to bidder + item owner only. Circle members can see the ITEM (via slice 15) but cannot see bids on it. The §9.1 third-party cell asserts this. Mirrors slice 16's deal-bid vs. thread_mode decoupling.

### 11.6 No wire `orgId` — enforced by Zod schemas

The §5.1 schemas accept only `inventoryItemId`, `bidId`, `priceCents`, `currency`, `notes`, `mode`. A grep over `src/lib/inventory/bidValidation.ts` for `orgId` / `bidderOrgId` returns zero matches — the PR review checklist (§11.10) makes this an explicit gate.

### 11.7 Defense-in-depth on UPDATEs

Every UPDATE on `inventory_bids` filters on `eq(inventoryBids.status, "pending")` (TOCTOU guard between SELECT and UPDATE). Every UPDATE on `inventory_items` (`setInventoryItemBidMode`) filters on `eq(inventoryItems.orgId, sessionOrgId)` (slice-3 verbatim).

### 11.8 Race conditions

A bidder's view of `inventory_items.bid_mode` could in principle stale-read just before the owner toggles bidding off. If the bidder submits during that window, `canBidOnItem` re-reads `bid_mode` server-side; if the toggle has landed, `Forbidden`. No race window leaks visibility — the bid never inserts.

A separate race: owner toggles `bid_mode` from `"single"` to `null` while pending bids exist. Slice 18 explicitly does NOT auto-reject pending bids on toggle-off (§3.1). The owner can still accept / reject them; partners simply can't submit new ones. Test in §9.5 is the regression guard.

### 11.9 Audit logging

Inherits the slice 15 / slice 4 deferred-audit-log posture. `Forbidden` rejections in the action layer surface a `console.warn` + Sentry capture; there is no `bid_audit` table this slice. Slice 3 §10 owns the open hardening item.

### 11.10 PR review checklist (slice 18 exit gate)

- `grep -rn "orgId\|bidderOrgId\|ownerOrgId" src/lib/inventory/bidValidation.ts` → zero matches.
- `grep -rn "from(inventoryBids)" src/` → every match is inside `src/db/inventory.ts` or `src/lib/inventory/actions.ts`. No raw queries outside the inventory subsystem.
- The five new actions' `Forbidden` paths each have a corresponding row-count-zero assertion in `test/lib/inventory/bid-authz.test.ts`.
- `acceptInventoryBid` is wrapped in `db.transaction(async (tx) => …)` — visual grep confirmation.
- `inventory_bids` table FK is `inventory_item_id → inventory_items.id ON DELETE CASCADE` (item delete cascades to its bids).
- `inventory_items.bid_mode` is nullable; no migration adds a default.
- Slice 15 / 16 / 1b-1 / 3 tests stay green.
- `npm run build` and `npm test` green.

### 11.11 Demo mode

Demo writes return `{ ok: false, error: "Demo mode — changes are disabled" }` at the `run()` short-circuit. The button + drawer render against seeds; submit is a no-op with a user-visible error. Same posture as slice 15.

---

## 12. File plan

### New files

| Path | Purpose |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/inventory/bidValidation.ts` | Zod schemas for the 5 actions |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/auth/orgLabel.ts` | Shared `resolveOrgLabel(db, orgId)` helper (lifted from `src/lib/deals/actions.ts`); slice 16 originally hid it as an internal helper, slice 18 needs it cross-subsystem. The plan keeps the slice-16 implementation byte-identical and adds an import-only redirect in `deals/actions.ts` for zero behavior change. |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/inventory/InventoryBidsTab.tsx` | Modal/drawer with bid form + list + owner accept/reject actions |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/inventory/PostInventoryBidForm.tsx` | Sub-component used inside `InventoryBidsTab` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/drizzle/0012_*.sql` | Migration: `inventory_bids` table + `inventory_items.bid_mode` column |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/db/inventory-bids.test.ts` | Query-layer truth-table |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/db/inventory-bids-migration-smoke.test.ts` | Migration smoke (schema columns + nullability) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/bidValidation.test.ts` | Zod truth-table |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/bid-authz.test.ts` | Write-side truth-table including self-bid + bidding-disabled cells |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/bid-accept-atomicity.test.ts` | Atomic accept + sibling-sweep + inventory.status-unchanged regression |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/bid-withdraw.test.ts` | Withdraw pre/post-state + idempotency |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/bid-mode-toggle.test.ts` | setInventoryItemBidMode authz + no-mutation-of-existing-bids |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/inventory/InventoryBidsTab.test.tsx` | Drawer states + accept/reject/withdraw wiring |

### Modified files

| Path | Change |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/schema.ts` | Add `inventoryBids` table + `bidMode` text NULL column on `inventoryItems` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/inventory.ts` | Add `InventoryBidView` type + `getInventoryBidsForItem`; extend `getSharedInventoryForOrg` projection to include `bidMode` (and widen `SharedInventoryRow`); thread `bidMode` through the in-memory demo path |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/inventory/actions.ts` | Append `postInventoryBid` / `acceptInventoryBid` / `rejectInventoryBid` / `withdrawInventoryBid` / `setInventoryItemBidMode`; add `canBidOnItem` helper; import `inventoryBids` from schema |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/actions.ts` | Re-export `resolveOrgLabel` via new shared `src/lib/auth/orgLabel.ts` (zero behavior change; keeps slice-16 callers byte-stable) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/inventory/TradeNetInventoryList.tsx` | Add "Place Bid" button per row (visible when bidMode !== null && orgId !== viewerOrgId); pending-bid count badge; thread `bidsByItemId` + `viewerOrgId` + actions through props |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/TradeNetInventoryPanel.tsx` | No new buttons; widen prop type to accept the extended `SharedInventoryRow` shape |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/inventory/InventoryAdmin.tsx` | Add per-row Bidding selector (Off / Single / History); add "Bidding · X" badge; thread `setInventoryItemBidMode` through props |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/exchange/page.tsx` | Pre-fetch `getInventoryBidsForItem` per row → `bidsByItemId: Map<number, InventoryBidView[]>`; pass through to `TradeNetInventoryList` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/inventory/page.tsx` | Extend the inline `select` projection with `inventoryItems.bidMode`; pass `setInventoryItemBidMode` into `InventoryAdmin` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/demo/seed.ts` | Add `DEMO_INVENTORY_BIDS` + `getSeedInventoryBidModes` + `SeedInventoryBid` type; widen `SeedSharedInventoryRow` with `bidMode`; thread `bidMode` through `getSeedSharedInventoryForOrg` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/demo/seed.test.ts` | Extend with the §9.10 assertions |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/inventory/TradeNetInventoryList.test.tsx` | Add §9.8 assertions |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/inventory/InventoryAdmin.test.tsx` | Add §9.9 assertions |

### Removed files

None.

---

## 13. Out of Scope (explicit)

| Feature | Assigned to |
|---|---|
| "Today's Inventory Bids" right-rail panel | **Slice 18c** — explicitly named, mirrors slice 16's `TodaysBidsPanel` |
| Reverse-auction / Dutch-style bidding (price descends until accepted) | Future — auction-flow slice |
| Bid expiration / TTL — Vercel Cron-based sweep `pending → expired` | Future — bid-lifecycle slice |
| Counter-offer as a structured primitive (`parent_bid_id` linkage) | Future — same posture as slice 16 §12 |
| Per-circle bid visibility (circle-mates see each others' bids on shared items) | Explicitly rejected — slice 16 made the same call for deal bids; slice 18 inherits the rejection. Bids stay bidder + owner only. |
| Audit log of bid acceptance (cross-table `bid_audit` row on every status change) | Tenancy audit log slice (descended from slice 3 §10) |
| Stock-deduction / reservation on `acceptInventoryBid` (mutate `inventory_items.status` or quantity) | **Slice 18b — Inventory Bid Fulfillment** — explicitly named; quantity-aware accept flow |
| Partial-quantity bids ("buy 25 of a 50-stone parcel") | Slice 18b (same as above) |
| Email/push notifications when a bid arrives | Slice 20 (Resend) — same home as slice 16's notifications gap |
| "Highest bid" auto-sort on the BidsTab | Polish follow-up |
| Outgoing-inventory-bids panel (bidder's "my pending offers across all partners" view) | Polish follow-up — mirror of slice 18c from the bidder's perspective |
| Bid acceptance triggers `deals` row creation (auto-promote an accepted item bid to a Deal Room sale) | Future — cross-subsystem integration slice |
| Per-currency conversion / FX | Polish follow-up — slice 16 deferred this on deals |
| Time-zone-aware "today" filter for the eventual 18c daily panel | Slice 18c — inherits the slice-16 timezone-fix posture (the `AT TIME ZONE 'UTC'` discipline lives in `src/db/bids.ts` already) |

---

## Design summary table

| Concern | Choice |
|---|---|
| Schema | New `inventory_bids` table (5-state lifecycle); `inventory_items.bid_mode` NULLABLE text (null = bidding off) |
| Self-bid block | Action-level via `canBidOnItem`; no SQL CHECK constraint |
| Visibility | Bidder + item owner only; SQL-enforced; decoupled from circle membership |
| Accept semantics | Atomic transaction: this bid → accepted; sibling pending bids → auto_rejected. `inventory_items.status` UNCHANGED (no stock-deduction this slice — see §13) |
| Withdraw | No time limit; idempotent re-call returns `{ ok: true }` |
| Bid-mode toggle | Owner-only; null disables bidding; toggle does NOT mutate existing bid rows |
| Wire fields | `inventoryItemId`, `bidId`, `priceCents`, `currency`, `notes`, `mode`. ZERO orgId/label fields — server-computed |
| Notes | Optional plain text, ≤500 chars, React-escaped rendering (XSS surface = zero) |
| Authz pattern | Reuses slice-15's `isOrgMemberOfCircle` + slice-16's `runWithUser` + `ForbiddenError`; no new auth primitive |
| UI surface | "Place Bid" button on `/exchange` rows + new `InventoryBidsTab` drawer + new Bidding mode selector on `/inventory` admin. No new dashboard panel this slice. |
| Defense-in-depth | All UPDATEs include `AND <session-org matches>`; `acceptInventoryBid` wraps both UPDATEs in `db.transaction` |
| Security posture | Plain-text only, never HTML-construct user data, no HTML sanitization libs; same as slices 4, 10, 15, 16 |
| Demo seed | 2 pending bids from AIYA on items 601 + 602; item 601's `bid_mode` set to `"single"` so the demo `/exchange` row shows the Place Bid button |
