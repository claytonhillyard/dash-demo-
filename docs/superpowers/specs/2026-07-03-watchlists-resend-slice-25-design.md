# iDesign Command Center — Slice 25: Watchlists + Email Alerts (Resend) — Design

**Date:** 2026-07-03
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 24/24b (`recordActivitySafely` — the dispatch chokepoint every instrumented action flows through), slice 32 (the seam pattern: real-vs-simulated, never-throw, PII-free Sentry), slice 22 (`run()` action wrapper + authz truth-table testing).

**Unlocks:** slice 28 (invoice email send reuses `sendEmail`), 33 (cash-runway alerts), 38 (Anomaly Sentinel alerting), 41 (investor updates).

---

## 1. Overview & Goals

Two halves shipped together because the second proves the first:

1. **Email seam** — `src/lib/email/sendEmail.ts`: the org-wide outbound-email entry point, Resend-backed via plain `fetch`, simulated no-op when demo/build/keyless. The infrastructure piece slices 28/33/38/41 reuse.
2. **Watchlists** — watch an entity, get an email when activity lands on it. Rides the `recordActivitySafely` chokepoint: all 21 instrumented handlers (slices 24/24b) dispatch alerts with zero per-action wiring.

**Recipient model (v1 honesty):** no users table exists; `session.user` is a username (`DASHBOARD_USER=boss`), not an email. Each watch therefore carries an explicit `notify_email`. When a real user model lands, watches migrate to it.

**Goals:**
- `sendEmail` seam: never-throw ok-union, `simulated` flag, `durationMs`, Sentry-tagged failures with **no recipient/body content ever**.
- `watchlists` table (migration `0018`) + watch/unwatch actions (slice-22 `run()` pattern, org-scoped, demo-guarded).
- `notifyWatchersSafely` hooked into `recordActivitySafely`: indexed lookup, 1-hour per-watch cooldown, 5-watcher cap per event, best-effort all the way down.
- `<WatchToggle>` on the customer edit page + `/watchlists` page + nav entry.
- `DEMO_WATCHLISTS` seed so the page renders in demo.
- `.env.example` gains `RESEND_API_KEY` + `EMAIL_FROM`.

## 2. Non-goals (named homes)

- **Digest/batching/quiet hours** — slice 38 (Sentinel owns notification intelligence; the cooldown is the v1 spam bound).
- **Deal/inventory/circle watch toggles** — slice 25b (the schema + dispatch support any whitelisted entity type from day one; only the customer surface ships now).
- **Org-level default email / users table** — future auth slice; `notify_email` per watch is the v1 contract.
- **Unsubscribe links / list-management headers** — when a second recipient type exists. v1 recipients are the operator's own addresses.
- **HTML email templates** — slice 28 (invoices need them); plain text for alerts.
- **Resend SDK dependency** — plain fetch mirrors the market-provider pattern; the seam contains any future swap.
- **Self-notification suppression** — single-user-per-org reality means the actor usually IS the watcher, and the email is the point (external channel). Notify regardless of actor.

## 3. Email seam — `src/lib/email/`

### 3.1 `types.ts`

```ts
export const EMAIL_FEATURES = ["watchlist-alert", "invoice", "runway-alert", "sentinel", "smoke-test"] as const;
export type EmailFeature = (typeof EMAIL_FEATURES)[number];

export type EmailErrorCode = "rate_limited" | "unavailable" | "error";

export type SendEmailInput = {
  to: string;            // single recipient, Zod .email() validated
  subject: string;       // 1..200 chars
  text: string;          // plain-text body, 1..10_000 chars
  feature: EmailFeature; // mandatory attribution tag (Sentry + future headers)
};

export type SendEmailResult =
  | { ok: true; simulated: boolean; durationMs: number }
  | { ok: false; error: EmailErrorCode; durationMs: number };
```

### 3.2 `sendEmail.ts`

Decision order at call time: `isDemoMode() || isBuildPhase() || !process.env.RESEND_API_KEY` → `{ ok: true, simulated: true, durationMs }` (no network). Else POST `https://api.resend.com/emails` with `{ from: process.env.EMAIL_FROM ?? "alerts@idesign.local", to, subject, text }`, `Authorization: Bearer <key>`, `cache: "no-store"`.

- Zod-validate input at the boundary; validation failure → `{ ok: false, error: "error" }` (never throw).
- HTTP mapping: 429 → `rate_limited`; 5xx → `unavailable`; other non-2xx → `error`. Network/fetch rejection → `error`.
- Sentry on failure: `withScope` tags `{ feature, statusCode?, durationMs }` — **never `to`, `subject`, or `text`**.
- Never throws; `durationMs` on every path.

## 4. Watchlists

### 4.1 Schema (migration `0018`)

```ts
watchlists
  id                serial PK
  org_id            int  NOT NULL FK → orgs(id) ON DELETE CASCADE
  actor             text NOT NULL                -- session.user who created the watch
  entity_type       text NOT NULL                -- whitelisted via ACTIVITY_ENTITY_TYPES
  entity_id         int  NOT NULL
  notify_email      text NOT NULL                -- explicit recipient (v1 recipient model)
  last_notified_at  timestamptz NULL             -- cooldown anchor
  created_at        timestamptz DEFAULT now() NOT NULL
```

- **Unique** `(org_id, actor, entity_type, entity_id)` → `watchlists_org_actor_entity_unique` — one watch per user per entity; re-watch updates the email instead of erroring (upsert in the action).
- **Index** `(org_id, entity_type, entity_id)` → `watchlists_org_entity_idx` — the notify-dispatch lookup path.
- `activity` whitelists extend (string unions, no migration): `ACTIVITY_ENTITY_TYPES` += `"watchlist"`; `ACTIVITY_VERBS` += `"watched"`, `"unwatched"`.

### 4.2 Actions — `src/lib/watchlists/actions.ts` (slice-22 `run()` pattern)

- `watchEntity(raw)` — Zod `{ entityType: z.enum(ACTIVITY_ENTITY_TYPES), entityId: int positive, notifyEmail: z.string().email().max(200) }`. UPSERT on the unique key (`onConflictDoUpdate` sets `notify_email`). Emits audit event (`entityType: "watchlist"`, `verb: "watched"`, summary `` `Watching ${entityType} #${entityId}` `` — no email address in the summary or payload).
- `unwatchEntity(raw)` — Zod `{ entityType, entityId }`. DELETE scoped `WHERE org_id AND actor AND entity_type AND entity_id`; idempotent (0 rows = still ok). Emits `verb: "unwatched"` only when a row was deleted.
- Org from session, never the wire. Demo mode blocked by `run()`'s existing guard.

### 4.3 Queries — `src/lib/watchlists/queries.ts`

- `getWatchlistsForActor(db, orgId, actor)` — the `/watchlists` page list, newest first.
- `getWatchForEntity(db, orgId, actor, entityType, entityId)` — drives the toggle's initial state.
- Demo branch: filter `DEMO_WATCHLISTS` (2 seeded entries on customers 2201/2204, `notify_email: "owner@aiya.demo"`).

## 5. Alert dispatch — `src/lib/watchlists/notify.ts`

```ts
export const WATCH_COOLDOWN_MS = 60 * 60 * 1000;  // 1 hour per watch
export const WATCH_NOTIFY_CAP = 5;                // max watchers emailed per event

export async function notifyWatchersSafely(db: Db, event: RecordActivityInput, now?: Date): Promise<void>;
```

Semantics:
1. Skip immediately when `event.entityId === null` or `isDemoMode()`.
2. One indexed SELECT of watches matching `(orgId, entityType, entityId)` where `last_notified_at IS NULL OR last_notified_at < now - 1h`, LIMIT 5 (`WATCH_NOTIFY_CAP`).
3. For each: `sendEmail({ to: watch.notifyEmail, subject, text, feature: "watchlist-alert" })` with content from pure `buildAlertEmail(event, now)` → `{ subject: "[iDesign] Activity: <summary>", text: summary + actor + relative path to the entity }`. Path map: customer → `/customers/<id>/edit`, deal → `/deals`, else `/activity`.
4. On `ok: true && !simulated` → `UPDATE watchlists SET last_notified_at = now` for that watch (simulated sends do NOT consume the cooldown — otherwise demo/keyless environments would silently burn it).
5. Everything wrapped: any failure Sentry-tagged (`feature: "watchlist-alert"`, `subStep: "notifyWatchers"`, no addresses/content) and swallowed. **This function can never throw.**

**Hook site:** inside `recordActivitySafely`, after a successful `recordActivity(...)`, add `await notifyWatchersSafely(db, input);` — inside the existing try/catch, so even a bug in notify falls into the existing swallow. Latency story: the no-watcher common case is one indexed SELECT (~1ms); with a due watcher it's ≤5 Resend POSTs (~100-300ms each) on that single action — acceptable v1, batching is slice 38's job.

**Import-cycle check:** `activity/recordActivitySafely` → `watchlists/notify` → `email/sendEmail` + `db/schema`. `watchlists/actions` → `activity/recordActivitySafely` (for audit) — no module imports back into `watchlists/actions`. Acyclic.

## 6. Surfaces

- **`<WatchToggle>`** (`src/components/watchlists/WatchToggle.tsx`, client): unwatched → email input (prefilled `""`, placeholder `you@example.com`) + "Watch" button; watched → "Watching — Unwatch" button. `useTransition` + inline error, mirroring `CustomerForm`'s action-call conventions. Server passes initial state.
- **Customer edit page**: toggle sits in the Health/Activity column, above the Activity section, fed by `getWatchForEntity`.
- **`/watchlists` page** (RSC, force-dynamic, `/customers`-page structure): table of watches (entity link, notify email, created, last notified) + per-row Unwatch (small client component reusing `unwatchEntity`). Empty state text. Nav: "Watchlists" between "Activity" and "Clients & CRM" (SECTIONS + ROUTES).
- Demo: page renders `DEMO_WATCHLISTS`; toggles return the demo-mode error via `run()`.

## 7. Test plan

- `test/lib/email/sendEmail.test.ts` — mocked `globalThis.fetch`: no-key → simulated + fetch never called; demo → simulated; live 200 → ok/simulated:false; 429 → rate_limited; 500 → unavailable; fetch rejection → error; Zod-invalid `to` → error without fetch; Sentry tags on failure contain feature+status but NOT the recipient string; durationMs ≥ 0 all paths; never throws.
- `test/db/watchlists-migration-smoke.test.ts` — 0018 columns/nullability, FK cascade, unique constraint (second insert violates), index names.
- `test/lib/watchlists/actions.test.ts` — truth table: watch happy path (row + audit event, email absent from audit payload); re-watch upserts email (no unique violation); cross-org isolation (wire-spoofed org ignored); unwatch happy + idempotent no-op (no audit event on no-op); invalid email rejected; demo blocked.
- `test/lib/watchlists/notify.test.ts` (sendEmail mocked) — no watchers → no send; match → send with correct to/subject/feature; cooldown: recently-notified watch skipped, NULL/stale notified; live send updates `last_notified_at`, simulated send does NOT; cap: 6 watchers → 5 sends; sendEmail returning ok:false → no cooldown update, no throw; sendEmail mock throwing → swallowed (audit path unaffected — asserted via a customers-action integration case).
- `test/lib/watchlists/buildAlertEmail.test.ts` — subject/text shape, entity path mapping, determinism.
- `test/components/watchlists/WatchToggle.test.tsx` — unwatched/watched renders, action called with the typed email.
- `test/app/watchlists-page.test.tsx` — demo harness: 2 seeded rows render.
- Extend `test/lib/activity/recordActivitySafely.test.ts` — notify failure does not break the audit contract.

## 8. Decisions

- Recipient = per-watch `notify_email` — the only honest option without a users table; audit events for watches never include the address (PII discipline: addresses live in the watchlists table only).
- Simulated sends don't consume cooldown — keyless environments must not silently burn notification windows.
- Cap + cooldown are constants, not per-tenant settings — slice 38 owns notification tuning.
- `notifyWatchersSafely` inside `recordActivitySafely`'s try/catch — double-swallowed by design; the audit contract ("never blocks business operation") extends transitively to notifications.
