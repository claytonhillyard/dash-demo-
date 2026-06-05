# AIYA Slice 11 — Polish + Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Sentry for backend error capture (action wrapper + middleware + client poll) and ship a Provider Status dashboard panel showing per-provider freshness. Multi-tenant safe (orgId only in server tags, never in breadcrumbs). Demo-mode disables Sentry entirely.

**Architecture:** @sentry/nextjs added; run() wrapper extended with captureException; useQuotesPoll tracks consecutive failures and captures on the 5th; ProviderStatusPanel reads from a new getProviderStatus() aggregator in the market router. CSP widening for Sentry ingest is derived from DSN at build time, conditional on SENTRY_DSN being set.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind · Drizzle ORM · @sentry/nextjs · existing slice-3 getCurrentOrgId() seam · existing slice-1a freshness model + FreshnessDot component.

---

## File Structure

**New files:**
- `src/lib/observability/sentry.ts` — `initSentry()` + `beforeSend` + `beforeBreadcrumb` + `withOrgScope(orgId, fn)`. Single source of truth.
- `src/lib/observability/stripOrgId.ts` — small pure helper used by the scrubbers (kept separate so unit tests don't need to touch the init seam).
- `src/lib/observability/csp.ts` — DSN→ingest-host parser used by `next.config.mjs`. Exported separately so the test can exercise it without the build.
- `src/lib/market/health.ts` — `getProviderStatus()` + `recordProviderResult(id, ok, err?)` + `PROVIDER_DISPLAY` map.
- `src/components/dashboard/ProviderStatusPanel.tsx`
- `sentry.server.config.ts` (repo root — Next 15 SDK convention)
- `sentry.client.config.ts` (repo root)
- `sentry.edge.config.ts` (repo root)
- `src/instrumentation.ts` — Next 15 server-runtime entry; imports the right config per `NEXT_RUNTIME`.
- `test/lib/observability/sentry-init.test.ts`
- `test/lib/observability/sentry-scrubber.test.ts`
- `test/lib/observability/sentry-action-wrapper.test.ts`
- `test/lib/observability/quote-poll-capture.test.ts`
- `test/lib/observability/csp.test.ts`
- `test/lib/market/health.test.ts`
- `test/components/dashboard/ProviderStatusPanel.test.tsx`

**Modified files:**
- `package.json` — add `@sentry/nextjs` dep.
- `next.config.mjs` — wrap export in `withSentryConfig`; widen `CONNECT_HOSTS` with parsed Sentry ingest host when `SENTRY_DSN` is set.
- `src/middleware.ts` — wrap body in try/catch + `Sentry.captureException` on the catch path.
- `src/lib/market/router.ts` — `resolveQuotes` accepts an optional `onProviderResult` callback.
- `src/lib/market/cache.ts` — `defaultQuoteFetcher` wires the callback to `recordProviderResult`.
- `src/lib/deals/actions.ts` — `run()` and `runWithUser()` catch blocks call `Sentry.captureException` (excluding `ForbiddenError`).
- `src/lib/inventory/actions.ts` — `run()` catch adds the same line.
- `src/lib/diamonds/actions.ts` — both `importMatrix` and `run()` catch blocks.
- `src/lib/website/actions.ts` — `run()` catch.
- `src/lib/company/actions.ts` — `run()` catch.
- `src/hooks/useQuotesPoll.ts` — threshold-5 consecutive-failure counter + capture.
- `src/lib/layout/registry.tsx` — append `provider-status` entry to `PANEL_REGISTRY`.
- `src/lib/layout/types.ts` — add `ProviderStatusView` to `PanelCtx`.
- `src/app/page.tsx` — call `getProviderStatus()` and thread it into `PanelCtx`.
- `DEPLOY.md` — append a "Sentry setup (optional)" section.

**Deleted files:** None.

---

## Pre-flight

- [ ] **Pre-flight Step 1: Verify clean working tree on `main`.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git status -sb
git rev-parse HEAD
```

Expected: `## main...origin/main`. The only untracked items should be the unrelated `.md2pdf.py` / `FEMALE_AI_BOT.md` / `FEMALE_AI_BOT.pdf` / `training protocol /` paths from prior sessions. HEAD should match the slice-10 merge commit `40cbf8b` (or its descendant if a hot-fix has landed since).

- [ ] **Pre-flight Step 2: Confirm tests baseline is green before any edits.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: `Test Files  111 passed (111)` and `Tests  588 passed (588)`. **If anything fails on `main`**, stop and fix that first — slice-11's tests can't tell pre-existing breakage from new regression.

---

## Task 0 — Worktree setup

**Files:** none (process)

- [ ] **Step 1: Create the worktree off main.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree add -b feature/aiya-polish-observability-11 .worktrees/aiya-polish-observability-11 main
```

Expected: a new working tree at `.worktrees/aiya-polish-observability-11`, branch `feature/aiya-polish-observability-11` checked out there.

- [ ] **Step 2: Switch to the worktree and install deps.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npm install
```

Expected: `npm install` finishes clean (this is the existing lockfile — no new packages yet; `@sentry/nextjs` is added in Task A1 with a separate install).

- [ ] **Step 3: Baseline test run inside the worktree.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npm test -- --run 2>&1 | tail -10
```

Expected: `Test Files  111 passed (111)` and `Tests  588 passed (588)`. This is the number every later phase compares against (slice 11 adds approximately 50 new tests across 7 new test files; final expected count after slice 11 is ~640).

> **All subsequent `cd` commands in this plan reference the worktree path.** Use `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"` before any command. If a step omits the `cd` for brevity, the worktree path is still implied.

---

## Phase A — Sentry SDK integration

### Task A1: Install `@sentry/nextjs` and pin the major version

**Files:**
- Modify: `package.json`, `package-lock.json` (auto-updated by npm)

> **CRITICAL — `@sentry/nextjs` v8+ API:** the integration API changed between v7 and v8 (the old `withSentry(handler)` wrapper around route handlers was removed in v8 in favor of `instrumentation.ts` + `sentry.server.config.ts` + `sentry.client.config.ts` + `sentry.edge.config.ts`). This plan targets **v8 or v9**. Verify the version that landed in `package.json` after the install matches one of those before continuing — if `npm` picks up a v7 or a v10+ release, STOP and pin v8 explicitly (`npm install @sentry/nextjs@^8`). Different majors have different files/exports and this plan's code will mis-compile.

- [ ] **Step 1: Install the dep, pinning at-or-after v8.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npm install @sentry/nextjs@^8
```

Expected: `package.json` gains a `"@sentry/nextjs": "^8.x.y"` line in `dependencies`. `package-lock.json` updates.

- [ ] **Step 2: Confirm the installed major.**

```bash
node -e 'console.log(require("@sentry/nextjs/package.json").version)'
```

Expected: a `8.x.y` string. If it's `7.*` or `10.*`, abort and pin v8 explicitly per the CRITICAL block above.

- [ ] **Step 3: Verify the entry-point exports exist.**

```bash
node -e 'const s = require("@sentry/nextjs"); console.log(typeof s.init, typeof s.captureException, typeof s.captureMessage, typeof s.withSentryConfig, typeof s.withScope, typeof s.setTag);'
```

Expected: `function function function function function function` — every API surface this slice uses is present in the installed version. If any logs `undefined`, the version is wrong.

- [ ] **Step 4: Commit the dep alone.**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add @sentry/nextjs@^8 for slice 11 observability

Sentry SDK is wired in subsequent A-phase tasks. This commit isolates
the lockfile churn so the wiring commits stay readable.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Create the `stripOrgId` scrubber helper + test

**Files:**
- Create: `src/lib/observability/stripOrgId.ts`
- Create: `test/lib/observability/sentry-scrubber.test.ts`

> **CRITICAL — `orgId` NEVER in breadcrumbs/extras/contexts:** the single load-bearing tenancy invariant of slice 11. The strip helper here is the canonical implementation. The `beforeSend` and `beforeBreadcrumb` hooks (Task A3) call it on every event before transmission. `orgId` is permitted ONLY in `event.tags` (set server-side via `Sentry.withScope`). Any other surface — breadcrumb `data`, event `extra`, event `contexts[*]`, event `message` — leaks the tenant id off the operator's control plane and is forbidden. The PR review grep checklist (Phase D) enforces this.

- [ ] **Step 1: Write the failing test.**

Create `test/lib/observability/sentry-scrubber.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { stripOrgId } from "@/lib/observability/stripOrgId";

describe("stripOrgId — shallow + one-level-deep", () => {
  it("returns undefined for undefined input (no throw)", () => {
    expect(stripOrgId(undefined)).toBeUndefined();
  });

  it("returns the object unchanged when there is no orgId field", () => {
    const obj = { otherField: "x", count: 3 };
    const out = stripOrgId(obj);
    expect(out).toEqual({ otherField: "x", count: 3 });
  });

  it("strips a shallow orgId field", () => {
    const out = stripOrgId({ orgId: 7, otherField: "x" });
    expect(out).toEqual({ otherField: "x" });
    expect("orgId" in out!).toBe(false);
  });

  it("strips an orgId field one level deep inside a nested object", () => {
    const out = stripOrgId({
      request: { orgId: 7, url: "/foo" },
      keep: "y",
    });
    expect(out).toEqual({
      request: { url: "/foo" },
      keep: "y",
    });
  });

  it("leaves arrays untouched (we do not recurse into arrays)", () => {
    const out = stripOrgId({ list: [{ orgId: 7, name: "a" }], keep: "y" });
    // Array contents preserved verbatim — the strip is documented as shallow +
    // one-level-deep on objects only. Acceptable trade-off; the PR review grep
    // is the belt-and-braces enforcement for intentional usages.
    expect(out).toEqual({ list: [{ orgId: 7, name: "a" }], keep: "y" });
  });

  it("ignores primitive values at the top level", () => {
    const out = stripOrgId({ count: 3, label: "x", flag: true });
    expect(out).toEqual({ count: 3, label: "x", flag: true });
  });
});
```

- [ ] **Step 2: Run the test — expect a missing-module error.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/sentry-scrubber.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: failure citing `Cannot find module '@/lib/observability/stripOrgId'` (or similar).

- [ ] **Step 3: Create the helper.**

```bash
mkdir -p "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11/src/lib/observability"
```

Create `src/lib/observability/stripOrgId.ts`:

```ts
/**
 * Removes the `orgId` field from `obj` (shallow) and from any value of `obj`
 * that is itself a plain object (one level deep). Arrays and primitives at any
 * depth are returned untouched.
 *
 * The strip is INTENTIONALLY shallow + one-level-deep, not fully recursive:
 *   - Every intentional `orgId` usage in this codebase is a flat tag/extra
 *     (slice-3 `getCurrentOrgId()` + slice-11 `withOrgScope`).
 *   - A deeply-nested `orgId` would be a bug in some unrelated capture site.
 *     The PR review grep checklist (slice 11 Phase D) is the second line of
 *     defense for that case.
 *   - Full recursion makes the helper expensive on large Sentry event payloads
 *     and harder to reason about. Trade-off accepted; documented here.
 */
export function stripOrgId<T extends Record<string, unknown> | undefined>(
  obj: T,
): T {
  if (!obj || typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "orgId") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};
      for (const [nk, nv] of Object.entries(nested)) {
        if (nk === "orgId") continue;
        cleaned[nk] = nv;
      }
      out[k] = cleaned;
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
```

- [ ] **Step 4: Run — expect 6 passed.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/sentry-scrubber.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: `6 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/observability/stripOrgId.ts test/lib/observability/sentry-scrubber.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): stripOrgId scrubber helper + tests (slice 11)

Shallow + one-level-deep strip of the orgId field from arbitrary plain
objects. Intentionally not recursive — see the docblock for the rationale
and the PR-review grep that backstops it.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Implement `initSentry`, `beforeSend`, `beforeBreadcrumb`, `withOrgScope`

**Files:**
- Create: `src/lib/observability/sentry.ts`
- Create: `test/lib/observability/sentry-init.test.ts`

> **CRITICAL — Demo mode = SDK disabled:** `Sentry.init({ enabled: !isDemoMode() && !!SENTRY_DSN })`. Without this, every demo visitor's transient client error floods the production Sentry project. The `enabled` flag — NOT a "skip init" branch — is the right shape because the rest of the SDK code (breadcrumb queues, `captureException`/`captureMessage` callsites) still loads and becomes no-ops; we never need to wrap callsites in `if (!isDemoMode())`. The init-time test below pins this.

- [ ] **Step 1: Write the failing init test.**

Create `test/lib/observability/sentry-init.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @sentry/nextjs so we can assert on .init.mock.calls.
vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((fn: (scope: { setTag: (k: string, v: unknown) => void }) => unknown) =>
    fn({ setTag: vi.fn() }),
  ),
  setTag: vi.fn(),
}));

// Stub the demo flag — we drive it via env in each test.
vi.mock("@/lib/demo/mode", () => ({
  isDemoMode: () => process.env.NEXT_PUBLIC_DEMO_MODE === "true",
}));

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  delete process.env.SENTRY_DSN;
});
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe("initSentry", () => {
  it("calls Sentry.init with enabled:false in demo mode (no DSN required)", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const { initSentry } = await import("@/lib/observability/sentry");
    const Sentry = await import("@sentry/nextjs");
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const cfg = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cfg.enabled).toBe(false);
  });

  it("calls Sentry.init with enabled:false when SENTRY_DSN is unset (non-demo)", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    // SENTRY_DSN deliberately unset.
    const { initSentry } = await import("@/lib/observability/sentry");
    const Sentry = await import("@sentry/nextjs");
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const cfg = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cfg.enabled).toBe(false);
    expect(cfg.dsn).toBeUndefined();
  });

  it("calls Sentry.init with enabled:true when DSN is set and not in demo", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const { initSentry } = await import("@/lib/observability/sentry");
    const Sentry = await import("@sentry/nextjs");
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const cfg = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cfg.enabled).toBe(true);
    expect(cfg.dsn).toBe("https://abc@o123.ingest.sentry.io/4567");
    expect(typeof cfg.beforeSend).toBe("function");
    expect(typeof cfg.beforeBreadcrumb).toBe("function");
    expect(cfg.tracesSampleRate).toBe(0);
  });

  it("is idempotent — calling twice does not throw and re-inits with same shape", async () => {
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const { initSentry } = await import("@/lib/observability/sentry");
    const Sentry = await import("@sentry/nextjs");
    initSentry();
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(2);
    const a = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const b = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(b.enabled).toBe(a.enabled);
    expect(b.dsn).toBe(a.dsn);
  });
});

describe("beforeSend (server scrubber)", () => {
  async function load() {
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const mod = await import("@/lib/observability/sentry");
    return mod.beforeSend;
  }

  it("strips orgId from event.extra", async () => {
    const beforeSend = await load();
    const out = beforeSend!(
      { extra: { orgId: 7, otherField: "x" } } as unknown as Parameters<NonNullable<typeof beforeSend>>[0],
      {} as never,
    );
    expect(out!.extra).toEqual({ otherField: "x" });
  });

  it("strips orgId from event.contexts[*]", async () => {
    const beforeSend = await load();
    const out = beforeSend!(
      { contexts: { request: { orgId: 7, url: "/foo" } } } as unknown as Parameters<NonNullable<typeof beforeSend>>[0],
      {} as never,
    );
    expect(out!.contexts!.request).toEqual({ url: "/foo" });
  });

  it("strips orgId from event.breadcrumbs[*].data", async () => {
    const beforeSend = await load();
    const out = beforeSend!(
      {
        breadcrumbs: [
          { data: { orgId: 7, query: "abc" }, message: "m" },
        ],
      } as unknown as Parameters<NonNullable<typeof beforeSend>>[0],
      {} as never,
    );
    expect(out!.breadcrumbs![0].data).toEqual({ query: "abc" });
  });

  it("leaves event.tags untouched (tags are intentionally allowed)", async () => {
    const beforeSend = await load();
    const out = beforeSend!(
      { tags: { orgId: 7, layer: "deals-action" } } as unknown as Parameters<NonNullable<typeof beforeSend>>[0],
      {} as never,
    );
    expect(out!.tags).toEqual({ orgId: 7, layer: "deals-action" });
  });
});

describe("beforeBreadcrumb (incoming-breadcrumb scrubber)", () => {
  async function load() {
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const mod = await import("@/lib/observability/sentry");
    return mod.beforeBreadcrumb;
  }

  it("strips orgId from breadcrumb.data before queue", async () => {
    const beforeBreadcrumb = await load();
    const out = beforeBreadcrumb!(
      { data: { orgId: 7, query: "abc" } } as unknown as Parameters<NonNullable<typeof beforeBreadcrumb>>[0],
      {} as never,
    );
    expect(out!.data).toEqual({ query: "abc" });
  });
});
```

- [ ] **Step 2: Run — expect a missing-module error.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/sentry-init.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: failure citing `Cannot find module '@/lib/observability/sentry'`.

- [ ] **Step 3: Implement `src/lib/observability/sentry.ts`.**

Create `src/lib/observability/sentry.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import { isDemoMode } from "@/lib/demo/mode";
import { stripOrgId } from "./stripOrgId";

const SENTRY_DSN = process.env.SENTRY_DSN;

/**
 * `beforeSend` is the SINGLE SOURCE OF TRUTH for the "no orgId in
 * breadcrumbs/extras/contexts" rule. It runs once per event right before
 * transmission. `event.tags` is INTENTIONALLY untouched — `orgId` is allowed
 * there (set server-side via `withOrgScope`) and is used for triage filtering
 * inside the Sentry workspace UI, never leaving the operator's control plane.
 */
export function beforeSend(
  event: Sentry.Event,
  _hint: Sentry.EventHint,
): Sentry.Event | null {
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      data: stripOrgId(b.data as Record<string, unknown> | undefined),
    }));
  }
  if (event.extra) {
    event.extra = stripOrgId(event.extra as Record<string, unknown>);
  }
  if (event.contexts) {
    const cleaned: Record<string, Record<string, unknown>> = {};
    for (const k of Object.keys(event.contexts)) {
      const v = event.contexts[k] as Record<string, unknown> | undefined;
      cleaned[k] = stripOrgId(v) as Record<string, unknown>;
    }
    event.contexts = cleaned as Sentry.Contexts;
  }
  return event;
}

/**
 * `beforeBreadcrumb` strips orgId before a breadcrumb is queued. Belt-and-
 * braces with `beforeSend` — the latter is the canonical strip, the former
 * keeps the in-memory breadcrumb buffer clean so a developer inspecting it
 * via DevTools never sees `orgId` either.
 */
export function beforeBreadcrumb(
  breadcrumb: Sentry.Breadcrumb,
  _hint: Sentry.BreadcrumbHint,
): Sentry.Breadcrumb | null {
  return {
    ...breadcrumb,
    data: stripOrgId(breadcrumb.data as Record<string, unknown> | undefined),
  };
}

/**
 * Server-side helper for tagging an event with the request's `orgId`. Tags
 * are filterable in the Sentry workspace UI and are necessary for an operator
 * to triage a real error back to a tenant. Tags do NOT leave the Sentry
 * workspace.
 *
 * Usage:
 *   await withOrgScope(orgId, async () => { ... ;Sentry.captureException(e); });
 */
export function withOrgScope<T>(orgId: number, fn: () => T): T {
  let result!: T;
  Sentry.withScope((scope) => {
    scope.setTag("orgId", orgId);
    result = fn();
  });
  return result;
}

/**
 * Idempotent SDK initialisation. Called from `sentry.server.config.ts`,
 * `sentry.client.config.ts`, and `sentry.edge.config.ts`. The function itself
 * is safe to call multiple times — `Sentry.init` is documented as re-init-safe.
 *
 * Demo mode → `enabled: false`. Missing DSN → `enabled: false`, `dsn: undefined`.
 * Both shapes make the SDK a no-op without throwing or crashing the host app.
 */
export function initSentry(): void {
  if (isDemoMode()) {
    Sentry.init({ enabled: false });
    return;
  }
  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: !!SENTRY_DSN,
    tracesSampleRate: 0, // tracing deferred to slice 12+
    beforeSend,
    beforeBreadcrumb,
  });
}
```

- [ ] **Step 4: Run — expect all init + scrubber tests pass.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/sentry-init.test.ts --reporter=verbose 2>&1 | tail -25
```

Expected: 9 passed (4 init + 4 beforeSend + 1 beforeBreadcrumb).

- [ ] **Step 5: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/observability/sentry.ts test/lib/observability/sentry-init.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): initSentry + beforeSend + beforeBreadcrumb + withOrgScope

initSentry is idempotent and demo-mode-disabled. beforeSend is the single
source of truth for the "no orgId in breadcrumbs/extras/contexts" tenancy
invariant; event.tags is intentionally left untouched so the server-side
withOrgScope helper can surface the tag for operator triage.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Create `sentry.{server,client,edge}.config.ts` + `src/instrumentation.ts`

**Files:**
- Create: `sentry.server.config.ts` (repo root)
- Create: `sentry.client.config.ts` (repo root)
- Create: `sentry.edge.config.ts` (repo root)
- Create: `src/instrumentation.ts`

> **CRITICAL — Three config files are required by `@sentry/nextjs` v8+:** the SDK introspects the *file existence* of these three files at the repo root during the Webpack plugin's source-map upload step. Even if all three delegate to the same `initSentry()`, all three must exist or the build emits a warning at minimum (and on some runtime paths the SDK silently no-ops). This is the documented v8 convention; don't try to collapse them into one file.

- [ ] **Step 1: Create `sentry.server.config.ts` at repo root.**

```ts
// This file configures the initialization of Sentry on the server side.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
//
// All three sentry.*.config.ts files in this repo delegate to the single
// initSentry() helper so the demo-mode guard and scrubbers are defined once.
import { initSentry } from "@/lib/observability/sentry";
initSentry();
```

- [ ] **Step 2: Create `sentry.client.config.ts` at repo root.**

```ts
// This file configures the initialization of Sentry on the browser side.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import { initSentry } from "@/lib/observability/sentry";
initSentry();
```

- [ ] **Step 3: Create `sentry.edge.config.ts` at repo root.**

```ts
// This file configures Sentry for the Next.js Edge runtime
// (middleware, route handlers on `runtime: "edge"`).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import { initSentry } from "@/lib/observability/sentry";
initSentry();
```

- [ ] **Step 4: Create `src/instrumentation.ts`.**

Next 15's `instrumentation.ts` runs once per server cold start. We dynamic-import the right config per runtime (Node vs Edge). The client config is auto-loaded by the SDK's Webpack plugin when it sees `sentry.client.config.ts` exists at the root.

```ts
// src/instrumentation.ts
// Next 15 server-runtime convention — runs once per cold start.
// See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Re-export Sentry's onRequestError so RSC + middleware errors are captured
// automatically (v8.28+ supports this Next 15 hook).
export const onRequestError = Sentry.captureRequestError;
```

- [ ] **Step 5: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors. (If `onRequestError`/`captureRequestError` is flagged unknown, the installed Sentry version is older than 8.28 — pin a newer 8.x: `npm install @sentry/nextjs@^8.28`.)

- [ ] **Step 6: Commit.**

```bash
git add sentry.server.config.ts sentry.client.config.ts sentry.edge.config.ts src/instrumentation.ts
git commit -m "$(cat <<'EOF'
feat(observability): wire sentry server/client/edge configs + instrumentation.ts

All three sentry.*.config.ts files delegate to initSentry() so the
demo-mode guard and scrubbers live in one place. instrumentation.ts
dynamic-imports the right runtime config and re-exports
Sentry.captureRequestError so RSC/middleware errors are captured
automatically.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Add `parseSentryIngestHost` (DSN → CSP host) helper + test

**Files:**
- Create: `src/lib/observability/csp.ts`
- Create: `test/lib/observability/csp.test.ts`

> **CRITICAL — CSP widening from DSN must be NARROW, not wildcard:** wrong: `https://*.ingest.sentry.io` (every Sentry project is reachable from your CSP — gives an attacker who poisons your DSN env var ample exfiltration surface). Right: parse the DSN's host (`o123.ingest.sentry.io`) and add ONLY that exact host. If `SENTRY_DSN` is unset (demo build, local dev without observability), the CSP is NOT widened — the demo build's `connect-src` stays exactly as today. The unit test below covers both branches.

- [ ] **Step 1: Write the failing test.**

Create `test/lib/observability/csp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSentryIngestHost } from "@/lib/observability/csp";

describe("parseSentryIngestHost", () => {
  it("returns the exact ingest host from a real-shaped DSN", () => {
    expect(
      parseSentryIngestHost("https://abc123@o111222.ingest.sentry.io/4506789"),
    ).toBe("https://o111222.ingest.sentry.io");
  });

  it("returns the exact host for a region-specific ingest (us, de, etc.)", () => {
    expect(
      parseSentryIngestHost("https://abc@o42.ingest.us.sentry.io/9999"),
    ).toBe("https://o42.ingest.us.sentry.io");
  });

  it("returns null when DSN is undefined (demo / unconfigured builds)", () => {
    expect(parseSentryIngestHost(undefined)).toBeNull();
  });

  it("returns null when DSN is empty string", () => {
    expect(parseSentryIngestHost("")).toBeNull();
  });

  it("returns null when DSN is malformed", () => {
    expect(parseSentryIngestHost("not-a-url")).toBeNull();
    expect(parseSentryIngestHost("http://")).toBeNull();
  });

  it("strips the project path and the auth segment — only origin remains", () => {
    expect(
      parseSentryIngestHost("https://pubkey@o1.ingest.sentry.io/12345"),
    ).not.toContain("/12345");
    expect(
      parseSentryIngestHost("https://pubkey@o1.ingest.sentry.io/12345"),
    ).not.toContain("pubkey");
  });

  it("rejects non-https DSNs (defense in depth — Sentry DSNs are always https in production)", () => {
    expect(
      parseSentryIngestHost("http://abc@o1.ingest.sentry.io/12345"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect a missing-module error.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/csp.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: failure citing `Cannot find module '@/lib/observability/csp'`.

- [ ] **Step 3: Implement `src/lib/observability/csp.ts`.**

```ts
/**
 * Derive the exact Sentry ingest origin from a DSN, for CSP `connect-src`
 * widening at build time.
 *
 * Returns the bare origin (e.g. `https://o111222.ingest.sentry.io`) — NEVER a
 * wildcard, NEVER includes the public key, NEVER includes the project path.
 * Returns null when:
 *   - DSN is undefined or empty (demo build, local dev without observability)
 *   - DSN is malformed (URL constructor throws)
 *   - DSN is not https (defense in depth — production DSNs are always https)
 *
 * Caller (`next.config.mjs`) appends the return value to its CONNECT_HOSTS
 * array IFF it is non-null. This keeps the demo build's CSP byte-identical
 * to today.
 */
export function parseSentryIngestHost(dsn: string | undefined): string | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return `${url.protocol}//${url.hostname}`;
}
```

- [ ] **Step 4: Run — expect 7 passed.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/csp.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: `7 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/observability/csp.ts test/lib/observability/csp.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): parseSentryIngestHost — DSN to CSP origin helper

Build-time-only helper used by next.config.mjs to widen connect-src
with the EXACT Sentry ingest host (never a wildcard). Returns null on
unset/malformed/non-https DSNs so demo builds skip the widening.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: Wrap `next.config.mjs` with `withSentryConfig` + conditional CSP widening

**Files:**
- Modify: `next.config.mjs`

> **CRITICAL — Three load-bearing properties of this edit:**
>
> 1. **The CSP widening is opt-in by `SENTRY_DSN`.** When `SENTRY_DSN` is unset (demo build, local dev), `parseSentryIngestHost` returns null and `CONNECT_HOSTS` is unchanged byte-for-byte. The demo deploy must not gain a Sentry host in its CSP just because the SDK is in the bundle as a no-op.
>
> 2. **Source map upload is skipped silently when `SENTRY_AUTH_TOKEN` is absent.** The `withSentryConfig` options below set `disableServerWebpackPlugin` / `disableClientWebpackPlugin` to `!process.env.SENTRY_AUTH_TOKEN` — when the token is missing the plugin is disabled at the config level (no warning spam). Sentry's docs also support a `silent: true` flag which we set unconditionally for the same reason.
>
> 3. **`next.config.mjs` is ESM**, so `withSentryConfig` is `import`-ed at the top. The existing file is already `.mjs`; do NOT switch to `.ts`.

- [ ] **Step 1: Edit `next.config.mjs`.**

Open the file. The new shape:

```js
/** @type {import('next').NextConfig} */

import { withSentryConfig } from "@sentry/nextjs";
import { parseSentryIngestHost } from "./src/lib/observability/csp.ts";

// External hosts the app contacts at runtime. Derived from
// src/lib/market/providers/*.ts — every fetch() to a non-self URL must be
// listed here, otherwise CSP will block live data in production.
//
//   coingecko.ts   -> api.coingecko.com
//   finnhub.ts     -> finnhub.io
//   frankfurter.ts -> api.frankfurter.app
//   metals.ts      -> api.gold-api.com
//   twelvedata.ts  -> api.twelvedata.com
const CONNECT_HOSTS = [
  "https://api.coingecko.com",
  "https://api.frankfurter.app",
  "https://api.gold-api.com",
  "https://api.twelvedata.com",
  "https://finnhub.io",
];

// Slice 11: widen connect-src with the exact Sentry ingest host derived
// from SENTRY_DSN. When SENTRY_DSN is unset (demo build, local dev), the
// helper returns null and CONNECT_HOSTS is unchanged byte-for-byte.
const SENTRY_INGEST_HOST = parseSentryIngestHost(process.env.SENTRY_DSN);
const EFFECTIVE_CONNECT_HOSTS = SENTRY_INGEST_HOST
  ? [...CONNECT_HOSTS, SENTRY_INGEST_HOST]
  : CONNECT_HOSTS;

// Single-line CSP. Each directive ends in ';'. Keep it readable.
//
// Notes:
// - 'unsafe-inline' on script-src is required by Next.js App Router today: the
//   framework injects an inline runtime/bootstrap script (and inline JSON for
//   RSC payloads) on every page. A nonce-based CSP is the proper follow-up
//   (Next supports it via middleware), but our existing JWT middleware
//   collides with that path — tracked as follow-up.
// - 'unsafe-inline' on style-src covers Next's <style jsx> + Tailwind's
//   injected styles in dev. Production CSS is in /_next/static, which 'self'
//   already covers, but inline <style> tags still appear from RSC streaming.
// - connect-src 'self' allows same-origin /api/* (the app's own routes); the
//   listed hosts are direct browser-side fetches (only api.gold-api.com is
//   currently called from the client; the others run server-side, but
//   listing them is harmless and future-proof if any move to client).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${EFFECTIVE_CONNECT_HOSTS.join(" ")}`,
  "img-src 'self' data:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Headers applied to every response. Exported so the test can introspect them
// without booting Next.
export const securityHeaders = [
  {
    // HSTS without `preload` — this is a Netlify demo deploy on a domain in
    // flux, so we don't want to lock browsers into HTTPS-only via the preload
    // list. 2 years is the standard long-lived value.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Both X-Frame-Options: DENY and CSP frame-ancestors 'none' are set — they
  // agree, and X-Frame-Options is kept for older browsers that ignore CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig = {
  reactStrictMode: true,
  // pglite ships a WASM module + uses Node fs to load it. If Next bundles it for
  // the server runtime, its asset paths get rewritten to URLs and the WASM/file
  // load throws ("path must be a string ... received URL"), so the dev DB never
  // migrates. Keeping it external lets it load from node_modules normally.
  // (Tests use vitest, not the bundler, so they were unaffected.)
  serverExternalPackages: ["@electric-sql/pglite"],
  // Drizzle's migrator reads ./drizzle/* at runtime (not via static import), so
  // Next's file-tracer doesn't auto-bundle it. Without this, the deployed
  // function instance can't migrate the local pglite DB and any page that
  // touches the DB throws (e.g. the dashboard / page on Netlify).
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
  async headers() {
    return [
      {
        // Apply to every route, including /_next/* assets and /api/*.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// Slice 11: wrap with Sentry's config helper for source-map upload at build
// time. Upload is skipped silently when SENTRY_AUTH_TOKEN is absent (demo
// build, local builds, CI without the secret). The webpack plugins are also
// explicitly disabled in that case so the build never warns about a missing
// auth token.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
});
```

> **Note on the `.ts` import in `.mjs`:** Next.js's config loader supports `.ts` imports out of the box in v15. If the build fails with a "Cannot use import statement outside a module" or similar TypeScript-not-resolved error, fall back to inlining the 8-line `parseSentryIngestHost` body directly in `next.config.mjs` (the function is small and pure). Document the fallback in the commit message.

- [ ] **Step 2: Verify the file loads — clean and dirty branches.**

Demo build branch (no DSN — CSP should NOT contain a Sentry host):

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
node -e '
  process.env.NEXT_PUBLIC_DEMO_MODE = "true";
  delete process.env.SENTRY_DSN;
  import("./next.config.mjs").then((m) => {
    const csp = m.securityHeaders.find((h) => h.key === "Content-Security-Policy").value;
    console.log(csp.includes("ingest.sentry.io") ? "FAIL: CSP contains Sentry host without DSN" : "OK: demo CSP unchanged");
  });
'
```

Expected: `OK: demo CSP unchanged`.

DSN-set branch (CSP SHOULD contain the exact ingest host):

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
SENTRY_DSN="https://pub@o12345.ingest.sentry.io/67890" node -e '
  import("./next.config.mjs").then((m) => {
    const csp = m.securityHeaders.find((h) => h.key === "Content-Security-Policy").value;
    console.log(csp.includes("https://o12345.ingest.sentry.io") ? "OK: CSP widened narrowly" : "FAIL: CSP missing ingest host");
    console.log(csp.includes("*.ingest.sentry.io") ? "FAIL: CSP uses wildcard" : "OK: no wildcard");
  });
'
```

Expected: `OK: CSP widened narrowly` and `OK: no wildcard`.

- [ ] **Step 3: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 4: Commit.**

```bash
git add next.config.mjs
git commit -m "$(cat <<'EOF'
feat(observability): wrap next.config.mjs with withSentryConfig + DSN-narrow CSP

CSP connect-src is widened with the EXACT Sentry ingest host parsed
from SENTRY_DSN — never a wildcard. When SENTRY_DSN is unset (demo,
local dev), CONNECT_HOSTS is unchanged byte-for-byte so the demo build
CSP is identical to today's. Source-map upload (and the webpack
plugins themselves) are disabled when SENTRY_AUTH_TOKEN is absent so
the build never warns about a missing secret.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A7: Wire `Sentry.captureException` into action wrappers

**Files:**
- Modify: `src/lib/inventory/actions.ts`
- Modify: `src/lib/diamonds/actions.ts`
- Modify: `src/lib/deals/actions.ts`
- Modify: `src/lib/website/actions.ts`
- Modify: `src/lib/company/actions.ts`
- Create: `test/lib/observability/sentry-action-wrapper.test.ts`

> **CRITICAL — `ForbiddenError` is NEVER captured.** It is the expected outcome of a cross-tenant or cross-circle violation (slice 4 + slice 10). Capturing it would (a) flood Sentry with noise on every attempted access, (b) leak attempted-access patterns to a third-party telemetry vendor, and (c) destroy the signal-to-noise ratio for real bugs. The capture site MUST come AFTER the `ForbiddenError instanceof` check, never before.

- [ ] **Step 1: Write the failing test.**

Create `test/lib/observability/sentry-action-wrapper.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((fn: (scope: { setTag: (k: string, v: unknown) => void }) => unknown) =>
    fn({ setTag: vi.fn() }),
  ),
  setTag: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import {
  postDeal, postDealMessage, __setTestDb,
} from "@/lib/deals/actions";
import { __setTestDb as setInventoryDb, createInventoryItem } from "@/lib/inventory/actions";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
  await setInventoryDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await setInventoryDb(null);
  await closeSharedDb();
});

describe("action wrapper Sentry capture", () => {
  it("calls Sentry.captureException with layer=deals-action on a non-Forbidden throw", async () => {
    // Force a database error by trying to insert a deal with a kind enum value
    // that the schema rejects (this hits the action's catch path).
    const Sentry = await import("@sentry/nextjs");
    const res = await postDeal({
      kind: "NOT_A_VALID_KIND", // will Zod-fail first, but we want a *thrown* DB error
      category: "Diamond",
      subject: "x",
      quantity: 1,
      priceCents: 1000,
      currency: "USD",
    });
    // Zod failure path returns ok:false but does NOT capture (validation
    // failures are user input errors, not bugs).
    if (!res.ok && res.error.toLowerCase().includes("kind")) {
      expect(Sentry.captureException).not.toHaveBeenCalled();
      return; // Zod caught it before the DB; the throw-path is exercised below
    }
    // Otherwise the DB threw — verify capture shape.
    expect(Sentry.captureException).toHaveBeenCalled();
    const callArgs = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].tags.layer).toBe("deals-action");
  });

  it("does NOT call captureException when a ForbiddenError is thrown", async () => {
    const Sentry = await import("@sentry/nextjs");
    // Seed an owner=999 deal with no circle. session.orgId=1 tries to post.
    const [d] = await db.insert(deals).values({
      orgId: 999, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x", threadMode: "private",
    }).returning({ id: deals.id });
    const res = await postDealMessage({ dealId: d.id, body: "no" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("demo mode short-circuits before the try block — no Sentry call", async () => {
    const Sentry = await import("@sentry/nextjs");
    const original = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const res = await createInventoryItem({
        category: "Diamond", name: "x", quantity: 1,
        status: "InStock", unitCostCents: 100, retailPriceCents: 200,
      });
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
      expect(Sentry.captureException).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = original;
    }
  });
});
```

- [ ] **Step 2: Run — expect failures (no Sentry import yet).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/sentry-action-wrapper.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: at least one failing assertion citing `expected captureException to have been called` (depending on which path Zod vs DB error takes).

- [ ] **Step 3: Edit `src/lib/inventory/actions.ts` — add Sentry to the `run()` catch.**

In the existing `run<T>` wrapper, locate the catch block at line ~48. Change it from:

```ts
  } catch (e) {
    console.error("[inventory action] database error:", e);
    return { ok: false, error: "Database error" };
  }
```

to:

```ts
  } catch (e) {
    console.error("[inventory action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "inventory-action" } });
    return { ok: false, error: "Database error" };
  }
```

Add the import at the top of the file, immediately after the existing imports:

```ts
import * as Sentry from "@sentry/nextjs";
```

- [ ] **Step 4: Edit `src/lib/diamonds/actions.ts`.**

Two catch sites: the `importMatrix` action (around line 80) and the shared `run()` wrapper (around line 106). Both get the same two-line additions:

```ts
  } catch (e) {
    console.error("[diamond import] database error:", e); // existing
    Sentry.captureException(e, { tags: { layer: "diamonds-action" } }); // new
    return { ok: false, error: "Database error" };
  }
```

and:

```ts
  } catch (e) {
    console.error("[diamond action] database error:", e); // existing
    Sentry.captureException(e, { tags: { layer: "diamonds-action" } }); // new
    return { ok: false, error: "Database error" };
  }
```

Add `import * as Sentry from "@sentry/nextjs";` at the top.

- [ ] **Step 5: Edit `src/lib/deals/actions.ts`.**

Two wrappers (`run` and `runWithUser`). The `runWithUser` catch already filters `ForbiddenError` BEFORE the generic error path — Sentry goes inside the generic branch, AFTER the Forbidden check. Final shape:

`run()` catch (line ~60):

```ts
  } catch (e) {
    console.error("[deals action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "deals-action" } });
    return { ok: false, error: "Database error" };
  }
```

`runWithUser()` catch (line ~89):

```ts
  } catch (e) {
    if (e instanceof ForbiddenError) {
      // Audit-friendly log of the rejection; the warn already happened
      // inside the callback for full context (org + user + circle).
      return { ok: false, error: "Forbidden" };
    }
    console.error("[deals action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "deals-action" } });
    return { ok: false, error: "Database error" };
  }
```

Add `import * as Sentry from "@sentry/nextjs";` at the top.

- [ ] **Step 6: Edit `src/lib/website/actions.ts`.**

`run()` catch (line ~54):

```ts
  } catch (e) {
    console.error("[website action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "website-action" } });
    return { ok: false, error: "Database error" };
  }
```

Add `import * as Sentry from "@sentry/nextjs";` at the top.

- [ ] **Step 7: Edit `src/lib/company/actions.ts`.**

`run()` catch — locate the existing catch block and add the same Sentry line with `layer: "company-action"`. Add the import at the top.

- [ ] **Step 8: Run the action-wrapper test — expect green.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/sentry-action-wrapper.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: `3 passed`.

- [ ] **Step 9: Run the existing action tests to confirm no regressions.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/deals test/lib/inventory 2>&1 | tail -15
```

Expected: every previously-green test still green. `@sentry/nextjs` is mocked at the top of the new test file but NOT auto-mocked in the existing tests — they call the real (no-op-in-non-prod) SDK, which is fine because `enabled: false` short-circuits transmission. If any existing test breaks here, it's because `Sentry.init` isn't being called in that test's environment; the fix is `vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), init: vi.fn() }))` in the offending file's setup.

- [ ] **Step 10: Commit.**

```bash
git add src/lib/inventory/actions.ts src/lib/diamonds/actions.ts src/lib/deals/actions.ts src/lib/website/actions.ts src/lib/company/actions.ts test/lib/observability/sentry-action-wrapper.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): wire Sentry.captureException into all 5 action wrappers

inventory/diamonds/deals/website/company action wrappers add one
captureException line in each catch block, gated on the layer tag for
filterability in the Sentry UI. ForbiddenError is intentionally
filtered BEFORE the capture call so cross-tenant/cross-circle violations
do not flood Sentry with attempted-access patterns.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A8: Wire Sentry into `src/middleware.ts`

**Files:**
- Modify: `src/middleware.ts`

> **NB:** the middleware runs in the Edge runtime. `@sentry/nextjs` v8+ supports edge captures via `sentry.edge.config.ts` (loaded by `src/instrumentation.ts` in Task A4). Importing `* as Sentry from "@sentry/nextjs"` inside `middleware.ts` is correct — the SDK detects the edge environment and dispatches via the edge transport.

- [ ] **Step 1: Edit `src/middleware.ts`.**

Final shape:

```ts
import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifySession } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/mode";

export async function middleware(req: NextRequest) {
  try {
    if (isDemoMode()) return NextResponse.next();
    const token = req.cookies.get("ccc_session")?.value;
    const session = token ? await verifySession(token, process.env.SESSION_SECRET!) : null;
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  } catch (e) {
    // The `process.env.SESSION_SECRET!` non-null assertion above is exactly
    // the kind of thing that should be captured if it ever fires — silently
    // 500-ing with no telemetry is what this slice exists to fix.
    Sentry.captureException(e, { tags: { layer: "middleware" } });
    throw e; // let Next.js's default error handling continue
  }
}

export const config = {
  matcher: [
    "/", "/api/quotes", "/api/convert", "/api/history", "/api/diamond-history",
    "/inventory", "/diamonds", "/deals", "/website", "/company/:path*",
  ],
};
```

- [ ] **Step 2: Run the existing middleware tests.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/auth 2>&1 | tail -15
```

Expected: every test still green (the new wrapper is purely additive; the happy paths return the same NextResponse as before).

- [ ] **Step 3: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 4: Commit.**

```bash
git add src/middleware.ts
git commit -m "$(cat <<'EOF'
feat(observability): capture middleware exceptions to Sentry

The SESSION_SECRET non-null assertion is exactly the silently-500 surface
this slice exists to fix. The captured error re-throws so Next.js's
default error handling continues — Sentry adds telemetry, it does not
swallow the error.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A9: Extend `useQuotesPoll` with threshold-5 capture

**Files:**
- Modify: `src/hooks/useQuotesPoll.ts`
- Create: `test/lib/observability/quote-poll-capture.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `test/lib/observability/quote-poll-capture.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@/store/quotes", () => ({
  useQuotes: (selector: (s: { ingest: () => void }) => unknown) =>
    selector({ ingest: () => {} }),
}));
vi.mock("@/hooks/useSetting", () => ({
  useSetting: () => 15,
}));

import { useQuotesPoll } from "@/hooks/useQuotesPoll";

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

async function advanceTicks(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve(); // flush microtasks for the await fetch chain
    });
  }
}

describe("useQuotesPoll — threshold-5 Sentry capture", () => {
  it("does not capture on 4 consecutive failures", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    const Sentry = await import("@sentry/nextjs");
    renderHook(() => useQuotesPoll());
    // First tick fires immediately on mount. Then 3 more via the interval.
    await act(async () => { await Promise.resolve(); });
    await advanceTicks(3); // 1 immediate + 3 timer ticks = 4 failures total
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("captures exactly once on the 5th consecutive failure", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    const Sentry = await import("@sentry/nextjs");
    renderHook(() => useQuotesPoll());
    await act(async () => { await Promise.resolve(); });
    await advanceTicks(4); // 5 failures total
    await waitFor(() => {
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    });
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toMatch(/5 consecutive/);
    expect(call[1].tags.layer).toBe("client-poll");
  });

  it("captures captureException when the fetch itself throws", async () => {
    global.fetch = vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    const Sentry = await import("@sentry/nextjs");
    renderHook(() => useQuotesPoll());
    await act(async () => { await Promise.resolve(); });
    await advanceTicks(4);
    await waitFor(() => {
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.layer).toBe("client-poll");
  });

  it("a single success between failures resets the counter (no capture at the 5th overall fail)", async () => {
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount += 1;
      // Fail, fail, fail, fail, SUCCEED, fail, fail = 7 total, but counter reset at 5
      if (callCount === 5) return { ok: true, status: 200, json: async () => ({ quotes: [] }) } as unknown as Response;
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const Sentry = await import("@sentry/nextjs");
    renderHook(() => useQuotesPoll());
    await act(async () => { await Promise.resolve(); });
    await advanceTicks(6); // 7 ticks total — only 2 consecutive failures at the end
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failures.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/quote-poll-capture.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: assertion failures (`captureMessage` never called — current hook has no counter).

- [ ] **Step 3: Edit `src/hooks/useQuotesPoll.ts`.**

Final shape:

```ts
"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { useQuotes } from "@/store/quotes";
import { useSetting } from "@/hooks/useSetting";

/**
 * Threshold for capturing sustained poll failure to Sentry.
 * At the default 15s refresh, 5 ticks = 75s of sustained failure — long
 * enough to filter out transient network blips, short enough to surface
 * a genuine outage within ~1 minute.
 *
 * Exactly one capture per failure run: the counter increments on each
 * non-ok response or thrown fetch error, fires exactly once when it
 * equals THRESHOLD, and resets to zero on the next successful response.
 */
const FAILURE_THRESHOLD = 5;

export function useQuotesPoll() {
  const refreshSeconds = useSetting("refreshSeconds");
  const ingest = useQuotes((s) => s.ingest);

  useEffect(() => {
    let cancelled = false;
    let consecutiveFailures = 0;
    async function tick() {
      try {
        const res = await fetch("/api/quotes", { cache: "no-store" });
        if (!res.ok) {
          consecutiveFailures += 1;
          if (consecutiveFailures === FAILURE_THRESHOLD) {
            Sentry.captureMessage(
              `useQuotesPoll: ${FAILURE_THRESHOLD} consecutive fetch failures (status ${res.status})`,
              { level: "warning", tags: { layer: "client-poll" } },
            );
          }
          return;
        }
        consecutiveFailures = 0;
        const { quotes } = await res.json();
        if (!cancelled) ingest(quotes);
      } catch (e) {
        consecutiveFailures += 1;
        if (consecutiveFailures === FAILURE_THRESHOLD) {
          Sentry.captureException(e, {
            tags: { layer: "client-poll" },
          });
        }
        // transient otherwise; next tick retries
      }
    }
    void tick();
    const id = setInterval(tick, refreshSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshSeconds, ingest]);
}
```

- [ ] **Step 4: Run — expect 4 passed.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/observability/quote-poll-capture.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: `4 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/hooks/useQuotesPoll.ts test/lib/observability/quote-poll-capture.test.ts
git commit -m "$(cat <<'EOF'
feat(observability): useQuotesPoll captures to Sentry on 5 consecutive failures

5 ticks at the 15s default = ~75s of sustained outage before a single
capture fires. The counter resets on the next successful response, so a
flapping network doesn't double-fire. Below the threshold we stay silent —
a transient blip is not an alertable event.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A10: Phase A green-bar verification

- [ ] **Step 1: Full test suite.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npm test -- --run 2>&1 | tail -15
```

Expected: every prior test still green + ~27 new tests across the 5 new observability test files. Note the new total for the final-phase comparison.

- [ ] **Step 2: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: PR-grep enforcement — orgId never in breadcrumbs/extras.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -rn "Sentry.addBreadcrumb\|Sentry.setExtra\|Sentry.setContext\|addBreadcrumb.*orgId\|setExtra.*orgId\|setContext.*orgId" src/ 2>&1
```

Expected: empty output. Any match is a violation — slice 11 NEVER calls these with orgId. If a match appears, fix the callsite to use `Sentry.setTag` or `withOrgScope` instead.

- [ ] **Step 4: PR-grep enforcement — sentry config has no orgId.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -rn "orgId" sentry.server.config.ts sentry.client.config.ts sentry.edge.config.ts 2>&1
```

Expected: empty output (the three config files are 2 lines each and contain no orgId reference).

- [ ] **Step 5: PR-grep enforcement — observability folder only has orgId in the scrubber.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -rn "orgId" src/lib/observability/ 2>&1
```

Expected: matches only inside `stripOrgId.ts` (the strip logic + docblock) and `sentry.ts` (the `withOrgScope` helper + docblock). No matches inside `csp.ts`.

Phase A done.

---

## Phase B — Provider Status panel

### Task B1: Health module + `getProviderStatus` aggregator

**Files:**
- Create: `src/lib/market/health.ts`
- Create: `test/lib/market/health.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `test/lib/market/health.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getProviderStatus,
  recordProviderResult,
  __resetHealth,
} from "@/lib/market/health";

const ORIG_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE;

beforeEach(() => {
  __resetHealth();
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
});
afterEach(() => {
  if (ORIG_DEMO === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
  else process.env.NEXT_PUBLIC_DEMO_MODE = ORIG_DEMO;
});

describe("getProviderStatus — demo short-circuit", () => {
  it("returns every provider as 'simulated' in demo mode", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const rows = getProviderStatus();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const r of rows) {
      expect(r.freshness).toBe("simulated");
      expect(r.lastOkAt).toBeNull();
      expect(r.lastErrorAt).toBeNull();
      expect(r.lastErrorMessage).toBeNull();
    }
  });
});

describe("getProviderStatus — live aggregation", () => {
  it("a fresh successful fetch ≤ 30s ago marks the provider 'live'", () => {
    recordProviderResult("finnhub", true, undefined, Date.now() - 5_000);
    const row = getProviderStatus().find((r) => r.id === "finnhub")!;
    expect(row.freshness).toBe("live");
    expect(row.lastErrorMessage).toBeNull();
  });

  it("a successful fetch between 30s and 5min ago marks the provider 'delayed'", () => {
    recordProviderResult("finnhub", true, undefined, Date.now() - 60_000);
    const row = getProviderStatus().find((r) => r.id === "finnhub")!;
    expect(row.freshness).toBe("delayed");
  });

  it("a successful fetch older than 5min marks the provider 'stale'", () => {
    recordProviderResult("finnhub", true, undefined, Date.now() - 10 * 60_000);
    const row = getProviderStatus().find((r) => r.id === "finnhub")!;
    expect(row.freshness).toBe("stale");
  });

  it("a fetch error captures lastErrorMessage but does not overwrite a prior lastOkAt", () => {
    const tOk = Date.now() - 10_000;
    recordProviderResult("finnhub", true, undefined, tOk);
    recordProviderResult("finnhub", false, new Error("ECONNRESET"));
    const row = getProviderStatus().find((r) => r.id === "finnhub")!;
    expect(row.lastErrorMessage).toBe("ECONNRESET");
    expect(row.lastOkAt).toBe(tOk);
    // The row is still 'live' because lastOkAt is recent — errors do NOT
    // override last-good-time.
    expect(row.freshness).toBe("live");
  });

  it("a provider that has NEVER been fetched is 'stale' (worst-case honesty)", () => {
    const row = getProviderStatus().find((r) => r.id === "twelvedata")!;
    expect(row.lastOkAt).toBeNull();
    expect(row.freshness).toBe("stale");
  });

  it("the row order matches PROVIDER_DISPLAY's declaration order", () => {
    const ids = getProviderStatus().map((r) => r.id);
    expect(ids).toEqual([
      "finnhub", "twelvedata", "coingecko", "frankfurter", "metals", "index-etf", "simulated",
    ]);
  });

  it("each row's display label is the human-friendly string", () => {
    const row = getProviderStatus().find((r) => r.id === "metals")!;
    expect(row.display).toMatch(/gold-api.com/);
  });
});
```

- [ ] **Step 2: Run — expect missing-module error.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/market/health.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: `Cannot find module '@/lib/market/health'`.

- [ ] **Step 3: Create `src/lib/market/health.ts`.**

```ts
import type { ProviderId, Freshness } from "./types";
import { computeFreshness } from "./freshness";
import { isDemoMode } from "@/lib/demo/mode";

export type ProviderHealth = {
  id: ProviderId;
  display: string;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  freshness: Freshness;
};

/**
 * Human-friendly labels for the Provider Status panel. The KEY ORDER is the
 * declared display order in the UI — keep it stable (the row-order test in
 * health.test.ts pins it).
 */
export const PROVIDER_DISPLAY: Record<ProviderId, string> = {
  "finnhub":     "Equities · Finnhub",
  "twelvedata":  "Indices/Commodities · Twelve Data",
  "coingecko":   "Crypto · CoinGecko",
  "frankfurter": "FX · Frankfurter (ECB)",
  "metals":      "Spot Metals · gold-api.com",
  "index-etf":   "Index ETF proxy",
  "simulated":   "Simulated (fallback)",
};

/**
 * In-memory per-process health map. Survives across requests in a single
 * Node.js server instance, NOT across cold starts. The Provider Status panel
 * is honest about this — "lastOkAt: null" renders as "never" in the UI.
 *
 * This is platform telemetry, NOT tenant data. There is intentionally NO
 * orgId column or per-org partitioning here — every tenant on this deploy
 * sees the same provider health (slice 11 §4.3).
 */
type HealthState = {
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
};
const health = new Map<ProviderId, HealthState>();

/**
 * Side-effect wired from `defaultQuoteFetcher` in `cache.ts` via the
 * `onProviderResult` callback added to `resolveQuotes` in `router.ts`.
 *
 * The optional `at` parameter is for tests — production callers omit it and
 * we stamp Date.now().
 */
export function recordProviderResult(
  id: ProviderId,
  ok: boolean,
  err?: unknown,
  at: number = Date.now(),
): void {
  const prev = health.get(id) ?? { lastOkAt: null, lastErrorAt: null, lastErrorMessage: null };
  if (ok) {
    health.set(id, { ...prev, lastOkAt: at });
  } else {
    const message = err instanceof Error ? err.message : err == null ? null : String(err);
    health.set(id, { ...prev, lastErrorAt: at, lastErrorMessage: message });
  }
}

/**
 * Returns one ProviderHealth row per known provider, in PROVIDER_DISPLAY's
 * declared order.
 *
 * Demo-mode: every row is `simulated` regardless of any prior recordProviderResult
 * calls. Consistent with the slice-1a "simulated dot" honesty contract — the
 * demo deploy has no live providers, the panel says so.
 *
 * "Never fetched" (`lastOkAt: null`) renders as `freshness: "stale"` — we
 * treat absence as worst-case rather than misleading the operator into
 * thinking it's healthy.
 */
export function getProviderStatus(): ProviderHealth[] {
  if (isDemoMode()) {
    return (Object.entries(PROVIDER_DISPLAY) as [ProviderId, string][]).map(
      ([id, display]) => ({
        id,
        display,
        lastOkAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        freshness: "simulated" as Freshness,
      }),
    );
  }
  return (Object.entries(PROVIDER_DISPLAY) as [ProviderId, string][]).map(
    ([id, display]) => {
      const h = health.get(id);
      const lastOkAt = h?.lastOkAt ?? null;
      const freshness: Freshness =
        lastOkAt === null
          ? "stale"
          : computeFreshness(id, lastOkAt);
      return {
        id,
        display,
        lastOkAt,
        lastErrorAt: h?.lastErrorAt ?? null,
        lastErrorMessage: h?.lastErrorMessage ?? null,
        freshness,
      };
    },
  );
}

/** Test-only — clears the in-memory health map. Used by `beforeEach`. */
export function __resetHealth(): void {
  health.clear();
}
```

- [ ] **Step 4: Run — expect 8 passed.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/market/health.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: `8 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/market/health.ts test/lib/market/health.test.ts
git commit -m "$(cat <<'EOF'
feat(market): getProviderStatus aggregator + in-memory health map

Platform telemetry — NOT tenanted. recordProviderResult is wired by
defaultQuoteFetcher in a follow-up task. Demo mode short-circuits every
row to simulated; "never fetched" renders as stale (worst-case honesty).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Wire `onProviderResult` callback through `router.ts` + `cache.ts`

**Files:**
- Modify: `src/lib/market/router.ts`
- Modify: `src/lib/market/cache.ts`

- [ ] **Step 1: Edit `src/lib/market/router.ts`.**

Change the `resolveQuotes` signature to accept the optional callback. Final shape:

```ts
import type { AssetClass, Quote, ProviderId, QuoteProvider, SymbolDef } from "./types";
import { computeFreshness } from "./freshness";
import { coingeckoProvider } from "./providers/coingecko";
import { frankfurterProvider } from "./providers/frankfurter";
import { finnhubProvider } from "./providers/finnhub";
import { twelvedataProvider } from "./providers/twelvedata";
import { metalsProvider } from "./providers/metals";
import { indexEtfProxyProvider } from "./providers/index-etf";
import { simulatedProvider } from "./providers/simulated";

export const CHAINS: Record<AssetClass, QuoteProvider[]> = {
  crypto: [coingeckoProvider, finnhubProvider, simulatedProvider],
  fx: [frankfurterProvider, finnhubProvider, simulatedProvider],
  equity: [finnhubProvider, twelvedataProvider, simulatedProvider],
  index: [indexEtfProxyProvider, twelvedataProvider, simulatedProvider],
  commodity: [twelvedataProvider, metalsProvider, simulatedProvider],
  bond: [twelvedataProvider, simulatedProvider],
};

export type OnProviderResult = (id: ProviderId, ok: boolean, err?: unknown) => void;

/**
 * Resolve quotes for `symbols` across the provider chain.
 *
 * Slice 11: when `onProviderResult` is supplied, the callback fires once per
 * provider per asset-class pass — `(id, true)` when the fetch yielded ≥1 raw
 * quote, `(id, false, err)` when the provider threw. Used by
 * `defaultQuoteFetcher` in cache.ts to update the health map.
 */
export async function resolveQuotes(
  symbols: SymbolDef[],
  chainOverride?: QuoteProvider[],
  onProviderResult?: OnProviderResult,
): Promise<Quote[]> {
  const result: Quote[] = [];
  const byClass = new Map<AssetClass, SymbolDef[]>();
  for (const s of symbols) {
    byClass.set(s.assetClass, [...(byClass.get(s.assetClass) ?? []), s]);
  }
  for (const [assetClass, syms] of byClass) {
    const base = chainOverride ?? CHAINS[assetClass];
    // simulatedProvider is always the guaranteed terminal fallback so a
    // panel is never blank (spec §5.5), even with a custom override chain.
    const chain = base.includes(simulatedProvider)
      ? base
      : [...base, simulatedProvider];
    const pending = new Map(syms.map((s) => [s.symbol, s]));
    for (const provider of chain) {
      if (pending.size === 0) break;
      if (!provider.supports(assetClass)) continue;
      let raws: Awaited<ReturnType<QuoteProvider["fetchQuotes"]>>;
      try {
        raws = await provider.fetchQuotes([...pending.values()]);
      } catch (err) {
        onProviderResult?.(provider.id, false, err);
        continue;
      }
      const beforeSize = pending.size;
      for (const [symbol, raw] of raws) {
        const def = pending.get(symbol);
        if (!def) continue;
        result.push({
          symbol: def.symbol,
          assetClass: def.assetClass,
          display: def.display,
          currency: def.currency,
          price: raw.price,
          changeAbs: raw.changeAbs,
          changePct: raw.changePct,
          asOf: raw.asOf,
          source: provider.id,
          freshness: computeFreshness(provider.id, raw.asOf),
        });
        pending.delete(symbol);
      }
      // "ok" = the provider returned at least one usable quote. A provider
      // that returned an empty map for everything pending is treated as
      // a soft failure for health-tracking purposes (it didn't throw, but
      // it also didn't help).
      if (pending.size < beforeSize) {
        onProviderResult?.(provider.id, true);
      } else if (raws.size === 0) {
        onProviderResult?.(provider.id, false, new Error("empty result"));
      }
    }
  }
  return result;
}
```

- [ ] **Step 2: Edit `src/lib/market/cache.ts`.**

Wire `defaultQuoteFetcher` to call `recordProviderResult`. Final shape:

```ts
import type { Quote, SymbolDef } from "./types";
import { ALL_SYMBOLS } from "./registry";
import { resolveQuotes } from "./router";
import { simulatedProvider } from "./providers/simulated";
import { recordProviderResult } from "./health";
import { isDemoMode } from "@/lib/demo/mode";
import { isBuildPhase } from "./buildPhase";

const SLOW_CLASSES = new Set<SymbolDef["assetClass"]>(["index", "commodity"]);
const FAST_SYMBOLS = ALL_SYMBOLS.filter((s) => !SLOW_CLASSES.has(s.assetClass));
const SLOW_SYMBOLS = ALL_SYMBOLS.filter((s) => SLOW_CLASSES.has(s.assetClass));

/**
 * Default poller fetcher. Resolves the given symbol subset through the real
 * provider chain — or, in demo mode or during `next build`, forces the
 * simulated provider so neither the demo nor the build ever makes an external
 * call. Building offline must always succeed deterministically; see
 * `buildPhase.ts` for the rationale.
 *
 * Slice 11: wires resolveQuotes's `onProviderResult` callback to update the
 * in-memory health map for the Provider Status panel.
 */
export function defaultQuoteFetcher(symbols: SymbolDef[]): Promise<Quote[]> {
  return isDemoMode() || isBuildPhase()
    ? resolveQuotes(symbols, [simulatedProvider], recordProviderResult)
    : resolveQuotes(symbols, undefined, recordProviderResult);
}

export class QuoteCache {
  private data = new Map<string, Quote>();
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private fetcher: (symbols: SymbolDef[]) => Promise<Quote[]> = defaultQuoteFetcher) {}

  snapshot(): Quote[] {
    return [...this.data.values()];
  }

  private apply(quotes: Quote[]): void {
    for (const q of quotes) this.data.set(q.symbol, q);
  }

  /** Refresh a specific symbol subset. Never wipes the snapshot on failure. */
  async refreshSymbols(symbols: SymbolDef[]): Promise<void> {
    try {
      this.apply(await this.fetcher(symbols));
    } catch {
      // keep last good snapshot — never wipe on failure
    }
  }

  /** Full refresh of every symbol. */
  async refresh(): Promise<void> {
    await this.refreshSymbols(ALL_SYMBOLS);
  }

  /**
   * One immediate full refresh, then split timers: fast sources every `fastMs`,
   * metered Twelve Data classes every `slowMs` (keeps the free-tier credit budget).
   */
  start(fastMs = 15_000, slowMs = 90_000): void {
    if (this.timers.length) return;
    void this.refresh();
    this.timers.push(setInterval(() => void this.refreshSymbols(FAST_SYMBOLS), fastMs));
    this.timers.push(setInterval(() => void this.refreshSymbols(SLOW_SYMBOLS), slowMs));
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __quoteCache: QuoteCache | undefined;
}

export function getQuoteCache(): QuoteCache {
  if (!globalThis.__quoteCache) {
    globalThis.__quoteCache = new QuoteCache();
    globalThis.__quoteCache.start();
  }
  return globalThis.__quoteCache;
}
```

- [ ] **Step 3: Run the existing market tests to confirm no regressions.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/lib/market 2>&1 | tail -20
```

Expected: every previously-green market test still green. The `resolveQuotes` signature change is purely additive (optional third arg), so existing call sites typecheck without edits.

- [ ] **Step 4: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/market/router.ts src/lib/market/cache.ts
git commit -m "$(cat <<'EOF'
feat(market): wire onProviderResult callback through router + cache

resolveQuotes gains an optional third arg; defaultQuoteFetcher passes
recordProviderResult so the in-memory health map updates on every fetch.
Empty-result responses are treated as soft failures so a provider that
never returns usable data still surfaces as 'stale' in the panel rather
than silently appearing healthy.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: `ProviderStatusPanel` component + test

**Files:**
- Create: `src/components/dashboard/ProviderStatusPanel.tsx`
- Create: `test/components/dashboard/ProviderStatusPanel.test.tsx`

- [ ] **Step 1: Write the failing test.**

Create `test/components/dashboard/ProviderStatusPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProviderStatusPanel } from "@/components/dashboard/ProviderStatusPanel";
import type { ProviderHealth } from "@/lib/market/health";

function row(over: Partial<ProviderHealth>): ProviderHealth {
  return {
    id: "finnhub",
    display: "Equities · Finnhub",
    lastOkAt: Date.now() - 5_000,
    lastErrorAt: null,
    lastErrorMessage: null,
    freshness: "live",
    ...over,
  };
}

describe("ProviderStatusPanel", () => {
  it("renders one row per provider", () => {
    render(
      <ProviderStatusPanel
        rows={[
          row({ id: "finnhub", display: "A" }),
          row({ id: "coingecko", display: "B" }),
        ]}
        demo={false}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
  });

  it("renders a live dot for a live row", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "live" })]}
        demo={false}
      />,
    );
    const dot = screen.getByTestId("freshness-dot");
    expect(dot).toHaveAttribute("data-freshness", "live");
  });

  it("renders the simulated dot for every row in demo mode", () => {
    render(
      <ProviderStatusPanel
        rows={[
          row({ id: "finnhub", freshness: "simulated", lastOkAt: null }),
          row({ id: "coingecko", freshness: "simulated", lastOkAt: null }),
        ]}
        demo={true}
      />,
    );
    const dots = screen.getAllByTestId("freshness-dot");
    expect(dots).toHaveLength(2);
    for (const d of dots) expect(d).toHaveAttribute("data-freshness", "simulated");
  });

  it("surfaces lastErrorMessage in the row's title attribute when set", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "stale", lastErrorMessage: "ECONNRESET" })]}
        demo={false}
      />,
    );
    const li = screen.getByRole("listitem");
    expect(li).toHaveAttribute("title", "ECONNRESET");
  });

  it("renders 'never' for a row with lastOkAt: null", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "stale", lastOkAt: null })]}
        demo={false}
      />,
    );
    expect(screen.getByText(/never/i)).toBeInTheDocument();
  });

  it("renders the demo-mode footnote when demo=true", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "simulated", lastOkAt: null })]}
        demo={true}
      />,
    );
    expect(screen.getByText(/no live providers/i)).toBeInTheDocument();
  });

  it("does NOT render the footnote when demo=false", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "live" })]}
        demo={false}
      />,
    );
    expect(screen.queryByText(/no live providers/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect missing-module error.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/components/dashboard/ProviderStatusPanel.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: missing-module error.

- [ ] **Step 3: Create `src/components/dashboard/ProviderStatusPanel.tsx`.**

```tsx
import { FreshnessDot } from "@/components/FreshnessDot";
import type { ProviderHealth } from "@/lib/market/health";

export type ProviderStatusPanelProps = {
  rows: ProviderHealth[];
  /** True when the host environment is in demo mode — renders the row footnote.
   *  Threaded as a prop (not read from isDemoMode() inside) so the component is
   *  trivially testable without env mocking. The page-level wiring reads
   *  isDemoMode() once and passes it through. */
  demo: boolean;
};

/** Minimal human-readable elapsed-time string. The Provider Status panel only
 *  ever shows "X seconds/minutes/hours ago" or "never" — so we inline a tiny
 *  helper rather than depending on the slice-2 timeAgo (which lives next to
 *  the deal-room-specific formatting). */
function relativeTimeAgo(epochMs: number): string {
  const ageSec = Math.floor((Date.now() - epochMs) / 1000);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

export function ProviderStatusPanel({ rows, demo }: ProviderStatusPanelProps) {
  return (
    <div data-testid="panel-provider-status" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-text/80">Provider Status</h3>
      <ul className="flex flex-col gap-1">
        {rows.map((p) => (
          <li
            key={p.id}
            title={p.lastErrorMessage ?? undefined}
            className="flex items-center gap-2 text-xs"
          >
            <FreshnessDot freshness={p.freshness} />
            <span className="flex-1 truncate">{p.display}</span>
            <span className="font-mono text-[10px] text-text/60">
              {p.lastOkAt ? relativeTimeAgo(p.lastOkAt) : "never"}
            </span>
          </li>
        ))}
      </ul>
      {demo && (
        <p className="text-[10px] text-text/50 italic">
          Demo mode — no live providers in use.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect 7 passed.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx vitest run test/components/dashboard/ProviderStatusPanel.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: `7 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/dashboard/ProviderStatusPanel.tsx test/components/dashboard/ProviderStatusPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): ProviderStatusPanel — per-provider freshness display

Reuses the slice-1a FreshnessDot for visual consistency. Title attribute
surfaces lastErrorMessage when present; "never" renders when a provider
has not yet returned a successful fetch. Demo-mode flag is a prop, not
an env read, so the component is unit-testable without env mocking.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Register `provider-status` in `PANEL_REGISTRY` + thread through `PanelCtx`

**Files:**
- Modify: `src/lib/layout/types.ts`
- Modify: `src/lib/layout/registry.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Extend `PanelCtx` in `src/lib/layout/types.ts`.**

Open the file, locate the `PanelCtx` interface (around line 69). Add a new view type above it, then a field on the interface:

```ts
// Add near the other view types:
export interface ProviderStatusView {
  rows: import("@/lib/market/health").ProviderHealth[];
  demo: boolean;
}

// Then on PanelCtx:
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
  providerStatus?: ProviderStatusView; // slice 11
}
```

- [ ] **Step 2: Register the panel in `src/lib/layout/registry.tsx`.**

Add the import at the top:

```ts
import { ProviderStatusPanel } from "@/components/dashboard/ProviderStatusPanel";
```

Append the entry to `PANEL_REGISTRY` — place it next to other 1-size system panels (after `website-overview` is fine):

```ts
  {
    id: "provider-status",
    title: "Provider Status",
    defaultSize: 1,
    render: (ctx) =>
      ctx.providerStatus ? (
        <ProviderStatusPanel
          rows={ctx.providerStatus.rows}
          demo={ctx.providerStatus.demo}
        />
      ) : (
        <BusinessPlaceholder title="Provider Status" testid="panel-provider-status" />
      ),
  },
```

> The existing `getEffectiveLayout` (in the same file) already handles new registry entries — they're appended to a persisted layout that doesn't know about them. No migration needed for existing user layouts.

- [ ] **Step 3: Thread the data through `src/app/page.tsx`.**

Open `src/app/page.tsx`. Add the import:

```ts
import { getProviderStatus } from "@/lib/market/health";
import { isDemoMode } from "@/lib/demo/mode";
```

In the existing RSC fetch block (look for the other `await get…()` calls that populate `PanelCtx`), add:

```ts
const providerStatus = {
  rows: getProviderStatus(),
  demo: isDemoMode(),
};
```

In the `PanelCtx` literal passed into the layout/grid renderer, add:

```tsx
providerStatus,
```

(If `page.tsx` is using `<DashboardGrid panelCtx={{...}} />` or similar, add `providerStatus` to the literal. The exact prop wiring follows the existing slice-5 `website` field as a model.)

- [ ] **Step 4: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 5: Build to confirm the page renders.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
rm -rf .next && npm run build 2>&1 | tail -25
```

Expected: build succeeds, no missing-render errors.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/layout/types.ts src/lib/layout/registry.tsx src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(layout): register provider-status panel + thread ProviderStatusView

ProviderStatusView added to PanelCtx; getProviderStatus() called once
per RSC pass. Existing layout migration appends new registry entries
to persisted layouts gracefully — no user-data migration needed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: Phase B green-bar verification

- [ ] **Step 1: Full test suite.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npm test -- --run 2>&1 | tail -15
```

Expected: every previously-green test still green + 15 new tests (8 health + 7 ProviderStatusPanel).

- [ ] **Step 2: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: PR-grep enforcement — Provider Status panel is NOT tenanted.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -n "orgId" src/lib/market/health.ts src/components/dashboard/ProviderStatusPanel.tsx 2>&1
```

Expected: at most one match — the docblock that says "NOT tenanted" / "no orgId column". No code-path match. If anywhere `getProviderStatus()` accepts an `orgId` parameter or `ProviderStatusPanel` accepts a per-org prop, that's a spec violation (slice 11 §4.3).

Phase B done.

---

## Phase C — DEPLOY.md walkthrough

### Task C1: Append "Sentry setup (optional)" section to `DEPLOY.md`

**Files:**
- Modify: `DEPLOY.md`

> The walkthrough is honest about what works without the DSN: **everything except error capture itself**. The action wrappers, middleware, useQuotesPoll counter, and Provider Status panel all function identically with or without `SENTRY_DSN`. The DSN only enables actual transmission.

- [ ] **Step 1: Append the new section to `DEPLOY.md`.**

Open `DEPLOY.md`. After the existing "Netlify — real app (not the demo)" section, append:

```markdown

## Sentry setup (optional)

Slice 11 adds `@sentry/nextjs` for backend error capture (action failures,
middleware exceptions, sustained client poll failures). Without these env
vars the SDK is a no-op — the app runs identically, just without
transmitting errors anywhere. Set up Sentry when you're ready for
production error telemetry.

### One-time setup

1. Create a free Sentry account at https://sentry.io.
2. Create a new "Next.js" project. Note the auto-generated **DSN** (looks
   like `https://abc123@o111222.ingest.sentry.io/4506789`).
3. Create an internal-integration **auth token** with the
   `project:releases` scope (Settings → Account → API → Auth Tokens, or
   for a new flow, the per-project "Source Maps" wizard). Note the token.
4. Note your Sentry **organization slug** (the part of the URL after
   `https://sentry.io/organizations/…`) and the **project slug**.

### Production env vars

On Vercel / Netlify (or any production host), set:

- `SENTRY_DSN` — the DSN from step 2. Enables runtime error capture.
- `SENTRY_AUTH_TOKEN` — from step 3. Build-time only; enables source-map
  upload so stack traces in Sentry are de-minified.
- `SENTRY_ORG` — your org slug.
- `SENTRY_PROJECT` — your project slug.

All four are **optional**. The SDK gracefully no-ops when any are absent.
Source-map upload is silently skipped when `SENTRY_AUTH_TOKEN` is missing.

### What gets captured

- Server-action database errors (excluding expected `ForbiddenError`
  cross-tenant rejections — those are deliberately filtered).
- Middleware exceptions (including the `SESSION_SECRET!` non-null
  assertion if the env var ever goes missing).
- Sustained client-poll failures — the `useQuotesPoll` hook captures
  exactly once after 5 consecutive failed `/api/quotes` fetches
  (~75 seconds at the default 15s refresh).
- Server-component / route-handler exceptions via Next 15's
  `instrumentation.ts` → `Sentry.captureRequestError` bridge.

### What does NOT get captured

- `ForbiddenError` (slice-4/slice-10 cross-tenant rejections — by design).
- Zod validation failures (user input errors, not bugs).
- Anything when `NEXT_PUBLIC_DEMO_MODE=true` — the SDK is initialised
  with `enabled: false` so demo deploys never send events.

### Verifying capture works

After deploying with `SENTRY_DSN` set, trigger a deliberate server-side
error (e.g. temporarily edit a server action to `throw new Error("sentry
test")` and submit the form). The event should appear in your Sentry
project's Issues view within ~60 seconds. Revert the test edit before
shipping.

### Tenancy note

`orgId` is attached to captured events ONLY as a Sentry tag (filterable
inside the Sentry workspace UI). It is NEVER included in breadcrumbs,
event extras, or event contexts — the `beforeSend` scrubber in
`src/lib/observability/sentry.ts` is the canonical enforcement. Tags
stay inside the Sentry workspace; they don't leak to anyone outside the
operator's control plane.
```

- [ ] **Step 2: Sanity check that the file is still well-formed.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
head -3 DEPLOY.md
tail -5 DEPLOY.md
wc -l DEPLOY.md
```

Expected: file starts with `# Deploying AIYA Dashboard`, ends inside the new section, total length somewhere in the 80-120 line range.

- [ ] **Step 3: Commit.**

```bash
git add DEPLOY.md
git commit -m "$(cat <<'EOF'
docs(deploy): add Sentry setup walkthrough for slice 11

Step-by-step instructions for the operator to enable production error
telemetry when they're ready. All four env vars are optional — the SDK
gracefully no-ops when any are absent, and the walkthrough is explicit
about what works without the DSN (everything except transmission itself).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Verification + ship

### Task D1: Enforcement greps + full suite + tsc + build

**Files:** none (verification only)

- [ ] **Step 1: Full test suite.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npm test -- --run 2>&1 | tail -15
```

Expected: zero failures. Total: ~640 tests (588 baseline + ~52 new across 7 new files).

- [ ] **Step 2: Typecheck.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: PR-grep — Sentry config files contain no orgId.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -rn "orgId" sentry.server.config.ts sentry.client.config.ts sentry.edge.config.ts 2>&1
```

Expected: empty output.

- [ ] **Step 4: PR-grep — no breadcrumb/extra/context surfaces orgId.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -rn "addBreadcrumb.*orgId\|breadcrumb.*orgId\|setExtra.*orgId\|setContext.*orgId" src/ 2>&1
```

Expected: empty output. If any match appears, the spec is violated — fix the callsite.

- [ ] **Step 5: PR-grep — middleware Sentry integration.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -n "Sentry" src/middleware.ts 2>&1
```

Expected: exactly two matches — one import line, one `Sentry.captureException(e, ...)` line inside the catch block. Anything else means an unintended capture site.

- [ ] **Step 6: PR-grep — withSentryConfig wraps next.config.mjs exactly once.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -n "withSentryConfig" next.config.mjs 2>&1
```

Expected: exactly two matches — one import line, one `export default withSentryConfig(...)` line.

- [ ] **Step 7: PR-grep — every captureException carries a `layer` tag.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -rn "captureException" src/ 2>&1
```

Audit the output line-by-line. Every match in `src/lib/{inventory,diamonds,deals,website,company}/actions.ts`, `src/middleware.ts`, and `src/hooks/useQuotesPoll.ts` must have `tags: { layer: "<…>" }`. Anonymous captures (no layer) are a finding.

- [ ] **Step 8: PR-grep — `ForbiddenError` is filtered before capture.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
grep -n "ForbiddenError\|captureException" src/lib/deals/actions.ts 2>&1
```

Expected: the `if (e instanceof ForbiddenError)` check appears BEFORE the `Sentry.captureException` call in the `runWithUser` catch block. If `captureException` runs before the Forbidden check, slice 4/10 noise will flood Sentry — fix immediately.

- [ ] **Step 9: CSP widening — demo branch.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
node -e '
  delete process.env.SENTRY_DSN;
  process.env.NEXT_PUBLIC_DEMO_MODE = "true";
  import("./next.config.mjs").then((m) => {
    const csp = m.securityHeaders.find((h) => h.key === "Content-Security-Policy").value;
    console.log(csp.includes("ingest.sentry.io") ? "FAIL" : "OK");
  });
'
```

Expected: `OK`.

- [ ] **Step 10: CSP widening — DSN-set branch.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
SENTRY_DSN="https://pub@o12345.ingest.sentry.io/67890" node -e '
  import("./next.config.mjs").then((m) => {
    const csp = m.securityHeaders.find((h) => h.key === "Content-Security-Policy").value;
    if (!csp.includes("https://o12345.ingest.sentry.io")) { console.log("FAIL: missing host"); process.exit(1); }
    if (csp.includes("*.ingest.sentry.io")) { console.log("FAIL: wildcard"); process.exit(1); }
    console.log("OK");
  });
'
```

Expected: `OK`.

- [ ] **Step 11: Build — demo mode (no DSN).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
rm -rf .next && NEXT_PUBLIC_DEMO_MODE=true npm run build 2>&1 | tail -25
```

Expected: build succeeds. No Sentry warnings about missing auth token (we set `disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN` so the plugin shouldn't even run). No `.map` files in `.next/static/chunks/` (verify with `ls .next/static/chunks/ | grep '.map$' || echo "no maps served"`).

- [ ] **Step 12: Build — production-shaped (DSN + token, but the token is fake — we just want to verify the plugin loads).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
rm -rf .next && SENTRY_DSN="https://pub@o12345.ingest.sentry.io/67890" SENTRY_AUTH_TOKEN="fake-token-for-build-test" SENTRY_ORG="x" SENTRY_PROJECT="y" npm run build 2>&1 | tail -30
```

Expected: build succeeds. The Sentry plugin will likely log a warning about the fake token being rejected by the Sentry API (that's expected — the build itself should still succeed because token rejection is non-fatal). The CSP header in the production-shaped build contains `https://o12345.ingest.sentry.io`.

- [ ] **Step 13: Local dev smoke — demo mode.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
NEXT_PUBLIC_DEMO_MODE=true npm run dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:3000/ -o /tmp/slice11-home.html
echo "--- panel marker check ---"
grep -oE "panel-provider-status|Provider Status|no live providers" /tmp/slice11-home.html | sort -u
kill $DEV_PID 2>/dev/null
```

Expected: at least `panel-provider-status` and `Provider Status` markers appear (the demo footnote may be SSR'd or hidden behind the layout-grid display logic — its presence is nice-to-have here, not required).

- [ ] **Step 14: Commit any verification fixes (if anything turned up).**

If steps 1-13 all passed clean, skip to Task D2. Otherwise commit the fix(es):

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(slice-11): verification fixes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task D2: Whole-slice code review + merge to main + worktree cleanup

**Files:** none (process)

- [ ] **Step 1: Whole-slice code review.** Spawn a code-review subagent with this prompt (paste verbatim):

> Review every change on branch `feature/aiya-polish-observability-11` against `main` for the AIYA Polish + Observability slice (slice 11). Spec: `docs/superpowers/specs/2026-06-05-aiya-polish-observability-slice-11-design.md`. Plan: `docs/superpowers/plans/2026-06-05-aiya-polish-observability-slice-11.md`. Verify each: (a) `grep -rn "orgId" sentry.server.config.ts sentry.client.config.ts sentry.edge.config.ts` returns empty; (b) `grep -rn "addBreadcrumb.*orgId\|setExtra.*orgId\|setContext.*orgId" src/` returns empty; (c) every `captureException` callsite in `src/lib/{inventory,diamonds,deals,website,company}/actions.ts`, `src/middleware.ts`, and `src/hooks/useQuotesPoll.ts` has a `tags: { layer: "<…>" }` argument — no anonymous captures; (d) inside `runWithUser` in `src/lib/deals/actions.ts`, the `if (e instanceof ForbiddenError)` check appears BEFORE the `Sentry.captureException` call; (e) `getProviderStatus` in `src/lib/market/health.ts` takes ZERO parameters (no `orgId` arg, no per-tenant filter); (f) `ProviderStatusPanel` accepts no `orgId` prop; (g) `parseSentryIngestHost` returns null for an unset DSN — the demo build's CSP byte-equals the pre-slice-11 CSP when `SENTRY_DSN` is unset; (h) `next.config.mjs` is wrapped by `withSentryConfig` exactly once and the plugin is `disable*WebpackPlugin: !process.env.SENTRY_AUTH_TOKEN`; (i) `initSentry` is idempotent and disabled when `isDemoMode()` is true OR when `SENTRY_DSN` is unset; (j) `useQuotesPoll` captures exactly ONCE per failure run (the counter increments to 5 and fires once, then resets only on the next success); (k) the `beforeSend` scrubber leaves `event.tags` untouched (tags are intentionally allowed to carry `orgId`); (l) Provider Status panel renders all rows as `simulated` in demo mode and falls back to the `BusinessPlaceholder` when `ctx.providerStatus` is missing entirely; (m) all slice-3/4/10 cross-tenant tests still pass (slice 11 is strictly additive instrumentation); (n) the `DEPLOY.md` Sentry section is honest about what works without the DSN. Report findings, no fixes.

- [ ] **Step 2: Apply review fixes** (if any). For each finding: write a failing test first, then the minimal fix, then verify the test passes. Commit with a `fix(observability): …` message ending in the Co-Authored-By trailer. Do NOT amend prior commits.

- [ ] **Step 3: Push the branch.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-polish-observability-11"
git push -u origin feature/aiya-polish-observability-11
```

- [ ] **Step 4: Merge to main from the main worktree.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git checkout main
git pull --ff-only origin main
git merge --no-ff feature/aiya-polish-observability-11 -m "$(cat <<'EOF'
Merge slice 11: Polish + Observability

Adds @sentry/nextjs for backend error capture (action wrappers + middleware
+ client poll threshold-5) and a Provider Status dashboard panel showing
per-provider freshness. Multi-tenant safe — orgId only in server-side
event.tags, NEVER in breadcrumbs/extras/contexts (beforeSend scrubber is
the single source of truth). Demo mode disables Sentry entirely; CSP
widening for the Sentry ingest host is DSN-narrow and only applied when
SENTRY_DSN is set.

ForbiddenError remains the silent-rejection path for slice-4/10
cross-tenant violations — by design.

DEPLOY.md gains a Sentry walkthrough — operator can turn it on when ready.

Closes the user's original (a)→(b)→(c)→(d) arc.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 5: Wait for the deploy to go live + verify Provider Status is visible on the demo.**

```bash
(
  url="https://idesign-dash-demo.netlify.app/"
  marker="Provider Status"
  start=$(date +%s)
  deadline=$((start + 360))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(curl -sL --max-time 15 "$url" 2>/dev/null || true)
    if echo "$body" | grep -q "$marker"; then
      echo "SLICE_11_LIVE after $(( $(date +%s) - start ))s"
      exit 0
    fi
    sleep 20
  done
  echo "TIMEOUT — slice-11 marker '$marker' not found in 6 min"
  exit 1
)
```

Run in background with the standard pattern from prior slice deploys.

- [ ] **Step 6: Cleanup worktree + branch.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree remove .worktrees/aiya-polish-observability-11
git branch -d feature/aiya-polish-observability-11
git push origin --delete feature/aiya-polish-observability-11 2>/dev/null || true
```

- [ ] **Step 7: Final green-bar from main.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
npm test -- --run 2>&1 | tail -10 && npx tsc --noEmit 2>&1 | tail -5 && echo "DONE"
```

Expected: green tests + clean tsc + `DONE`.

Slice 11 done.

---

## Done criteria

- All new tests green; full suite green; `tsc --noEmit` clean; `npm run build` succeeds in both demo (no DSN) and DSN-set shapes.
- `@sentry/nextjs@^8` is in `dependencies`.
- `src/lib/observability/{sentry,stripOrgId,csp}.ts` exist.
- `sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts` exist at the repo root and delegate to `initSentry()`.
- `src/instrumentation.ts` dynamic-imports the right runtime config and re-exports `Sentry.captureRequestError` as `onRequestError`.
- `next.config.mjs` is wrapped by `withSentryConfig`; CSP widens with the parsed Sentry ingest host ONLY when `SENTRY_DSN` is set; demo builds' CSP is byte-identical to the pre-slice-11 CSP.
- All five action wrappers (`inventory`, `diamonds`, `deals`, `website`, `company`) capture exceptions on the generic-error path with a `layer` tag. `ForbiddenError` is filtered before capture in `deals`.
- `src/middleware.ts` wraps its body in try/catch with `Sentry.captureException` + re-throw.
- `src/hooks/useQuotesPoll.ts` captures exactly once on the 5th consecutive failure; counter resets on the next success.
- `src/lib/market/health.ts` exports `getProviderStatus`, `recordProviderResult`, `PROVIDER_DISPLAY`. Takes no `orgId` (platform telemetry).
- `src/components/dashboard/ProviderStatusPanel.tsx` renders one row per provider with `FreshnessDot` + demo footnote.
- `PANEL_REGISTRY` includes `provider-status`; `PanelCtx` has a `providerStatus?: ProviderStatusView` field.
- `DEPLOY.md` has a "Sentry setup (optional)" section.
- PR-review greps in Task D1 all return the expected shapes (no orgId in breadcrumbs/extras/contexts, every captureException has a layer tag, ForbiddenError filtered before capture, CSP DSN-narrow).

---

## Self-Review Notes (filled during writing-plans skill)

**1. Spec coverage check (§-by-§):**
- §1 Overview + goals → Tasks A1-A9, B1-B4, C1 ✓
- §2 Architecture decisions → embedded in task docblocks and CRITICAL boxes ✓
- §3 Sentry SDK integration: §3.1 init seam → A3; §3.2 action wrapper → A7; §3.3 middleware → A8; §3.4 client store → A9; §3.5 tenancy scrubber → A2 + A3; §3.6 source map upload → A6 ✓
- §4 Provider Status panel: §4.1 aggregator → B1 + B2; §4.2 panel component → B3; §4.3 NOT tenanted (explicit) → B5 step 3 grep + D1 step 7 grep + D2 review prompt (e) ✓
- §5 Multi-tenant safety → A2 (strip helper) + A3 (scrubbers) + B5 step 3 (panel grep) + D1 steps 3-4 + D2 review prompt (a-d, e) ✓
- §6 Demo mode → A3 (init guard) + A6 (CSP guard) + B1 (panel guard) + B3 (panel demo prop) + D1 step 9 ✓
- §7 Tests (TDD) — §7.1 init → A3; §7.2 scrubber → A2 + A3; §7.3 action wrapper → A7; §7.4 health → B1; §7.5 ProviderStatusPanel → B3; §7.6 quote-poll capture → A9; plus §7.7 existing-suite green at A10, B5, D1 ✓
- §8 File plan — every entry is realized in a task with the correct create/modify verb ✓
- §9 Security & threat model — §9.1 (tenancy invariant) → A2/A3/D1; §9.2 (DSN public-ish) → DEPLOY.md C1; §9.3 (source map exposure) → A6 + D1 step 11; §9.4 (demo-mode invariant) → A3 + A6 + B1; §9.5 (PR review grep checklist) → D1 steps 3-8 + D2 review prompt; §9.6 (audit logging gap, explicit) → DEPLOY.md C1 mentions ForbiddenError filtering; §9.7 (CSP narrow widening) → A5 + A6 + D1 steps 9-10 ✓
- §10 Out of scope — Web Vitals + Pixel Polish + everything else deferred; none touched ✓

**2. Placeholder scan:** None found. Every step has either a complete code block, an exact command with expected output, or a precise textual edit instruction (e.g., "locate line ~60, change `catch (e) { … }` to …" with the full before/after shown). The closest thing to a placeholder is `src/app/page.tsx`'s "add `providerStatus,` to the PanelCtx literal" — but the surrounding context (`getProviderStatus()` + `isDemoMode()` imports, the assembled literal) is fully specified.

**3. Type consistency:**
- `ProviderHealth` defined once in `src/lib/market/health.ts`; re-imported in `ProviderStatusPanel.tsx` and `src/lib/layout/types.ts`. Never redefined.
- `OnProviderResult` defined once in `router.ts`; consumed by `cache.ts`.
- `ProviderId`, `Freshness` continue to be sourced from `src/lib/market/types.ts` — no new union types introduced.
- `ActionResult` reused from each existing actions file; never touched.
- `ProviderStatusView` is the only new `PanelCtx` field; type matches `{ rows: ProviderHealth[]; demo: boolean }` in both definition and consumer.
- `initSentry`, `beforeSend`, `beforeBreadcrumb`, `withOrgScope` exported from one place (`src/lib/observability/sentry.ts`); consumed only by the three `sentry.*.config.ts` files and (in the case of `withOrgScope`) potentially future server-action callsites.

**4. Risk consistency:** The five CRITICAL boxes are placed at the highest-risk steps — `@sentry/nextjs` v8+ API (A1), orgId scrubber tenancy invariant (A2), demo-mode SDK disable (A3), three config files required (A4), CSP narrow widening (A5/A6). Each is callable from PR review (D2) via the grep checklist.

Plan is ready.
