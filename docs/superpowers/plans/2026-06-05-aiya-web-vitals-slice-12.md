# AIYA Slice 12 — Web Vitals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Google's `web-vitals@^5` library into the existing slice-11 Sentry pipeline. Mount a single client component in the root layout that registers `onLCP`/`onINP`/`onCLS` observers, translates each `Metric` to a tagged `Sentry.captureMessage` (`metric` + `rating` + `route` as tags; `value`/`delta`/`id`/`navigationType` as extras), and short-circuits the registration entirely in demo mode. Multi-tenant safe (zero `orgId` on the wire; route is the triage axis).

**Architecture:** One new dep (`web-vitals@^5`). One helper module (`src/lib/observability/webVitals.ts`) exports a pure `reportWebVital(metric, route)` function. One client component (`src/components/observability/WebVitalsReporter.tsx`) calls the helper from a one-effect mount. Root layout (`src/app/layout.tsx`) mounts it once. Demo-mode and missing-DSN paths are both no-ops by design.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · `@sentry/nextjs@^8.55` (already on main from slice 11) · `web-vitals@^5` (new) · vitest · jsdom · existing `isDemoMode()` seam from `src/lib/demo/mode.ts`.

---

## File Structure

**New files:**
- `src/lib/observability/webVitals.ts` — `reportWebVital(metric, route)` helper. Single source of truth for the Metric → Sentry.captureMessage translation.
- `src/components/observability/WebVitalsReporter.tsx` — Effect-only client component. Mounted once at root layout. Short-circuits in demo.
- `test/lib/observability/web-vitals-report.test.ts` — Unit tests for the helper: capture-shape + rating-passthrough + route-passthrough + no-orgId-leak.
- `test/components/observability/WebVitalsReporter.test.tsx` — Component tests: non-demo registers, demo skips, callback wires to `reportWebVital`, renders null.

**Modified files:**
- `package.json` — add `web-vitals@^5` to `dependencies`.
- `package-lock.json` — auto-updated by `npm install`.
- `src/app/layout.tsx` — add one import line + one `<WebVitalsReporter />` mount inside `<body>` (sibling to `{children}`).

**Deleted files:** None.

---

## Pre-flight

- [ ] **Pre-flight Step 1: Verify clean working tree on `main`.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git status -sb
git rev-parse HEAD
```

Expected: `## main...origin/main`. HEAD should match `490c043` (the slice 11 merge commit) or a descendant. Untracked items from prior sessions (`.md2pdf.py`, `FEMALE_AI_BOT.md`, `FEMALE_AI_BOT.pdf`, `training protocol /`) are acceptable noise — leave them alone.

- [ ] **Pre-flight Step 2: Confirm tests baseline is green before any edits.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
npm test -- --run 2>&1 | tail -10
```

Expected: all tests pass. Record the exact `Test Files X passed (X)` and `Tests Y passed (Y)` numbers — every later phase compares against these. **If anything fails on `main`**, stop and fix that first — slice 12's tests can't tell pre-existing breakage from new regression.

- [ ] **Pre-flight Step 3: Confirm the slice 11 Sentry wiring is in place.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
node -e 'console.log(require("@sentry/nextjs/package.json").version)'
test -f sentry.client.config.ts && echo "sentry.client.config.ts present"
test -f src/lib/observability/sentry.ts && echo "sentry.ts present"
```

Expected: a `8.x.y` Sentry version (≥ 8.28; current `main` has `^8.55.2`), and both files present. If either file is missing, slice 11 was not merged — STOP, this plan depends on slice 11.

- [ ] **Pre-flight Step 4: Confirm `web-vitals` is NOT already a dep.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
node -e 'const p = require("./package.json"); console.log(p.dependencies["web-vitals"] || p.devDependencies?.["web-vitals"] || "absent");'
```

Expected: `absent`. If a version string is printed, slice 12's Task A1 install becomes a version bump — read the diff carefully before installing.

---

## Task 0 — Worktree setup

**Files:** none (process)

- [ ] **Step 1: Create the worktree off main.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree add -b feature/aiya-web-vitals-12 .worktrees/aiya-web-vitals-12 main
```

Expected: a new working tree at `.worktrees/aiya-web-vitals-12`, branch `feature/aiya-web-vitals-12` checked out there.

- [ ] **Step 2: Switch to the worktree and install deps.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npm install
```

Expected: `npm install` finishes clean against the existing lockfile (no new packages yet; `web-vitals` is added in Task A1 with a separate install).

- [ ] **Step 3: Baseline test run inside the worktree.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npm test -- --run 2>&1 | tail -10
```

Expected: same `Test Files X passed` / `Tests Y passed` numbers as Pre-flight Step 2. This is the number every later phase compares against (slice 12 adds ~10-15 new tests across 2 new test files; final expected count is baseline + 10-15).

> **All subsequent `cd` commands in this plan reference the worktree path.** Use `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"` before any command. If a step omits the `cd` for brevity, the worktree path is still implied.

---

## Phase A — Web Vitals integration

### Task A1: Install `web-vitals@^5` and confirm the API surface

**Files:**
- Modify: `package.json`, `package-lock.json` (auto-updated by npm)

> **CRITICAL — `web-vitals` v5 API:** the named exports we use are `onLCP`, `onINP`, `onCLS` from `web-vitals`. The `Metric` type is also a named export. v5 is the current major as of 2026; v4 had the same API surface so a v4 install would also work, but we pin v5 explicitly. If `npm` picks up a v6+ that has not yet been audited against this plan, STOP and pin v5 explicitly (`npm install web-vitals@^5`). Different majors may rename `Metric` to `MetricWithAttribution` or change the `rating` field shape.

- [ ] **Step 1: Install the dep, pinning at ^5.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npm install web-vitals@^5
```

Expected: `package.json` gains a `"web-vitals": "^5.x.y"` line in `dependencies`. `package-lock.json` updates. No peer-dep warnings.

- [ ] **Step 2: Confirm the installed major.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
node -e 'console.log(require("web-vitals/package.json").version)'
```

Expected: a `5.x.y` string. If it's `4.*` or `6.*`, abort and pin v5 explicitly per the CRITICAL block above.

- [ ] **Step 3: Verify the entry-point exports exist.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
node -e 'const w = require("web-vitals"); console.log(typeof w.onLCP, typeof w.onINP, typeof w.onCLS);'
```

Expected: `function function function` — every observer this slice uses is present in the installed version. If any logs `undefined`, the version is wrong.

- [ ] **Step 4: Verify the `Metric` type re-export (TypeScript check).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
echo 'import type { Metric } from "web-vitals"; const x: Metric = { name: "LCP", value: 1, rating: "good", delta: 1, id: "x", entries: [], navigationType: "navigate" }; console.log(x.name);' > /tmp/wv-types-check.ts
npx tsc --noEmit --target es2022 --module nodenext --moduleResolution nodenext --strict /tmp/wv-types-check.ts 2>&1 | tail -5
rm /tmp/wv-types-check.ts
```

Expected: zero errors. If the typecheck flags an unknown `rating` field or a missing `navigationType` value, the v5 type surface has shifted — STOP and read the `web-vitals` CHANGELOG before continuing.

- [ ] **Step 5: Commit the dep alone.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add web-vitals@^5 for slice 12 Core Web Vitals reporting

The library is wired into the slice-11 Sentry pipeline in subsequent
A-phase tasks. This commit isolates the lockfile churn so the wiring
commits stay readable.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Implement `reportWebVital` helper + unit tests

**Files:**
- Create: `src/lib/observability/webVitals.ts`
- Create: `test/lib/observability/web-vitals-report.test.ts`

> **CRITICAL — Three load-bearing invariants in this helper:**
>
> 1. **No `orgId` anywhere.** The helper has no `orgId` parameter. It never reads `getCurrentOrgId()`. Vitals are platform-level rendering signals; the meaningful triage axis is the route, NOT the tenant. Slice 11 §5 invariant preserved by *not putting `orgId` there in the first place* (defense in depth: the slice 11 `beforeSend` scrubber would strip it anyway).
>
> 2. **`metric.entries` is NEVER forwarded to Sentry.** The `PerformanceEntry[]` field on the web-vitals Metric contains DOM node references and detailed timing data. We forward only the four numeric/string primitives we need (`value`, `delta`, `id`, `navigationType`). This is a scrubber by omission — load-bearing for the §7.2 "no PII" claim.
>
> 3. **Use the library's `metric.rating` verbatim — do not re-derive.** The `web-vitals` library computes good/needs-improvement/poor against the canonical Google thresholds (LCP good ≤ 2500ms, INP good ≤ 200ms, CLS good ≤ 0.1). Re-deriving in our code creates drift risk if Google updates a threshold in a future v5 patch release.

- [ ] **Step 1: Write the failing test.**

Create `test/lib/observability/web-vitals-report.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Metric } from "web-vitals";

// Mock @sentry/nextjs so we can assert on .captureMessage.mock.calls.
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}));

import { reportWebVital } from "@/lib/observability/webVitals";
import * as Sentry from "@sentry/nextjs";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeMetric(over: Partial<Metric> = {}): Metric {
  return {
    name: "LCP",
    value: 1800,
    rating: "good",
    delta: 1800,
    id: "v3-1-test",
    entries: [],
    navigationType: "navigate",
    ...over,
  };
}

describe("reportWebVital — capture shape", () => {
  it("calls Sentry.captureMessage exactly once per invocation", () => {
    reportWebVital(makeMetric(), "/inventory");
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("uses level=info (vitals are events, not exceptions)", () => {
    reportWebVital(makeMetric(), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].level).toBe("info");
  });

  it("builds the message string from the metric name", () => {
    reportWebVital(makeMetric({ name: "LCP" }), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("web-vital LCP");
  });

  it("puts metric name, rating, and route in tags (the filterable axes)", () => {
    reportWebVital(
      makeMetric({ name: "LCP", rating: "good" }),
      "/inventory",
    );
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags).toEqual({
      metric: "LCP",
      rating: "good",
      route: "/inventory",
    });
  });

  it("puts value, delta, id, and navigationType in extras (not tags)", () => {
    reportWebVital(
      makeMetric({ value: 1800, delta: 1800, id: "v3-1-test", navigationType: "navigate" }),
      "/inventory",
    );
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].extra).toEqual({
      value: 1800,
      delta: 1800,
      id: "v3-1-test",
      navigationType: "navigate",
    });
  });

  it("does NOT forward metric.entries to Sentry (scrubber by omission)", () => {
    const entries = [{ name: "test-entry", entryType: "largest-contentful-paint" } as unknown as PerformanceEntry];
    reportWebVital(makeMetric({ entries }), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect("entries" in call[1].extra).toBe(false);
    expect(JSON.stringify(call[1])).not.toContain("largest-contentful-paint");
  });
});

describe("reportWebVital — rating passthrough", () => {
  it("passes rating='good' through verbatim", () => {
    reportWebVital(makeMetric({ name: "LCP", rating: "good" }), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.rating).toBe("good");
  });

  it("passes rating='needs-improvement' through verbatim (CLS example)", () => {
    reportWebVital(makeMetric({ name: "CLS", rating: "needs-improvement", value: 0.15 }), "/deals");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.rating).toBe("needs-improvement");
  });

  it("passes rating='poor' through verbatim (INP example)", () => {
    reportWebVital(makeMetric({ name: "INP", rating: "poor", value: 480 }), "/deals");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.rating).toBe("poor");
  });

  it("does NOT re-derive rating from value — uses metric.rating as source of truth", () => {
    // Construct a metric whose value/rating disagree (would never happen in real
    // web-vitals output, but guards against a future careless edit that recomputes).
    reportWebVital(
      makeMetric({ name: "LCP", value: 9999, rating: "good" }),
      "/inventory",
    );
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.rating).toBe("good");
  });
});

describe("reportWebVital — route passthrough", () => {
  it("uses the route argument verbatim in tags", () => {
    reportWebVital(makeMetric(), "/deals");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.route).toBe("/deals");
  });

  it("does not strip query strings or hashes provided by the caller (caller's responsibility)", () => {
    // Defensive: if a future caller does Window.location.pathname + search, we
    // honor it. Today the reporter passes pathname only — this test documents
    // the contract, not a current need.
    reportWebVital(makeMetric(), "/inventory?filter=foo");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.route).toBe("/inventory?filter=foo");
  });
});

describe("reportWebVital — multi-tenant safety", () => {
  it("emits zero `orgId` keys anywhere on the event payload", () => {
    reportWebVital(makeMetric(), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("orgId");
  });
});
```

- [ ] **Step 2: Run the test — expect a missing-module error.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npx vitest run test/lib/observability/web-vitals-report.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: failure citing `Cannot find module '@/lib/observability/webVitals'` (or similar).

- [ ] **Step 3: Create the helper.**

Create `src/lib/observability/webVitals.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import type { Metric } from "web-vitals";

/**
 * Translate a `web-vitals` Metric into a Sentry `captureMessage` event.
 *
 * - `tags` carry the three filterable axes: which metric, what rating bucket,
 *   what route. Tag values are coerced to strings by Sentry, which is the
 *   right shape for low-cardinality enums.
 * - `extra` carries the metric value and metadata as primitives. Numeric
 *   floats (millisecond LCP, fractional CLS) belong in extras, not tags.
 * - `entries` (the PerformanceEntry[] field on Metric) is INTENTIONALLY NOT
 *   forwarded. It contains DOM node references and detailed timing data we
 *   don't need for triage; forwarding it would (a) bloat every event, and
 *   (b) potentially leak DOM contents into the observability pipeline.
 *   The scrubber-by-omission is load-bearing for the slice 12 §7.2 invariant.
 * - Rating is forwarded VERBATIM from `metric.rating` — we do NOT re-derive
 *   from `metric.value`. The `web-vitals` library is the canonical source of
 *   truth for good/needs-improvement/poor thresholds (LCP ≤ 2500ms etc.); a
 *   re-derivation would silently drift if Google updates a threshold in a
 *   future patch release.
 * - NO `orgId` field anywhere. Vitals are platform-level rendering signals;
 *   the meaningful triage axis is the route, not the tenant. Slice 11 §5
 *   tenancy invariant preserved by not introducing the leak in the first
 *   place (the slice-11 `beforeSend` scrubber is the defense-in-depth backstop).
 */
export function reportWebVital(metric: Metric, route: string): void {
  Sentry.captureMessage(`web-vital ${metric.name}`, {
    level: "info",
    tags: {
      metric: metric.name,
      rating: metric.rating,
      route,
    },
    extra: {
      value: metric.value,
      delta: metric.delta,
      id: metric.id,
      navigationType: metric.navigationType,
    },
  });
}
```

- [ ] **Step 4: Run — expect all helper tests pass.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npx vitest run test/lib/observability/web-vitals-report.test.ts --reporter=verbose 2>&1 | tail -25
```

Expected: 13 passed (6 capture-shape + 4 rating-passthrough + 2 route-passthrough + 1 multi-tenant).

- [ ] **Step 5: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors. If the `Metric` type doesn't import cleanly, the v5 install in Task A1 may have shifted — verify `node_modules/web-vitals/dist/modules/types.d.ts` exists.

- [ ] **Step 6: Commit.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
git add src/lib/observability/webVitals.ts test/lib/observability/web-vitals-report.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): reportWebVital helper + tests (slice 12)

Pure function that translates a web-vitals Metric into a tagged
Sentry.captureMessage. Tags carry metric/rating/route (filterable in
Sentry workspace UI); extras carry value/delta/id/navigationType
(numeric/string primitives). metric.entries is deliberately not
forwarded — scrubber by omission. Rating is passed through verbatim
from the library, never re-derived.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Implement `<WebVitalsReporter />` client component + tests

**Files:**
- Create: `src/components/observability/WebVitalsReporter.tsx`
- Create: `test/components/observability/WebVitalsReporter.test.tsx`

> **CRITICAL — Two load-bearing invariants in the reporter:**
>
> 1. **Demo mode short-circuits BEFORE observer registration.** `if (isDemoMode()) return;` is the first line inside the `useEffect`. The `web-vitals` library adds non-trivial overhead (PerformanceObservers, visibilityState listeners, event-timing buffers) even when its callbacks become no-ops. The slice-11 §6 pattern is "no observability work in demo"; this slice extends it.
>
> 2. **`window.location.pathname` is read at REPORT TIME, not registration time.** The closure captures a function that calls `window.location.pathname` each time a metric fires — so soft-nav between `/inventory` and `/deals` attaches the right route to each metric. If we captured `pathname` once at mount, all metrics would tag the page the user landed on, regardless of where they navigated to before the metric reported. Wrong shape.

- [ ] **Step 1: Write the failing test.**

Create `test/components/observability/WebVitalsReporter.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Mock the web-vitals library so we can assert on the on* calls.
vi.mock("web-vitals", () => ({
  onLCP: vi.fn(),
  onINP: vi.fn(),
  onCLS: vi.fn(),
}));

// Mock the report helper so we can assert it gets the right pathname.
vi.mock("@/lib/observability/webVitals", () => ({
  reportWebVital: vi.fn(),
}));

// Mock demo mode — we drive it per test via the mock factory.
let mockIsDemoMode = false;
vi.mock("@/lib/demo/mode", () => ({
  isDemoMode: () => mockIsDemoMode,
}));

import { WebVitalsReporter } from "@/components/observability/WebVitalsReporter";
import * as webVitals from "web-vitals";
import { reportWebVital } from "@/lib/observability/webVitals";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDemoMode = false;
});

describe("WebVitalsReporter", () => {
  it("registers onLCP, onINP, and onCLS exactly once on mount (non-demo)", () => {
    render(<WebVitalsReporter />);
    expect(webVitals.onLCP).toHaveBeenCalledTimes(1);
    expect(webVitals.onINP).toHaveBeenCalledTimes(1);
    expect(webVitals.onCLS).toHaveBeenCalledTimes(1);
  });

  it("each on* registration receives a function callback", () => {
    render(<WebVitalsReporter />);
    const lcpCb = (webVitals.onLCP as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const inpCb = (webVitals.onINP as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const clsCb = (webVitals.onCLS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof lcpCb).toBe("function");
    expect(typeof inpCb).toBe("function");
    expect(typeof clsCb).toBe("function");
  });

  it("renders null (no DOM output)", () => {
    const { container } = render(<WebVitalsReporter />);
    expect(container.firstChild).toBeNull();
  });

  it("DEMO MODE: does NOT register any web-vitals observer", () => {
    mockIsDemoMode = true;
    render(<WebVitalsReporter />);
    expect(webVitals.onLCP).not.toHaveBeenCalled();
    expect(webVitals.onINP).not.toHaveBeenCalled();
    expect(webVitals.onCLS).not.toHaveBeenCalled();
  });

  it("DEMO MODE: still renders null (no JSX side effects)", () => {
    mockIsDemoMode = true;
    const { container } = render(<WebVitalsReporter />);
    expect(container.firstChild).toBeNull();
  });

  it("the registered callback invokes reportWebVital with the current pathname (read at report time)", () => {
    render(<WebVitalsReporter />);
    const lcpCb = (webVitals.onLCP as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // jsdom default location.pathname is "/blank" or "/" depending on config —
    // we don't pin a specific value, just assert it's forwarded.
    const fakeMetric = {
      name: "LCP" as const,
      value: 1800,
      rating: "good" as const,
      delta: 1800,
      id: "v3-1",
      entries: [],
      navigationType: "navigate" as const,
    };
    lcpCb(fakeMetric);
    expect(reportWebVital).toHaveBeenCalledTimes(1);
    expect(reportWebVital).toHaveBeenCalledWith(fakeMetric, window.location.pathname);
  });

  it("pathname is read at REPORT TIME, not registration time (soft-nav correctness)", () => {
    // 1. Mount the reporter while location.pathname is "/" (jsdom default).
    render(<WebVitalsReporter />);
    const lcpCb = (webVitals.onLCP as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // 2. Simulate a soft-nav by overwriting pathname.
    const originalPath = window.location.pathname;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, pathname: "/deals" },
    });

    // 3. Fire the metric — reportWebVital should see "/deals", not the old path.
    const fakeMetric = {
      name: "LCP" as const,
      value: 1800,
      rating: "good" as const,
      delta: 1800,
      id: "v3-1",
      entries: [],
      navigationType: "navigate" as const,
    };
    lcpCb(fakeMetric);
    expect(reportWebVital).toHaveBeenCalledWith(fakeMetric, "/deals");

    // 4. Restore.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, pathname: originalPath },
    });
  });
});
```

- [ ] **Step 2: Run — expect a missing-module error.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npx vitest run test/components/observability/WebVitalsReporter.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: failure citing `Cannot find module '@/components/observability/WebVitalsReporter'`.

- [ ] **Step 3: Create the component directory and file.**

```bash
mkdir -p "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12/src/components/observability"
```

Create `src/components/observability/WebVitalsReporter.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { onCLS, onINP, onLCP, type Metric } from "web-vitals";
import { isDemoMode } from "@/lib/demo/mode";
import { reportWebVital } from "@/lib/observability/webVitals";

/**
 * Mounted once at the root layout (`src/app/layout.tsx`). Registers
 * PerformanceObservers for LCP, INP, and CLS via the `web-vitals` library on
 * mount, then pipes each metric report into Sentry via `reportWebVital()`.
 *
 * Demo-mode short-circuit: skip observer registration ENTIRELY. The
 * `web-vitals` library installs PerformanceObservers, visibilityState
 * listeners, and event-timing buffers even when its callbacks become no-ops —
 * so we don't pay any of that overhead in the demo deploy. Slice 11 §6
 * established the "no observability work in demo" pattern; this preserves it.
 *
 * `window.location.pathname` is read at REPORT TIME (inside the callback),
 * not registration time. This is correctness-critical for soft-navigation:
 * a user who lands on `/` and navigates to `/inventory` before LCP fires
 * gets the LCP tagged with `/inventory`, which is the page the metric
 * actually describes.
 *
 * Returns null — effect-only component, no DOM output.
 */
export function WebVitalsReporter(): null {
  useEffect(() => {
    if (isDemoMode()) return;

    const report = (metric: Metric) =>
      reportWebVital(metric, window.location.pathname);

    onLCP(report);
    onINP(report);
    onCLS(report);
  }, []);

  return null;
}
```

- [ ] **Step 4: Run — expect all 7 component tests pass.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npx vitest run test/components/observability/WebVitalsReporter.test.tsx --reporter=verbose 2>&1 | tail -25
```

Expected: `7 passed`. If the soft-nav test (the last one) fails because jsdom rejects the `Object.defineProperty(window, "location", ...)` overwrite, swap it for a `history.pushState` call to change the pathname — both shapes exercise the "read at report time" property.

- [ ] **Step 5: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 6: Commit.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
git add src/components/observability/WebVitalsReporter.tsx test/components/observability/WebVitalsReporter.test.tsx
git commit -m "$(cat <<'EOF'
feat(observability): WebVitalsReporter client component + tests (slice 12)

Effect-only component that registers onLCP/onINP/onCLS via web-vitals
and pipes each report into reportWebVital with the current pathname.
Demo mode short-circuits the entire registration so the web-vitals
PerformanceObservers + event-timing buffers don't run in the demo
deploy. Pathname is read at report time (not registration time) so
soft-nav between dashboard / inventory / deals tags each metric with
the page it actually describes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Mount `<WebVitalsReporter />` in the root layout

**Files:**
- Modify: `src/app/layout.tsx`

> **CRITICAL — Single mount point at the root layout.** The reporter MUST mount exactly once per browser session. The natural home is `src/app/layout.tsx` as a sibling to `{children}`. Do NOT mount it in any per-page server component; do NOT mount it twice; do NOT mount it inside a `<Suspense>` boundary (the effect would re-run on suspense resume). The `web-vitals` library's internal de-duplication does NOT cover the case of two `onLCP` registrations from two different mount points — you'd get double-reported metrics.

- [ ] **Step 1: Edit `src/app/layout.tsx`.**

Open the file. The current contents:

```tsx
import "./globals.css";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Cormorant_Garamond } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

export const metadata = { title: "AIYA Designs — Command Center" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

Edit it to:

```tsx
import "./globals.css";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Cormorant_Garamond } from "next/font/google";
import { WebVitalsReporter } from "@/components/observability/WebVitalsReporter";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

export const metadata = { title: "AIYA Designs — Command Center" };

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

Two changes: the import line, and the `<WebVitalsReporter />` mount immediately inside `<body>` and before `{children}`.

- [ ] **Step 2: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: Smoke-test the build.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npm run build 2>&1 | tail -30
```

Expected: build succeeds. The output should include a `WebVitalsReporter` chunk in the client bundle (look for it in the `/_next/static/chunks/` listing). If the build fails citing "useEffect in a server component" or similar, the `"use client"` directive at the top of `WebVitalsReporter.tsx` is missing or got stripped — fix and re-run.

- [ ] **Step 4: Full test run — confirm baseline + new tests all green.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npm test -- --run 2>&1 | tail -10
```

Expected: pre-flight baseline + ~13 new helper tests + ~7 new component tests = baseline + ~20 new tests, all green. The full count is `baseline + 20`.

- [ ] **Step 5: Commit.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
git add src/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat(observability): mount WebVitalsReporter in root layout (slice 12)

Single mount point inside <body>, sibling to {children}. Registers
LCP/INP/CLS PerformanceObservers exactly once per browser session.
Demo deploys short-circuit the registration via the component's own
isDemoMode() guard — no need for layout-level branching.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Verification + merge

### Task B1: Whole-slice verification

**Files:** none (verification only)

> **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion`. Every claim of "it works" must be backed by a command and its output.

- [ ] **Step 1: Full test suite is green.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npm test -- --run 2>&1 | tail -15
```

Expected: `Test Files (baseline+2) passed` and `Tests (baseline+~20) passed`. Zero skipped, zero failed. Compare against Task 0 Step 3 numbers.

- [ ] **Step 2: Typecheck is clean.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors, zero warnings.

- [ ] **Step 3: Build is clean.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npm run build 2>&1 | tail -20
```

Expected: build succeeds. Sentry's webpack plugin should log "skipped: SENTRY_AUTH_TOKEN absent" (or similar) since we're not uploading source maps in dev. The `WebVitalsReporter` should be visible as a small client chunk in the route summary.

- [ ] **Step 4: Bundle-size sanity check.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
ls -lah .next/static/chunks/ | grep -i webvitals 2>&1 | tail -5 || true
# web-vitals total bundle contribution is documented as ~2KB gzipped — confirm via du if needed.
du -sh node_modules/web-vitals 2>&1 | tail -3
```

Expected: `node_modules/web-vitals` is in the low 100s of KB (source + sourcemaps; the *bundled* contribution is much smaller after tree-shaking + minification). If the directory is >1MB, something is wrong with the install.

- [ ] **Step 5: PR review grep checklist (slice 12 spec §7.6).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"

echo "--- grep 1: orgId in slice 12 surface ---"
grep -rn "orgId" src/lib/observability/webVitals.ts src/components/observability/WebVitalsReporter.tsx || echo "OK: 0 matches"

echo "--- grep 2: captureException in vitals helper (should be 0) ---"
grep -rn "captureException" src/lib/observability/webVitals.ts || echo "OK: 0 matches"

echo "--- grep 3: metric.entries forwarded (should be 0 outside type import) ---"
grep -n "entries" src/lib/observability/webVitals.ts || echo "OK: 0 matches"

echo "--- grep 4: next/web-vitals (should be 0 — we use the direct dep) ---"
grep -rn "useReportWebVitals\|next/web-vitals" src/ || echo "OK: 0 matches"
```

Expected:
- grep 1: "OK: 0 matches"
- grep 2: "OK: 0 matches"
- grep 3: "OK: 0 matches" (no `entries` read in the helper file)
- grep 4: "OK: 0 matches"

If any grep returns a match, STOP — read the spec §7.6 and fix before continuing.

- [ ] **Step 6: Manual smoke — dev server boot + console check.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
npm run dev > /tmp/slice-12-dev.log 2>&1 &
DEV_PID=$!
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/ || true
tail -30 /tmp/slice-12-dev.log
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected: HTTP 200 on `/` (or a 307 redirect to `/login` — both are normal). No `web-vitals` errors in the log, no `WebVitalsReporter` errors, no "Cannot find module" errors. The page renders without the reporter throwing.

> **Browser-side smoke (optional, recommended for confidence):** open `http://localhost:3000/` in a browser with the dev server running and `SENTRY_DSN` unset. Open DevTools → Console — should be clean (no errors from `web-vitals` or Sentry). The slice 12 reporter installs PerformanceObservers silently; with no DSN, the `captureMessage` calls are no-ops. Browser-side smoke with a real DSN should land events in the Sentry workspace UI's "Issues" or "Web Vitals" tab.

- [ ] **Step 7: Mark the verification done. No commits in this task.**

---

### Task B2: Final review + merge

**Files:** none (process)

> **REQUIRED SUB-SKILL:** Use `superpowers:finishing-a-development-branch` to decide between fast-forward merge, PR, or further cleanup. For solo-operator work on `main`, fast-forward merge is the default unless code review is explicitly requested.

- [ ] **Step 1: Confirm working tree is clean inside the worktree.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
git status -sb
```

Expected: `## feature/aiya-web-vitals-12` with no untracked, modified, or staged files. The four commits from Tasks A1–A4 should be the only diff vs `main`.

- [ ] **Step 2: Review the commits.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-web-vitals-12"
git log main..HEAD --oneline
git diff main..HEAD --stat
```

Expected: four commits matching Tasks A1, A2, A3, A4 — `chore(deps): add web-vitals@^5`, `feat(observability): reportWebVital helper + tests`, `feat(observability): WebVitalsReporter client component + tests`, `feat(observability): mount WebVitalsReporter in root layout`. The diff stat should show ~150 lines added (production code + tests) and ~2 lines modified in `src/app/layout.tsx`.

- [ ] **Step 3: Decide merge shape.**

For solo-operator work matching the existing slice merges (see `git log main` for the slice 10 / slice 11 pattern), the default is a no-fast-forward merge back to `main` to preserve the slice boundary in history:

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git checkout main
git merge --no-ff feature/aiya-web-vitals-12 -m "$(cat <<'EOF'
Merge slice 12: Web Vitals

LCP/INP/CLS reporting via Google's web-vitals@^5 library, piped into
the slice-11 Sentry pipeline as tagged captureMessage events. Single
client component mounted in the root layout; demo-mode short-circuits
the entire registration. Zero orgId on the wire; route is the
triage axis.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: clean merge, no conflicts (slice 12 only touches one shared file — `src/app/layout.tsx` — and only adds two lines to it).

- [ ] **Step 4: Run the full test suite ONE MORE TIME on `main` after merge.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
npm test -- --run 2>&1 | tail -10
```

Expected: `Test Files (baseline+2) passed`, `Tests (baseline+~20) passed`. Same numbers as Task B1 Step 1.

- [ ] **Step 5: Remove the worktree.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree remove .worktrees/aiya-web-vitals-12
git branch -d feature/aiya-web-vitals-12
```

Expected: clean worktree removal. If `git branch -d` complains the branch isn't fully merged, you skipped Step 3 — re-run.

- [ ] **Step 6: Confirm `main` is clean and slice 12 is shipped.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git status -sb
git log -5 --oneline
```

Expected: `## main` clean, top commit is the slice 12 merge. Slice 12 is on `main`.

---

## Done

When all checkboxes in this plan are checked:
- `web-vitals@^5` is in `dependencies`.
- `src/lib/observability/webVitals.ts` exports `reportWebVital(metric, route)`.
- `src/components/observability/WebVitalsReporter.tsx` is mounted at the root layout and registers LCP/INP/CLS observers in non-demo browsers.
- Two test files cover the helper (capture-shape + rating-passthrough + route-passthrough + no-orgId-leak) and the component (registration + demo-skip + callback wiring + null render + soft-nav correctness).
- All slice 11 invariants (`orgId` only in tags, never in extras/breadcrumbs; demo = no observability work) are preserved.
- The slice ships under 100 lines of production code and ~150 lines of tests.

Web Vitals data should start flowing into the Sentry workspace as soon as the first real user hits the production deploy with `SENTRY_DSN` configured. The operator can now filter LCP regressions by route, set up regression alerts inside the Sentry UI, and watch INP/CLS trends per page over time — all without any further code in this repo.

Future follow-ons (named in slice 12 spec §9): bundle-size budgets (slice 13), Lighthouse CI (slice 14), per-route performance budgets (later), FCP/TTFB if needed (one-line addition).
