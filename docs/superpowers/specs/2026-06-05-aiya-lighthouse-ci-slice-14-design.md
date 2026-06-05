# AIYA Dashboard — Slice 14: Lighthouse CI — Design

**Date:** 2026-06-05
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market), #1a (AIYA dashboard + reskin + honesty contract), #1b-1 (inventory), #1b-3 (diamond price lists), #1c (customizable layout), demo (Netlify simulation mode), slice 2 (Deal Room), slice 3 (Multi-Tenant Foundation), slice 4 (Circles), slice 5 (Website Overview), slice 10 (Deal Reply Threads), slice 11 (Polish + Observability — `@sentry/nextjs@^8` wired with action-wrapper + middleware + client-poll capture; `withOrgScope` + `beforeSend` scrubber establish the tenancy-safe capture pattern), and **slice 12 (Web Vitals — `web-vitals@^5` reports LCP/INP/CLS into Sentry via tagged `captureMessage` events)** — all shipped on `main`.

**Numbering note:** Slice 12 §9 explicitly named slice 14 as the "Lighthouse CI" follow-on. Slice 13 is reserved for bundle-size budgets (slice 12 §9). Slices 6–9 remain reserved for the parallel-agent track. Slice 14 is the synthetic-lab counterpart to slice 12's real-user telemetry.

---

## 1. Overview & Goals

Slice 12 closed the visitor-side performance signal loop: real user LCP/INP/CLS now lands in Sentry tagged by route. But the operator finds out a performance regression *only after a user has paid the price* — the first poor-LCP event on `/inventory` is by definition a user who already experienced a slow page. There is no pre-merge gate that catches "this commit doubled LCP" before it ships. Slice 14 closes that gap with the smallest honest cut: **`@lhci/cli` (Lighthouse CI) configured to run against the built app locally, asserting performance budgets that match slice 12's good/needs-improvement thresholds.** A `npm run lighthouse` script runs Chrome headless against the production build, computes Lighthouse scores + lab vitals, and FAILS the run if budgets are violated.

This is build-tooling, not runtime code. There are **zero new `src/` files**. The slice ships one new config file (`lighthouserc.js`), one new devDependency (`@lhci/cli`), one new npm script, a `.gitignore` entry for `.lighthouseci/` reports, and a DEPLOY.md walkthrough. Total production-code impact: zero lines. Total build-tooling impact: ~60 lines of config + ~30 lines of docs.

The pairing with slice 12 is the load-bearing design pattern: **slice 12 reports REAL USER metrics in production; slice 14 enforces SYNTHETIC LAB metrics in CI before deployment.** The same three thresholds (LCP / CLS / interaction-proxy) appear on both sides. A developer sees a budget failure pre-merge; the operator sees a regression post-deploy. The two signals tell the same story in different idioms.

### 1.1 Goals

- **Install `@lhci/cli@^0.15`** as a devDependency. Verified `package.json` does not currently include it; this is a net-new dev dep. **Cost note:** `@lhci/cli` transitively installs Puppeteer + a Chromium binary (~150MB). One-time per developer machine, cached in `node_modules`. Accepted because the alternative (uploading every build to an LHCI server) is significantly more infrastructure and the user hasn't asked for that.
- **One new config file** `lighthouserc.js` at repo root. CommonJS module exporting an `{ ci: { collect, assert, upload } }` object. Audits two URLs (see §2.3) against the built `npm start` server, with budgets baked in (see §2.4).
- **One new npm script** `npm run lighthouse` — runs `lhci autorun`, which builds, starts the app in demo mode, runs Lighthouse N times per URL, asserts budgets, and exits non-zero if any assertion fails.
- **Demo-mode auth bypass.** The dashboard requires login on the `/` route (slice 3 middleware). Lighthouse can't auth. So `lighthouserc.js` sets `NEXT_PUBLIC_DEMO_MODE=true` when starting the server for the lighthouse run. **This avoids the credential-leak risk** of putting real demo-mode credentials in a build config — there are no credentials at all because demo mode bypasses auth entirely. As a side effect, Sentry init is also disabled (slice 11 §6), so lighthouse runs never pollute the production Sentry project with synthetic events.
- **Budgets calibrated from observed baseline, not aspirational.** §2.5 explains why: setting LCP ≤ 2500ms (slice 12's "good" threshold) before the dashboard has been perf-optimized would mean every CI run fails. The plan's Phase B includes a real lighthouse run against the current build to observe the actual numbers, then sets budgets to "observed + 10% headroom" with a TODO comment naming the trajectory toward slice-12's "good" thresholds.
- **`.lighthouseci/` directory gitignored.** Lighthouse writes JSON reports + HTML reports under `.lighthouseci/` after each run. These are large (one ~5MB JSON per URL per run) and machine-generated. Add to `.gitignore` alongside the existing `.next/`, `.netlify`, and `.playwright-mcp/` entries.
- **Tests (light TDD):** one smoke test that `lighthouserc.js` parses as a CommonJS module and exposes the expected `ci.assert.assertions` shape. The actual lighthouse run is too heavy + flaky for the vitest suite — it lives in the npm script, exercised manually + in CI when slice 14b lands.
- **DEPLOY.md gains an "Optional: Lighthouse CI" section** mirroring the slice-11 Sentry walkthrough — explains the install cost, how to run locally, how to read the report, and the budget-tightening trajectory.
- All existing tests stay green. Slice 14 is strictly additive build tooling.

### 1.2 Non-Goals for Slice 14 (each has a named home — see §8)

LHCI server upload (defer; would require running an LHCI server or paying for one — out of scope for the solo operator), GitHub Actions workflow integration (slice 14b candidate — current repo has no `.github/workflows/` directory; deferring per brief decision 1), per-page route budgets beyond `/login` + `/` (defer until those routes mature — slice 14c candidate), Lighthouse mobile audits (defer — desktop-only baseline first), bundle-size budgets (slice 13 candidate — different lever, different signal), accessibility-budget tightening to 100 (defer — the dashboard's accessibility-conscious foundation from slice 1c gets the audit started at 95 with a tightening trajectory), Lighthouse "PWA" audits (the dashboard is not a PWA), regression-against-baseline diff comparison (would require LHCI server upload — see above).

---

## 2. Architecture decisions

### 2.1 Why `@lhci/cli` over raw `lighthouse` CLI

The raw `lighthouse` package (Google's Lighthouse engine) runs a single audit and dumps a report. To assert budgets and fail the build, we'd have to write our own assertion runner around it. `@lhci/cli` is Google's official wrapper that adds:

- **`autorun`** — a single command that builds, starts the server, runs Lighthouse N times per URL, aggregates the results (median by default), asserts budgets, and exits with the right code.
- **`assert`** — declarative budget assertions in `lighthouserc.js` (`"largest-contentful-paint": ["error", { "maxNumericValue": 3500 }]`). Maps directly to the slice-12 thresholds.
- **`collect`** — declarative URL configuration with built-in support for starting + stopping a dev server via `startServerCommand` (which is how we hand it `npm start` with `NEXT_PUBLIC_DEMO_MODE=true`).
- **CI-friendly output** — JSON + HTML reports under `.lighthouseci/` plus a console summary that's readable in a terminal.

The cost is ~150MB of devDependencies (Puppeteer + Chromium). Accepted. The alternative — hand-rolling all of the above around the raw `lighthouse` package — is more code, more bugs, and reinvents what `@lhci/cli` already does correctly.

### 2.2 Why local-only runs, not LHCI server upload

`@lhci/cli` supports two modes:

1. **`upload: { target: "temporary-public-storage" }`** — uploads reports to Google's free public storage and prints a viewable URL. Reports are public; anyone with the URL can see them. Not a fit because the reports show our dashboard's DOM structure + route names + screenshots.
2. **`upload: { target: "lhci", serverBaseUrl: "..." }`** — uploads to a self-hosted LHCI server with proper auth. Best long-term answer, but stands up new infrastructure.

Slice 14 picks neither: `upload: { target: "filesystem", outputDir: ".lighthouseci" }`. Reports stay on the developer's machine, in a gitignored directory. The developer can open `.lighthouseci/manifest.json` + the HTML reports in a browser locally. CI integration (slice 14b) can revisit the upload decision when there's actually a CI to upload from.

### 2.3 Why audit two URLs, not more

The dashboard has at least seven routes: `/login`, `/`, `/inventory`, `/diamonds`, `/deals`, `/website`, plus the admin sub-routes. Auditing all of them per CI run would be slow (each URL = ~30s × N=3 samples = ~90s per URL = ~10min total) and produces too much signal to triage.

Slice 14 audits **two URLs**:

1. **`/login`** — the entry point. Small, fast, no auth, no live data. Establishes a "baseline budget" — if the framework's own baseline (Next.js + fonts + the login form) doesn't hit the budget, no other page will. The lightweight cousin.
2. **`/`** — the dashboard. Heaviest page in the app; live market polling, multiple panels, the full layout grid. The real test. Audited in demo mode (auth bypassed) so lighthouse can actually reach it.

The other pages (`/inventory`, `/diamonds`, `/deals`, `/website`) are not yet audited because (a) the per-page audit budget is mostly noise compared to `/`, which is the worst case, and (b) those pages will keep growing as their slices mature — adding per-page budgets now means tightening them constantly. Documented in §8 with a named home.

### 2.4 Why these budgets

Slice 12 established the runtime thresholds based on Google's Core Web Vitals "good" classification:

| Metric | Slice 12 "good" | Slice 14 budget (initial) | Trajectory |
|---|---|---|---|
| LCP | ≤ 2500ms | ≤ observed baseline + 10% headroom (likely ~3500ms initially) | tighten toward 2500ms across follow-on slices |
| CLS | ≤ 0.1 | ≤ 0.1 (the dashboard's CLS should already be near-zero; this is a tight initial target) | hold |
| INP (lab proxy: TBT) | ≤ 200ms (INP) / ~300ms (TBT proxy) | ≤ observed baseline + headroom | tighten over time |
| Performance score | n/a (not a vitals metric) | ≥ observed - 5 points (initial); ≥ 80 (trajectory) | tighten |
| Accessibility score | n/a | ≥ 95 (the dashboard is accessibility-conscious per slice 1c) | hold or tighten to 100 |
| Best Practices score | n/a | ≥ 90 | hold |
| SEO score | n/a | **skipped** (the dashboard isn't a marketing site; SEO assertions would be noise) | n/a |

The **trajectory** column matters. The first budget snapshot is intentionally permissive — set just above observed baseline so the slice doesn't fail on day one. Each subsequent perf-improvement slice should also tighten the relevant budget. A `// TODO: tighten toward slice-12 good thresholds` comment in `lighthouserc.js` makes the trajectory explicit.

### 2.4.1 Why TBT, not INP, in lab budgets

Lighthouse 11+ does not yet emit INP as a lab metric — INP requires real user interactions to measure, and the lab uses simulated throttling. TBT (Total Blocking Time) is Lighthouse's documented proxy for INP in the lab. The slice 12 spec captured INP at the runtime; slice 14 captures TBT at build time. They measure different things but answer the same operator question ("is the page interactive when the user tries to use it?"). The DEPLOY.md doc and the `lighthouserc.js` comment both note the proxy relationship to avoid future confusion.

### 2.5 Why "observed baseline + headroom", not aspirational targets

This is the single highest-risk design decision in the slice. Two failure modes if we get it wrong:

- **Too tight (set budgets at aspirational Google "good" thresholds):** the first CI run fails. Every commit after that fails until someone does a perf-optimization sprint. The budget stops being a regression gate and becomes a perpetual broken-window — developers add `--no-lighthouse` flags to bypass it.
- **Too loose (set budgets at 2× current observed):** the budget never fires. Performance regressions slip through to slice 12's runtime telemetry, which is exactly what slice 14 was supposed to catch.

The middle path: **observe before asserting**. The plan's Phase B includes a step that runs lighthouse against the current `main` build, reads the actual median LCP / CLS / TBT / Perf-score values, and writes budgets at `observed × 1.1` for the metrics with headroom (so a normal-variance bad day doesn't fail CI) and `observed` (no headroom) for CLS (because CLS should be ~0 on this dashboard — if it isn't, that's a bug to fix, not a budget to slacken). A `// observed YYYY-MM-DD: LCP median Xms; budget set at X×1.1` comment per-assertion documents the calibration.

### 2.6 Why CommonJS (`lighthouserc.js`), not ESM (`lighthouserc.mjs`)

`@lhci/cli`'s config loader prefers CommonJS — its examples, its docs, and the recommended config shape are all `module.exports = { ... }`. ESM support exists but is undocumented and has been the source of bug reports in the LHCI repo. CommonJS is the safe path. The file is build-tooling config, not runtime code, so the `.js` (CommonJS) extension is fine even in this otherwise-ESM repo (`next.config.mjs` is the precedent for mixing).

### 2.7 Why no Lighthouse mobile audits

Lighthouse audits can target two device profiles: `desktop` and `mobile`. Mobile is the default. The dashboard is a desktop-first product (the panels are sized for desktop browsers; mobile is an explicit follow-on, see slice 1c's mobile drawer attempt). Auditing on mobile when the dashboard isn't designed for it would generate a flood of false-positive failures. Slice 14 sets `settings.preset = "desktop"` in `lighthouserc.js`. Mobile audits become a future slice (named in §8) once the dashboard has a mobile design.

---

## 3. Configuration

### 3.1 The `lighthouserc.js` config

A new file at repo root:

```js
/**
 * Lighthouse CI configuration for AIYA Dashboard.
 *
 * Slice 14 — synthetic-lab perf budgets enforced at build time. The companion
 * to slice 12's real-user Web Vitals telemetry: same thresholds, different
 * idiom. Run via `npm run lighthouse`.
 *
 * Auth: the dashboard requires login on `/`. Lighthouse runs against the
 * demo-mode build (NEXT_PUBLIC_DEMO_MODE=true), which bypasses auth entirely.
 * No credentials in this file by design — see §4 of the spec.
 *
 * Budgets: calibrated from observed baseline + 10% headroom, NOT from
 * aspirational Google "good" thresholds. Each assertion documents the observed
 * value at calibration time. See spec §2.4 + §2.5.
 */
module.exports = {
  ci: {
    collect: {
      // Build + start in demo mode so /login AND / are reachable without auth.
      // NEXT_PUBLIC_DEMO_MODE=true also disables Sentry init (slice 11 §6), so
      // lighthouse runs don't pollute the production Sentry project.
      startServerCommand: "NEXT_PUBLIC_DEMO_MODE=true SESSION_SECRET=lighthouse-ci-noop-secret npm run start",
      startServerReadyPattern: "Ready in",
      url: [
        "http://localhost:3000/login",
        "http://localhost:3000/",
      ],
      numberOfRuns: 3, // median of 3 — smooths out single-run variance
      settings: {
        preset: "desktop", // slice 14 is desktop-only (see spec §2.7)
        // Skip SEO category — not a marketing site (see spec §2.4 table)
        onlyCategories: ["performance", "accessibility", "best-practices"],
      },
    },
    assert: {
      assertions: {
        // ─── Performance vitals ──────────────────────────────────────────
        // LCP — slice 12 "good" target is 2500ms. Initial budget calibrated
        // from observed baseline; tighten in follow-on slices.
        // TODO(slice-14-followup): tighten toward 2500ms after perf-improvement sprint.
        "largest-contentful-paint": ["error", { "maxNumericValue": 3500 }],

        // CLS — slice 12 "good" target is 0.1. Dashboard should already be
        // near-zero (no above-the-fold image swaps, no late-loading layout
        // shifts). Tight initial target.
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],

        // TBT — lab proxy for slice 12's INP runtime signal (Lighthouse 11+
        // does not emit lab INP; TBT is the documented stand-in). See spec §2.4.1.
        // TODO(slice-14-followup): tighten as we optimize main-thread work.
        "total-blocking-time": ["error", { "maxNumericValue": 400 }],

        // ─── Category scores ────────────────────────────────────────────
        // Performance — initial budget set permissively from observed baseline;
        // tighten toward ≥ 80 in follow-on slices.
        "categories:performance": ["error", { "minScore": 0.75 }],

        // Accessibility — slice 1c established the accessibility-conscious
        // foundation. Hold at 0.95; tighten to 1.0 in a future a11y-focused slice.
        "categories:accessibility": ["error", { "minScore": 0.95 }],

        // Best Practices — generally an easy 0.9+ for a Next.js app.
        "categories:best-practices": ["error", { "minScore": 0.9 }],
      },
    },
    upload: {
      // Reports written to .lighthouseci/ on the local filesystem. Gitignored.
      // No upload to LHCI server / public storage — see spec §2.2.
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
```

The numeric budgets above are **placeholders for the spec doc**. The plan's Phase B calibrates them from a real lighthouse run before committing.

### 3.2 The `npm run lighthouse` script

`package.json` gains one new line in `scripts`:

```json
{
  "scripts": {
    // ... existing scripts ...
    "lighthouse": "lhci autorun"
  }
}
```

`lhci autorun` reads `lighthouserc.js` from the repo root by default. No flags needed.

### 3.3 The devDependency

`package.json` gains one new line in `devDependencies`:

```json
{
  "devDependencies": {
    // ... existing dev deps ...
    "@lhci/cli": "^0.15.0"
  }
}
```

The `^` allows minor + patch updates within the 0.15.x series. LHCI is pre-1.0 so we pin tighter than usual; a 0.16 release may change the config shape, and we want to opt-in deliberately.

### 3.4 The `.gitignore` entry

`.gitignore` gains one new line alongside the existing `.next/`, `.netlify`, and `.playwright-mcp/` entries:

```
# lighthouse CI reports (slice 14)
.lighthouseci/
```

### 3.5 The DEPLOY.md section

A new section after the existing Sentry walkthrough:

```markdown
## Optional: Lighthouse CI (slice 14)

Slice 14 wires `@lhci/cli` to enforce performance budgets at build time. The
companion to slice 12's real-user Web Vitals — same thresholds, but checked
in a synthetic Chrome lab before the code ships.

**Install cost note.** `@lhci/cli` is a heavy devDep — it transitively installs
Puppeteer and a Chromium binary (~150MB). One-time per developer machine.
`npm ci` will reinstall it from cache after that. CI integration is deferred
(see slice 14b candidate).

### Running locally

```bash
npm run lighthouse
```

This runs `lhci autorun`, which:

1. Runs `npm run build` (production build).
2. Starts the app via `npm run start` with `NEXT_PUBLIC_DEMO_MODE=true`
   (no auth required, no Sentry init, no live providers).
3. Audits `/login` and `/` against the budgets in `lighthouserc.js`.
4. Writes HTML + JSON reports to `.lighthouseci/`.
5. Exits non-zero if any budget is violated.

### Interpreting failures

When a budget fails, the console output shows which assertion violated which
threshold. To see the full report:

```bash
open .lighthouseci/lhr-*.html
```

(replace `*` with the run hash — `ls .lighthouseci/` to find it).

### Budgets

Initial budgets are calibrated from observed baseline + 10% headroom — see
`lighthouserc.js` for the per-assertion `TODO` comments naming the tightening
trajectory toward slice-12's good thresholds (LCP ≤ 2500ms, CLS ≤ 0.1).

### What's NOT enforced

- LHCI server upload (deferred — would require running an LHCI server).
- GitHub Actions integration (slice 14b candidate — current repo has no
  `.github/workflows/`).
- Mobile audits (deferred — desktop-only baseline first).
- Per-page budgets beyond `/login` and `/` (slice 14c candidate).
```

---

## 4. Demo-mode interaction

The slice 11 §6 "no observability work in demo" pattern and the slice 12 §5 "zero web-vital events in demo" pattern compose cleanly with slice 14's design. Lighthouse runs in demo mode, so:

| Surface | Behavior during a lighthouse run |
|---|---|
| Auth middleware | Bypassed — `isDemoMode()` returns true; `/` is publicly reachable. No credentials in `lighthouserc.js`. |
| Sentry SDK | `Sentry.init({ enabled: false })` — slice 11 §3.1. No synthetic events pollute the production Sentry project even if `SENTRY_DSN` happens to be set in the lighthouse-run environment. |
| Web Vitals reporter | Slice 12 short-circuits observer registration when `isDemoMode()` — so lighthouse's own metric collection isn't competing with our `web-vitals` library calls. The Lighthouse engine and our `web-vitals` library both read from the same browser PerformanceObserver API; they don't interfere, but skipping ours keeps the lighthouse measurements clean. |
| Live providers | Demo mode short-circuits to simulated quotes (slice 11 §6). No external network during lighthouse runs. Faster + more deterministic measurements. |
| Quote polling | Still runs (it's a panel feature, not gated by demo). But it polls `/api/quotes` against the simulated provider — same-origin, no third-party network. |
| Database | Demo mode uses in-memory pglite seed. No Neon traffic during lighthouse runs. |

The cumulative effect: **a lighthouse run touches zero external services and produces zero side effects beyond the `.lighthouseci/` directory on local disk**. This is the design property that makes the slice safe to ship without further infrastructure.

### 4.1 Why the dummy SESSION_SECRET

The middleware import reads `SESSION_SECRET` even though demo mode bypasses auth (see slice 11 §3.3 — the `!` non-null assertion). So `startServerCommand` provides a literal `SESSION_SECRET=lighthouse-ci-noop-secret`. This value is never used for any cryptographic operation in the demo path; it just satisfies the import. The string `"lighthouse-ci-noop-secret"` makes the source obvious in process listings + logs.

---

## 5. Tests (TDD)

Slice 14 is build-tooling, not runtime code, so the test surface is intentionally small. One light test file. The actual lighthouse run is too heavy (~3 minutes per invocation, requires Chromium, requires a built app) and too flaky (real-world timing noise) to live in the vitest suite — it's exercised manually via `npm run lighthouse` and (eventually) in CI via slice 14b.

### 5.1 `test/lighthouserc-config.test.ts`

A static-shape test that the config file parses + exposes the expected structure. No Chromium, no audits.

- **Module loads:** `require("../lighthouserc.js")` returns an object with a `ci` key. Confirms the file is valid CommonJS.
- **Collect shape:** `ci.collect.url` is an array containing exactly the two URLs we audit (`/login`, `/`). `ci.collect.numberOfRuns === 3`. `ci.collect.settings.preset === "desktop"`. `ci.collect.startServerCommand` includes the literal substring `NEXT_PUBLIC_DEMO_MODE=true` (the load-bearing demo-mode invariant).
- **Assertions shape:** `ci.assert.assertions` includes keys for `largest-contentful-paint`, `cumulative-layout-shift`, `total-blocking-time`, `categories:performance`, `categories:accessibility`, `categories:best-practices`. **Does NOT include** `categories:seo` (the spec §2.4 explicit skip).
- **SEO skip invariant:** `ci.collect.settings.onlyCategories` does not include `"seo"`. Documents the "not a marketing site" decision.
- **Upload to filesystem only:** `ci.upload.target === "filesystem"` and `ci.upload.outputDir === ".lighthouseci"`. No upload to public storage, no LHCI server URL.

### 5.2 Existing test suite

All post-slice-12 tests stay green. Slice 14 adds no source files, so it cannot regress any runtime behavior. The full suite passes verbatim before and after the slice merges.

### 5.3 The actual lighthouse run — manual, not automated

The plan's Phase B includes a manual `npm run lighthouse` invocation as part of calibrating the initial budgets. This is a one-time human-in-the-loop step at slice-merge time. Once the budgets are set, future CI integration (slice 14b) automates the invocation; for slice 14 the invocation is manual.

---

## 6. Security & Threat Model

### 6.1 No new wire surface

Slice 14 adds zero runtime code. The lighthouse audit runs locally against a local server. There is no new endpoint, no new env var read at runtime, no new ingest path. The threat surface of the deployed app is unchanged.

### 6.2 No credentials in config

The `lighthouserc.js` config contains exactly one secret-shaped string: `SESSION_SECRET=lighthouse-ci-noop-secret`. This is a literal dummy value, not a real secret — it satisfies the middleware import in demo mode where the secret is never used for crypto. The string is checked into the repo deliberately as a flag that "this is the lighthouse-only no-op value".

Notably absent: any real demo credentials, any production DB string, any auth token. The auth-bypass property of demo mode is what lets us avoid putting credentials in CI config at all. This is the load-bearing security decision of the slice.

### 6.3 `.lighthouseci/` is the only persistent state

Lighthouse writes JSON + HTML reports to `.lighthouseci/` after each run. The directory contains:
- Per-run HTML reports (the human-readable Lighthouse report — DOM screenshots, audit-by-audit results).
- Per-run JSON (`lhr-*.json`) with the raw audit data.
- A `manifest.json` listing the runs.

The HTML reports include screenshots of the audited pages. Since we audit `/` in demo mode, the screenshots show seeded demo data — no real customer data, no real org names, no real diamonds. The gitignored directory means these screenshots never leave the developer's machine.

If a future developer adds non-demo URLs to the audit (e.g. running lighthouse against a real production deploy with a real auth token), they would need to think hard about whether the screenshots are safe to keep on disk. Documented in the DEPLOY.md walkthrough as a watch-out.

### 6.4 Demo-mode invariant — composes with slices 11 + 12

The slice 11 demo invariant (no Sentry events from demo) and the slice 12 demo invariant (no web-vital events from demo) together mean: **a lighthouse run produces zero events in any external observability system**, even if `SENTRY_DSN` happens to be set in the lighthouse-run environment. This is belt-and-suspenders — the spec is explicit that the lighthouse run should be in demo mode, but if a developer accidentally runs lighthouse against a non-demo dev build, the slice 11/12 demo gates would still need to be re-evaluated. The DEPLOY.md doc explicitly tells the developer to run lighthouse only against demo-mode builds.

### 6.5 Chromium binary trust

`@lhci/cli` pulls in Puppeteer which downloads a pinned Chromium binary at install time from Google's CDN. The download is checksummed by Puppeteer. The binary runs sandboxed by default. This is the same trust posture as any other developer dependency on Chromium-based tooling (Playwright, Cypress, Puppeteer used directly). Documented in the DEPLOY.md as the "install cost note" — the developer is informed before they run `npm install`.

### 6.6 PR review checklist (slice 14 exit gate)

Before merge:

- `grep -rn "lighthouse" src/` → 0 matches (slice 14 adds zero source files).
- `grep -n "DEMO_MODE=true" lighthouserc.js` → at least one match (the load-bearing demo invariant in the config).
- `grep -rn "lhci\|@lhci/cli" .github/workflows/` → 0 matches OR confirmed deferred to slice 14b (per the brief decision — no GitHub workflows in slice 14).
- `cat .gitignore | grep -i lighthouseci` → 1 match (the gitignore entry).
- `node -e 'JSON.stringify(require("./lighthouserc.js"))'` → no throws (config parses).
- `npm test` green (the slice 14 config-shape test plus the full existing suite).
- `npm run build` green (slice 14 changes nothing about the build itself).

### 6.7 Why "no GitHub Actions" is itself a security property

The brief's decision 1 defers CI integration to slice 14b. There's a security upside to this: a CI workflow that runs Chromium against secrets is a non-trivial supply-chain risk surface (the Chromium binary, the LHCI CLI itself, the dozens of transitive deps). Keeping the slice local-only means an attacker who compromises the LHCI npm package can only run code on developer machines that opt into running `npm run lighthouse` — not on every CI build that touches the repo. This is a marginal benefit at slice-14 scale but worth naming.

---

## 7. File Plan

### New files

| Path | Purpose |
|---|---|
| `lighthouserc.js` | LHCI config — collect URLs, assertions, filesystem upload. ~60 lines. |
| `test/lighthouserc-config.test.ts` | §5.1 config-shape smoke test. ~30 lines. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `@lhci/cli@^0.15` to `devDependencies`; add `"lighthouse": "lhci autorun"` to `scripts`. |
| `package-lock.json` | Auto-updated by `npm install`. |
| `.gitignore` | Add `.lighthouseci/` entry. |
| `DEPLOY.md` | Add "Optional: Lighthouse CI" section. |

### Deleted files

None.

### Source files (`src/`)

**Zero modifications.** Slice 14 is purely build-tooling. The plan's PR review grep explicitly checks `grep -rn "lighthouse" src/` returns 0 matches.

### Estimated diff size

- Config + script: ~60 lines (`lighthouserc.js`) + ~3 lines (`package.json`) + 1 line (`.gitignore`).
- Test code: ~30 lines (`test/lighthouserc-config.test.ts`).
- Docs: ~50 lines (`DEPLOY.md` section).
- Lockfile churn: significant (Puppeteer + Chromium + LHCI's own deps). Read the diff but don't audit every transitive line.

---

## 8. Out of Scope (Explicit)

| Item | Home |
|---|---|
| GitHub Actions workflow integration | Slice 14b candidate. Trigger: `.github/workflows/` directory exists and the user explicitly asks. Today the repo has neither. |
| LHCI server upload (per-PR perf diffs) | Future slice. Requires standing up an LHCI server or paying for one — out of scope for the solo operator's current cost profile. |
| Per-page route budgets for `/inventory`, `/diamonds`, `/deals`, `/website` | Slice 14c candidate. Add as those pages mature; today they'd be noise. |
| Lighthouse mobile audits | Future slice; requires the dashboard to have a mobile design (slice 1c attempted a drawer; full mobile is a separate slice). |
| Bundle-size budgets (Webpack stats, bundlephobia-style) | Slice 13 candidate. Different lever (build artifact size, not runtime metric); different signal. |
| Tightening Accessibility to 1.0 (currently 0.95) | Future a11y-focused slice. Today's 0.95 floor matches the slice 1c foundation. |
| Lighthouse "PWA" audits | Not planned — the dashboard is not a PWA. |
| Regression-against-baseline diff (LCP vs. last-merged-main) | Requires LHCI server upload — see "LHCI server upload" row. |
| Auto-failing CI on perf regression in PRs | Slice 14b — local config is the prerequisite; the CI wiring is the next step. |
| Per-tenant performance budgets | Future; vitals are platform-level (slice 12 §1.1), so per-tenant budgets need a multi-tenant performance baseline first. |
| Lighthouse audits against production deploy (not local) | Out of scope — would require auth handling (the production app is not in demo mode), report-handling for real customer data in screenshots, and a separate config preset. |

---

## Design summary table

| Concern | Choice |
|---|---|
| Scope | Local-only `@lhci/cli` config + npm script + .gitignore + DEPLOY.md walkthrough. |
| Library | `@lhci/cli@^0.15` (Google's official wrapper around `lighthouse`). |
| Pages audited | `/login` (baseline) + `/` (real test, in demo mode). Defer per-page audits. |
| Device profile | Desktop only. Mobile deferred. |
| Categories | Performance + Accessibility + Best Practices. SEO skipped (not a marketing site). |
| Budget calibration | Observed baseline + 10% headroom, NOT aspirational. TODO comments name the tightening trajectory. |
| LCP budget | `maxNumericValue: 3500` (placeholder; calibrated in plan Phase B). |
| CLS budget | `maxNumericValue: 0.1` (matches slice 12 "good"; dashboard should already be near-zero). |
| TBT budget | `maxNumericValue: 400` (lab proxy for INP; placeholder, calibrated in Phase B). |
| Perf score | `minScore: 0.75` (placeholder; trajectory ≥ 0.80). |
| A11y score | `minScore: 0.95` (matches slice 1c posture). |
| Best Practices | `minScore: 0.90`. |
| Auth | None — demo mode bypasses auth via `NEXT_PUBLIC_DEMO_MODE=true` in `startServerCommand`. No credentials in config. |
| Sentry interaction | Lighthouse runs in demo mode → slice 11 disables Sentry init → no synthetic events pollute production. |
| Web Vitals interaction | Lighthouse runs in demo mode → slice 12 short-circuits observer registration → no interference. |
| Report storage | `.lighthouseci/` local directory, gitignored. No upload to public storage or LHCI server. |
| New runtime deps | Zero. |
| New devDeps | One: `@lhci/cli@^0.15` (transitively pulls Puppeteer + Chromium, ~150MB). |
| New env vars | Zero (the dummy `SESSION_SECRET` is inline in `startServerCommand`, not a real env var). |
| Source code touched (`src/`) | Zero files. |
| Test surface | One config-shape smoke test (~30 lines). The actual lighthouse run is manual + slice 14b CI. |
| PR review grep gate | §6.6 — seven checks. |
| LOC budget | ~60 lines config + ~30 lines test + ~50 lines docs. Zero production code. |
