# AIYA Dashboard — Slice 1b-1: Item-Level Inventory — Design

**Date:** 2026-05-25
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market), #1a (AIYA dashboard + reskin), #2 (company data) — all shipped on `main`.

## 1. Overview & Goals

Replace the Inventory Overview placeholder on the AIYA dashboard with real,
owner-entered, **item-level** inventory. The owner manages individual finished
pieces and loose stones through an in-app admin UI; the dashboard panel shows
category counts **derived** from those items. This slice also establishes the
`org_id` tenancy convention that every later business table will follow.

Goals:

- Real persistence (Postgres via the existing Drizzle layer) with a full Admin
  CRUD UI for inventory items.
- Light up the Inventory Overview panel with derived category counts + total.
- Capture the fields that matter for a diamond house: piece metal/weight and the
  stone **4 Cs** (carat, cut, color, clarity), so the next slice (diamond/gem
  price lists) can value real stones.
- Never show fake numbers — empty inventory renders an honest empty state.
- Keep tests fast and the market poller unaffected.

Non-goals (later slices): inventory **value** / Portfolio aggregation (1b-6);
diamond/gem **pricing** (1b-3); images, GIA/certificate numbers, supplier/origin
(enrichment slice); full nav routing for every section; customizable dashboard
layout (1c).

## 2. Roadmap Context

Slice 1b (real business data) is decomposed into sub-slices. Agreed build order:

| Sub-slice | Domain | Lights up | Status |
|---|---|---|---|
| **1b-1** | **Inventory (item-level)** | Inventory Overview | **This spec** |
| 1b-3 | Diamond/Gem price lists | Diamond indices, Mkt-Intel Diamonds, trend line | Next |
| 1c | Customizable dashboard layout | (cross-cutting UI) | After 1b-3 |
| 1b-2 | Orders & Pipeline | Orders & Pipeline | Later |
| 1b-4 | Financial Overview | Financial Overview | Later |
| 1b-5 | Crypto Wallet balances | Crypto Wallet | Later |
| 1b-6 | Portfolio Snapshot (aggregates) | Portfolio Snapshot | Later (depends on 1b-1/4/5) |

## 3. Tenancy (`org_id`) — established here

Per slice 1a's design (§2.1), business records carry an `org_id` from the start
so the future multi-tenant partner network is additive, not a rewrite.

- `inventory_items.org_id` is `integer NOT NULL DEFAULT 1`, where **1 = AIYA
  Designs** (the only org today).
- **No `orgs` table yet.** A real `orgs` table + per-user org resolution arrives
  with the dedicated multi-tenant slice. Until then, the data-access layer
  resolves the current org to the constant `AIYA_ORG_ID = 1` in one place
  (`src/db/org.ts`) so there is a single seam to replace later.
- All inventory reads/writes filter by `org_id`.

## 4. Data Model

One table, `inventory_items` (Drizzle `pgTable`, integer-only for money/weight —
no floats, consistent with slice 2's cents convention):

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `org_id` | integer NOT NULL default 1 | tenancy seam (§3) |
| `category` | text enum | Rings, Necklaces, Earrings, Bracelets, Pendants, Chains, Watch Bands, Diamonds, Gems |
| `name` | text NOT NULL | item title |
| `sku` | text NULL | optional owner reference |
| `quantity` | integer NOT NULL default 1 | units on hand for this record |
| `status` | text enum default `in_stock` | in_stock \| reserved \| sold |
| `unit_cost_cents` | integer NOT NULL default 0 | acquisition cost (for Portfolio later) |
| `retail_price_cents` | integer NOT NULL default 0 | asking/retail (for Portfolio later) |
| `metal` | text enum NULL | gold \| silver \| platinum \| other (finished pieces) |
| `weight_mg` | integer NULL | metal weight in milligrams (display ÷1000 = grams) |
| `carat_x100` | integer NULL | carat ×100 (1.01 ct → 101) — stones |
| `cut` | text NULL | e.g. Round, Princess, Emerald — stones |
| `color` | text NULL | e.g. D–Z grade — stones |
| `clarity` | text NULL | e.g. FL, IF, VVS1 — stones |
| `created_at` | timestamptz default now | |
| `updated_at` | timestamptz default now | |

Finished pieces populate `metal`/`weight_mg` and leave stone fields null; loose
stones (Diamonds/Gems categories) populate the 4 Cs and leave metal/weight null.
The form shows the relevant group based on the chosen category, but no field is
hard-required beyond `category` + `name` (lean data entry).

Migration generated via Drizzle Kit (`drizzle/`), applied identically to pglite
(dev/test) and Neon (prod), matching the slice-2 setup.

## 5. Derived Metrics

A single data-access query (`src/db/inventory.ts`) returns the dashboard summary:

- **Category counts** = `SUM(quantity)` grouped by `category`, filtered to
  `org_id = AIYA_ORG_ID` and `status <> 'sold'` (on-hand = in_stock + reserved).
  All nine categories are always returned (missing categories → 0) so the panel
  renders a stable 9-tile grid.
- **Total on-hand** = sum of the category counts.
- `updated_at` max across items → drives the panel's "updated Xd ago" label.

Inventory **value** (cost/retail sums) is intentionally NOT surfaced in this
slice; it is computed in Portfolio (1b-6). The cost/price columns exist now so
that slice needs no migration.

## 6. Admin UI — "Inventory"

A new admin page at `/inventory`, following the slice-2 admin pattern exactly:

- Item **list table** (name, category, qty, status, cost, price, key specs).
- **Create / update / delete** via **Server Actions** (`"use server"`) with
  **Zod** server-side validation; each action re-asserts the session
  (defense in depth) and is scoped to `AIYA_ORG_ID`.
- Actions return typed `{ ok: true } | { ok: false, error }`; the UI surfaces
  errors — **no silent failures**.
- Successful mutations revalidate the dashboard inventory data.
- **First-run empty state** with an "Add your first item" CTA.
- The category select drives which optional spec fields show (metal/weight for
  pieces, 4 Cs for stones).
- The sidebar **"Inventory"** nav entry becomes a real link to `/inventory`
  (other nav entries remain non-interactive placeholders for now).

## 7. Wiring the Inventory Overview Panel

- `src/app/page.tsx` (server component) reads the inventory summary (§5) via the
  data-access layer and passes it as a serializable prop into `DashboardGrid`,
  which forwards it to a new `InventoryOverviewPanel`.
- The panel renders the 9 category tiles (icon + label + count) + total, using
  the existing `Panel` primitive, with an **"updated Xd ago"** owner-data
  provenance label (distinct from market live/delayed/stale/simulated freshness,
  which does not apply to hand-entered data).
- No data → honest empty state ("No inventory yet — add items in the Inventory
  section").

## 8. Error Handling & Testing (TDD)

- **Unit:** the count-derivation query (group/sum, excludes `sold`, org-scoped,
  zero-fills absent categories) against pglite; the "updated Xd ago" formatting
  reuses the existing `updatedAgo` helper.
- **Integration:** Server Action create/update/delete round-trips and the query
  layer against pglite; Zod validation rejects bad input (e.g. negative
  quantity, unknown category) with surfaced errors.
- **Component:** admin form validation + empty states; Inventory Overview panel
  real-vs-empty rendering; category tiles reflect derived counts.
- **Performance:** admin route code-split; dashboard read cached/revalidated;
  **zero impact on the market poller** (separate subsystem).
- DB errors are surfaced, never swallowed.

## 9. Out of Scope (this slice)

Inventory value/Portfolio aggregation (1b-6); diamond/gem pricing (1b-3); images,
certificates, supplier/origin; multi-tenant `orgs` table and per-user org
resolution; routing for nav entries other than Inventory; customizable layout
(1c).
