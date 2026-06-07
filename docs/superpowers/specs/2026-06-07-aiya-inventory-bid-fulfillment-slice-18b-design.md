# AIYA Dashboard — Slice 18b: Inventory Bid Fulfillment — Design

**Date:** 2026-06-07
**Status:** Approved (design); implementation plan companion at `docs/superpowers/plans/2026-06-07-aiya-inventory-bid-fulfillment-slice-18b.md`
**Builds on:**
- **Slice 18 Inventory Bidding** — the `inventory_bids` table, `inventory_items.bid_mode` opt-in column, the five `runWithUser`-wrapped inventory-bid actions (`postInventoryBid`, `acceptInventoryBid`, `rejectInventoryBid`, `withdrawInventoryBid`, `setInventoryItemBidMode`), the `canBidOnItem` write-side gate, the `InventoryBidView` projection, and — critically — the parent-row `SELECT … FOR UPDATE` lock + in-transaction re-read pattern added in commit `293f3fd` (`fix(inventory): serialize acceptInventoryBid with parent-row lock`). Slice 18b extends that same locked region rather than introducing a new transaction shape.
- **Slice 16 Bidding** — informs the architecture; not the template. Slice 16 has no quantity primitive (it operates on a single-quantity `deals.quantity` snapshot inside the deal body); 18b's mechanic — partial-fill multi-bidder marketplaces — has no precedent in slice 16.
- **Slice 15 TradeNet Inventory** — `inventory_items.quantity` is the live stock counter and `inventory_items.status` is the `["in_stock", "reserved", "sold"]` enum that the accept path will transition. The slice-1b-1 status taxonomy is unchanged.
- **Slice 3 Multi-Tenant Foundation** — every tenancy invariant is preserved verbatim: `orgId` is session-resolved (never wire), and every UPDATE includes a defense-in-depth `WHERE … AND <session-org-id> matches` clause. Slice 18b adds an UPDATE on `inventory_items` (the stock decrement), which restores the slice-3 verbatim discipline that slice 18 didn't need (slice 18 only mutated `inventory_bids` rows).

**Numbering note:** Slice 18 just landed (PR merged at `60675a4`). Slice 18b is the immediate follow-up that closes the stock loop slice 18 §13 named as out of scope. Slice 18c (Today's Inventory Bids panel) is parallel and unblocked.

---

## 1. Overview & Goals

Slice 18 added structured price-offer bidding on shared inventory items. Owners can accept the winning bid, which atomically sets that bid → `accepted` and auto-rejects sibling pending bids. But slice 18 deliberately stopped at price negotiation — the parent `inventory_items` row was untouched on accept. The slice-18 spec §13 named the gap and assigned it to this slice:

> **Stock-deduction / reservation on `acceptInventoryBid` (mutate `inventory_items.status` or quantity)** → **Slice 18b — Inventory Bid Fulfillment** — explicitly named; quantity-aware accept flow

Slice 18b closes that loop. It adds:

- **Quantity-aware bidding.** Every `inventory_bids` row gains a `quantity_requested` integer column (default 1; existing slice-18 rows semantically interpret as 1-unit bids). A bid is now a request to buy **N units** of the item at the offered price.
- **Stock decrement on accept.** Inside the existing parent-row-locked transaction, `acceptInventoryBid` now decrements `inventory_items.quantity -= bid.quantity_requested` AND, when the new quantity reaches 0, flips `inventory_items.status` from `'in_stock'` to `'sold'` (the canonical sold-out value from the slice-1b-1 status enum).
- **Selective sibling auto-reject.** Slice 18 unconditionally auto-rejected ALL sibling pending bids. Slice 18b auto-rejects **only** the bids that no longer fit — bids whose `quantity_requested > <new available quantity>` after the accept lands. Bids that still fit stay pending, so a 10-unit item with three pending bids (3, 7, 1) can accept the 7-unit bid → quantity becomes 3 → the 1-unit bid stays pending (still fits in 3) and the 3-unit bid stays pending (just barely fits). This is the marquee multi-bidder marketplace mechanic the slice introduces.
- **Over-subscribed accept guard.** A bid whose `quantity_requested > current item.quantity` at accept time is rejected with `Forbidden` inside the locked transaction. The bid itself transitions to `auto_rejected` as part of the failure path (it's stale and would never fit again). Owner sees a "this bid no longer fits available stock" error.
- **Post-time guard in `canBidOnItem`.** A 6th precondition: `input.quantityRequested <= item.quantity AT POST TIME`. UX guard only; the accept-side check is the source of truth (stock can change between post and accept).
- **UI:** `PostInventoryBidForm` gains a quantity input (default 1, max=item.quantity, with a visible "available stock: N" hint); `InventoryBidsTab` shows `quantity_requested` per bid row; `/exchange` rows with `status='sold'` hide the Place Bid button and show a "Sold" badge.
- **Demo seed delta:** existing slice-18 seeded bids gain explicit `quantityRequested=1`; the Marathi 50-stone parcel (item 603) gets bidding enabled with one realistic partial-fill demo bid for 5 units so reviewers can see the mechanic.

The slice does NOT add: counter-offers, bid expiration cron, audit log of stock decrements, per-bid notification on accept (slice 20 — Resend), or the "Today's Inventory Bids" panel (slice 18c).

**Goal posture:** every slice-3 tenancy invariant + every slice-15 visibility invariant + every slice-18 bidding invariant is preserved. The only NEW security/correctness risk is **stock-mutation atomicity** — answered by reusing the slice-18 parent-row-lock pattern + in-transaction re-read of `item.quantity` immediately before the decrement.

---

## 2. Schema

### 2.1 New column: `inventory_bids.quantity_requested`

```ts
// src/db/schema.ts — modify the inventoryBids pgTable definition
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
    // Slice 18b: quantity of units this bid is requesting. INTEGER NOT NULL
    // DEFAULT 1. The default preserves existing slice-18-seeded rows without
    // a data-fixup migration — they semantically interpret as "1 unit" which
    // matches the slice-18 mental model (every bid was implicitly singular).
    quantityRequested: integer("quantity_requested").notNull().default(1),
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
  // (indexes unchanged from slice 18 — no new index on quantity_requested;
  //  the accept path filters by inventoryItemId + status='pending' which is
  //  already covered by inventory_bids_pending_by_item_idx)
);
```

| Column | Type | Notes |
|---|---|---|
| `quantity_requested` | int NOT NULL DEFAULT 1 | Always positive (Zod-enforced ≥ 1); the action layer treats 0 / negative as invalid. Defaulting to 1 makes the migration safe + lossless for slice-18-seeded rows. |

**Why DEFAULT 1 instead of NOT NULL with no default?** Drizzle's `ALTER TABLE … ADD COLUMN … NOT NULL` without a default fails on tables with existing rows. The DEFAULT 1 backfills every slice-18 row with quantity_requested=1 at migration time. After the migration lands, new inserts still hit the default unless the Zod input layer overrides it (which it always will from this slice forward). The DEFAULT survives in the schema as a safety net — if an action ever forgets to pass quantity_requested, the row is still consistent. This is the slice-1b-1 status taxonomy convention applied at a different column.

**No new index.** The accept path's expensive query is `SELECT … FROM inventory_bids WHERE inventory_item_id = $1 AND status = 'pending'` — already covered by the slice-18 partial index `inventory_bids_pending_by_item_idx`. The `quantity_requested` column is read alongside that filter, not as a search key. No new B-tree needed.

### 2.2 No new column on `inventory_items`

The status flip (`'in_stock' → 'sold'`) reuses the existing `inventory_items.status` enum from slice 1b-1: `["in_stock", "reserved", "sold"]`. The canonical sold-out value is `'sold'` — confirmed by reading `src/db/schema.ts:176`. No new status value is invented. No CHECK constraint on `quantity >= 0` is added (the action layer rejects over-subscribed accepts before the UPDATE; a CHECK would be defense-in-depth but adds operational surface — same tradeoff as slice 18 §2.3 made on the self-bid CHECK).

**Why not introduce a `'reserved'` intermediate state?** The slice-1b-1 status enum already has `'reserved'`, but slice 18b deliberately does not transition through it. Reasoning: an accepted bid in this slice is a binding sale, not a hold. A future "Mark as reserved" UX (e.g. "owner says they're shipping the stones — flip to reserved until delivery confirms") could use the column. Slice 18b leaves the `'reserved'` value to that future slice and goes straight from `'in_stock'` to `'sold'` on quantity-zero. The §9 sold-on-zero test enforces this exact transition.

### 2.3 Migration `drizzle/NNNN_*.sql`

Generated by `npm run db:generate` after the schema edit. Expected file contents:

```sql
ALTER TABLE "inventory_bids" ADD COLUMN "quantity_requested" integer DEFAULT 1 NOT NULL;
```

Single ALTER. No new index. No `inventory_items` change.

**Schema-only header** (same convention as slices 4, 4c, 15, 16, 18):

```sql
-- schema-only; no seed data in this migration.
-- inventory_bids.quantity_requested defaults to 1 — backfills slice-18
-- rows with the semantically-correct "1 unit" interpretation. Demo seeds
-- live in src/lib/demo/seed.ts and never touch the DB.
-- See docs/superpowers/plans/2026-06-07-aiya-inventory-bid-fulfillment-slice-18b.md.
```

**Migration order dependency:** runs against a DB that has the slice-18 migration (`0013_inventory_bidding.sql`) applied — verified by listing `drizzle/` at plan time. The next sequential number is `0014_*`.

**Rollback:** `ALTER TABLE inventory_bids DROP COLUMN quantity_requested;`. Slice-18 readers don't reference the column, so the rollback degrades cleanly — accept calls behave like slice 18 (no stock mutation), and the UI's quantity input vanishes harmlessly.

### 2.4 Demo seed deltas

Two changes to `src/lib/demo/seed.ts`:

**(a) Annotate existing slice-18 bids with explicit `quantityRequested` values.** The `SeedInventoryBid` interface gains `quantityRequested: number`. The two existing entries get `quantityRequested: 1` (matches their semantic intent). Adding the field at the type level catches any missing site at typecheck time — the `getSeedInventoryBidModes` map + the inventory shim that renders bids both need to thread it through.

```ts
export interface SeedInventoryBid {
  inventoryItemId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  quantityRequested: number;  // slice 18b — defaults to 1 for slice-18-vintage seeds
  status: "pending";
  createdAtOffsetMinutes: number;
}

export const DEMO_INVENTORY_BIDS: SeedInventoryBid[] = [
  {
    inventoryItemId: 601, // Mehta Round 2.51ct (quantity 1)
    bidderOrgId: DEMO_AIYA_ORG_ID,
    bidderOrgLabel: "AIYA Designs",
    priceCents: 168_500_00,
    currency: "USD",
    notes: "Firm. 7-day inspection window.",
    quantityRequested: 1,
    status: "pending",
    createdAtOffsetMinutes: 40,
  },
  {
    inventoryItemId: 602, // Saint-Cloud Cushion Padparadscha (quantity 1)
    bidderOrgId: DEMO_AIYA_ORG_ID,
    bidderOrgLabel: "AIYA Designs",
    priceCents: 42_000_00,
    currency: "USD",
    notes: null,
    quantityRequested: 1,
    status: "pending",
    createdAtOffsetMinutes: 12,
  },
];
```

**(b) Add one partial-fill demo bid on the Marathi 50-stone parcel (item 603).** Slice 18 seeded item 603 with `bidMode: null` (bidding disabled) and quantity 50. Slice 18b flips item 603's bidMode to `"history"` AND adds a 5-unit bid from AIYA — demonstrating the partial-fill mechanic in the canned demo without touching any real DB.

```ts
// In DEMO_INVENTORY_BIDS, appended:
  {
    inventoryItemId: 603, // Marathi Princess parcel (quantity 50)
    bidderOrgId: DEMO_AIYA_ORG_ID,
    bidderOrgLabel: "AIYA Designs",
    priceCents: 14_000_00, // 5 units × ~$2800/stone — realistic for IGI G/SI1 1.05ct princess
    currency: "USD",
    notes: "Cherry-picking 5 stones from the parcel — please call to discuss.",
    quantityRequested: 5,
    status: "pending",
    createdAtOffsetMinutes: 75,
  },

// In getSeedInventoryBidModes():
export function getSeedInventoryBidModes(): Map<number, "single" | "history" | null> {
  return new Map<number, "single" | "history" | null>([
    [601, "single"],
    [602, "history"],
    [603, "history"],   // ← slice 18b flipped from null. Demo's partial-fill row.
  ]);
}
```

The Netlify demo never boots pglite; reads short-circuit to seeds. Writes return `{ ok: false, error: "Demo mode — changes are disabled" }` (existing slice-18 + slice-15 invariant — slice 18b carries forward).

### 2.5 No `inventory_items.quantity` schema change

The `quantity` column already exists from slice 1b-1 (`integer NOT NULL default 1`). Slice 18b just starts mutating it. No DDL.

---

## 3. Updated authz / `canBidOnItem` model

Slice 18's `canBidOnItem` (in `src/lib/inventory/actions.ts:161`) enforced 5 preconditions:

1. Item exists
2. Caller is not the owner (self-bid block)
3. `bid_mode` is non-null
4. Item has a `visibility_circle_id`
5. Caller is a member of that circle

Slice 18b adds a **6th precondition** layered on top:

6. `input.quantityRequested <= item.quantity` at post time (over-stock-bid block — UX guard)

### 3.1 Updated `canBidOnItem` signature + body

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
  // Single read: item ownership + bid_mode + visibility_circle_id + quantity.
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
  if (!row) return { ok: false };                              // (1) item doesn't exist
  if (row.ownerOrgId === orgId) return { ok: false };          // (2) self-bid block
  if (row.bidMode === null) return { ok: false };              // (3) bidding disabled
  if (row.visibilityCircleId === null) return { ok: false };   // (4) item is private
  const isMember = await isOrgMemberOfCircle(d, orgId, row.visibilityCircleId);
  if (!isMember) return { ok: false };                         // (5) viewer not in circle
  if (quantityRequested > row.quantity) return { ok: false };  // (6) NEW — over-stock-bid block
  return {
    ok: true,
    ownerOrgId: row.ownerOrgId,
    bidMode: row.bidMode,
    visibilityCircleId: row.visibilityCircleId,
  };
}
```

The 6th check sits AFTER membership — order matters for the same reason slice 18 ordered them. A non-member who happens to pass an over-stock quantity gets the same `Forbidden` as a member who passes an over-stock quantity. No information leak about either condition.

### 3.2 Post-vs-accept race window — by design

The 6th precondition is **best-effort UX**. The authoritative check happens inside `acceptInventoryBid`'s locked transaction (§4). Reasoning:

- The `canBidOnItem` SELECT is unlocked (no `FOR UPDATE` at post time — that would be a useless lock held for milliseconds during form submit).
- Between the post-time read and the eventual accept, the owner may have accepted ANOTHER bid that decremented stock. The bidder's bid may now exceed available quantity even though it didn't at post time.
- The race is **not exploitable** — there's no path where a bid is silently accepted at an over-subscribed quantity. The accept-side check (in the locked region) is the source of truth. The worst the bidder experiences is "my bid was auto-rejected at accept time because stock sold down below my requested quantity" — handled the same way as the explicit over-subscribed-sibling auto-reject path (§4.2).

The §9 test "post-then-decrement-then-accept" asserts this exact sequence: bid posted at qty=5, sibling accepted (qty becomes 3), the 5-unit bid's accept now returns `Forbidden` AND the row flips to `auto_rejected`.

### 3.3 Per-action authz table — unchanged from slice 18

The slice-18 §4.2 table stays valid verbatim. Only `postInventoryBid` and `acceptInventoryBid` change semantics (per §5); the other three actions are byte-stable.

| Action | Slice 18b change |
|---|---|
| `postInventoryBid` | Validates `quantityRequested` via Zod; canBidOnItem 6th precondition rejects over-stock at post time |
| `acceptInventoryBid` | In-transaction re-read of `item.quantity`; decrement; sold-on-zero; selective sibling auto-reject |
| `rejectInventoryBid` | Unchanged |
| `withdrawInventoryBid` | Unchanged |
| `setInventoryItemBidMode` | Unchanged |

---

## 4. Accept-time semantics — the marquee mechanic

The slice-18 `acceptInventoryBid` (commit `293f3fd`) already established:

1. Pre-tx SELECT to validate ownership + bid status
2. Inside `db.transaction`: `SELECT id FROM inventory_items WHERE id = $itemId FOR UPDATE` (parent-row lock)
3. In-tx re-read of bid status (catches concurrent-accept on a different sibling)
4. UPDATE this bid → `accepted`
5. UPDATE all sibling pending bids → `auto_rejected`

Slice 18b extends step 3 onward. Steps 1–2 are byte-stable.

### 4.1 Updated transaction body

```ts
await d.transaction(async (tx) => {
  // STEP 1: Take the parent-row lock (UNCHANGED from slice 18 / 293f3fd).
  // Serializes concurrent accept calls on the same item. Without this,
  // two acceptInventoryBid calls would both see item.quantity in their
  // own pre-decrement snapshot and over-subscribe stock.
  await tx.execute(
    sql`SELECT id FROM inventory_items WHERE id = ${row.inventoryItemId} FOR UPDATE`,
  );

  // STEP 2: Re-read bid status + FRESH item.quantity inside the lock.
  // The slice-18 re-read only checked bid.status. Slice 18b ALSO reads
  // item.quantity because the previous accept may have decremented it
  // below what this bid asked for.
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

  const now = new Date();

  // STEP 3: Over-subscribed accept guard — bid asks for more than's available.
  // Flip the bid to auto_rejected (it's permanently stale; sibling bids may
  // still fit and stay pending) and throw Forbidden so the owner sees the
  // failure. The throw rolls back nothing visible because the auto_reject
  // happens BEFORE the throw — but inside the same tx, so if a downstream
  // step later throws, the auto_reject rolls back too. (See test §9.4 for
  // the exact sequence.)
  if (f.bid_qty > f.item_qty) {
    await tx
      .update(inventoryBids)
      .set({ status: "auto_rejected", decidedAt: now })
      .where(and(
        eq(inventoryBids.id, input.bidId),
        eq(inventoryBids.status, "pending"),
      ));
    throw new ForbiddenError("Forbidden");
  }

  // STEP 4: Accept this bid.
  await tx
    .update(inventoryBids)
    .set({ status: "accepted", decidedAt: now })
    .where(and(
      eq(inventoryBids.id, input.bidId),
      eq(inventoryBids.status, "pending"),
    ));

  // STEP 5: Decrement stock + flip to 'sold' if it hits zero.
  // Defense-in-depth: AND eq(orgId, sessionOrgId) — slice-3 verbatim.
  // Compute the new quantity in TS (we already have item_qty + bid_qty)
  // to keep the UPDATE single-shot. Using a SQL expression like
  // `quantity - ${bid_qty}` would also work but separating the math makes
  // the sold-on-zero branch easier to read.
  const newQuantity = f.item_qty - f.bid_qty;
  await tx
    .update(inventoryItems)
    .set({
      quantity: newQuantity,
      status: newQuantity === 0 ? "sold" : undefined,
      // ↑ undefined means "don't touch the column" in Drizzle's set semantics —
      // status stays 'in_stock' (or whatever it was) when there's stock left.
      // Test §9.3 asserts both branches.
      updatedAt: now,
    })
    .where(and(
      eq(inventoryItems.id, row.inventoryItemId),
      eq(inventoryItems.orgId, orgId),  // ← slice-3 defense-in-depth
    ));

  // STEP 6: Selective sibling auto-reject — ONLY bids that no longer fit.
  // Slice 18 unconditionally rejected siblings. Slice 18b leaves bids
  // pending if they still fit in `newQuantity`. The condition is
  // quantity_requested > newQuantity (strictly greater — bids equal to
  // remaining stock stay pending, since they could still be the next
  // accept).
  if (newQuantity > 0) {
    await tx
      .update(inventoryBids)
      .set({ status: "auto_rejected", decidedAt: now })
      .where(and(
        eq(inventoryBids.inventoryItemId, row.inventoryItemId),
        eq(inventoryBids.status, "pending"),
        ne(inventoryBids.id, input.bidId),
        gt(inventoryBids.quantityRequested, newQuantity),
        // ↑ NEW guard — only over-subscribed siblings are auto_rejected.
      ));
  } else {
    // Sold-out: ALL remaining pending bids on this item are stale.
    // Slice-18 behavior for this case (every sibling auto_rejected).
    await tx
      .update(inventoryBids)
      .set({ status: "auto_rejected", decidedAt: now })
      .where(and(
        eq(inventoryBids.inventoryItemId, row.inventoryItemId),
        eq(inventoryBids.status, "pending"),
        ne(inventoryBids.id, input.bidId),
      ));
  }
});
```

The `gt` import comes from `drizzle-orm` (already imported alongside `and`, `eq`, `ne`, `sql` in `actions.ts`; the plan's Task B1 makes the import explicit).

### 4.2 Truth table for the selective sibling sweep

Item starts with quantity = 10. Three pending bids: A=3, B=7, C=11. Owner accepts B=7.

| Step | State |
|---|---|
| Pre-accept | item.qty=10, A=pending(3), B=pending(7), C=pending(11) |
| In-tx re-read | f.bid_qty=7, f.item_qty=10 → 7 ≤ 10, proceed |
| Accept B | B→accepted, decidedAt=now |
| Decrement | item.qty=10-7=3, status stays 'in_stock' (3 > 0) |
| Sibling sweep | newQuantity=3; auto_reject siblings where qty_requested > 3 → only C (11 > 3) gets auto_rejected. A (3 ≤ 3) stays pending. |
| Post-accept | item.qty=3, A=pending(3), B=accepted(7), C=auto_rejected(11) |

The §9.2 test asserts this exact post-state.

### 4.3 Sold-out path

Item starts with quantity = 5. Two pending bids: A=2, B=5. Owner accepts B=5.

| Step | State |
|---|---|
| Pre-accept | item.qty=5, status='in_stock', A=pending(2), B=pending(5) |
| In-tx re-read | f.bid_qty=5, f.item_qty=5 → 5 ≤ 5, proceed |
| Accept B | B→accepted |
| Decrement | item.qty=0, status='sold' (newQuantity === 0 branch) |
| Sibling sweep | newQuantity=0 → "else" branch: auto-reject ALL remaining siblings → A→auto_rejected |
| Post-accept | item.qty=0, status='sold', A=auto_rejected(2), B=accepted(5) |

§9.3 asserts the status flip + qty=0 + A's auto_rejected status.

### 4.4 Over-subscribed accept path

Item starts with quantity = 3. Two pending bids: A=2 (older), B=5 (newer — was posted when qty was 5; in between, owner accepted a now-departed C=2 that took qty from 5 to 3). Owner now tries to accept B=5.

| Step | State |
|---|---|
| Pre-accept | item.qty=3, A=pending(2), B=pending(5) |
| Pre-tx SELECT (unlocked) | reads B as pending — proceeds into tx |
| In-tx lock + re-read | f.bid_qty=5, f.item_qty=3 → 5 > 3 — over-subscribed branch |
| B is flipped to auto_rejected with decidedAt=now (inside tx) |
| Throw ForbiddenError → tx rolls back? NO — the SET above is committed BEFORE the throw because the throw is within the same tx. PostgreSQL's tx semantics: the throw rolls back the tx EXCEPT FOR steps already committed by the framework... |
| Owner sees `{ ok: false, error: "Forbidden" }`; B is now `auto_rejected` |

**Critical correctness note on the throw-after-update pattern.** PostgreSQL transactions are atomic — if the body throws, the entire tx rolls back, INCLUDING the auto_reject UPDATE. The §9.4 test must verify the post-state carefully:

- Option A (preferred): The throw IS the failure signal AND the auto_reject UPDATE is rolled back. The owner sees Forbidden; the bid stays `pending`. The next refresh shows the bid as still pending — they can manually reject it.
- Option B: Swallow the throw, return `{ ok: false, error: "Bid no longer fits available stock" }`, and the auto_reject UPDATE commits.

**This spec chooses Option A.** Reasoning:

- Symmetry with slice-18's accept-path Forbidden behavior — if the tx body throws, the tx rolls back; the caller sees `Forbidden`. Adding a special-case auto-commit-then-throw path complicates the mental model.
- The bid is still actually pending after the failure — it didn't fit THIS time, but if another bid is rejected and stock recovers (no current path does this, but the slice-1b-1 inventory editor allows owners to increase quantity), the bid could become valid again. Auto-rejecting it on first-fail is destructive.
- The "next refresh shows the bid as pending" UX is honest. The owner clicks Reject manually if they want to clear it.
- The test §9.4 asserts that after a failed over-subscribed accept, B's status is **still pending** (the auto_reject UPDATE rolled back with the throw).

**This is a real drift from the brief's pseudocode**, which framed step 3 as "throw Forbidden; the bid auto-rejects." The Postgres semantics make the auto-reject-then-throw pattern silently roll-back. The plan's Task B3 must verify the test's post-state matches Option A — bid stays `pending` after the failed accept.

The over-subscribed branch's `auto_reject` UPDATE is therefore **removed** from the spec body above — included only for narrative; the implementation skips it. The corrected transaction body:

```ts
  // STEP 3 (CORRECTED): Over-subscribed accept guard.
  // No pre-throw UPDATE — Postgres tx semantics roll it back anyway.
  // The owner sees Forbidden; the bid stays pending; they can manually
  // reject it on the next page render.
  if (f.bid_qty > f.item_qty) {
    throw new ForbiddenError("Forbidden");
  }
```

The §9.4 test enforces this exact behavior (`expect(bidAfter.status).toBe("pending")`).

### 4.5 Defense-in-depth on the new UPDATE

The slice-3 verbatim discipline mandates that every UPDATE on a tenanted row include the session-org clause. Slice 18b adds the first such UPDATE for `inventory_items` inside the bid-accept tx:

```ts
await tx
  .update(inventoryItems)
  .set({ quantity: newQuantity, status: …, updatedAt: now })
  .where(and(
    eq(inventoryItems.id, row.inventoryItemId),
    eq(inventoryItems.orgId, orgId),  // ← slice-3 defense-in-depth
  ));
```

Without this clause, a forged `bidId` whose parent item belongs to a different org could in principle survive the pre-tx SELECT (which already gates on `row.itemOwnerOrgId === orgId`) — defense-in-depth ensures the UPDATE itself matches zero rows if any layer above is bypassed. Slice-18's `setInventoryItemBidMode` already follows this idiom; slice 18b mirrors it.

The bid UPDATEs continue to NOT include an explicit `eq(inventoryItems.orgId, orgId)` clause — they don't join to `inventory_items` in the UPDATE statement, but the parent's ownership was confirmed in the pre-tx SELECT and the parent-row lock guarantees the item didn't change orgs mid-tx (it can't — `inventory_items.org_id` has no UPDATE path in slice-1b-1's actions; the column is effectively immutable).

---

## 5. Server actions — diff from slice 18

Only two actions change. The other three (`rejectInventoryBid`, `withdrawInventoryBid`, `setInventoryItemBidMode`) are byte-stable.

### 5.1 Zod schema delta — `src/lib/inventory/bidValidation.ts`

```ts
export const postInventoryBidInput = z.object({
  inventoryItemId: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  currency: z.enum(["USD", "EUR", "INR", "JPY"]).default("USD"),
  notes: z.string().trim().max(500, "Notes too long").optional(),
  quantityRequested: z.number().int().positive().default(1),  // ← NEW
});
```

`default(1)` makes the field optional from the wire — the slice-18 UI shape (which doesn't pass quantityRequested) still validates. The slice-18b form WILL pass a value; the default exists for back-compat with any non-form caller (and as a safety net for the test fixtures).

**No maximum cap at the Zod layer.** The cap is per-item (`<= item.quantity`) — Zod can't know the item's quantity. The cap is enforced in `canBidOnItem`'s 6th check. Spec §3.1.

**No default on the schema migration ALSO means no default at Zod input** — but here we DO default, because the wire vs. DB are different layers. Schema DEFAULT 1 handles missing-column-on-INSERT (safety net for any non-Zod path). Zod default 1 handles missing-field-on-action-call (slice-18 form back-compat).

### 5.2 `postInventoryBid` — pass quantity through canBidOnItem

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

Two new lines: the canBidOnItem arg + the insert value. No other change.

### 5.3 `acceptInventoryBid` — full tx body per §4.1 (corrected)

The full implementation is in §4.1 + §4.4. The plan's Task B3 reproduces it. Summary of the delta vs. slice 18:

- The in-tx re-read SELECT now reads `quantity_requested` + `item.quantity` (joined), not just `bid.status`.
- New "over-subscribed" branch after the re-read.
- New `inventory_items` UPDATE for stock + sold-on-zero.
- Sibling sweep now filters `gt(quantityRequested, newQuantity)` — selective.
- Sold-out branch (newQuantity === 0) sweeps all siblings unconditionally (matches slice-18 behavior).

### 5.4 Demo mode short-circuit — unchanged

The `run()` wrapper's `if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" }` is hit before any of the new logic runs. Slice-18b adds zero new demo-write paths.

---

## 6. Query layer — `src/db/inventoryBids.ts`

### 6.1 `InventoryBidView` widens to include `quantityRequested`

```ts
export type InventoryBidView = {
  id: number;
  inventoryItemId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  quantityRequested: number;   // ← NEW
  status: InventoryBidStatus;
  decidedAt: Date | null;
  createdAt: Date;
};
```

The SELECT projection in `getInventoryBidsForItem` adds `ib.quantity_requested`; the row mapper adds `quantityRequested: r.quantity_requested`. No SQL filter change. No new visibility logic. The slice-18 truth-table tests stay green (they assert visibility shape, not column presence).

### 6.2 No new query helper

Slice 18b doesn't need an "available stock per item" projection — `inventory_items.quantity` is already on `SharedInventoryRow` (slice 15) + on `InventoryAdminRow` (slice 1b-1). The InventoryBidsTab consumer composes the two: `item.quantity` from the page-level fetch + `bids` from `getInventoryBidsForItem`.

### 6.3 Demo mode

`isDemoMode()` returns `[]` (unchanged). The demo `/exchange` shim consumes `DEMO_INVENTORY_BIDS` directly. The shim must now project `quantityRequested` through the same type-widened shape — but since the demo bids are now annotated (§2.4), this is automatic.

---

## 7. UI

### 7.1 `PostInventoryBidForm` — quantity input + available-stock hint

`src/components/inventory/PostInventoryBidForm.tsx` (slice-18 file, modified):

```tsx
export function PostInventoryBidForm({
  inventoryItemId,
  availableQuantity,    // ← NEW prop
  postInventoryBid,
}: {
  inventoryItemId: number;
  availableQuantity: number;
  postInventoryBid: (input: PostInventoryBidInput) => Promise<ActionResult>;
}) {
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<"USD" | "EUR" | "INR" | "JPY">("USD");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("1");      // ← NEW state, default 1
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cents = …;  // unchanged
  const qty = (() => {
    const n = Number(quantity);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return 0;
    return n;
  })();

  const overStock = qty > availableQuantity;   // ← NEW

  function submit() {
    setError(null);
    if (overStock) return;                              // ← NEW client-side guard
    start(async () => {
      const res = await postInventoryBid({
        inventoryItemId,
        priceCents: cents,
        currency,
        notes: notes.trim() ? notes.trim() : undefined,
        quantityRequested: qty,    // ← NEW field on the wire
      });
      if (res.ok) {
        setPrice("");
        setNotes("");
        setQuantity("1");           // ← reset on success
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form …>
      {/* Available stock hint — visible above the price input */}
      <p className="text-[10px] text-text/40">
        Available: {availableQuantity} unit{availableQuantity === 1 ? "" : "s"}
      </p>
      <div className="flex gap-2">
        {/* Quantity input — NEW */}
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
        {/* Existing price + currency + notes inputs unchanged */}
        …
      </div>
      {overStock && (
        <p role="alert" className="text-xs text-bad">
          Cannot bid for more than {availableQuantity} units.
        </p>
      )}
      <button
        type="submit"
        disabled={pending || cents === 0 || qty === 0 || overStock}
        …
      >
        {pending ? "Submitting…" : "Place Bid"}
      </button>
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </form>
  );
}
```

**Why client-side stock guard in addition to the action-layer 6th check?** UX — clicking submit when you've typed `100` into the quantity field for a 5-unit item should NOT fire a request that returns `Forbidden`. The action layer is the security gate; the client-side guard is the speed gate. The §9 test asserts both layers reject the over-stock case.

### 7.2 `InventoryBidsTab` — quantity column + per-row badge

`src/components/inventory/InventoryBidsTab.tsx` (slice-18 file, modified):

- The bid row gains a `quantity_requested` display: `Bid: $X for N units` (or `× N` next to the price for compactness).
- Props gain `inventoryItem.quantity: number` (the available stock — threaded from the page so the embedded `PostInventoryBidForm` can render the hint + cap).

```tsx
type Props = {
  inventoryItem: {
    id: number;
    name: string;
    ownerOrgId: number;
    bidMode: "single" | "history" | null;
    quantity: number;                       // ← NEW
    status: "in_stock" | "reserved" | "sold"; // ← NEW (drives sold-out copy)
  };
  viewerOrgId: number;
  bids: InventoryBidView[];
  actions: { … };
  onClose: () => void;
};
```

Row rendering (excerpt — the new `quantity_requested` span is added between price and status badge):

```tsx
<li key={b.id} aria-label="bid row" className="flex flex-wrap items-center gap-2 py-2">
  <span className="flex-1 text-text/80">{isOwner ? b.bidderOrgLabel : "You"}</span>
  <span className="font-mono text-text/70">{fmt(b.priceCents, b.currency)}</span>
  <span className="text-[10px] uppercase tracking-wider text-text/40">
    × {b.quantityRequested}
  </span>
  <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_CLASS[b.status]}`}>{b.status}</span>
  …
</li>
```

The form is rendered only when `inventoryItem.status !== "sold"`:

```tsx
{inventoryItem.bidMode !== null && (isOwner || bids.length > 0) && (
  <ul …>{/* rows */}</ul>
)}

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

### 7.3 `/exchange` row — Sold badge + hide Place Bid

`src/components/inventory/TradeNetInventoryList.tsx` (slice-18 file, modified):

- The `Place Bid` button is hidden when `it.status === "sold"`.
- A "Sold" badge (zinc-pill, distinct from the slice-18 gold "Bidding · single" badge) renders inline.

```tsx
{it.status === "sold" ? (
  <span className="rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
    Sold
  </span>
) : (
  it.bidMode !== null && it.orgId !== viewerOrgId && (
    <button … >Place Bid …</button>
  )
)}
```

The `SharedInventoryRow` already projects `status` (slice 15) — no new wire shape needed.

### 7.4 `/exchange` page wires `inventoryItem.quantity` through

`src/app/(admin)/exchange/page.tsx` already prefetches `bidsByItemId`. Slice 18b extends the props passed into `TradeNetInventoryList` + (for the drawer) into `InventoryBidsTab` to include each item's `quantity` and `status`. Both fields are already on `SharedInventoryRow` from slice 15 — no DB-layer change; just plumbing.

### 7.5 `/inventory` admin — no changes

The owner's own inventory editor (`InventoryAdmin.tsx`) already lets owners set `quantity` and `status` via the slice-1b-1 form. Slice 18b doesn't add UI here — the stock decrement is automatic on accept.

A future polish slice could add a "Bidding has reserved N units on this row" note next to the quantity input — out of scope here. Defer to slice 18d / polish.

### 7.6 Demo mode UX

The demo `/exchange` shim renders items 601, 602, 603 with the slice-18b-annotated bids. Clicking Place Bid on item 603 opens the drawer with the partial-fill scenario visible (one 5-unit AIYA bid pending against a 50-unit parcel). Submitting any form returns the demo-disabled error.

---

## 8. Demo seed — annotation + partial-fill demo

Per §2.4. Summary of the demo deltas:

| Item | Slice 18 state | Slice 18b state |
|---|---|---|
| 601 Mehta Round (qty 1) | bidMode='single', 1 pending bid (1 unit) | bidMode='single', 1 pending bid w/ quantityRequested=1 (semantically unchanged) |
| 602 Saint-Cloud Cushion (qty 1) | bidMode='history', 1 pending bid (1 unit) | bidMode='history', 1 pending bid w/ quantityRequested=1 (semantically unchanged) |
| 603 Marathi parcel (qty 50) | bidMode=null, 0 bids | bidMode='history', 1 pending bid w/ quantityRequested=5 |

The third row is the marquee demo — partial-fill mechanic on a high-quantity parcel. Reviewers can see the "× 5" rendering in the bid drawer and the "Available: 50 units" hint on the form.

### 8.1 Demo seed test updates

`test/lib/demo/seed.test.ts` extends slice-18 assertions with:

- `DEMO_INVENTORY_BIDS` has 3 entries (was 2); the third targets item 603.
- The third entry's `quantityRequested === 5`.
- `getSeedInventoryBidModes()` returns `{ 601 → "single", 602 → "history", 603 → "history" }` (was 603 → null).
- `getSeedSharedInventoryForOrg(DEMO_AIYA_ORG_ID)` row for item 603 now has `bidMode === "history"`.

---

## 9. Tests

All under `test/db/`, `test/lib/inventory/`, `test/components/inventory/`. Mirrors slice-18 §9 in structure; extends the existing test files with new cases + updates the slice-18 atomicity assertion.

### 9.1 `test/db/inventory-bids.test.ts` — extend slice-18 truth table

Slice-18 truth-table cells (bidder/owner/third-party/stranger) stay green. ADD one case:

- `getInventoryBidsForItem` projection includes `quantityRequested` on every returned row. Seed a bid with `quantityRequested: 7`; assert the view shape's field reads back as `7`.

### 9.2 `test/lib/inventory/bid-accept-atomicity.test.ts` — REVISE existing + ADD partial-fill

**Slice-18 baseline test that must be REVISED:**

The existing test (`accepts one bid, auto-rejects siblings, leaves inventory_items.status unchanged`) asserts `itemAfter.status === "in_stock"` and `itemAfter.quantity === 10` AFTER accepting bid #2 (priceCents=200). All three seeded bids in that test have `quantityRequested: undefined` (uses DB DEFAULT 1). Accepting any single-unit bid against a 10-unit item leaves 9 units → slice-18b correct post-state is `quantity === 9` and the OTHER two single-unit bids STAY pending (they still fit in 9). Update the assertion:

```ts
expect(byId.get(insertedBids[0].id)?.status).toBe("pending");   // ← was "auto_rejected"
expect(byId.get(insertedBids[1].id)?.status).toBe("accepted");
expect(byId.get(insertedBids[2].id)?.status).toBe("pending");   // ← was "auto_rejected"

expect(itemAfter.status).toBe("in_stock");                       // unchanged — still stock left
expect(itemAfter.quantity).toBe(9);                              // ← was 10
```

**The slice-18 concurrent-accept race test** (`two concurrent accepts on the same item — exactly one wins`) seeds 2 bids on a quantity=5 item with implicit qty_requested=1 each. After slice 18b: accepting either bid leaves 4 units AND the OTHER bid stays pending (since 1 ≤ 4). So the "exactly one accepted + exactly one auto_rejected" assertion is wrong — it becomes "exactly one accepted + exactly one PENDING (the loser raced but the actual data didn't conflict — only the locking did)". REVISE:

```ts
const accepted = after.filter((b) => b.status === "accepted");
const pending = after.filter((b) => b.status === "pending");
expect(accepted).toHaveLength(1);
expect(pending).toHaveLength(1);   // ← was: auto_rejected.length === 1

expect(itemAfter.status).toBe("in_stock");
expect(itemAfter.quantity).toBe(4);   // ← was 5; one unit decremented
```

The race semantics are still tested: only one tx wins the lock at a time, and the second tx observes the locked state correctly (it sees its own bid is still pending — because it's a 1-unit bid against the now-4-unit item — and successfully accepts it too). The race test's INVARIANT shifts from "exactly one accept ever" to "no double-decrement of stock." Update the test name + body accordingly.

**Alternatively**, raise both seeded bids to `quantityRequested: 5` so the original "exactly one accept" semantics survive (only one 5-unit bid can fit in a 5-unit item; the second necessarily becomes Forbidden). The plan recommends this approach — it preserves the original test's semantic intent with a one-line seed change:

```ts
const [bidA, bidB] = await db.insert(inventoryBids).values([
  { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "A", priceCents: 100, quantityRequested: 5 },
  { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "B", priceCents: 200, quantityRequested: 5 },
]).returning();
```

After this seed change, the original "exactly one ok + one Forbidden" assertion still holds — the second tx finds qty=0 (the first one's accept landed) and bails per §4.4. Item status is `'sold'`, quantity=0. Update the test's post-state assertions:

```ts
expect(itemAfter.status).toBe("sold");        // ← was "in_stock"
expect(itemAfter.quantity).toBe(0);           // ← was 5
```

**NEW marquee test — `partial accept leaves smaller bids pending, rejects oversubscribed bids`:**

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
  expect(byId.get(bidA.id)?.status).toBe("pending");         // 3 ≤ 3 remaining → stays pending
  expect(byId.get(bidB.id)?.status).toBe("accepted");
  expect(byId.get(bidC.id)?.status).toBe("auto_rejected");   // 11 > 3 remaining → auto_rejected

  const [itemAfter] = await db
    .select({ status: inventoryItems.status, quantity: inventoryItems.quantity })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, item.id));
  expect(itemAfter.status).toBe("in_stock");
  expect(itemAfter.quantity).toBe(3);     // 10 - 7 = 3
});
```

**NEW test — `sold-on-zero flips inventory_items.status to 'sold'`:**

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

  const [bidAAfter] = await db.select({ status: inventoryBids.status })
    .from(inventoryBids).where(eq(inventoryBids.id, bidA.id));
  expect(bidAAfter.status).toBe("auto_rejected");  // sold-out path → all siblings rejected
});
```

**NEW test — `over-subscribed accept returns Forbidden and leaves bid pending`:**

```ts
it("over-subscribed accept returns Forbidden and leaves bid pending", async () => {
  // Item has 3 units; bid asks for 5 (was posted when stock was higher).
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

  // Post-state: bid stays pending (the tx rolled back; no destructive side-effect)
  const [bidAfter] = await db.select({ status: inventoryBids.status })
    .from(inventoryBids).where(eq(inventoryBids.id, bid.id));
  expect(bidAfter.status).toBe("pending");

  // Item untouched
  const [itemAfter] = await db.select({
    status: inventoryItems.status,
    quantity: inventoryItems.quantity,
  }).from(inventoryItems).where(eq(inventoryItems.id, item.id));
  expect(itemAfter.status).toBe("in_stock");
  expect(itemAfter.quantity).toBe(3);
});
```

### 9.3 `test/lib/inventory/bid-authz.test.ts` — ADD over-stock-bid cell

Slice-18 cells stay green. ADD:

- `postInventoryBid` with `quantityRequested > item.quantity` → `Forbidden` AND zero rows inserted (`canBidOnItem` 6th precondition).
- `postInventoryBid` with `quantityRequested === item.quantity` → `{ ok: true }` (boundary — equal is allowed).
- `postInventoryBid` with `quantityRequested = 0` → Zod-rejection (positive integer required). Existing `bidValidation.test.ts` already covers this if extended.

### 9.4 `test/lib/inventory/bidValidation.test.ts` — ADD quantity cell

Slice-18 cells stay green. ADD:

- `quantityRequested` defaults to 1 when omitted → input.quantityRequested === 1.
- `quantityRequested: 0` rejected (positive).
- `quantityRequested: -5` rejected (positive).
- `quantityRequested: 1.5` rejected (integer).
- `quantityRequested: 1000000` accepted (no Zod cap; item-level cap is in canBidOnItem).

### 9.5 `test/components/inventory/InventoryBidsTab.test.tsx` — extend

ADD:

- Bid row renders `× N` next to price for the seeded `quantityRequested` value.
- Form is hidden when `inventoryItem.status === "sold"`.
- "This item is sold out" copy renders when status === "sold".
- `PostInventoryBidForm` receives `availableQuantity` prop equal to `inventoryItem.quantity`.

### 9.6 `test/components/inventory/PostInventoryBidForm.test.tsx` — NEW or extend

If slice-18 didn't ship a dedicated form test (it didn't — slice-18 §9.7 covers the form inside `InventoryBidsTab.test.tsx`), ADD a thin dedicated test file:

- Quantity input renders with `min={1}` and `max={availableQuantity}`.
- Typing a quantity exceeding `availableQuantity` shows the over-stock error AND disables submit.
- Submitting with a valid quantity passes `quantityRequested` through to the action.
- "Available: N units" hint renders with the right pluralization (`1 unit` vs `5 units`).

### 9.7 `test/components/inventory/TradeNetInventoryList.test.tsx` — extend

ADD:

- "Sold" badge renders when `it.status === "sold"`.
- Place Bid button is HIDDEN when `it.status === "sold"` (even if bidMode !== null + viewer != owner).

### 9.8 `test/lib/demo/seed.test.ts` — extend per §2.4

Per §8.1. The new fixtures must satisfy the type-widened `SeedInventoryBid` shape.

### 9.9 Migration smoke test — extend `test/db/inventory-bids-migration-smoke.test.ts`

ADD a column assertion: `inventory_bids.quantity_requested` exists, is `integer`, `NOT NULL`, with DEFAULT 1. Mirrors the slice-18 schema-shape assertions on the same file.

### 9.10 Existing tests stay green

- Slice 15 `test/db/inventory.test.ts` — unchanged (slice 18b doesn't touch the visibility predicate or `getSharedInventoryForOrg` projection).
- Slice 16 `test/db/bids.test.ts` + `test/lib/deals/*` — slice 18b doesn't touch slice 16's surface.
- Slice 18 `test/lib/inventory/bid-withdraw.test.ts` + `bid-mode-toggle.test.ts` — slice 18b doesn't touch withdraw or mode toggle. Stay green.
- Slice 18 `test/lib/inventory/bid-accept-atomicity.test.ts` — REVISED per §9.2.
- Slice 18 `test/db/inventory-bids.test.ts` — extended per §9.1.

---

## 10. Migration plan

- New drizzle migration `0014_*.sql` (next sequential — last on main is `0013_inventory_bidding.sql`).
- Schema-only; additive. Existing rows: every `inventory_bids.quantity_requested` lands at `1` via the column DEFAULT. Zero changes to `inventory_items`.
- `outputFileTracingIncludes` already covers `./drizzle/**/*` — no Netlify config change.
- No env vars added. No Sentry tag additions beyond the existing `layer: "inventory-action"`.
- Demo seed runs on every cold pglite boot — slice 18b demo bids appear automatically on the dev DB.

**Rollout sequence:** schema → migration + smoke → query helper widening → server actions (canBidOnItem + postInventoryBid + acceptInventoryBid) + tests → UI (form + drawer + list) → demo seed → verify + ship. Same phase-A/B/C/D structure as slice 18.

---

## 11. Security & threat model — diff from slice 18

The risk surface is identical to slice 18 §11 in shape, but slice 18b adds stock-mutation atomicity to the list of invariants. Most cells of slice 18's threat table carry through verbatim; the deltas:

### 11.1 New invariant: stock-mutation only inside the locked tx

The `inventory_items` UPDATE that decrements quantity + flips status to sold lives ONLY inside `acceptInventoryBid`'s `db.transaction` body, AFTER the parent-row `SELECT FOR UPDATE` lock. No other action mutates `inventory_items.quantity` or `inventory_items.status` along the bid path. The §9.2 partial-fill test + the §9.2 sold-on-zero test are the regression guards.

If a future slice adds a "mark as reserved" UX that also mutates `inventory_items.status` along a non-locked path, that slice MUST take the same parent-row lock — otherwise a race between accept + mark-reserved could leave the row in an inconsistent state. This invariant is documented in the inline comment above the lock SELECT in `actions.ts`. Add an explicit note (TODO/INVARIANT comment) in the slice-18b commit so future authors see the rule.

### 11.2 Over-subscribed accept guard — no race, no leak

The 6th-precondition post-time check is best-effort; the locked re-read inside the tx is authoritative. There is no path where stock decrements below 0 — the §9.4 over-subscribed test asserts the bid stays pending AND item.quantity is unchanged on the Forbidden path. The accept never partial-applies (the throw rolls back any UPDATE that happened before the throw, by Postgres tx semantics).

### 11.3 No new wire fields beyond `quantityRequested`

`postInventoryBid`'s schema gains one positive integer. No `bidderOrgId`, no `ownerOrgId`, no wire-side quantity-of-stock or item.status hint — the action layer re-reads everything. The PR-review-checklist grep `grep -rn "orgId\|bidderOrgId\|ownerOrgId" src/lib/inventory/bidValidation.ts` still returns zero matches.

### 11.4 Defense-in-depth on the new UPDATE

Per §4.5: the new `inventory_items` UPDATE includes `AND eq(inventoryItems.orgId, orgId)`. Slice-3 invariant preserved.

### 11.5 Selective sibling sweep does NOT leak info

A bidder whose bid stays pending (still fits) gets no notification — there's no notification primitive yet (slice 20). They simply see their bid still pending on next refresh. No info leak. A bidder whose bid is auto_rejected sees the status flip on next refresh — same as slice 18.

### 11.6 PR review checklist additions

ADD to slice-18's §11.10:

- `grep -n "FOR UPDATE" src/lib/inventory/actions.ts` → exactly one match, inside `acceptInventoryBid`. Slice 18 introduced this; slice 18b must not remove or duplicate it.
- `grep -n "quantity_requested\|quantityRequested" src/lib/inventory/bidValidation.ts` → one match (the Zod field).
- `grep -n -A 5 "newQuantity === 0" src/lib/inventory/actions.ts` → confirms the sold-on-zero branch reaches `status: "sold"`.
- The two new `inventory_bids.status` set values (`auto_rejected` in the selective sweep + `auto_rejected` in the sold-out sweep) both filter on `ne(inventoryBids.id, input.bidId)` to avoid re-rejecting the just-accepted row.

### 11.7 Demo mode — unchanged from slice 18

Demo writes return `{ ok: false, error: "Demo mode — changes are disabled" }` at the `run()` short-circuit. Slice 18b adds no new demo write paths.

---

## 12. File plan

### New files

| Path | Purpose |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/drizzle/0014_*.sql` | Migration: `ADD COLUMN inventory_bids.quantity_requested INTEGER NOT NULL DEFAULT 1` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/inventory/PostInventoryBidForm.test.tsx` | Form quantity-input + over-stock guard + available-stock hint (new dedicated test file) |

### Modified files

| Path | Change |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/schema.ts` | Add `quantityRequested` column to `inventoryBids` table definition |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/inventoryBids.ts` | Widen `InventoryBidView` with `quantityRequested`; extend the SELECT + mapper |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/inventory/bidValidation.ts` | Add `quantityRequested` to `postInventoryBidInput` Zod schema (default 1, positive int) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/inventory/actions.ts` | `canBidOnItem` gains a 6th precondition + `quantityRequested` arg + `quantity` projection; `postInventoryBid` passes quantity through + inserts the new column; `acceptInventoryBid` body extended per §4.1 |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/inventory/PostInventoryBidForm.tsx` | Add quantity input + available-stock hint + over-stock client guard; pass `quantityRequested` to action |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/inventory/InventoryBidsTab.tsx` | Widen Props (item.quantity, item.status); render `× N` per row; hide form when sold; render sold-out copy; thread `availableQuantity` to form |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/inventory/TradeNetInventoryList.tsx` | Sold-badge branch (hides Place Bid when status === 'sold') |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/exchange/page.tsx` | Thread `item.quantity` and `item.status` into the row's props for the drawer (existing `SharedInventoryRow` already has both — only the prop wiring changes if the drawer is rendered by the same RSC) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/demo/seed.ts` | Add `quantityRequested` field to `SeedInventoryBid` interface; backfill on existing 2 entries (value=1); ADD the 3rd entry for item 603 (quantityRequested=5); flip `getSeedInventoryBidModes()` item 603 to "history" |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/bid-accept-atomicity.test.ts` | REVISE slice-18 baseline test + concurrent-accept race per §9.2; ADD partial-fill / sold-on-zero / over-subscribed-accept tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/bid-authz.test.ts` | ADD over-stock-bid cell per §9.3 |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/bidValidation.test.ts` | ADD quantity-input Zod cells per §9.4 |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/db/inventory-bids.test.ts` | ADD projection assertion for `quantityRequested` per §9.1 |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/db/inventory-bids-migration-smoke.test.ts` | ADD column-shape assertion per §9.9 |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/inventory/InventoryBidsTab.test.tsx` | Extend per §9.5 |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/inventory/TradeNetInventoryList.test.tsx` | Extend per §9.7 (Sold badge + Place Bid hidden) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/demo/seed.test.ts` | Extend per §8.1 |

### Removed files

None.

---

## 13. Out of Scope (explicit)

| Feature | Assigned to |
|---|---|
| Counter-offer linkage (`parent_bid_id`) | Future (already deferred by slice 18 §13) |
| Bid expiration / TTL cron sweep | Future bid-lifecycle slice |
| Audit log of stock decrements (cross-table `inventory_stock_audit`) | Tenancy audit log slice (descended from slice 3 §10) |
| Per-bid notification on accept (email / push) | Slice 20 (Resend) |
| "Today's Inventory Bids" right-rail panel | Slice 18c (parallel — already named) |
| Highest-bid auto-sort on the BidsTab | Polish follow-up |
| Owner UX showing "5 units reserved by pending bids" on the inventory editor | Slice 18d / polish |
| `'reserved'` intermediate status transition (sold but not shipped) | Future — fulfillment/shipping slice |
| Outgoing-inventory-bids panel (bidder's "my pending offers" view) | Polish follow-up — mirror of slice 18c from bidder POV |
| Bid acceptance triggers `deals` row creation (auto-promote to Deal Room sale) | Future cross-subsystem slice |
| Per-currency FX / conversion | Polish follow-up — slice 16 deferred this on deals |
| Owner can adjust an item's quantity DOWN below sum-of-pending-bids (over-commit check) | Polish — currently the system allows the owner to manually edit quantity to a smaller number than open pending bids; the next accept observes the new state and rejects oversubscribed bids correctly per §4.4 |
| Concurrent-accept on DIFFERENT items by different orgs | Naturally serialized — each item has its own row lock; no cross-item contention. No explicit test needed beyond the slice-18 race test (which stays green per §9.2). |
| UI optimistic update (decrement quantity client-side before server confirms) | Polish — current behavior: page re-fetches after accept, server-state truth |
| Bulk accept (accept 3 of 5 pending bids at once) | Out of scope — accept-one-at-a-time is the slice-18 contract |
| Anti-flicker on the sold-out badge when stock is mid-decrement | RSC-level revalidatePath already triggers a re-render — no client-side spinner needed |

---

## Design summary table

| Concern | Choice |
|---|---|
| Schema delta | `inventory_bids.quantity_requested INTEGER NOT NULL DEFAULT 1`; no `inventory_items` schema change |
| Status taxonomy | Existing slice-1b-1 enum `["in_stock", "reserved", "sold"]`; canonical sold-out is `'sold'`; no new value |
| Authz delta | `canBidOnItem` 6th precondition: `quantityRequested <= item.quantity` at post time |
| Accept atomicity | Reuses slice-18 parent-row lock + in-tx re-read; extends with stock decrement + sold-on-zero + selective sibling sweep |
| Over-subscribed accept | Throws `Forbidden`; tx rolls back; bid stays `pending`. Owner can manually reject later. |
| Selective sibling sweep | Only auto-reject bids where `quantityRequested > newQuantity` (strict); equal bids stay pending |
| Sold-out (newQuantity = 0) sweep | Reverts to slice-18 unconditional sibling auto-reject |
| Demo seed delta | Existing slice-18 bids get `quantityRequested: 1`; new partial-fill bid for 5 units on item 603 (parcel); bidMode for 603 flipped to "history" |
| UI | PostInventoryBidForm gains quantity input + available-stock hint; InventoryBidsTab renders `× N` per row + sold-out copy; TradeNetInventoryList shows "Sold" badge when status === 'sold' |
| Defense-in-depth | New `inventory_items` UPDATE includes `AND eq(inventoryItems.orgId, orgId)` — slice-3 verbatim |
| Backward compat | Slice-18 callers and seeded bids interpret as 1-unit bids via DB DEFAULT + Zod default; zero data fixup required |
| Wire fields | Existing slice-18 fields + new `quantityRequested` (optional, default 1). ZERO orgId/label fields — server-computed |
| Security posture | Identical to slice 18 + the new stock-mutation invariant (§11.1) |
