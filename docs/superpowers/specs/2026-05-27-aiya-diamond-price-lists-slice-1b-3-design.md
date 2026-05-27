# AIYA Dashboard — Slice 1b-3: Diamond & Gem Price Lists — Design

**Date:** 2026-05-27
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0/#1/#1a/#2 and #1b-1 (inventory) — all shipped on `main`.

## 1. Overview & Goals

Owner-maintained, **Rapaport-style** diamond pricing plus named price points for
fancy-colored diamonds and gems. This lights up three currently-placeholder
surfaces with real, owner-supplied data:

- the **Natural Diamond Index** + **Lab Diamond Index** KPI cards (today: "awaiting
  price list"),
- the Market Intelligence **Diamonds** tab (today: "not yet wired"),
- the Price Trend chart's **Diamond Index line** (today: omitted).

Goals:

- A structured **price matrix** (shape × color × clarity × carat-band, separate
  Natural and Lab sheets) plus **named price points** for fancy-colored diamonds
  and gems.
- **CSV bulk import** (paste) + **inline cell editing**; honest provenance
  ("your pricing, imported <date>"), never presented as a live market feed.
- Derived **indices**, **24h change**, and a **trend** series from snapshotted
  history.
- Org-scoped like all business data; tests fast; market poller unaffected.
- **No seeded Rapaport values** — the numbers are owner-supplied (their licensed
  data). We build the container + importer only.

Non-goals (later slices): per-stone **inventory valuation** via the matrix
(belongs with Portfolio, slice 1b-6); parsing Rapaport's native multi-grid sheet
layout (we define our own clean long CSV); a configurable-benchmark UI; advanced
fancy-color grading.

## 2. Roadmap Context

Slice 1b decomposition (agreed order): 1b-1 Inventory (shipped) → **1b-3 Diamond/Gem
price lists (this spec)** → 1c Customizable layout → 1b-2 Orders → 1b-4 Financial →
1b-5 Crypto balances → 1b-6 Portfolio (consumes the matrix for per-stone value).

## 3. Tenancy

All new tables carry `org_id` (integer NOT NULL default 1 = AIYA), resolved via the
existing `currentOrgId()` seam (`src/db/org.ts`). All reads/writes filter by org.

## 4. Data Model (new tables; integer cents; Drizzle)

### 4.1 `diamond_matrix_prices` — the grid
One row per cell:

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `org_id` | integer NOT NULL default 1 | |
| `sheet` | text enum | `natural` \| `lab` |
| `shape` | text enum | `round` \| `fancy` |
| `color` | text enum | `D`..`Z` (see §5 constant) |
| `clarity` | text enum | `IF`,`VVS1`,`VVS2`,`VS1`,`VS2`,`SI1`,`SI2`,`SI3`,`I1`,`I2`,`I3` |
| `carat_band` | text | band key, e.g. `1.00-1.49` (see §5 constant) |
| `price_per_carat_cents` | integer NOT NULL | owner-supplied |
| `created_at` / `updated_at` | timestamptz | |

Unique: `(org_id, sheet, shape, color, clarity, carat_band)`.

### 4.2 `diamond_price_points` — named non-grid prices
For fancy-colored diamonds + gems (not on a Rapaport grid):

| Column | Type | Notes |
|---|---|---|
| `id` / `org_id` | | |
| `label` | text NOT NULL | e.g. "Pink Diamond 1ct", "Emerald" |
| `kind` | text enum | `fancy_diamond` \| `gem` |
| `price_per_carat_cents` | integer NOT NULL | |
| `created_at` / `updated_at` | timestamptz | |

### 4.3 `diamond_index_history` — snapshots for change/trend
| Column | Type | Notes |
|---|---|---|
| `id` / `org_id` | | |
| `series` | text | `natural_index`, `lab_index`, or a `point:<label>` key |
| `recorded_at` | timestamptz default now | |
| `value_cents` | integer NOT NULL | |

A row is appended for each tracked headline series on every import or
benchmark-affecting edit.

## 5. Constants (this slice; configurable later)

- **Colors:** `D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z`.
- **Clarities:** `IF,VVS1,VVS2,VS1,VS2,SI1,SI2,SI3,I1,I2,I3`.
- **Carat bands:** `0.01-0.03, 0.04-0.07, 0.08-0.14, 0.15-0.17, 0.18-0.22,
  0.23-0.29, 0.30-0.39, 0.40-0.49, 0.50-0.69, 0.70-0.89, 0.90-0.99, 1.00-1.49,
  1.50-1.99, 2.00-2.99, 3.00-3.99, 4.00-4.99, 5.00-5.99, 10.00-10.99` (a
  pragmatic standard set; the importer accepts any subset).
- **Benchmark cell** (the index): `shape=round, color=G, clarity=VS1,
  carat_band=1.00-1.49`, applied per sheet → Natural Index (natural sheet) and
  Lab Index (lab sheet).

## 6. Derived Values

- **Natural/Lab Index** = `price_per_carat_cents` of the benchmark cell on that
  sheet, or `null` (honest empty) if not present.
- **24h change** for a series = latest snapshot vs. the most recent snapshot with
  `recorded_at` ≥ 24h earlier (fallback: previous snapshot); `null` if <2 points.
- **Trend** = the `natural_index` series over the selected range (and `lab_index`
  if shown).
- Computed in a data-access module (`src/db/diamonds.ts`) returning typed summaries.

## 7. CSV Import + Inline Edit

### 7.1 Import (bulk)
- Admin selects **sheet** + **shape**, pastes CSV into a **textarea** (no file
  upload). Format (header required):
  `carat_band,color,clarity,price_per_carat`
  where `price_per_carat` is a dollar amount per carat (converted to integer cents).
- A server action validates every row (known color/clarity/band, positive price),
  and on success **replaces all cells for that (org, sheet, shape)** in one
  transaction, then appends index-history snapshots. Returns
  `{ ok:true, imported:N } | { ok:false, error }`. Malformed rows → the whole
  import is rejected with a row-specific message (no partial writes).

### 7.2 Inline edit + named points
- An editable **color × clarity grid** for a chosen sheet/shape/band updates
  individual cells (server action, per-cell upsert).
- Named price points get simple **CRUD** (label/kind/price).
- Admin route **`/diamonds`** (added to the auth middleware matcher), linked from
  the sidebar "Diamonds" entry.

## 8. Panel Wiring

- **KPI cards:** Natural/Lab Diamond Index render the benchmark $/ct + 24h change
  (▲/▼), or keep the honest "awaiting price list" state when the benchmark cell is
  absent.
- **Market Intelligence → Diamonds tab:** rows for Natural 1ct + Lab 1ct
  (benchmark) and each named point, with price/ct + 24h change. Honest empty state
  when no pricing exists.
- **Price Trend:** add a **Diamond Index line** (natural index) sourced from
  `diamond_index_history` via a small server read; omitted gracefully when there's
  no history yet.

Reads happen server-side (`ensureDbReady()`), passed as serializable props into the
client panels (same pattern as 1b-1 inventory).

## 9. Copyright & Honesty

Rapaport price lists are copyrighted/licensed. This slice ships **no real Rapaport
values** — only the schema, importer, and UI. The owner imports their own licensed
data; the UI labels it as **their** pricing with an "imported <date>" provenance,
distinct from the live market freshness used for metals/crypto. Tests use small
fictional fixtures.

## 10. Error Handling & Testing (TDD)

- **Unit:** CSV parse/validate (reject unknown grade/band, non-numeric/negative
  price, missing header); benchmark lookup; 24h-change + trend derivation;
  index/named-point summaries against pglite (`createTestDb`).
- **Integration:** import replace-in-transaction (no partial writes on a bad row);
  per-cell edit upsert; named-point CRUD; all org-scoped; session re-asserted.
- **Component:** KPI cards real-vs-empty; Diamonds tab rows + empty state; admin
  import/edit forms surface errors (never silent).
- **Security/perf:** `/diamonds` gated (matcher test); DB errors surfaced not
  swallowed; market poller untouched; admin route code-split.

## 11. Out of Scope (this slice)

Per-stone inventory valuation (Portfolio 1b-6); Rapaport native-layout parsing;
configurable-benchmark UI; file uploads; fancy-color sub-grading; multi-tenant org
resolution.
