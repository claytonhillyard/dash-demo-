# AIYA Designs Dashboard — Slice #1a: Live Dashboard Shell & Reskin — Design

**Date:** 2026-05-24
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market data), #2 (company data) — all shipped on `main`.

## 1. Overview & Goals

Re-cast the existing "CEO Command Center" foundation as the **AIYA Designs** jewelry
business dashboard, delivering the exact dense look-and-feel of mockup 1 (the main
Dashboard / home screen). Every **market/price** panel is genuinely live on day one;
every **business-operations** panel renders as a polished, honest placeholder in its
correct position. No fake numbers anywhere.

AIYA Designs is a real, multi-generational high-end jewelry house that also wholesales
and mines across diamonds, gold, platinum, silver, and gems, sourcing directly from
India and Italy.

Goals:

- A **mockup-exact** dense AIYA-branded dashboard (layout, palette, typography, logo).
- All **metals / crypto / FX** panels wired to the existing live market layer with
  honest freshness labeling.
- All **business** panels present and correctly positioned, in an honest "not yet
  wired" state — never fake numbers.
- **Smooth performance** preserved: one price tick re-renders only its own cell.
- Schema/routing structured to be **tenant-ready** so later multi-tenant work is
  additive, not a rewrite.

## 2. Product Context & Roadmap

The four mockups are four distinct full app views, each its own future scope:

| View | Mockup | Status |
|---|---|---|
| **Main Dashboard** | image 1 | **This track (1a + 1b)** |
| Elite Command Center | image 2 | Future |
| Website Overview | image 3 | Future |
| Deal Room | image 4 | Future |

This document covers **Slice 1a** only. The main Dashboard is split:

- **Slice 1a (this doc):** AIYA rebrand + mockup-1 layout + all market/price panels
  live + honest placeholders for business panels. Tenant-ready structure, no business
  tables yet.
- **Slice 1b (next spec):** tenant-scoped, owner-maintained ("manual / POS-style")
  business data + admin CRUD for Inventory, Orders & Pipeline, Portfolio, Financial
  Overview, Crypto Wallet balances, and owner-maintained diamond/gem price lists —
  then wire those panels.

### 2.1 Multi-tenant future (flagged, not built here)

The long-term vision is a **multi-tenant platform**: AIYA is tenant #1, with partners
and business associates each getting their own dashboard and inventory, plus a private
B2B network between them for sharing inventory with specific trusted parties, deals,
and bidding (the TradeNet Exchange + Deal Room — mockups 2 and 4).

The current foundation is deliberately single-tenant. The cheap-now/expensive-later
decision is **data scoping**: business records introduced in 1b will carry an `org_id`
from the start (even while AIYA is the only org), so multi-tenant becomes additive.
**Slice 1a introduces no business tables**, so it only needs to ensure the dashboard
route and layout host org-scoped data later without moving panels.

## 3. Data Source Policy (the honesty contract)

| Domain | Source in this track | Freshness treatment |
|---|---|---|
| Gold, Silver, Platinum (commodities) | **Live** via existing market layer | live / delayed / stale / simulated dot |
| Bitcoin / crypto | **Live** via existing market layer | live / delayed / stale / simulated dot |
| FX (USD/AED, EUR/USD) | **Live** via existing market layer | live / delayed / stale / simulated dot |
| Natural / Lab Diamond Index, per-cut diamond & gem prices | **Owner-maintained price lists** (manual, POS-style) — added in **1b** | labeled "owner pricing — updated Xd ago", never presented as a live market feed |
| Inventory, Orders, Portfolio, Financial, Crypto-wallet balances | **Owner-entered** (manual, POS-style) — added in **1b** | "updated Xd ago" owner-data provenance |

A licensed diamond data feed (e.g. Rapaport / IDEX) may replace owner price lists later;
that is a future swap behind the same panel interface.

## 4. Architecture (additions in 1a)

No new backend subsystems. 1a is a **presentation + market-registry** slice:

- Extend the static symbol registry with **XPT (Platinum, commodity)** and
  **USD/AED (fx)**. They flow through the existing router → single poller → server
  cache → `/api/quotes` → `useQuotes` store, with zero changes to the poller contract.
- All live panels are client components subscribing to the `useQuotes` store via
  **selector subscriptions** (the existing `TickerStrip` pattern), each rendering a
  `FreshnessDot` driven by `quote.freshness`.
- The Unit Converter is **client-computed** from live quotes (no new endpoint).
- Business panels use the existing `Panel` primitive's `unwired` state.

## 5. Branding & Design System

A token + layout reskin of the existing "Nocturnal Gold" system — not a rewrite.

- **Palette (from mockup 1):** near-black / AMOLED base surfaces; gold gradient accent
  (existing `--gold` token, warmed); teal/green = positive, red = negative; secondary
  chart accents purple / blue / pink for multi-series charts and category tiles.
- **Identity:** AIYA diamond logo + "AIYA DESIGNS" wordmark and tagline
  "Crafting Brilliance. Building Trust." in the nav header; "Good Morning, AIYA 👑"
  greeting + subtitle in the top bar; "AIYA DESIGNS" profile control.
- **Typography:** keep the existing UI/mono pairing; stylized headings via real
  fonts + CSS only (no Unicode glyph substitution — accessibility).
- Reuse `globals.css` tokens, the `Panel` primitive, and existing state styling.

## 6. Layout & Panel Inventory

Rebuild `src/app/page.tsx` into the mockup-1 dense grid. Left nav lists all sections
(Dashboard, Command Center, TradeNet Exchange, Market Intelligence, Inventory,
Diamonds, Gold & Metals, Orders & Deals, Clients & CRM, Finances, Payments, POS System,
Crypto Wallet, Converter Hub, Reports & Analytics, Marketing Suite, Social & Inbox,
Calendar & Tasks, Documents, Settings) plus the AIYA ELITE card and Market Status
widget. Only **Dashboard** is a built page in 1a; other nav entries link to honest
"coming soon" routes.

| Panel | 1a treatment |
|---|---|
| Top KPI ticker — Gold 24K, Silver, Platinum, Bitcoin, USD/AED, EUR/USD | **LIVE** |
| Top KPI ticker — Natural Diamond Index, Lab Diamond Index | **Placeholder** (owner price-list → 1b) |
| Market Intelligence — Gold / Metals / Crypto tabs | **LIVE**; Diamonds / Gas / News tabs → placeholder |
| Price Trend Analytics — Gold + Bitcoin series, range selector | **LIVE**; Diamond Index series → placeholder |
| Unit Converter — Metals / Currency | **LIVE** (client-computed from live rates). **Currency tab offers a broad list (~30+ currencies)** — see §7.1. Weight tab = static unit math. Diamonds / Gas tabs → placeholder where no live source |
| Clock + month calendar widget | **Real** (client local time; static current month) |
| Footer status ticker — Gold / Diamond Index / Bitcoin | **LIVE** for Gold + Bitcoin; Diamond Index → placeholder cell |
| Inventory Overview (category tiles + counts) | **Placeholder** (1b) |
| Orders & Pipeline (donut + recent orders) | **Placeholder** (1b) |
| Portfolio Snapshot (total value, breakdown, area chart) | **Placeholder** (1b) |
| Financial Overview (revenue / expenses / profit, cash-flow, payment methods) | **Placeholder** (1b; folds in existing slice-2 company data) |
| Crypto Wallet (balance + holdings list) | **Placeholder** (1b; prices live, balances owner-entered) |
| TradeNet Exchange (summary stats + recent listings) | **Placeholder** (network slice, later) |
| AI Insights | **Placeholder** (later slice) |
| Today's Schedule | **Placeholder** (calendar slice, later) |
| Social & Inbox | **Placeholder** (later slice) |

## 7. Data Wiring Detail

- `registry.ts`: add `{ symbol: "XPT", assetClass: "commodity", display: "Platinum",
  currency: "USD" }` and `{ symbol: "USDAED", assetClass: "fx", display: "USD/AED",
  currency: "AED" }`. Confirm router maps `commodity` → Twelve Data (with simulated
  last-resort) and `fx` → Frankfurter / Twelve Data per existing slice-1 routing.
- Live KPI cards, Market Intelligence rows, Price Trend series, footer ticker, and the
  converter all read from `useQuotes` via selector subscriptions; no component holds
  more of the store than the symbols it displays.
- Where a live value is briefly unavailable, the existing graceful-degradation chain
  (primary → fallback → stale cache → labeled simulated) applies; the panel shows the
  best available value with an honest dot.

### 7.1 Broad currency coverage (Unit Converter)

The Converter's **Currency tab supports a broad set (~30+ currencies)**, distinct from
the small curated KPI-ticker FX set. Source and behavior:

- Driven by **Frankfurter** (keyless, ECB daily reference rates), which exposes the
  full supported-currency list and conversion between any pair (USD, EUR, GBP, AED,
  INR, JPY, CHF, CNY, AUD, CAD, SGD, HKD, …). India (INR) and Italy (EUR) sourcing
  make those especially relevant for AIYA.
- The converter fetches the currency list + rates **on demand** through a server route
  (keys stay server-side; Frankfurter is keyless but the call still proxies through our
  layer for caching/consistency). This is independent of the single market poller, so
  the broad list never inflates the ticker's upstream budget.
- Honest freshness applies: ECB rates are daily, so converter currency results are
  labeled accordingly (delayed/daily), never implied to be real-time tick data.
- Metals conversion in the converter continues to use the **live** XAU/XAG/XPT quotes
  from the store.

## 8. Honest Placeholder Treatment

Business panels render via the `Panel` `unwired` state: real title and mockup-matching
framing (faint preview chrome), explicitly labeled "not yet wired," **no fake numbers
and no fabricated charts**. This preserves the project's existing honesty principle and
keeps the layout visually complete for review.

## 9. Non-Functional Requirements

### 9.1 Performance
- Selector subscriptions so a single-symbol tick re-renders only that cell.
- Sparklines on canvas (Lightweight Charts), charts memoized.
- Below-the-fold panels lazy-loaded / code-split where it helps.
- `reduce-motion` setting continues to disable animation.
- **Acceptance criterion:** a single-symbol tick must not re-render unrelated panels
  (render-count test).

### 9.2 Security
- No new secrets. API keys remain server-side only; the browser calls only
  `/api/quotes`. Dashboard stays behind the existing #0 auth gate.

## 10. Testing Strategy (TDD)

- **Unit:** registry/router resolves `XPT` and `USDAED` to the correct live providers
  with the documented fallback chain (mocked HTTP → normalized `Quote`).
- **Component:** live KPI/Market Intelligence/converter panels bind to the `useQuotes`
  store and render a `FreshnessDot`; business panels render the honest `unwired` state
  (assert no numeric content).
- **Performance:** render-count isolation — one tick re-renders one cell, not the
  dashboard root.

## 11. Out of Scope (this slice)

All business data and its admin (→ 1b); diamond/gem price lists (→ 1b); TradeNet
Exchange network and Deal Room (→ later); AI Insights, Social & Inbox, Today's Schedule
(→ later); multi-tenant auth and the cross-org private network (→ later); mockups 2–4.
