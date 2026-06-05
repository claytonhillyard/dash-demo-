# AIYA Dashboard — Slice 16: Bidding tab + Today's Bids panel — Design

**Date:** 2026-06-05
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 2 (Deal Room), slice 3 (Multi-tenant), slice 4 (Circles), slice 10 (Deal Reply Threads) — particularly slice-10's `canSeeDeal` helper, `runWithUser` + `ForbiddenError` pattern, denormalized `*_org_label` identity convention, and per-row mode-snapshot discipline.

**Numbering note:** Slices 11-15 are reserved for the parallel-agent track (slice 11 "Polish + Observability" is in their feature branch). This bidding work picks up at slice 16. Functionally it is the direct sequel to slice 10.

---

## 1. Overview & Goals

Slice 10 turned the Deal Room into a two-way market through reply threads (freeform conversation). Slice 16 adds **structured price offers** — bids — alongside the messaging surface. Bidding completes the partner→owner trade loop: a partner can submit a *binding* dollar amount, and the owner can *accept* it to atomically transition the deal to `Filled`.

The Deal Room becomes a structured marketplace. Each deal now has two surfaces in its expansion accordion:

- **Messages** (slice 10) — freeform conversation, owner controls private/group visibility per deal.
- **Bids** (slice 16) — structured offers with a `pending → accepted/rejected/withdrawn/auto_rejected` lifecycle. The owner controls display mode (single standing offer per bidder vs. full history) — purely a render-time choice.

Plus a **Today's Bids** right-rail panel that aggregates incoming pending bids across the viewer's deals (owner perspective) — the "command-center" feed for whoever's running the trade floor.

**Goals:**

- New `bids` table with full lifecycle columns (status, decided_at, bid_mode snapshot).
- New `deals.bid_mode` column (owner's current display preference; default `"single"`).
- Five server actions wrapped in `runWithUser` + Zod: `postBid`, `acceptBid`, `rejectBid`, `withdrawBid`, `setDealBidMode`.
- `acceptBid` is **atomic**: deal → `Filled`, accepted bid → `accepted`, sibling pending bids → `auto_rejected`, all in one transaction.
- Two query functions in `src/db/bids.ts`: `getBidsForDeal` and `getTodaysBidsForOwner`.
- New `DealBidsTab` component nested inside `DealThreadAccordion` (tabs at top of accordion: `Messages | Bids`).
- New `TodaysBidsPanel` for the right rail.
- Demo seed: 2 pending bids on existing slice-10 demo deals so the live Netlify demo shows the feature.

## 2. Non-Goals (each has a named home)

- **Partial-quantity fills** — bids implicitly cover the whole deal quantity. The "buy 200g of a 320g lot" case is a follow-up (slice 17 photos may come first; partial-fills slice TBD).
- **Bid expiration / TTL** — bids live until acted on. Vercel Cron-based expiration is a downstream slice.
- **Email notifications when a bid arrives** — covered by slice 20 (Watchlists + Resend).
- **Counter-offers as a structured primitive** — bidders just submit a new bid (the data layer is append-only; submitting again creates a new row).
- **"Highest bid" auto-sort** — chronological-descending in slice 16; explicit sort UI is a polish follow-up.
- **Cross-org bid visibility** — bids are visible to exactly two orgs (deal owner + bidder). The thread_mode (private/group) does NOT influence bid visibility. They are separate surfaces with separate rules.

## 3. Schema

### 3.1 `bids` (new)

```ts
bids
  id                serial PK
  deal_id           int    NOT NULL  FK → deals(id) ON DELETE CASCADE
  bidder_org_id     int    NOT NULL  FK → orgs(id)
  bidder_org_label  text   NOT NULL    -- denormalized snapshot at send time (slice-4 pattern)
  price_cents       int    NOT NULL
  currency          text   NOT NULL DEFAULT 'USD'
  notes             text   NULL         -- optional plain-text, Zod-capped at 500 chars
  bid_mode          enum   NOT NULL     -- "single" | "history", snapshot at send time, immutable
  status            enum   NOT NULL DEFAULT 'pending'
                          -- "pending" | "accepted" | "rejected" | "withdrawn" | "auto_rejected"
  decided_at        timestamptz NULL    -- set when status moves off 'pending'
  created_at        timestamptz NOT NULL DEFAULT now()
```

Indexes:
- `(deal_id, created_at DESC)` — primary bid-list-for-a-deal read path
- `(bidder_org_id, status)` — supports "my outgoing bids" + withdraw lookups
- **Partial index** `(deal_id, status) WHERE status = 'pending'` — supports the accept-atomicity sweep (`UPDATE bids SET status='auto_rejected' WHERE deal_id = ? AND status = 'pending' AND id != ?`). Mirrors the slice-4 partial-index pattern (`deals_visibility_circle_idx`).

### 3.2 `deals` (alter)

```ts
+ bid_mode          enum NOT NULL DEFAULT 'single'   -- "single" | "history"; owner's CURRENT display preference
```

Migration: drizzle generates the next sequential migration file. Additive only — no destructive changes to existing rows. All existing deals get `'single'` as the default.

### 3.3 Demo seed deltas

Two pending bids appended to `src/lib/demo/seed.ts` after existing slice-10 message seeds, keyed off existing demo deals 109 + 110:

- Mehta (`DEMO_PARTNER_ORG_IDS.MEHTA`) → deal 109 — `price_cents: 12_300_00`, `notes: "Can pick up today, cash."`
- Saint-Cloud (`DEMO_PARTNER_ORG_IDS.SAINT_CLOUD`) → deal 110 — `price_cents: 89_500_00`, `notes: "Spot price + 2%, 2-day courier."`

Both `status: 'pending'`, `bid_mode: 'single'`. Idempotent guard checks `SELECT 1 FROM bids LIMIT 1` before inserting (same pattern slice 10 uses for `dealMessages`).

## 4. Visibility model — independent of `thread_mode`

A bid row is visible to exactly two orgs:
- The deal owner (`deals.org_id`)
- The bidder (`bids.bidder_org_id`)

This is true regardless of `deals.thread_mode`. **Bidding visibility is not coupled to messaging visibility.** Reasoning:

- Messages are conversation; the owner may want group-chat semantics (slice 10's `thread_mode = "group"`) so all partners can chime in.
- Bids are private trade negotiations. Even in group thread mode, a bidder's price offer is for the owner's eyes only — exposing it to other partners would undermine the negotiation primitive bidding is designed to enable.

Enforcement is in SQL inside `getBidsForDeal`:

```sql
WHERE (b.bidder_org_id = $viewerOrgId OR d.org_id = $viewerOrgId)
```

No application-layer filtering. The bidder sees their own bids. The owner sees all bids. Nobody else sees anything.

## 5. Display mode (the toggle — pure rendering choice)

`deals.bid_mode` is the owner's CURRENT display preference. The data layer is **always append-only** — every bid is a new row, no UPSERTs, no DELETEs. Mode switching never mutates existing rows.

Each row carries `bid_mode` as a snapshot at send time. This is for audit only ("this row was sent when display was set to X") — it does NOT affect rendering. The current `deals.bid_mode` value controls all rendering decisions.

**Single mode display (owner view):**
- For each `bidder_org_id` that has at least one `pending` bid, render the most recent pending row.
- Past rows from the same bidder are hidden behind a `[Show history (N)]` disclosure that expands inline.
- Non-pending rows (accepted/rejected/withdrawn/auto_rejected) are hidden by default, also surfaced via the same disclosure.

**History mode display (owner view):**
- Render every bid row chronologically (newest first).
- All statuses shown inline; status badge indicates state.

**Bidder view (both modes):**
- Bidder sees only their own bids. The `bid_mode` toggle is hidden from non-owners. In both modes, bidders see all their own bids chronologically.

Owner can flip mode anytime via `setDealBidMode`. Zero data risk.

## 6. Authz rules (all enforced via `runWithUser`)

1. **`postBid`** — caller must satisfy `canSeeDeal(orgId, dealId)` AND `caller.orgId !== deal.org_id` (no self-bidding) → insert as `pending` with `bid_mode` snapshot of current `deals.bid_mode`.
2. **`acceptBid`** — caller must own the bid's parent deal. **Atomic transaction:**
   - UPDATE bids: this bid → `status='accepted'`, `decided_at = now()`
   - UPDATE bids: all *other* pending bids on this deal → `status='auto_rejected'`, `decided_at = now()`
   - UPDATE deals: `status='Filled'`
3. **`rejectBid`** — caller must own the bid's parent deal. This bid → `status='rejected'`, `decided_at = now()`.
4. **`withdrawBid`** — caller must be the bid's `bidder_org_id`. Bid must currently be `status='pending'`. → `status='withdrawn'`, `decided_at = now()`. No time limit.
5. **`setDealBidMode`** — caller must own the deal. Updates `deals.bid_mode`. No row mutations on `bids`.

Violations throw `ForbiddenError` inside the `runWithUser` callback (slice-10 pattern). Wrapper maps to `{ok:false, error:"Forbidden"}` with zero DB writes.

**Defense-in-depth:** all UPDATEs include `AND deal_owner_orgId = $orgId` (or `AND bidder_org_id = $orgId` for withdraw) in their WHERE clause, mirroring the slice-3 inventory + slice-10 cleanup pattern (`updateInventoryItem`, `setDealThreadMode`). Closes any TOCTOU window between the existence check and the UPDATE.

## 7. Server actions (in `src/lib/deals/actions.ts`)

All wrapped via `runWithUser`. All inputs validated by Zod schemas living in new file `src/lib/deals/bidValidation.ts` (parallel to `replyValidation.ts`).

### 7.1 `postBid({ dealId, priceCents, currency?, notes? })`

Steps inside the callback:
1. Look up `(deal.id, deal.org_id, deal.visibility_circle_id, deal.bid_mode)`.
2. Assert `canSeeDeal` — `ForbiddenError` if not.
3. Assert `deal.org_id !== orgId` — `ForbiddenError` (no self-bidding).
4. Resolve bidder org label.
5. Insert `bids` row with current `deal.bid_mode` snapshot, `status='pending'`.

### 7.2 `acceptBid({ bidId })`

```sql
-- All within a single transaction (drizzle .transaction or raw BEGIN/COMMIT):
SELECT deal_id, status FROM bids WHERE id = $bidId
  → fail if not found, not pending, or caller doesn't own that deal
UPDATE bids SET status='accepted', decided_at=now()
  WHERE id = $bidId
UPDATE bids SET status='auto_rejected', decided_at=now()
  WHERE deal_id = $dealId AND status='pending' AND id != $bidId
UPDATE deals SET status='Filled', updated_at=now()
  WHERE id = $dealId AND org_id = $orgId   -- defense-in-depth
```

If the deal is already `Filled` or `Withdrawn`, the action returns `Forbidden` (you cannot accept a bid on a closed deal).

### 7.3 `rejectBid({ bidId })`

Single UPDATE with `status='rejected'`, `decided_at = now()`, gated on caller-owns-parent-deal.

### 7.4 `withdrawBid({ bidId })`

Single UPDATE with `status='withdrawn'`, `decided_at = now()`, gated on caller-is-bidder AND existing `status='pending'`.

### 7.5 `setDealBidMode({ dealId, mode })`

Single UPDATE on `deals.bid_mode`, gated on caller-owns-deal (with defense-in-depth `AND org_id = $orgId`).

## 8. Query layer (`src/db/bids.ts`)

### 8.1 `getBidsForDeal(db, viewerOrgId, dealId): Promise<BidView[]>`

```ts
type BidView = {
  id: number;
  dealId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  bidMode: "single" | "history";
  status: "pending" | "accepted" | "rejected" | "withdrawn" | "auto_rejected";
  decidedAt: Date | null;
  createdAt: Date;
};
```

SQL skeleton:
```sql
SELECT b.* FROM bids b
JOIN deals d ON d.id = b.deal_id
WHERE b.deal_id = $dealId
  AND (b.bidder_org_id = $viewerOrgId OR d.org_id = $viewerOrgId)
ORDER BY b.created_at DESC
```

Mode filtering is applied **client-side** (TS) by `DealBidsTab` — the query returns all visible bids, and the component decides which to render based on `deals.bid_mode`. This keeps the query simple and lets the component reuse the same data for the disclosure expand/collapse without a refetch.

Demo mode: returns `[]` (matches slice-10 query helpers).

### 8.2 `getTodaysBidsForOwner(db, viewerOrgId): Promise<TodaysBidView[]>`

```ts
type TodaysBidView = {
  bidId: number;
  dealId: number;
  dealSubject: string;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  createdAt: Date;
};
```

SQL:
```sql
SELECT b.id AS bid_id, d.id AS deal_id, d.subject, b.bidder_org_label,
       b.price_cents, b.currency, b.created_at
FROM bids b
JOIN deals d ON d.id = b.deal_id
WHERE d.org_id = $viewerOrgId
  AND b.status = 'pending'
  AND b.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
ORDER BY b.created_at DESC
LIMIT 30
```

Returns the day's pending incoming bids on the viewer's deals. UTC-day windowing avoids per-user timezone complexity in slice 16 (timezone-aware filter is a polish follow-up if it ever matters).

Demo mode: returns `[]` (matches slice-10 convention — `isDemoMode()` short-circuits at the query layer, so the right-rail panel always shows its "No bids today yet" empty state in the live Netlify demo). The seed constants in §3.3 are authored but not inserted into pglite at demo runtime; they exist as a source for any future demo-rendering shim. This is a known constraint inherited from slice 10's pattern and is consistent across the deals subsystem.

## 9. UI

### 9.1 `DealThreadAccordion` (slice-10 component, extended)

Add tabs at the top of the accordion:

```tsx
<div role="tablist">
  <button role="tab" aria-selected={tab === "messages"} onClick={…}>Messages</button>
  <button role="tab" aria-selected={tab === "bids"} onClick={…}>Bids</button>
</div>
{tab === "messages" ? <existing message UI /> : <DealBidsTab … />}
```

Default tab: `messages` (slice 10's existing surface). Tab state is local component state (not URL-synced) — minimal footprint, no router changes.

### 9.2 `DealBidsTab` (new component)

Props: `{ dealId, viewerOrgId, isOwner, currentBidMode, bids, actions }` where `actions = { postBid, acceptBid, rejectBid, withdrawBid, setBidMode }`.

States rendered:

- **No bids** — placeholder text + bid form (if viewer is not the owner).
- **Owner view, single mode** — group rows by `bidder_org_id`; for each bidder, show the latest pending row + `[Show history (N)]` disclosure + `[Accept] [Reject]` buttons on the latest pending row.
- **Owner view, history mode** — flat chronological list of all bids with status badges; `[Accept] [Reject]` buttons on pending rows only.
- **Owner view, mode selector** — `Display: [Single ▾ | History ▾]` at top of the tab. `onChange` fires `setBidMode({ dealId, mode })`.
- **Bidder view** — only the bidder's own bids, chronological. `[Withdraw]` button on pending rows. Bid form at bottom for submitting another bid.

Each bid row:
- `{bidder_org_label}` (owner view) or `You` (bidder view)
- `{currency} {price}` formatted as `$12,300.00`
- `{relative time}` (e.g. "12 min ago")
- Status badge (color-coded: pending=amber, accepted=emerald, rejected=zinc, withdrawn=zinc, auto_rejected=zinc)
- Optional `notes` rendered as plain text (whitespace-pre-wrap, same XSS-zero contract as messages)
- Action buttons per role + status

Plain-text rendering for `notes`: `<p className="whitespace-pre-wrap text-xs">{notes}</p>`. React escapes the string. No HTML construction from user data anywhere.

### 9.3 `PostBidForm` (new sub-component, lives inside DealBidsTab)

Inputs:
- `price` — number input (decimal), parsed to cents on submit
- `currency` — dropdown limited to `USD`, `EUR`, `INR`, `JPY` (the `deals.currency` column is unconstrained `text` in the schema, but the form enforces this short list via the Zod schema for slice 16 — broader currency support is a polish follow-up)
- `notes` — textarea, optional, maxLength=500

Submit button → calls `postBid` via `useTransition`. Disabled when price is empty or 0. On success, the form clears.

### 9.4 `TodaysBidsPanel` (new right-rail panel)

Props: `{ bids: TodaysBidView[], actions: { acceptBid, rejectBid } }`.

States:
- **Empty** — `"No bids today yet"` placeholder.
- **Populated** — each row: bidder label, price formatted, deal subject (truncated to 40 chars), relative time, `[Accept] [Reject]` buttons inline.
- Clicking a row's deal subject opens the parent deal in `DealRoomPanel` (sets `openDealId` via a callback prop — optional polish; if hard, scroll-into-view alone is fine).

Wired in `src/app/page.tsx` like the existing dashboard panels, using `getTodaysBidsForOwner(db, orgId)`.

## 10. Testing (mirrors slice-10's truth-table structure)

All under `test/lib/deals/` and `test/components/` per the deals subsystem convention.

### 10.1 `test/db/bids.test.ts` — query layer

- Visibility filter: bidder sees own bids, owner sees all, third party sees nothing.
- Mode-aware display NOT covered here (component layer test owns that).
- `getTodaysBidsForOwner` correctness: respects org_id filter, status='pending' filter, today-only filter.
- Demo-mode short-circuit returns `[]`.

### 10.2 `test/lib/deals/bid-authz.test.ts` — write-side truth table

Matrix dimensions: `{owner, bidder, third-party-in-circle, out-of-circle}` × actions `{postBid, acceptBid, rejectBid, withdrawBid, setBidMode}`. Each cell returns either `{ok:true}` or `{ok:false, error:"Forbidden"}` with zero unintended row mutations.

Self-bid case explicitly covered: deal owner attempts `postBid` on own deal → Forbidden, zero rows inserted.

### 10.3 `test/lib/deals/bid-accept-atomicity.test.ts`

- Seed deal with 3 pending bids from 3 different orgs.
- `acceptBid` on bid #1.
- Assert: deal.status === 'Filled', bid #1.status === 'accepted', bids #2 + #3.status === 'auto_rejected', all with `decided_at` set, all in the snapshot read after the action returns.
- Concurrent-accept safety: with two `acceptBid` calls on different bids of the same deal racing, exactly one succeeds (the other returns Forbidden because the deal is now Filled). This is enforced by the deal-status-equals-Open precondition inside the transaction.

### 10.4 `test/lib/deals/bid-withdraw.test.ts`

- Pending → withdrawn allowed (bidder only)
- Accepted → withdraw Forbidden (status must be pending)
- Owner attempting to withdraw a partner's bid → Forbidden
- Idempotent: double-withdraw on a row already in `status='withdrawn'` returns `{ok:true}` as a no-op (matches slice-10 `deleteDealMessage` idempotency pattern — never throw Forbidden on a state the caller is allowed to reach by other means). Implementation: the action checks for `status='withdrawn'` *before* the pending-status assertion and short-circuits with `{ok:true}` if already withdrawn.

### 10.5 `test/components/deals/DealBidsTab.test.tsx`

- Empty state renders placeholder + bid form
- Single mode renders one row per bidder + disclosure for history
- History mode renders all bids chronologically
- Mode selector hidden when viewer is not the owner
- Bid form hidden when viewer IS the owner (can't bid on own deal)
- Accept button click fires `acceptBid`
- Withdraw button only on bidder's own pending rows
- Status badge color/text matches each enum value
- XSS sanity: `notes: "<script>alert(1)</script>"` renders as visible text

### 10.6 `test/components/dashboard/TodaysBidsPanel.test.tsx`

- Empty state renders "No bids today yet"
- Populated state renders one row per incoming pending bid
- Accept button click fires `acceptBid`
- Rows are sorted newest-first

### 10.7 Demo seed test update

In `test/lib/demo/seed.test.ts`:
- Assert `bids` count is exactly 2 after first seed.
- Assert one bid is from Mehta on deal 109 with `priceCents = 12_300_00`.
- Assert one bid is from Saint-Cloud on deal 110 with `priceCents = 89_500_00`.
- Idempotency: second seed call adds zero rows.

## 11. Migration & rollout

- New drizzle migration (next sequential number — likely 0010 or higher depending on parallel-agent progress at land time).
- Migration is additive only: new `bids` table + `deals.bid_mode` column with non-null default `'single'`. Safe for existing rows.
- `outputFileTracingIncludes` already covers `./drizzle/**/*`. No Netlify config change.
- No env vars added.
- Demo seed runs on every cold pglite boot — slice 16 bids appear automatically in the Netlify demo.

## 12. Out-of-scope follow-ups (named, not built)

- **Partial-fill bids** — `bid_quantity ≤ deal.quantity`, deal lifecycle gains `Partial` state.
- **Bid expiration via cron** — `expires_at` column + Vercel Cron route that flips `pending → expired`.
- **Email/push notifications** — slice 20 (Resend) for "new bid arrived on your deal."
- **Counter-offer as a primitive** — currently bidders just submit a new bid; a structured `parent_bid_id` linkage would be a polish.
- **Highest-bid auto-sort** — owner UI control to sort by price instead of recency.
- **Outgoing-bids panel** — bidder's "my pending bids across all sellers" cross-deal view (mirror of `TodaysBidsPanel` from the buyer's perspective).
- **Timezone-aware "today" filter** — currently UTC start-of-day; user-tz filter when it matters.

---

## Design summary table

| Concern | Choice |
|---|---|
| Bid history model | Always append-only (every bid = new row); `bid_mode` is purely display |
| Display mode | Owner toggle: single (latest pending per bidder) vs history (all bids interleaved) |
| Visibility | Bidder + deal owner only; independent of `deals.thread_mode` |
| Quantity | Full-deal-quantity bids only (no partial fills in slice 16) |
| Accept side effect | Atomic deal→Filled + sibling-bids auto-reject in one transaction |
| Self-bidding | Forbidden (`caller.orgId === deal.org_id` → ForbiddenError) |
| Withdraw window | No time limit; bidder can withdraw any pending bid |
| Notes | Optional plain text, ≤500 chars, React-escaped rendering (XSS surface = zero) |
| Today's panel scope | Owner perspective only: pending incoming bids on your deals, UTC today |
| Authz pattern | Reuses slice-10 `canSeeDeal` + `runWithUser` + `ForbiddenError`; no new auth primitive |
| UI surface | `Messages | Bids` tabs inside slice-10's `DealThreadAccordion` + new right-rail `TodaysBidsPanel` |
| Defense-in-depth | All UPDATEs include `AND org_id = $orgId` (slice-3 / slice-10 cleanup pattern) |
| Security posture | Secure-by-default: plain-text only, never construct HTML from user data, no HTML sanitization libraries |
