# AIYA Dashboard — Netlify Demo (Simulation Mode) — Design

**Date:** 2026-05-27
**Status:** Approved (design); implementation plan pending
**Builds on:** all shipped slices on `main` (0/1/1a/2/1b-1/1b-3).

## 1. Overview & Goals

A public, shareable Netlify deployment of the AIYA dashboard that runs with **zero
secrets and no database** — driven by seeded, clearly-labeled simulation data — so
partners can click through a polished, always-full dashboard from a link. Built as a
single env flag with honest short-circuits; with the flag unset the app behaves
exactly as today (the real Vercel/Neon app is untouched).

Goals:
- One-link public demo, no login wall, no API keys, no `DATABASE_URL`.
- Every panel looks full (seeded to mirror the mockup) and is honestly labeled
  "simulated / demo".
- Writes are safely disabled so the seeded snapshot stays pristine across visitors.
- Deterministic & reliable (no external API calls in demo → no rate-limit/network
  flakiness).

Non-goals: real persistence/interactivity in demo (rejected option C — Netlify
functions are stateless across instances, so in-memory writes wouldn't survive);
static export; any change to non-demo behavior.

## 2. Single Flag: `NEXT_PUBLIC_DEMO_MODE`

A `NEXT_PUBLIC_` env var so both server (middleware, data-access, actions) and client
(banner, login note) can read it, via one helper:

```
// src/lib/demo/mode.ts
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
```

Every demo behavior keys off `isDemoMode()`. Unset (default) ⇒ all existing,
already-tested code paths run unchanged.

## 3. Behaviors When Demo Is On

| Area | Demo behavior |
|---|---|
| **Auth (middleware)** | Bypass the session check — `NextResponse.next()` for everyone. No login wall. |
| **Login page** | Still renders; shows "Demo mode — no login required" + an "Enter dashboard" link. |
| **Inventory read** (`getInventorySummary`) | Return seeded counts from `src/lib/demo/seed.ts` (no DB). |
| **Diamond read** (`getDiamondSummary`) | Return seeded indices + named points from the seed (no DB). |
| **Market poller** (`QuoteCache` fetcher) | Force the **simulated** provider for all symbols (deterministic; no external calls). |
| **Writes** (inventory + diamond server actions) | Short-circuit to `{ ok: false, error: "Demo mode — changes are disabled" }` before any DB/auth work; surfaced by `FormStatus`. |
| **Banner** | A slim "DEMO MODE · simulated data" strip in the shell. |

The market panels already render a "simulated" freshness dot, so the simulated feed is
self-labeling; the banner covers the seeded business data.

## 4. Seed Data (`src/lib/demo/seed.ts`)

Fixed, representative, mockup-matching constants (honestly fictional):
- **Inventory summary:** category counts (Rings 1,240 · Necklaces 980 · Earrings 870 ·
  Bracelets 620 · Pendants 450 · Chains 320 · Watch Bands 150 · Diamonds 2,350 ·
  Gems 1,120) + total + a fixed "updated today" label.
- **Diamond summary:** natural & lab index values with small 24h changes; named points
  (Pink/Blue/Yellow diamond, plus a couple of gems).

Shapes exactly match the existing `InventorySummary` / `DiamondSummary` types so the
demo path is a drop-in return.

## 5. Architecture / Integration

- `getInventorySummary` / `getDiamondSummary` gain a first-line `if (isDemoMode()) return
  <seed>;` guard — the single cleanest seam, leaving panels and page code unchanged.
- The market `QuoteCache` constructor's default fetcher uses a demo-aware chain:
  `isDemoMode() ? resolveQuotes(ALL_SYMBOLS, [simulatedProvider]) : resolveQuotes(ALL_SYMBOLS)`.
- Inventory/diamond actions gain a first-line demo guard returning the disabled error
  (before `requireSession`/validation), so demo writes never touch auth or the DB.
- `middleware.ts` returns `NextResponse.next()` immediately when `isDemoMode()`.
- A `DemoBanner` component rendered by the shell when `isDemoMode()`.

## 6. Netlify Config

- `netlify.toml`: `[build] command = "npm run build"`, `[[plugins]] package =
  "@netlify/plugin-nextjs"`, Node 20+. (`@netlify/plugin-nextjs` turns the
  middleware/SSR/route handlers/server-actions into Netlify Functions — no static
  export.)
- `@netlify/plugin-nextjs` added as a devDependency.
- `DEPLOY.md`: connect the repo to Netlify; set `NEXT_PUBLIC_DEMO_MODE=true` and a
  throwaway `SESSION_SECRET` (satisfies middleware's import even though auth is
  bypassed); **no API keys, no `DATABASE_URL`**. Notes that the real (non-demo)
  deploy needs those instead.

## 7. Testing (TDD)

- `isDemoMode()` true/false on the env var.
- `getInventorySummary` / `getDiamondSummary` return the seed under the flag, and hit
  the DB path when unset (existing tests still pass).
- Inventory + diamond actions return the disabled error under the flag (no DB write,
  no session call).
- `middleware` config/handler bypasses under the flag and still gates when unset.
- Market cache uses the simulated chain under the flag (no real provider call).
- `DemoBanner` renders only under the flag.
- Full suite + `tsc` + `next build` green; the existing non-demo suite unaffected.

## 8. Out of Scope

Interactive/persistent demo data; per-instance state; static-only export; multi-tenant;
auto-seeding a real Neon DB; any change to behavior when `NEXT_PUBLIC_DEMO_MODE` is unset.
