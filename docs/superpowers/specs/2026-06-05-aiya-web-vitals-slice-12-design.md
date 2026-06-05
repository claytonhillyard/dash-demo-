# AIYA Dashboard — Slice 12: Web Vitals — Design

**Date:** 2026-06-05
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market), #1a (AIYA dashboard + reskin + honesty contract), #1b-1 (inventory), #1b-3 (diamond price lists), #1c (customizable layout), demo (Netlify simulation mode), slice 2 (Deal Room), slice 3 (Multi-Tenant Foundation), slice 4 (Circles), slice 5 (Website Overview), slice 10 (Deal Reply Threads), and **slice 11 (Polish + Observability — `@sentry/nextjs@^8` wired with action-wrapper + middleware + client-poll capture; `withOrgScope` + `beforeSend` scrubber establish the tenancy-safe capture pattern this slice extends)** — all shipped on `main`.

**Numbering note:** Slice 11 §10 named slice 12 as "Web Vitals" — clean follow-on, reuses the Sentry SDK as the ingest sink for ~zero infrastructure cost. Slices 6–9 remain reserved for the parallel-agent track.

---

## 1. Overview & Goals

Slice 11 closed the operator-side observability loop: a real backend error now lands in Sentry with the right tenancy-safe scope. But the dashboard still has zero visibility into the **rendering-side performance** the visitor actually experiences. A 4-second LCP on `/inventory` is not a thrown exception — it's silent UX rot. A poor INP on `/deals` is invisible until a user complains. Slice 12 closes that gap with the smallest honest cut: **report Core Web Vitals (LCP, INP, CLS) client-side via Google's `web-vitals` library and pipe them into Sentry as tagged `captureMessage` events.**

The whole slice is under 100 lines of production code. There is no UI surface, no new dashboard panel, no new env var, no new schema. The signal lands in the Sentry workspace the operator already has open from slice 11. Per-route filtering, regression alerts, and Sentry's own "Web Vitals" tab become available the moment the first event arrives — **all of which are operator workflows inside Sentry, NOT code in this repo**.

### 1.1 Goals

- **Install `web-vitals@^5`** (Google's official package; ~2KB gzipped; verified not currently in `package.json`). One new dependency.
- **Single integration point**: a new `<WebVitalsReporter />` client component mounted in `src/app/layout.tsx`. On mount, it calls `onLCP(report)`, `onINP(report)`, `onCLS(report)`. No JSX. No state. Effect-only.
- **One helper function** `reportWebVital(metric, route)` exported from `src/lib/observability/webVitals.ts` that translates a `web-vitals` `Metric` object into `Sentry.captureMessage` with `event.tags = { metric: 'LCP', rating: 'good'|'needs-improvement'|'poor', route: '/inventory' }`.
- **Demo-mode short-circuit at the registration boundary.** `if (isDemoMode()) return;` inside the reporter's effect — the `web-vitals` library never observes anything in demo, so demo browsers do zero measurement work. (Slice 11's `Sentry.init({ enabled: false })` would already make the `captureMessage` a no-op, but skipping the observers themselves is a performance win and matches the slice 11 "no observability work in demo" pattern.)
- **No `orgId` in vitals events.** Web Vitals are *platform-level rendering signals* — the same `/inventory` LCP is the same number whether tenant A or tenant B viewed it. The meaningful triage signal is the **route**, not the org. Slice 11's tenancy invariant (§5) is preserved verbatim: zero `orgId` flows into this slice's events. The slice 11 `beforeSend` scrubber would strip it anyway, but the cleaner pattern is *don't put it there in the first place*.
- **Route as a tag**: `route: window.location.pathname` (no query string, no hash). This is the column the operator filters on in the Sentry UI to spot regressions on specific pages.
- **TDD with three test files**: capture-shape (the `Metric` → `captureMessage` translation), rating-passthrough (the `web-vitals` `rating` field flows through verbatim — we don't re-derive), demo-mode-skip (the registration short-circuits in demo).
- All existing tests (post-slice-11 baseline) stay green.

### 1.2 Why these three vitals, not five

The `web-vitals` library exports five metrics: `onLCP`, `onINP`, `onCLS` (the Core Web Vitals — Google's official ranking signals) plus `onFCP` and `onTTFB` (secondary). Slice 12 scope is **Core only**. Rationale:

- **Core Web Vitals are the canonical user-experience metrics.** LCP measures "did the meaningful content appear?", INP measures "was it responsive when the user tried to interact?", CLS measures "did the page jump around?". These three answer the operator's actual question ("is this dashboard fast for my team?") in 80% of cases.
- **FCP and TTFB are server-side characteristics.** FCP is largely a function of CDN/edge config; TTFB is the network round-trip. We have direct measurements of both from Netlify's deploy logs and (with Sentry tracing, when slice 13+ enables it) from server spans. Capturing them client-side is duplicative.
- **Smaller signal surface = better triage.** Three metrics × three rating buckets = nine distinct alert lines in the Sentry workspace. Five metrics would be fifteen. The marginal value of `onFCP` and `onTTFB` doesn't justify the noise.

If a future slice needs FCP/TTFB, the helper is a one-line addition (`onFCP(report); onTTFB(report);`). Documented as out of scope (§9) with a named home.

### 1.3 Non-Goals for Slice 12 (each has a named home — see §9)

Bundle-size budgets / build-time perf gates (slice 13 candidate), Lighthouse CI (slice 14 candidate), per-route performance budgets (needs slice 13 + 14 + 16 to settle), real-user monitoring dashboards (those are the Sentry workspace UI, not our code), custom RUM aggregation, server-side Web Vitals via `next/web-vitals` route-level hooks, FCP / TTFB / TBT secondary metrics, anomaly alerting (PagerDuty / Slack hooks — configured inside Sentry workspace, not in the codebase).

---

## 2. Architecture decisions

### 2.1 Why Google's `web-vitals` library over `next/web-vitals` (Next.js's built-in)

Next.js exposes a `useReportWebVitals` hook (`next/web-vitals`) that *wraps* `web-vitals` internally. Two reasons we use the underlying library directly:

1. **`useReportWebVitals` reports Next-specific custom metrics too** (`Next.js-hydration`, `Next.js-route-change-to-render`, etc.). Those are useful for framework profiling but they are NOT Core Web Vitals — they have no `rating` field, no canonical thresholds, and they'd skew the Sentry "Web Vitals" tab which expects only the five Google metrics. Filtering them out at the report site means more code to maintain than just calling `onLCP/onINP/onCLS` directly.
2. **Tighter version pinning.** `next/web-vitals` ships the version of `web-vitals` that Next vendors. We may want a newer or older version independently (e.g. if a regression lands in `web-vitals` v6 we want to stay on v5). A direct dep gives us that lever; the wrapper takes it away.

The cost is one extra dep (~2KB gzipped). Accepted.

### 2.2 Why a client component, not a Server Component effect

Web Vitals can only be measured client-side — the browser `PerformanceObserver` API is the source of every metric. The reporter MUST be a client component (`"use client"`). The natural home is a tiny effect-only component mounted in `app/layout.tsx`, sibling to `{children}`. No JSX output (returns `null`). The component runs `useEffect(() => { onLCP(report); onINP(report); onCLS(report); }, [])` once per browser session.

### 2.3 Why mount in the root layout, not per-page

Web Vitals fire once per page load — LCP is observed up to the first user interaction or page hide; INP is the worst observed interaction up to page hide; CLS is the cumulative shift score up to page hide. Mounting once at the root layout means *one* set of observers per session, even as the user navigates between dashboard / `/inventory` / `/deals`. The `web-vitals` library handles soft-navigation correctly in single-page apps: each route change resets the observers and the next set of metrics is tagged with the new `window.location.pathname` at report time.

A per-page mount would double-register observers on every nav and conflict with the library's internal de-duplication. Wrong shape.

### 2.4 Why `captureMessage`, not `captureException` or a custom transport

`captureMessage` is the right Sentry surface for **performance signals that are not bugs**. An LCP of 4500ms is not an exception; it's a "this happened" event. `captureException` would put performance noise in the same triage queue as real thrown errors — exactly the dilution we just avoided in slice 11 by NOT capturing `ForbiddenError`.

A custom transport (e.g. a `/api/vitals` route that writes to our own database) would let us own the data, but:
- Persistent storage of vitals samples is a project in itself (retention policy, per-route aggregation, querying UX).
- Sentry already has a Web Vitals tab in its workspace UI; the operator gets per-route filtering, p75/p95 dashboards, and regression alerts for free.
- The bandwidth & write cost of vitals samples (one per page load × N visitors) is non-trivial on a serverless DB.

`captureMessage` with rich tags is the smallest honest path to a useful signal. The Sentry workspace UI is the dashboard; our code's job is just to ship the events.

### 2.5 Why tag, not extra/breadcrumb

Sentry has three places to attach metadata: `tags`, `extra`, and `contexts`. **Tags are the only one that's filterable in the Sentry workspace UI.** A regression alert ("LCP rating became `poor` more than 3 times in the last hour on `/inventory`") requires the route and the rating to be filterable. Putting them in `extra` (where slice 11's scrubber strips `orgId` from) would make the events findable only by full-text search of `event.message`. Wrong shape. Tags it is.

### 2.6 Why no sampling

`web-vitals` reports each metric once per page load, so the natural event rate is **3 events per page load per visitor** (LCP + INP + CLS). On a solo-operator dashboard with maybe 10 concurrent viewers, that's ~30 events per page load — well inside Sentry's free-tier event budget. If usage scales to the point where this matters, we add `Math.random() < SAMPLE_RATE` at the report site as a one-line change. Documented in §9.

---

## 3. Implementation

### 3.1 The helper function

A new module `src/lib/observability/webVitals.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import type { Metric } from "web-vitals";

/**
 * Translate a `web-vitals` Metric into a Sentry `captureMessage` event.
 *
 * Tags carry the three filterable axes: which metric, what rating bucket,
 * what route. The route is taken from `window.location.pathname` at REPORT
 * TIME (not registration time) so soft-nav between dashboard / inventory /
 * deals attaches the right route to each metric's report.
 *
 * The metric value is in `extra` (not tags) — Sentry tag values are coerced
 * to strings and tag cardinality is bounded, so a millisecond float belongs
 * in `extra`. The slice 11 `beforeSend` scrubber leaves `extra` alone for
 * non-orgId fields. Slice 11 §5 tenancy invariant: NO orgId here.
 */
export function reportWebVital(metric: Metric, route: string): void {
  Sentry.captureMessage(`web-vital ${metric.name}`, {
    level: "info",
    tags: {
      metric: metric.name,           // 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'
      rating: metric.rating,         // 'good' | 'needs-improvement' | 'poor'
      route,                         // e.g. '/inventory'
    },
    extra: {
      value: metric.value,           // ms for LCP/INP, unitless for CLS
      delta: metric.delta,           // change since last report (for delta-aware sinks)
      id: metric.id,                 // per-page-load unique id from web-vitals
      navigationType: metric.navigationType,
    },
  });
}
```

### 3.2 The reporter component

A new client component `src/components/observability/WebVitalsReporter.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { onCLS, onINP, onLCP } from "web-vitals";
import { isDemoMode } from "@/lib/demo/mode";
import { reportWebVital } from "@/lib/observability/webVitals";

/**
 * Mounted once at the root layout. Registers PerformanceObservers for LCP,
 * INP, and CLS via the web-vitals library, then pipes each metric report into
 * Sentry via reportWebVital().
 *
 * Demo-mode short-circuit: skip observer registration entirely. The
 * web-vitals library still adds non-trivial overhead (PerformanceObservers,
 * visibilityState listeners, event-timing buffers) even when its callbacks
 * become no-ops — and slice 11 §6 establishes the "no observability work
 * in demo" pattern.
 *
 * Returns null — effect-only component, no DOM output.
 */
export function WebVitalsReporter(): null {
  useEffect(() => {
    if (isDemoMode()) return;

    const report = (metric: Parameters<typeof reportWebVital>[0]) =>
      reportWebVital(metric, window.location.pathname);

    onLCP(report);
    onINP(report);
    onCLS(report);
  }, []);

  return null;
}
```

### 3.3 Mount in the root layout

`src/app/layout.tsx` adds two lines — an import and the mount inside `<body>`:

```tsx
import { WebVitalsReporter } from "@/components/observability/WebVitalsReporter";

// ... existing imports + fonts unchanged ...

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <WebVitalsReporter />
        {children}
      </body>
    </html>
  );
}
```

The mount is BEFORE `{children}` (sibling order). Order doesn't affect measurement — the `web-vitals` library observes the document globally — but reading the mount as "the first thing the document does is register vitals observers" matches the mental model.

### 3.4 Sentry init order

Critical correctness invariant: `Sentry.init` must have run before any `captureMessage` call. Slice 11 wired `sentry.client.config.ts` which Next.js loads via the SDK's webpack plugin at the very top of the client bundle, before any React code mounts. So by the time `WebVitalsReporter`'s `useEffect` fires, the SDK is initialized.

When `SENTRY_DSN` is unset (most local dev) the SDK is `enabled: false` and `captureMessage` is a documented no-op — no network call, no throw. Demo mode never even calls `captureMessage` because the reporter short-circuits before observer registration. Both paths are safe.

---

## 4. Multi-tenant safety

This slice is the cleanest possible application of the slice 11 §5 invariant: **no `orgId` flows into any event this slice emits**.

1. **The reporter component is client-only.** `window.location.pathname` is the only context fetched at report time. `orgId` is a server-side concept (slice 3 `getCurrentOrgId()` reads it from the JWT inside `requireSession`). The client doesn't even *have* the orgId in scope here. There is no path by which it leaks.

2. **The route is the meaningful triage axis, not the tenant.** Slice 11 §5 articulates this: "orgId in event.tags is permitted only when it is a meaningful triage signal for that error type." For LCP regressions on `/inventory`, the triage question is "did a recent commit regress that page?" — answerable by the route tag without any tenant context. Tenant context would actively mislead: the same `/inventory` LCP is the same metric for tenant A and tenant B because both render the same code.

3. **The grep enforcement from slice 11 §9.5 extends verbatim.** PR review confirms:
   - `grep -rn "orgId" src/lib/observability/webVitals.ts` → 0 matches.
   - `grep -rn "orgId" src/components/observability/WebVitalsReporter.tsx` → 0 matches.
   - The slice 11 `beforeSend` scrubber is a second line of defense — if a future careless edit puts `orgId` somewhere on the event, it gets stripped before send. But the design is to *not put it there in the first place*.

4. **No new Zod input schema.** The Web Vitals helper is read-only (consumes a `Metric` object from `web-vitals`, emits to Sentry). Slice 3 invariant "no `orgId` in `src/lib/*/validation.ts`" remains satisfied — slice 12 adds zero files in those directories.

---

## 5. Demo mode

| Surface | Demo behavior |
|---|---|
| `web-vitals` observers | NOT registered. `useEffect` short-circuits on `isDemoMode()` check. Zero PerformanceObserver overhead, zero event-timing buffers. |
| `reportWebVital` calls | Never invoked (the observers never fire because they were never registered). |
| Sentry events | Zero web-vital events sent from a demo browser. Defense in depth: even if a metric somehow reported, slice 11's `Sentry.init({ enabled: false })` would no-op the `captureMessage`. |
| CSP | Unchanged from slice 11. `web-vitals` makes no network calls of its own — it only invokes our local callback. No new allowed origin. |
| Bundle size | The `web-vitals` library is in the client bundle in all modes (~2KB gzipped). Removing it from the demo bundle would require a build-time branch we don't have; the size is negligible enough that we accept it. |

The demo deploy continues to require zero secrets and zero external services. Slice 12 introduces no new env vars.

---

## 6. Tests (TDD)

Three new test files, all under `test/lib/observability/` and `test/components/observability/`. Approximately 50 lines of test code total. The slice 11 baseline test-file pattern (mock `@sentry/nextjs` with `vi.mock`, assert on `.mock.calls`) extends directly.

### 6.1 `test/lib/observability/web-vitals-report.test.ts`

Unit-tests the `reportWebVital(metric, route)` translation. Mocks `@sentry/nextjs`.

- **Capture-shape test (LCP, good):** `reportWebVital({ name: 'LCP', value: 1800, rating: 'good', delta: 1800, id: 'v3-1', entries: [], navigationType: 'navigate' }, '/inventory')` → `Sentry.captureMessage` called exactly once with `'web-vital LCP'` and `{ level: 'info', tags: { metric: 'LCP', rating: 'good', route: '/inventory' }, extra: { value: 1800, delta: 1800, id: 'v3-1', navigationType: 'navigate' } }`.
- **Rating-passthrough test (INP, poor):** `rating: 'poor'` on the input metric → `tags.rating === 'poor'` on the captured event. We do NOT re-derive the rating from the value; the `web-vitals` library is the source of truth.
- **Rating-passthrough test (CLS, needs-improvement):** same idea for the third rating bucket.
- **Different-route test:** the `route` argument flows through verbatim — `reportWebVital(metric, '/deals')` → `tags.route === '/deals'`.
- **No orgId leakage (defensive):** even if a future careless caller passed a metric with an unexpected field, `event.extra` contains only `value/delta/id/navigationType` — no `orgId` key. (This test is a regression guard, not a current concern; the helper has no `orgId` parameter.)

### 6.2 `test/components/observability/WebVitalsReporter.test.tsx`

Tests the registration boundary. Mocks `web-vitals` (so we can assert the `on*` functions were called) and `@/lib/demo/mode`.

- **Non-demo registers all three observers:** mount `<WebVitalsReporter />` with `isDemoMode() === false` → `onLCP`, `onINP`, `onCLS` each called exactly once with a function callback.
- **Demo mode skips registration:** mount with `isDemoMode() === true` → none of `onLCP/onINP/onCLS` are called. (This is the load-bearing demo invariant.)
- **Callback wires to `reportWebVital` with current `window.location.pathname`:** invoke the captured callback with a synthetic metric → `reportWebVital` is called with that metric and the current pathname. Use jsdom's default location (`/`) as the test fixture pathname.
- **Renders nothing:** `container.firstChild === null` after mount. The component returns null.

### 6.3 `test/lib/observability/web-vitals-demo-skip.integration.test.ts`

Lightweight integration test that exercises the full demo-mode path end-to-end without rendering React. Mocks `web-vitals` and `@sentry/nextjs`; sets `NEXT_PUBLIC_DEMO_MODE=true`; imports `WebVitalsReporter` and calls its effect manually (via `renderHook` on a wrapper or by extracting the effect body). Asserts: zero calls to `onLCP/onINP/onCLS`, zero calls to `Sentry.captureMessage`. (If the component-level test in 6.2 already covers this, this file can be skipped at implementation time — the plan documents both for the writer's discretion.)

### 6.4 Existing test suite

All post-slice-11 tests stay green. The implementation plan's phase-end green-bar step runs the full suite.

---

## 7. Security & Threat Model

### 7.1 No new wire fields

`reportWebVital`'s emitted event contains:
- `tags`: `metric` (one of five constants), `rating` (one of three constants), `route` (`window.location.pathname` — a path the user is already on, no new info).
- `extra`: `value`, `delta`, `id`, `navigationType` — all numeric/string primitives from `web-vitals`'s internal state. No user input, no DOM contents, no orgId, no auth artifacts.

There is **no field on the wire that the user can influence beyond which route they are visiting**. The route they're visiting is already on the wire as the page-load URL itself. Slice 12 adds zero new attack surface.

### 7.2 No PII

`web-vitals` reports rendering performance — millisecond floats and accumulated shift scores. No DOM text, no user identifiers, no clipboard data, no input values. The `entries: PerformanceEntry[]` field on `Metric` contains `PerformanceEntry` objects (DOM node references, timestamps, types) — but we **deliberately do not forward `entries` to Sentry**. We forward only `value/delta/id/navigationType`. This is a load-bearing scrubber by omission.

### 7.3 No CSP changes

`web-vitals` makes no network calls of its own — it uses browser `PerformanceObserver` APIs entirely in-process. The `captureMessage` call goes through the same Sentry ingest endpoint that slice 11 already widened CSP for. No new `connect-src` host needed.

### 7.4 Demo-mode invariant

`isDemoMode()` gates the entire observer registration. No PerformanceObservers, no event-timing buffers, no callbacks. The demo deploy stays at its current performance baseline.

### 7.5 The DSN secret — no change

Slice 11 documented `SENTRY_DSN` as a public-ish secret exposed to the browser. Slice 12 does not change this surface. The `captureMessage` calls flow through the same SDK that's already loaded.

### 7.6 PR review grep checklist (slice 12 exit gate)

Before merge:
- `grep -rn "orgId" src/lib/observability/webVitals.ts src/components/observability/WebVitalsReporter.tsx` → 0 matches.
- `grep -rn "captureException" src/lib/observability/webVitals.ts` → 0 matches (vitals are info-level messages, not exceptions).
- `grep -rn "entries" src/lib/observability/webVitals.ts` → only in the type import; never read off `metric.entries` and forwarded to Sentry.
- `grep -rn "useReportWebVitals\|next/web-vitals" src/` → 0 matches (we use the underlying library, not the Next wrapper — §2.1).
- All post-slice-11 baseline tests pass plus the new slice 12 tests.
- `npm run build` and `npm test` green.

---

## 8. File Plan

### New files

| Path | Purpose |
|---|---|
| `src/lib/observability/webVitals.ts` | `reportWebVital(metric, route)` — single source of truth for the Metric → Sentry translation. |
| `src/components/observability/WebVitalsReporter.tsx` | Client component mounted in root layout; registers `onLCP`/`onINP`/`onCLS`; demo-mode short-circuits. |
| `test/lib/observability/web-vitals-report.test.ts` | §6.1 — capture-shape + rating-passthrough + route-passthrough tests. |
| `test/components/observability/WebVitalsReporter.test.tsx` | §6.2 — observer registration + demo skip + callback wiring + null render. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `web-vitals@^5` to `dependencies`. |
| `src/app/layout.tsx` | Add one import + one `<WebVitalsReporter />` mount inside `<body>`. |

### Deleted files

None.

### Estimated diff size

- Production code: ~70 lines (helper ~30, reporter ~25, layout edit 2, package.json 1, package-lock churn).
- Test code: ~50 lines across two/three files.
- Spec + plan: ~700 lines combined documentation.

---

## 9. Out of Scope (Explicit)

| Item | Home |
|---|---|
| FCP / TTFB / TBT secondary metrics | Future slice; one-line addition in `WebVitalsReporter` when needed. |
| Bundle-size budgets / build-time perf gates | Slice 13 candidate — pairs with vitals data once a few weeks of samples exist. |
| Lighthouse CI integration | Slice 14 candidate — synthetic perf check on PRs, complementary to Web Vitals' real-user data. |
| Per-route performance budgets | Future; needs slice 13 + 14 + slice 16 to settle to know which routes matter. |
| Real-user monitoring dashboards | The Sentry workspace UI already provides the Web Vitals tab; not our code. |
| Custom RUM aggregation / per-org performance baselining | Future slice; would require building our own storage + UI. |
| Server-side Web Vitals via `next/web-vitals` route-level hooks | Future; requires us to filter Next's framework-custom metrics out of the report site — added complexity for marginal value. |
| Anomaly alerting (PagerDuty / Slack hooks) | Configured inside the Sentry workspace, not in the codebase. |
| Sampling (probabilistic event drop) | Future; one-line addition (`if (Math.random() > SAMPLE_RATE) return;`) when event volume warrants. |
| Soft-nav LCP tagging via `metric.navigationType` filtering | Already in `extra.navigationType` — Sentry workspace can filter; no special code needed. |

---

## Design summary table

| Concern | Choice |
|---|---|
| Scope | Core Web Vitals only: LCP, INP, CLS. Defer FCP, TTFB. |
| Library | `web-vitals@^5` direct dep (not `next/web-vitals`). |
| Sentry surface | `captureMessage` with `level: 'info'` — vitals are events, not exceptions. |
| Tags | `metric` + `rating` + `route` (the three filterable axes in Sentry UI). |
| Extras | `value` + `delta` + `id` + `navigationType` (numeric/string primitives only; never `entries`). |
| Integration point | Single client component `<WebVitalsReporter />` mounted in `src/app/layout.tsx`. |
| Effect lifecycle | One `useEffect` on mount; observers registered once per browser session. |
| Demo mode | Entire registration short-circuits; zero PerformanceObservers in demo. |
| Tenancy | NO `orgId` anywhere. Route is the meaningful filter; slice 11 §5 preserved. |
| Rating computation | Use `web-vitals`'s built-in `metric.rating` verbatim; do not re-derive. |
| Sampling | None initially; one-line addition possible if volume warrants. |
| New deps | One: `web-vitals@^5`. |
| New env vars | Zero. |
| New input schemas with `orgId` | Zero. Slice 3 invariant preserved. |
| LOC budget | Under 100 lines of production code, ~50 lines of tests. |
| PR review grep gate | Four greps in §7.6; merge blocked until all pass. |
