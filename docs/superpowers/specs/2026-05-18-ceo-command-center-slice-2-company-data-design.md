# CEO Command Center — Slice #2: Company Data Backend — Design

**Date:** 2026-05-18
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation) + #1 (live market data), both shipped on `main`.

## 1. Overview & Goals

Wire the dashboard's core business numbers to a real database with a full in-app
Admin CRUD UI, so the owner ("The Boss") maintains revenue, profit, clients,
employees, and projections directly from the command center. Replaces the honest
"not yet wired" placeholders for the company-data panels with real, owner-entered data.

Goals:

- Real persistence (Postgres) with a full Admin CRUD UI.
- Light up Company Overview KPIs, Revenue Projections, and Company Growth Analytics.
- Keep tests fast and the market poller unaffected.
- Never show fake numbers — empty data renders honest empty states.

Non-goals (later slices): projects, work orders, HR breakdowns, financial health,
client satisfaction.

## 2. Architecture & Stack Additions

- **Drizzle ORM** with two drivers behind a single `getDb()`:
  - **pglite** (`@electric-sql/pglite`) for dev + tests — real Postgres in WASM, no
    install, in-process (fast tests).
  - **Neon HTTP** (`@neondatabase/serverless` via `drizzle-orm/neon-http`) for prod.
  - Driver selected by presence of `DATABASE_URL` (set → Neon; unset → local pglite).
- **One schema file** (`src/db/schema.ts`). **Drizzle Kit** migrations in `drizzle/`,
  applied identically to both drivers.
- **Mutations via Server Actions** (`"use server"`); **reads via a data-access layer**
  (`src/db/queries.ts`) consumed by server components.
- **Auth:** admin pages and actions sit behind the existing #0 session gate. Middleware
  already protects `/`; each Server Action additionally re-asserts the session
  server-side (defense in depth).
- **Money stored as integer cents** everywhere (no floats).

## 3. Data Model

- `revenue_months(year, month, amount_cents)` — unique per `(year, month)`. Headline
  monthly bucket.
- `revenue_transactions(occurred_on, amount_cents, memo)` — itemized income.
- `profit_months(year, month, amount_cents)` — unique per `(year, month)`. Profit is
  entered monthly (not a transaction stream → no transaction table).
- `clients(name, status['active'|'prospect'|'churned'], value_cents, acquired_on)` —
  `acquired_on` is the **business acquisition date** (used for the growth series),
  kept separate from `created_at` (record-insertion time) so back-entered historical
  clients don't all collapse onto today's date.
- `employees(name, role, hired_on)` — count source for #2; full HR detail is slice #3.
- `projection_assumptions(base_year, base_revenue_cents, cagr_pct, per_year_overrides jsonb)`
  — singleton row.

All tables carry `id`, `created_at`, `updated_at`.

### 3.1 Revenue precedence rule (the "do both" resolution)

A given month's revenue total is computed to avoid double-counting:

> **If the month has any `revenue_transactions`, its revenue = the sum of those
> transactions. Otherwise, its revenue = the `revenue_months` manual bucket (or 0 if
> none).**

So the owner can *either* type a monthly total *or* itemize individual deals — both
are supported, never ambiguously combined.

## 4. Derived Metrics

- **Revenue MTD** = current month's revenue total (precedence rule).
- **Net Profit MTD** = current month's `profit_months` amount.
- **Operating Margin** = profit ÷ revenue for the current month (guard divide-by-zero).
- **Total Clients** = count of `status = 'active'` (total count shown alongside).
- **Employees** = `count(employees)`.
- **Growth Analytics** = monthly revenue + profit series, plus clients-added-per-month
  (derived from `clients.acquired_on`), over a **trailing 12 months**.
- **Revenue Projection** = `base_revenue × (1 + cagr)^n` for 5 years, with
  `per_year_overrides` taking precedence for any year set.

## 5. Admin UI — "Company Data" section

Pages: Revenue (months + transactions), Profit (months), Clients (table CRUD),
Employees (table CRUD), Projections (assumptions form).

- Create/update/delete via **Server Actions** with **zod** server-side validation.
- Actions return typed `{ ok: true } | { ok: false, error }`; the UI surfaces errors —
  **no silent failures**.
- Successful mutations revalidate affected dashboard data.
- **First-run empty states** with "Add your first …" CTAs. Never fake numbers.

## 6. Wiring the Panels

Replace placeholders for:

- **Company Overview** — real KPIs; render "—" / empty state when no data exists.
- **Revenue Projections** — real chart from the projection calc.
- **Company Growth Analytics** — real multi-line chart (Recharts) from the monthly series.

These panels show an **"updated Xd ago"** timestamp (owner-data provenance) — distinct
from the market panels' live/delayed/stale/simulated freshness, which does not apply to
hand-entered data.

## 7. Error Handling & Testing (TDD)

- **Unit:** projection math, margin calc (incl. divide-by-zero), revenue precedence
  rule, client/employee counts.
- **Integration:** Server Action CRUD round-trips and the query layer against pglite.
- **Component:** admin form validation states, empty states, KPI panel real-vs-empty.
- **Performance:** admin routes code-split; dashboard read queries cached/revalidated;
  **zero impact on the market poller** (separate subsystem).
- DB errors are surfaced, never swallowed.

## 8. Out of Scope (this slice)

Stay honest placeholders: Active Projects, Work Orders, Employee Distribution /
Milestones / Department Performance, Financial Health (cash/runway/ratios), Client
Satisfaction. Each is a later slice.

## 9. Related Future Work — Distribution (separate spec, NOT this slice)

The owner has requested, for a later dedicated spec:

- **Switch hosting from Vercel to Netlify.**
- **Installable desktop apps via Tauri** (`.dmg` / `.AppImage` / `.exe`), build output
  organized in per-OS folders.

**Open architectural tension to resolve in that spec:** the app is server-centric
(route handlers proxy secret API keys, middleware auth, market poller). A desktop build
must decide where the server/secrets live (bundle a local server with user-supplied
keys, vs. thin shell over the hosted site). `next export` is not viable. This is
explicitly deferred and does not affect slice #2.
