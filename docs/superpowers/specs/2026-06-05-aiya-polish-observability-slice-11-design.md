# AIYA Dashboard — Slice 11: Polish + Observability — Design

**Date:** 2026-06-05
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market), #1a (AIYA dashboard + reskin + honesty contract), #1b-1 (inventory), #1b-3 (diamond price lists), #1c (customizable layout), demo (Netlify simulation mode), slice 2 (Deal Room), slice 3 (Multi-Tenant Foundation: real `orgs` table, `getCurrentOrgId()` async seam, JWT `{user, orgId}`, cross-org isolation tests), slice 4 (Circles: cross-org Deal Room visibility, `ForbiddenError` + `runWithUser` authz pattern), slice 5 (Website Overview), and slice 10 (Deal Reply Threads) — all shipped on `main`.

**Numbering note:** Slice 11 follows directly from slice 10 (Deal Reply Threads). Slices 6-9 remain reserved for the parallel-agent track. This is the final track in the user's original "(a)→(b)→(c)→(d)" arc — the (d) "Polish + Observability" cut.

---

## 1. Overview & Goals

The dashboard has shipped 12 vertical slices and a multi-tenant foundation. The market layer fans out across six providers with a documented "live / delayed / stale / simulated" honesty contract — but **the operator running this app has no visibility into when that contract is degrading**. If gold-api.com goes down, the FreshnessDot quietly flips to `delayed` on a single symbol; no one is paged, no error is logged, and a partner clicking the demo URL sees a `simulated` dot with no explanation of *why*. Symmetrically, the slice-3/4/10 silent-rejection paths (zero-rows updates on cross-org write attempts, `ForbiddenError` thrown inside `runWithUser`) currently emit nothing to a backend — the only signal is the action result the caller sees.

**Slice 11 closes that loop with the smallest honest cut: server-side error capture (Sentry) + a user-facing platform-telemetry panel (Provider Status).** Two surfaces, one slice. Sentry gives the operator a backend signal when something silently fails. Provider Status gives every visitor a visible, honest readout of which market providers are healthy right now — extending the slice-1a honesty contract from per-symbol freshness dots up to a per-provider system view.

### 1.1 Why these two of the four candidates

The user's framing names four candidate areas: (1) Sentry, (2) Core Web Vitals reporting, (3) Provider Failover Dashboard, (4) Visual fidelity polish on Mockup 1. The cut for this slice is **(1) + (3)**. Rationale:

- **Different surfaces.** Sentry is server-side telemetry the operator consumes; Provider Status is a UI panel every visitor consumes. Bundling them produces a coherent "you can see what's happening in this thing" slice — observability for the operator AND for the visitor — without internal coupling.
- **Demo-safe stories.** Sentry can be hard-disabled in demo mode (`Sentry.init({ enabled: false })`); Provider Status renders all providers in `simulated` state when `isDemoMode()` is true, mirroring the existing FreshnessDot's `simulated` treatment. Both ship cleanly to the public Netlify deploy.
- **Measurable user value, low LOC.** Sentry SDK is ~3 small integration points (middleware, action wrapper, root layout) plus a scrubber. Provider Status is one new helper + one new panel + a layout-registry entry. Together this is a meaningfully smaller surface than (2)+(4), and the win is more legible.
- **(2) Core Web Vitals and (4) Visual Polish are deferred** to named follow-up slices (§10). Web Vitals has a clean home behind Next.js's built-in `reportWebVitals` once Sentry is in place (so we can ship vitals as a Sentry breadcrumb later for ~zero extra LOC). Visual polish is highly subjective and prone to scope creep — it deserves its own dedicated slice with a tighter spec.

### 1.2 Goals

- **Install `@sentry/nextjs`** as a runtime dependency. Verified `package.json` does not currently include it; this is a net-new dep. No other Sentry packages.
- **Three Sentry integration points**, each minimal:
  1. `src/middleware.ts` — wrap auth gating in a Sentry-aware boundary so middleware failures (token verify exceptions, network exceptions on edge runtime) get captured. Existing `verifySession` returns `null` on bad tokens — we don't capture those (expected). We capture genuine thrown errors only.
  2. `src/lib/deals/actions.ts` `run()` and `runWithUser()` wrappers — the existing `catch` blocks already log to `console.error`; they gain a `Sentry.captureException(e, { tags: { layer: "deals-action" } })` call right next to the existing `console.error`. `ForbiddenError` is intentionally NOT captured (it's an expected user-input rejection, not a bug). Other action files (inventory, diamonds, website, company) follow the same pattern in a single sweep — five files, one new line in each `catch` block.
  3. `src/app/layout.tsx` — the root layout already exists; client-side init is done via a sibling file `src/instrumentation-client.ts` (Next 15 convention) that calls `Sentry.init` on first client render. No JSX changes to the layout.
- **Demo-mode invariant:** `if (isDemoMode()) { Sentry.init({ enabled: false }); }` — the SDK is initialised with capture disabled. No DSN is required for the demo deploy; no events are sent.
- **Missing-DSN graceful degrade:** if `SENTRY_DSN` is unset (which it will be on most local dev installs and on the demo), `Sentry.init` is called with `dsn: undefined` and `enabled: false`. The SDK becomes a no-op — never throws, never crashes the app.
- **Tenancy-safe scrubber:** the Sentry init config includes a `beforeSend` hook that strips any `orgId` field from breadcrumbs and event extra/contexts before send. The `orgId` is allowed in *server-side scope tags* (so an operator triaging a real error can see which tenant's request blew up), but never in breadcrumbs, never in `event.message`, never in `event.exception.values[].value`. The scrubber is the single source of truth for this rule.
- **Source map upload at build time:** `withSentryConfig` wraps `next.config.mjs`. When `SENTRY_AUTH_TOKEN` is present at build time, source maps are uploaded; when absent (most local builds, the demo build, CI without the secret), source map upload is skipped silently. The build never fails on a missing auth token.
- **Provider Status panel (`provider-status`)** added to the layout registry. Renders 1×1 by default. Reads from a new helper `getProviderStatus()` exported from `src/lib/market/router.ts` (or a sibling file `src/lib/market/health.ts` — see §4.1). Returns an array `ProviderHealth[]` shape:
  ```ts
  type ProviderHealth = {
    id: ProviderId;           // existing union: finnhub | twelvedata | coingecko | frankfurter | metals | index-etf | simulated
    display: string;          // human label, e.g. "Gold (gold-api.com)"
    lastOkAt: number | null;  // epoch ms of last successful fetch, null = never
    lastErrorAt: number | null;
    lastErrorMessage: string | null;
    freshness: Freshness;     // reuses the slice-1a Freshness union
  };
  ```
  UI: one row per provider, each row showing `<FreshnessDot freshness={p.freshness} /> <span>{p.display}</span> <span class="text-mono text-xs">{relativeTimeAgo(p.lastOkAt)}</span>`. Title-attribute tooltip surfaces `lastErrorMessage` if present.
- **Demo mode for Provider Status:** when `isDemoMode()` is true, the panel renders the six providers with `freshness: "simulated"` and a row-level footnote *"Demo mode — no live providers in use."* No live signals are surfaced (consistent with the simulated-only quote pipeline in demo).
- **Tests (TDD):**
  - `test/lib/market/health.test.ts` — `getProviderStatus()` aggregator: per-provider freshness math, demo-mode short-circuit, "never fetched" state.
  - `test/components/dashboard/ProviderStatusPanel.test.tsx` — renders live/delayed/stale/simulated rows + the demo footnote.
  - `test/lib/sentry-wrapper.test.ts` — mocks `@sentry/nextjs`; asserts that an action thrown error calls `Sentry.captureException` with the right tags; asserts that a thrown `ForbiddenError` does **not** call `captureException`; asserts demo mode short-circuits `Sentry.init` to `enabled: false`.
  - `test/lib/sentry-scrubber.test.ts` — the `beforeSend` scrubber removes `orgId` from breadcrumbs and event extra; the same scrubber preserves the `orgId` *scope tag*.
- All existing 588 tests stay green.

### 1.3 Non-Goals for Slice 11 (each has a named home — see §10)

Core Web Vitals reporting (slice 12), pixel polish on Mockup 1 (slice 13), per-tenant error rate dashboards inside Sentry, OpenTelemetry / distributed tracing, real-time SSE freshness push, per-page-level React error boundaries with custom UI, demo URL access controls, anomaly alerting (PagerDuty / Slack hooks), cost/billing telemetry, per-org performance budgets.

---

## 2. Architecture decisions

### 2.1 Why Sentry over OTEL or vendor-neutral

OpenTelemetry is the technically-correct choice for a long-lived backend, but slice 11 needs **errors landing in a queryable backend within an hour of implementation, not a tracing backend within a quarter**. Sentry is single-vendor, single-SDK, single-DSN. The operator runs one `npm install`, sets one env var, and gets errors. The follow-on slice that adds tracing can stand up an OTEL collector then; the breadcrumbs from Sentry will continue to work alongside it (Sentry has an OTEL bridge if needed). This slice prioritizes time-to-signal over architectural purity.

### 2.2 Why `@sentry/nextjs` (not `@sentry/node` + `@sentry/browser` separately)

The Next.js wrapper resolves three things in one package:
- The `withSentryConfig` wrapper hooks `next.config.mjs` for source map upload.
- The `instrumentation.ts` and `instrumentation-client.ts` conventions are honored automatically — no manual entry-points.
- Server actions, route handlers, middleware, and RSC all get a single boundary configuration.

Using two separate packages would force us to write the boundary wiring by hand, and we'd lose source map upload.

### 2.3 Why a server-side aggregator helper, not a separate `health_check` table

Provider health is **ephemeral platform state**, not durable tenant data. Persisting per-provider success/failure into Postgres would buy us nothing (the panel never needs history beyond "most recent") and would cost us multi-tenant cross-talk concerns (no `org_id` column makes sense — health is platform-wide, not per-tenant). Instead we extend the existing `QuoteCache` (which already holds an in-memory snapshot of every symbol's freshness) with a small per-provider tally — last-successful-fetch timestamp and last-error timestamp/message per `ProviderId`. The aggregator reads from this in-memory state. If the server restarts, the panel shows "never" until the next refresh tick, which is honest.

### 2.4 The "freshness" reuse

`Quote.freshness` already encodes "live / delayed / stale / simulated" with the same age-based math (`live ≤ 30s`, `delayed ≤ 5m`, `stale otherwise`, `simulated` regardless of age when source is `"simulated"`). Provider Status reuses **the exact same function** `computeFreshness(source, asOf)` over the per-provider `lastOkAt`, so the dot semantics are identical between the existing per-symbol display and the new per-provider panel. No new freshness ladder is introduced.

---

## 3. Sentry SDK integration

### 3.1 The single init seam

A new file `src/lib/observability/sentry.ts` exports two functions:

```ts
import * as Sentry from "@sentry/nextjs";
import { isDemoMode } from "@/lib/demo/mode";

const SENTRY_DSN = process.env.SENTRY_DSN;

export function initSentry(): void {
  if (isDemoMode()) {
    Sentry.init({ enabled: false });
    return;
  }
  Sentry.init({
    dsn: SENTRY_DSN, // undefined => SDK is a no-op
    enabled: !!SENTRY_DSN,
    tracesSampleRate: 0,  // tracing deferred to slice 12+
    beforeSend,
    beforeBreadcrumb,
  });
}

export { beforeSend, beforeBreadcrumb };
```

`initSentry()` is called from two places:
- `src/instrumentation.ts` (Next 15 server convention) — runs once per server cold start.
- `src/instrumentation-client.ts` (Next 15 client convention) — runs once per client load.

Both call the same function. The function itself is idempotent (Sentry's SDK is safe to re-init).

### 3.2 The action wrapper integration

In `src/lib/deals/actions.ts` (and the symmetric files in `inventory/`, `diamonds/`, `website/`, `company/`), the `run()` and `runWithUser()` `catch` blocks gain one line each:

```ts
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    console.error("[deals action] database error:", e);
    Sentry.captureException(e, {
      tags: { layer: "deals-action" },
      // orgId is NOT in tags — it's in the per-request scope set by initOrgScope, see §3.5
    });
    return { ok: false, error: "Database error" };
  }
```

`ForbiddenError` is **deliberately not captured**. It is the expected outcome of a cross-tenant or cross-circle violation — a user-input rejection, not a bug. Capturing it would flood Sentry with noise and (worse) leak attempted access patterns to a third-party telemetry vendor.

### 3.3 The middleware integration

`src/middleware.ts` currently does not throw — `verifySession` returns `null` on bad tokens, which is a normal control flow path. We add only a single `try/catch` around the body:

```ts
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
    Sentry.captureException(e, { tags: { layer: "middleware" } });
    throw e; // let the platform's default error handling continue
  }
}
```

The middleware's `!` non-null assertion on `process.env.SESSION_SECRET` is exactly the kind of thing we want captured if it ever fires — currently it would silently 500 and we'd have no way to know.

### 3.4 The client-store integration

`src/hooks/useQuotesPoll.ts` currently swallows fetch errors silently with `// transient; next tick retries`. That's correct UX (don't spam the user with a banner), but a sustained fetch failure means the panels go stale and no one knows. We add **bounded** capture:

```ts
let consecutiveFailures = 0;
async function tick() {
  try {
    const res = await fetch("/api/quotes", { cache: "no-store" });
    if (!res.ok) {
      consecutiveFailures += 1;
      if (consecutiveFailures === 5) {
        Sentry.captureMessage("useQuotesPoll: 5 consecutive fetch failures", {
          level: "warning",
          tags: { layer: "client-poll" },
        });
      }
      return;
    }
    consecutiveFailures = 0;
    const { quotes } = await res.json();
    if (!cancelled) ingest(quotes);
  } catch (e) {
    consecutiveFailures += 1;
    if (consecutiveFailures === 5) {
      Sentry.captureException(e, { tags: { layer: "client-poll" } });
    }
  }
}
```

Threshold = 5 ticks (= 75s at the default 15s refresh). Below the threshold, we stay silent (transient network blip is not an alertable event). At the threshold, exactly one capture per failure run — the counter resets on the next success.

### 3.5 The tenancy scrubber

A single `beforeSend` hook strips `orgId` from breadcrumbs and event extras before transmission. The hook is the **single source of truth** for this rule.

```ts
function beforeSend(event: Sentry.Event, _hint: Sentry.EventHint): Sentry.Event | null {
  // orgId may legitimately appear in scope.tags (set server-side per request).
  // We never want it in breadcrumbs, event.extra, event.contexts, or
  // event.message. Defensive strip.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => stripOrgId(b));
  }
  if (event.extra) event.extra = stripOrgId(event.extra);
  if (event.contexts) {
    for (const k of Object.keys(event.contexts)) {
      event.contexts[k] = stripOrgId(event.contexts[k]);
    }
  }
  return event;
}

function stripOrgId<T extends Record<string, unknown> | undefined>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;
  // Shallow + one-level-deep strip; the failure mode if a value contains a
  // deeply-nested orgId is acceptable because all our intentional usages are
  // flat tags / extras.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "orgId") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>;
      const cleanedNested: Record<string, unknown> = {};
      for (const [nk, nv] of Object.entries(nested)) {
        if (nk === "orgId") continue;
        cleanedNested[nk] = nv;
      }
      out[k] = cleanedNested;
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
```

The `beforeBreadcrumb` hook does the same one-level strip on incoming breadcrumbs (so they're already clean when the SDK queues them).

**`orgId` in scope tags is allowed.** The scrubber removes it from breadcrumbs/extras/contexts but *does not* touch `event.tags`. A server-side helper `withOrgScope(orgId, fn)` calls `Sentry.withScope` and sets `tag.orgId = orgId` inside the scope. Tags are used for filtering in the Sentry UI — necessary for an operator triaging a real error to know which tenant's request blew up. Tags are NOT visible to anyone outside the Sentry workspace.

The implementation plan's PR review grep is the enforcement mechanism:
- `grep -rn "orgId" src/lib/observability/` → only the scrubber file, only the strip code.
- `grep -rn "Sentry.addBreadcrumb.*orgId\|Sentry.setExtra.*orgId\|setContext.*orgId" src/` → 0 matches.
- `grep -rn "Sentry.setTag.*orgId\|withOrgScope" src/` → only intended scope-tag callsites.

### 3.6 Source map upload

`next.config.mjs` is wrapped:

```ts
import { withSentryConfig } from "@sentry/nextjs";

// ... existing nextConfig ...

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // When SENTRY_AUTH_TOKEN is absent, sourcemap upload is skipped silently.
  // The build still produces source maps locally (Next default); they're just
  // not pushed anywhere.
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
});
```

The CSP in `next.config.mjs` will need `connect-src` widened to include the Sentry ingest host (e.g. `*.ingest.sentry.io` — exact host derived from the DSN at build time). The implementation plan documents the exact regex used (project-specific subdomain) and adds it to the existing `CONNECT_HOSTS` array, gated on `SENTRY_DSN` being set so the demo build doesn't widen its CSP unnecessarily.

---

## 4. Provider Status panel

### 4.1 The aggregator helper

A new module `src/lib/market/health.ts`:

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

const PROVIDER_DISPLAY: Record<ProviderId, string> = {
  "finnhub":     "Equities · Finnhub",
  "twelvedata":  "Indices/Commodities · Twelve Data",
  "coingecko":   "Crypto · CoinGecko",
  "frankfurter": "FX · Frankfurter (ECB)",
  "metals":      "Spot Metals · gold-api.com",
  "index-etf":   "Index ETF proxy",
  "simulated":   "Simulated (fallback)",
};

export function getProviderStatus(): ProviderHealth[];
```

The `QuoteCache` constructor gains a `private health = new Map<ProviderId, { lastOkAt: number; lastErrorAt: number; lastErrorMessage: string }>()` field. `apply()` updates `lastOkAt` for the provider IDs that returned quotes; the `catch` in `refreshSymbols()` updates `lastErrorAt` + `lastErrorMessage` for the failing provider — but **router.ts is where we know the per-provider success/failure**, not cache.ts.

The clean implementation: `resolveQuotes` in router.ts gains a side-effect callback parameter `onProviderResult?: (id: ProviderId, ok: boolean, err?: unknown) => void`. The default `defaultQuoteFetcher` in cache.ts wires it to a `recordProviderResult()` function inside `health.ts` that maintains the in-memory map. The `getProviderStatus()` aggregator reads from that map plus `PROVIDER_DISPLAY` and computes freshness via `computeFreshness(id, lastOkAt ?? 0)`.

Demo-mode short-circuit:

```ts
export function getProviderStatus(): ProviderHealth[] {
  if (isDemoMode()) {
    return Object.entries(PROVIDER_DISPLAY).map(([id, display]) => ({
      id: id as ProviderId,
      display,
      lastOkAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      freshness: "simulated",
    }));
  }
  // ... real aggregation
}
```

### 4.2 The panel component

`src/components/dashboard/ProviderStatusPanel.tsx` is a server component (it has no state of its own — just renders the aggregator output once per RSC pass).

```tsx
import { getProviderStatus } from "@/lib/market/health";
import { FreshnessDot } from "@/components/FreshnessDot";
import { isDemoMode } from "@/lib/demo/mode";
import { timeAgo } from "@/lib/format/timeAgo";

export function ProviderStatusPanel() {
  const rows = getProviderStatus();
  return (
    <div data-testid="panel-provider-status" className="...">
      <h3>Provider Status</h3>
      <ul>
        {rows.map((p) => (
          <li key={p.id} title={p.lastErrorMessage ?? undefined}>
            <FreshnessDot freshness={p.freshness} />
            <span>{p.display}</span>
            <span className="font-mono text-xs">
              {p.lastOkAt ? timeAgo(p.lastOkAt) : "never"}
            </span>
          </li>
        ))}
      </ul>
      {isDemoMode() && (
        <p className="text-xs opacity-60">
          Demo mode — no live providers in use.
        </p>
      )}
    </div>
  );
}
```

The panel is added to `PANEL_REGISTRY` in `src/lib/layout/registry.tsx` with `id: "provider-status"`, `defaultSize: 1`. Existing layout migration in `getEffectiveLayout` already handles new registry entries gracefully — they're appended to the end of a persisted layout that doesn't know about them.

### 4.3 Why this panel is NOT tenanted

Provider health is **platform telemetry, identical for every tenant**. Every org sees the same list of providers in the same states. No `orgId` flows into this panel. This is an explicit exception to the "everything is tenanted" rule from slice 3, and it is correct because:
- The data is in-memory on the server, not in a tenanted database table.
- The signal is about the platform's connectivity to external vendors, which is identical for every tenant on this deploy.
- A future multi-deploy / cell-based topology might surface different provider health per deploy, but that's still platform-level, not tenant-level.

The PR review checklist (§9.4) explicitly confirms that `getProviderStatus` takes no `orgId` argument and the panel does not accept any per-org prop.

---

## 5. Multi-tenant safety

Slice 11 is platform-level instrumentation. The tenancy invariants from slices 3 + 4 + 10 are preserved verbatim, with two new rules added:

1. **No `orgId` in Sentry breadcrumbs, event.extra, event.contexts, or event.message.** Enforced by the `beforeSend` scrubber. `orgId` is permitted only in `event.tags` (set via `Sentry.withScope`), which is server-side only and used for triage filtering in the Sentry UI. A future slice may evaluate whether even this should be replaced with an opaque per-request request-id (hashed with a server-side secret) — for now we accept the trade-off because the alternative is forcing an operator to manually correlate request IDs to tenant identities, which is both slower and more error-prone.

2. **The Provider Status panel is platform-wide, not tenanted.** Documented as an explicit exception to the slice-3 enforcement. The aggregator takes no `orgId`. The panel takes no per-org prop. No new wire schema includes `orgId`. The PR review confirms this by inspection.

3. **No new Zod input schema in slice 11.** The Provider Status panel is read-only; the Sentry SDK initialization is config-time, not input-time. The slice-3 invariant *"no `orgId` in `src/lib/*/validation.ts`"* remains satisfied — slice 11 adds zero new files in those directories.

---

## 6. Demo mode

| Surface | Demo behavior |
|---|---|
| Sentry SDK | `Sentry.init({ enabled: false })` — no events captured, no DSN required. The bundled SDK code is still loaded (small, ~20KB gzipped), but it's a no-op. |
| Source map upload | Skipped at build time when `SENTRY_AUTH_TOKEN` is absent (which it always is for the demo deploy). |
| `useQuotesPoll` capture | The threshold-5 counter still runs, but `Sentry.captureMessage`/`captureException` are no-ops because the SDK is disabled. No behavioral difference observable to the visitor. |
| Provider Status panel | Renders all six providers in `simulated` state with a row footnote *"Demo mode — no live providers in use."* No live timestamps surfaced (because there are none). |
| CSP `connect-src` | Sentry ingest host is added only when `SENTRY_DSN` is set at build time; demo builds don't widen their CSP. |

The demo deploy continues to require zero secrets and zero external services beyond the keyless market providers that are already short-circuited to simulated.

---

## 7. Tests (TDD)

All tests under `test/lib/` and `test/components/` to keep the observability subsystem self-contained. Five new test files.

### 7.1 `test/lib/observability/sentry-init.test.ts`

- Mocks `@sentry/nextjs`.
- `initSentry()` in demo mode → calls `Sentry.init` with `{ enabled: false }`.
- `initSentry()` with `SENTRY_DSN` unset, non-demo → calls `Sentry.init` with `enabled: false, dsn: undefined`.
- `initSentry()` with `SENTRY_DSN` set, non-demo → calls `Sentry.init` with `enabled: true, dsn: $DSN, beforeSend, beforeBreadcrumb`.
- `initSentry()` is idempotent (calling twice doesn't throw, and the second call re-inits with the same config).

### 7.2 `test/lib/observability/sentry-scrubber.test.ts`

- `beforeSend({ extra: { orgId: 7, otherField: "x" } })` → returns event with `extra: { otherField: "x" }` (orgId stripped).
- `beforeSend({ breadcrumbs: [{ data: { orgId: 7, query: "abc" } }] })` → breadcrumb data has `{ query: "abc" }`, no `orgId`.
- `beforeSend({ contexts: { request: { orgId: 7, url: "/foo" } } })` → `contexts.request` has `{ url: "/foo" }`, no `orgId`.
- `beforeSend({ tags: { orgId: 7 } })` → returns event UNCHANGED (tags are intentionally allowed). This test documents the rule.
- `beforeBreadcrumb({ data: { orgId: 7 } })` → returns breadcrumb with `data: {}`.

### 7.3 `test/lib/observability/sentry-action-wrapper.test.ts`

- Mocks `@sentry/nextjs` so we can assert `captureException.mock.calls`.
- A `run()` callback that throws a non-Forbidden error → `Sentry.captureException` called exactly once with `{ tags: { layer: "deals-action" } }`. (Repeated for inventory/diamonds/website/company with their respective layer tag — five mini-tests via parameterization.)
- A `runWithUser()` callback that throws `ForbiddenError` → `Sentry.captureException` NOT called. The existing `{ ok: false, error: "Forbidden" }` return is preserved.
- Demo mode → action short-circuits before the try block; `Sentry.captureException` not called.

### 7.4 `test/lib/market/health.test.ts`

- `getProviderStatus()` in demo mode → returns six rows, all `freshness: "simulated"`, all `lastOkAt: null`.
- `getProviderStatus()` after `recordProviderResult("finnhub", true)` at `t = now - 5_000` → `finnhub` row is `freshness: "live"`, `lastOkAt = t`.
- `getProviderStatus()` after `recordProviderResult("finnhub", true)` at `t = now - 60_000` (60s ago) → `finnhub` row is `freshness: "delayed"`.
- `getProviderStatus()` after `recordProviderResult("finnhub", true)` at `t = now - 600_000` (10min ago) → `finnhub` row is `freshness: "stale"`.
- `getProviderStatus()` after `recordProviderResult("finnhub", false, new Error("ECONNRESET"))` → `lastErrorMessage = "ECONNRESET"`, `lastErrorAt = now`. If `lastOkAt` exists from earlier, the freshness still uses `lastOkAt` (errors don't override last-good-time).
- "Never fetched" state: a provider with no recorded results → `lastOkAt: null, freshness: "stale"` (treating "never" as worst-case rather than misleading the operator into thinking it's healthy).

### 7.5 `test/components/dashboard/ProviderStatusPanel.test.tsx`

- Renders one row per provider returned by `getProviderStatus`.
- A `live` row has a green dot (`data-freshness="live"`).
- A `simulated` row has the simulated dot (`data-freshness="simulated"`).
- A `stale` row with `lastErrorMessage` has the message in the `title` attribute.
- A `lastOkAt: null` row renders "never" in the time-ago column.
- Demo mode → footnote *"Demo mode — no live providers in use."* is rendered.

### 7.6 `test/lib/observability/quote-poll-capture.test.ts`

- Mock `fetch` to fail 4 times → `Sentry.captureException` not called.
- Mock `fetch` to fail 5 times → `Sentry.captureException` called exactly once with `{ tags: { layer: "client-poll" } }`.
- A success after 4 failures resets the counter → next failure run does NOT capture until the 5th.

### 7.7 Existing test suite

All 588 existing tests stay green. The implementation plan's phase-end green-bar step runs the full suite.

---

## 8. File Plan

### New files

| Path | Purpose |
|---|---|
| `src/lib/observability/sentry.ts` | `initSentry()`, `beforeSend`, `beforeBreadcrumb`, `withOrgScope(orgId, fn)`. Single source of truth for Sentry config. |
| `src/lib/market/health.ts` | `getProviderStatus()` aggregator + `recordProviderResult(id, ok, err?)` + `PROVIDER_DISPLAY` map. |
| `src/components/dashboard/ProviderStatusPanel.tsx` | The new dashboard panel. |
| `src/instrumentation.ts` | Calls `initSentry()` server-side (Next 15 convention). |
| `src/instrumentation-client.ts` | Calls `initSentry()` client-side. |
| `test/lib/observability/sentry-init.test.ts` | §7.1. |
| `test/lib/observability/sentry-scrubber.test.ts` | §7.2. |
| `test/lib/observability/sentry-action-wrapper.test.ts` | §7.3. |
| `test/lib/observability/quote-poll-capture.test.ts` | §7.6. |
| `test/lib/market/health.test.ts` | §7.4. |
| `test/components/dashboard/ProviderStatusPanel.test.tsx` | §7.5. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `@sentry/nextjs` to `dependencies`. |
| `next.config.mjs` | Wrap export in `withSentryConfig`; add Sentry ingest host to `CONNECT_HOSTS` only when `SENTRY_DSN` is set. |
| `src/middleware.ts` | Wrap body in try/catch with `Sentry.captureException`. |
| `src/lib/market/router.ts` | `resolveQuotes` accepts an optional `onProviderResult` callback. |
| `src/lib/market/cache.ts` | `defaultQuoteFetcher` wires `onProviderResult` to `recordProviderResult`. |
| `src/lib/deals/actions.ts` | `run()` + `runWithUser()` catch blocks add one `Sentry.captureException` line (excluding `ForbiddenError`). |
| `src/lib/inventory/actions.ts` | Same: one line in the `run()` catch block. |
| `src/lib/diamonds/actions.ts` | Same. |
| `src/lib/website/actions.ts` | Same. |
| `src/lib/company/actions.ts` | Same. |
| `src/hooks/useQuotesPoll.ts` | Threshold-5 capture in the fetch tick. |
| `src/lib/layout/registry.tsx` | Add `provider-status` entry to `PANEL_REGISTRY`. |
| `DEPLOY.md` | Document `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` env vars (all optional; missing = no-op). |

### Deleted files

None.

---

## 9. Security & Threat Model

### 9.1 The tenancy invariant — no `orgId` leakage to Sentry

The single most load-bearing security invariant of slice 11. Enforced by:
- The `beforeSend` scrubber stripping `orgId` from breadcrumbs, extras, contexts.
- The `beforeBreadcrumb` scrubber stripping `orgId` from incoming breadcrumb data.
- The PR review grep checklist (§9.5).
- A unit test (§7.2) that documents the rule and catches future regressions.

`orgId` is permitted only in `event.tags`, set via `Sentry.withScope` in a server-only helper `withOrgScope`. Tags are visible only inside the Sentry workspace; they don't leave the operator's control plane.

### 9.2 The DSN secret

`SENTRY_DSN` is a public-ish secret — the DSN itself is exposed to the browser via `instrumentation-client.ts` (Sentry's standard architecture). The DSN authorizes events into a specific project, and an attacker with the DSN can spam the project. Sentry recommends rate-limiting at the project level inside their UI; we accept this as a known trade-off of using their SDK. No other secrets are exposed to the client.

`SENTRY_AUTH_TOKEN` is server-only and used only at build time for source map upload. Never sent to the browser.

### 9.3 Source map exposure

Source maps are uploaded to Sentry, not served from the dashboard. Next.js's default `productionBrowserSourceMaps: false` (the implicit default) means source maps are NOT served from the browser bundle. The `withSentryConfig` wrapper handles upload via webpack plugins at build time. Verify in the build output that no `.map` files land in `.next/static/chunks/`.

### 9.4 Demo-mode invariant

`isDemoMode()` gates every behavior in this slice:
- Sentry: `enabled: false` at init.
- Provider Status: all rows `simulated`, no live data surfaced.
- CSP: ingest host not added when `SENTRY_DSN` is absent (which it always is in demo).

The demo deploy has no DSN, no auth token, and no live providers. No external network traffic originates from the demo aside from the visitor's own browser fetching static assets and `/api/quotes`.

### 9.5 PR review grep checklist (slice 11 exit gate)

Before merge:
- `grep -rn "orgId" src/lib/observability/` → matches only inside the scrubber strip logic and the `withOrgScope` helper. No `setExtra`, no `addBreadcrumb`, no `setContext` call surfaces `orgId`.
- `grep -rn "Sentry.addBreadcrumb\|setExtra\|setContext" src/` → audited line-by-line; none contain `orgId`.
- `grep -rn "SENTRY_DSN\|SENTRY_AUTH_TOKEN\|SENTRY_ORG\|SENTRY_PROJECT" src/` → only in `src/lib/observability/sentry.ts` and `next.config.mjs`.
- `grep -rn "captureException" src/` → audited; every callsite either has a `tags: { layer: ... }` tag or is in test code. No anonymous captures.
- `grep -rn "ForbiddenError" src/` shows that none of the new `captureException` callsites precede a `ForbiddenError` rethrow without filtering it out first.
- All cross-org isolation tests (slice 3 + 4 + 10) pass — slice 11 is strictly additive instrumentation.
- All new slice 11 tests (§7) pass.
- `npm run build` and `npm test` green.

### 9.6 Audit logging — still an explicit gap

Slice 11 captures *bugs* (genuine thrown errors) to Sentry. It does NOT capture *attempted cross-org violations* (slice 3 §6.7 noted this gap). A `ForbiddenError` raised in `runWithUser` returns `{ok: false, error: "Forbidden"}` and is intentionally NOT sent to Sentry. A future slice should add a dedicated audit-log table or a separate Sentry layer for these — but that's a different signal (security audit, not bug telemetry), and conflating them would dilute the bug-triage value of Sentry. Documented as out-of-scope, named for a future slice.

### 9.7 CSP — narrow widening

The Content-Security-Policy's `connect-src` directive currently lists six external hosts (the live market providers). Sentry adds one more — the project-specific ingest subdomain. The widening is conditional on `SENTRY_DSN` being set at build time, so the demo build's CSP is unchanged. The implementation plan documents the exact host derivation.

---

## 10. Out of Scope (Explicit)

| Item | Home |
|---|---|
| Core Web Vitals reporting (LCP / INP / CLS) | Slice 12 "Web Vitals" — clean follow-on; reuses Sentry SDK as the breadcrumb sink. |
| Pixel polish on Mockup 1 | Slice 13 "Pixel Polish" — dedicated slice with its own tight spec. |
| Per-tenant error rate dashboards | Future slice; requires Sentry org/project setup + per-tenant filtering UX. |
| OpenTelemetry / distributed tracing | Future slice; Sentry's OTEL bridge keeps the door open. |
| Real-time SSE freshness push | Future; current polling model is sufficient for the dashboard cadence. |
| Per-page-level React error boundaries with custom UI | Future slice; Sentry's default global handler captures unhandled exceptions today. |
| Demo URL access controls | Not planned — the demo is public by design. |
| Custom error UI for production | Future. Today's behavior (Next.js default error page) is acceptable. |
| Anomaly alerting (PagerDuty, Slack hooks) | Future; configured inside Sentry workspace, not in the codebase. |
| Cost / billing metrics | Future. |
| Per-org performance budgets | Future; requires multi-tenant performance baselining. |
| Audit logging of cross-org access attempts | Slice 3 §6.7 gap; named as "tenancy audit logs" for a future slice. |
| Replacing `orgId` scope tag with an opaque hashed request-id | Future; documented in §9.1 as an evaluated trade-off. |

---

## Design summary table

| Concern | Choice |
|---|---|
| Cut from 4 candidates | (1) Sentry + (3) Provider Status panel. Defer (2) Web Vitals → slice 12, (4) Pixel polish → slice 13. |
| Telemetry backend | Sentry via `@sentry/nextjs`. Single vendor; defer OTEL. |
| Init seam | One `initSentry()` function called from `instrumentation.ts` + `instrumentation-client.ts`. |
| Capture points | Middleware try/catch, action `run()`/`runWithUser()` catch (excluding `ForbiddenError`), `useQuotesPoll` threshold-5 counter. |
| Tenancy safety | `beforeSend` + `beforeBreadcrumb` scrubbers strip `orgId` from breadcrumbs/extras/contexts. `orgId` allowed in `event.tags` only, via server-side `withOrgScope` helper. |
| Demo mode | `Sentry.init({ enabled: false })`; Provider Status panel shows all rows `simulated` with a footnote. |
| Missing DSN | SDK is a no-op (`enabled: false, dsn: undefined`). Never crashes. |
| Source map upload | `withSentryConfig` wrapper; skipped silently when `SENTRY_AUTH_TOKEN` is absent. |
| Provider Status data source | New `getProviderStatus()` aggregator; reads from an in-memory health map updated by `resolveQuotes` via an `onProviderResult` callback. |
| Provider Status tenanting | Platform-wide, NOT tenanted. Explicit exception to slice-3 rule, documented and grep-enforced. |
| Freshness ladder reuse | Same `computeFreshness` function as per-symbol dots. No new freshness primitive. |
| New deps | One: `@sentry/nextjs`. |
| New env vars | `SENTRY_DSN` (optional), `SENTRY_AUTH_TOKEN` (optional, build-time), `SENTRY_ORG` (optional), `SENTRY_PROJECT` (optional). All absent = no-op. |
| New input schemas with `orgId` | Zero. Slice-3 invariant preserved. |
| PR review grep gate | Six greps in §9.5; merge blocked until all pass. |
