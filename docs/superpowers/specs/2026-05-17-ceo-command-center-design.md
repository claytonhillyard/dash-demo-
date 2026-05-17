# CEO Command Center — Design

**Date:** 2026-05-17
**Status:** Approved (design); first slice pending implementation plan

## 1. Overview & Goals

A dense, dark "command center" dashboard ("Nocturnal Empire") with ~25 panels spanning
market data, company financials, HR, operations, infrastructure, social, an AI agent,
and a command terminal. The user wants the full system eventually wired to real
backends, built **incrementally one slice at a time**.

Goals:

- **Genuinely live** market data on day one (real financial APIs, honest freshness).
- A **professionally advanced** UI with a deep settings/options surface.
- **Smooth performance** with many live panels — a hard requirement, specified and tested.
- A foundation that later subsystems slot into with zero layout churn.

Non-goals (now): real backends for company/HR/ops/social/AI — these are later slices
with their own spec → plan → build cycles.

## 2. Scope Decomposition & Roadmap

The mockup is ~11 independent subsystems. Each later subsystem gets its own
spec/plan/build cycle. Build order:

| Slice | Subsystem | Status |
|---|---|---|
| **0** | App shell + design system + settings + auth scaffold | **This build** |
| **1** | Live Market Analysis (hybrid providers) | **This build** |
| 2 | Company core data (Postgres + admin UI) | Future |
| 3 | HR / People analytics | Future |
| 4 | Operations (work orders, maintenance, infra) | Future |
| 5 | Financial health (cash, runway, ratios) | Future |
| 6 | Client satisfaction (CSAT source) | Future |
| 7 | Social Media Hub (per-platform approved APIs) | Future |
| 8 | Notifications / activity feed | Future |
| 9 | ChillyAI agent (LLM + tools over your data) | Future |
| 10 | System terminal (command parser) | Future |

## 3. Tech Stack

- **Next.js (App Router) + TypeScript + Tailwind**, deployed on **Vercel**.
- **Route Handlers as a backend-for-frontend / proxy** — all third-party API keys live
  server-side only; the browser only ever calls our own endpoints.
- **Charts:** TradingView Lightweight Charts (market candles/sparklines, canvas);
  Recharts (analytics donuts/lines/bars, later slices).
- **Typography:** Inter (UI/dense data), JetBrains Mono (terminal/numeric tickers),
  Orbitron (ChillyAI wordmark + key headings). Stylized look is achieved with real
  fonts + CSS — never Unicode character substitution (accessibility).
- **Later (named, not built in slices 0–1):** Postgres (Neon via Vercel Marketplace)
  + Drizzle ORM; LLM API for ChillyAI; per-platform social APIs.

## 4. Architecture

Four layers, top to bottom:

1. **Browser (Next.js App Router):** dashboard shell, panel components, client
   revalidation (~10–15s). Never holds API keys.
2. **Server (Route Handlers):** provider router, normalizer, cache + rate-limit guard.
   Keys live here only.
3. **External providers (hybrid, slice #1):** CoinGecko (keyless, crypto),
   Frankfurter (keyless, fx), Finnhub (free key, equities/fx), Twelve Data
   (free key, indices/commodities).
4. **Later subsystems:** attach to the same server layer incrementally.

Data flows: panel → `/api/quotes` → server cache (fed by a single poller) →
normalized `Quote` → panel.

## 5. Data Layer (core of slice #1)

### 5.1 Normalized `Quote`

```
Quote {
  symbol        e.g. "AAPL" | "BTC" | "EURUSD" | "SPX" | "XAU"
  assetClass    equity | crypto | fx | index | commodity | bond
  display       e.g. "Apple Inc." / "Bitcoin"
  price         number
  changeAbs     number
  changePct     number
  currency      "USD"
  asOf          ISO timestamp (provider valuation time)
  source        "finnhub" | "twelvedata" | "coingecko" | "frankfurter" | "simulated"
  freshness     live | delayed | stale | simulated
}
```

Panels bind only to `Quote`. Swapping providers, adding paid keys, or moving to
WebSocket changes only an adapter — zero panel changes.

### 5.2 Symbol classification & routing

A static symbol registry tags each symbol with `assetClass`. The router maps class
to an **ordered** provider list and tries them in order (failover):

| Asset class | Primary | Fallback | Last resort |
|---|---|---|---|
| crypto | CoinGecko (keyless) | Finnhub | simulated |
| fx | Frankfurter (keyless) | Twelve Data | simulated |
| equity | Finnhub (key) | Twelve Data | stale cache → simulated |
| index | Twelve Data (key) | Finnhub (ETF proxy SPY/QQQ/DIA) | simulated |
| commodity | Twelve Data (key) | — | simulated (labeled) |
| bond / VIX | Twelve Data if available | — | simulated (labeled) |

### 5.3 Single poller, many clients

One server-side scheduler refreshes each class on its own interval (crypto ~10s,
equities ~15s, fx ~60s, commodities ~5m) into a server cache. All clients/tabs read
the cache, so upstream call rate is constant regardless of viewer count. Per-provider
request budgets are tracked; near exhaustion, the router skips to the next provider
rather than getting throttled.

**Client vs upstream cadence are independent.** The browser revalidates the
`/api/quotes` endpoint at a settings-controlled interval; that endpoint only reads
the server cache, so client refresh can be frequent (and is decoupled from) the
upstream provider poll cadence — viewer activity never consumes provider budget.

### 5.4 Honest freshness labeling

Every value carries `freshness`. UI shows a dot/label: green = live, amber = delayed,
grey = stale-cache, outline = simulated. **Nothing is ever silently fake.**

### 5.5 Graceful degradation

Primary fails → fallback → last good cached value (marked stale) → labeled simulated.
A panel never shows an empty box or crashes; it shows the best available data with
honest provenance.

## 6. Slice #0 — Foundation

- **Scaffold:** Next.js App Router + TypeScript + Tailwind on Vercel.
- **Design system:** "Nocturnal Gold" tokens (amoled/dark surfaces, gold accent +
  intensity scale, teal, status colors). A **`Panel` primitive** with built-in
  `loading / empty / error / live / stale / simulated` states and the freshness dot.
  Dense grid layout matching the mockup. Type system wired.
- **Full shell, honestly unwired:** left nav (all sections), top bar (logo + header
  ticker + search + notifications + profile + session clock), right rail (quick
  access, shortcuts, theme/display), footer status bar. The header ticker is the one
  top-bar element wired live in slice #1; every other non-market panel and control is
  a styled placeholder explicitly labeled "not yet wired" — **no fake numbers**.
- **Settings subsystem:** a typed settings store persisted to `localStorage` (DB
  later), a Settings panel exposing theme/accent/gold-intensity/amoled/reduce-motion/
  UI-scale/data-density/per-panel show-hide/refresh-rate. A `useSetting` hook so
  panels react live. Density and reduce-motion genuinely alter rendering.
- **Auth scaffold:** a real session gate protecting the dashboard. **Decision
  (default):** a single environment-configured credential (no public signup) + secure
  HTTP-only session cookie, passkey-ready. Hardening to passkey/MFA ("biometric" in
  the mockup footer) is a later slice. Swappable to Clerk if multi-user is ever
  needed.

## 7. Slice #1 — Live Market Data

In-scope panels bound to the data layer:

- Header **ticker strip**: S&P 500, NASDAQ, DOW, VIX, BTC/USD, ETH/USD.
- **Market Analysis** panel with tabs: Overview / Indices / Commodities / Crypto /
  Forex / Bonds.
- **Top-20 stocks table**: symbol, price, change, %chg, market cap, 52w, sparkline.
- **Mini-cards**: gold, silver, BTC, ETH, SOL.
- Each value renders its freshness dot.

Flow: client → `/api/quotes` → server cache (single poller) → normalized Quotes →
panels, revalidating at the settings-controlled interval. All non-market panels remain
honest placeholders until their future slice.

## 8. Non-Functional Requirements

### 8.1 Performance ("runs smooth" — testable)

- One shared store; panels use **selector subscriptions** so a single price tick
  re-renders only that cell, never the dashboard.
- Charts memoized; sparklines on canvas (Lightweight Charts), not 25 SVG React trees.
- Below-the-fold panels lazy-loaded / code-split.
- Updates batched to animation frames; `reduce-motion` disables flashing/animation.
- **Acceptance criterion:** a single-symbol tick must not re-render unrelated panels
  (asserted via render-count tests).

### 8.2 Settings surface

Deep, first-class — see §6. Persisted; reactive; affects real rendering, not cosmetic
only.

### 8.3 Security

API keys server-side only (env vars, never shipped to client). Dashboard behind an
auth gate. No secret values in logs or client bundles.

## 9. Testing Strategy

TDD throughout (red → green → refactor):

- **Unit:** provider adapters (mocked HTTP) → normalized `Quote`; router failover
  logic; freshness computation; budget guard.
- **Integration:** `/api/quotes` returns normalized data; full degradation chain
  (primary down → fallback → stale → simulated).
- **Component:** `Panel` states; settings effects (density, reduce-motion).
- **Performance:** render-count isolation (single tick ≠ global re-render).

## 10. External Dependencies / Action Required by User

- **Finnhub** free API key (email signup, no card).
- **Twelve Data** free API key (email signup, no card).
- CoinGecko and Frankfurter require no key.
- Keys provided as Vercel/local environment variables before slice #1 runs live;
  until then the data layer falls back to labeled simulated data so development is
  unblocked.

## 11. Out of Scope (this build)

Real backends for company/HR/ops/financial/social/notifications/AI/terminal; paid
data tiers; full commodity/bond coverage; passkey/MFA hardening; multi-user auth.
All are later slices.
