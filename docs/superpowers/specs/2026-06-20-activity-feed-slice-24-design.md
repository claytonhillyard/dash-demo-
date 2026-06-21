# iDesign Command Center — Slice 24: Activity Feed (audit log) — Design

**Date:** 2026-06-20
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 22 (Customers — first instrumentation target), slice 11 (Sentry `runWithUser` pattern — events emitted *inside* the wrapper), slice 3 (multi-tenant invariant — every row org-scoped, every read explicit-`orgId`).

**Unlocks:** slice 36 (Customer Health Score reads activity), slice 38 (Anomaly Sentinel watches activity), per-tenant compliance / "what changed when" answers, per-customer audit tab (slice 24c UI).

---

## 1. Overview & Goals

Every modern SMB CEO needs to answer "who touched this and when". Today the codebase has Sentry breadcrumbs for errors and Web Vitals for performance — but no first-class story for *successful* business mutations. Slice 24 introduces an append-only per-org event log that captures every write across the platform, plus the helpers to emit and query it.

The slice is intentionally scoped to **schema + helpers + first instrumentation target (customers)**. Subsequent slices (24b: instrument deals/circles/inventory/bids; 24c: ActivityPanel + `/activity` route + per-customer activity tab) consume this primitive.

**Goals (Phase A + B, in scope for this slice):**

- New `activity_events` table with the schema in §3.
- Three helpers in `src/db/activityEvents.ts`: `recordActivity`, `getOrgActivity`, `getEntityActivity`. SQL-enforced `org_id = $viewerOrgId` predicate on every read.
- Zod-checked event input at the helper boundary (verb whitelist, summary length, payload size cap).
- Append-only API surface — no `updateActivity` / `deleteActivity` exported.
- Customers actions (`createCustomer`, `updateCustomer`, `deleteCustomer`) emit events inside `runWithUser` on success; emit failure swallowed + tagged in Sentry, never blocks the action.
- Demo seed extended with `DEMO_ACTIVITY` (10 events on `DEMO_ORG_ID`).
- Tests: migration smoke, cross-org isolation on both readers, ordering DESC, keyset pagination via `beforeId`, entityTypes filter, limit clamp at 200, payload-size cap, summary cap, customer actions emit-on-success, customer actions still-ok-when-recordActivity-throws.

## 2. Non-goals (each has a named home)

- **Real-time push / WebSocket / SSE.** Slice 52 (streaming layer).
- **Diff visualization / pretty-printed change rendering.** Slice 24 stores enough `payload` to compute a diff; rendering is polish, a slice 24c (UI) concern.
- **Audit-grade WORM immutability beyond append-only-by-convention.** Slice 48 (Provenance / compliance ledger) is the home for Postgres-level WORM via revoked UPDATE/DELETE grants + trigger enforcement. Slice 24's "append-only" is enforced at the application boundary (no helper exists for UPDATE / DELETE) — good enough for "what happened", insufficient for legal evidence.
- **Cross-org event sharing.** Circles (slice 4) handle cross-org content; the audit log is strictly per-org and never leaks across orgs.
- **Full-text / search over events.** Pagination + entity-type filter only in this slice. Full-text is a follow-up if volume + product demand justify the index cost.
- **Retention / pruning / TTL.** Audit grows. Pruning policy is a slice 38 (Anomaly Sentinel) concern — sentinel needs historical depth, so trim policy ships when sentinel ships.
- **Instrumentation of every other action file (deals, circles, inventory, bids).** Slice 24b. This slice ships the customers instrumentation only to prove the pattern end-to-end and give 24b a copy-paste template.
- **`<ActivityPanel>` right-rail component / `/activity` route / per-customer Activity tab.** Slice 24c. No UI in this slice.

## 3. Schema

### 3.1 `activity_events` (new, migration `0017`)

```ts
activity_events
  id              serial PK
  org_id          int    NOT NULL  FK → orgs(id)                 -- slice-3 invariant
  actor           text   NULL                                     -- session.user label ('aiya@idesign.com', ...); NULL = system event (seed, cron, import)
  entity_type     text   NOT NULL                                 -- whitelisted at helper boundary
  entity_id       int    NULL                                     -- nullable: some events have no entity (e.g. session events)
  verb            text   NOT NULL                                 -- whitelisted at helper boundary
  summary         text   NOT NULL                                 -- 1..240 chars, human one-liner
  payload         jsonb  NULL                                     -- ≤ 4 KB serialized (cap enforced before INSERT)
  created_at      timestamptz NOT NULL DEFAULT now()
```

**Indexes:**

- `(org_id, created_at DESC, id DESC)` → `activity_events_org_created_idx`
  - Composite includes `id DESC` as tiebreak so keyset pagination (`beforeId`) is deterministic when multiple events share a `created_at` (system seed, batch import).
- `(org_id, entity_type, entity_id, created_at DESC, id DESC)` → `activity_events_org_entity_idx`
  - Drives `getEntityActivity` per-entity drill-down.

**No FK on `entity_id`.** Entities (customers, deals, inventory items) can be deleted while their audit rows must survive. Defended-in-depth via the `org_id` FK alone — orphan rows from a deleted entity are intentional behavior, not a bug.

**No FK on `actor`.** No `users` table exists yet in this codebase — `session.user` is a string identifier (email-shaped) carried in the JWT, not an FK. When the multi-user-per-tenant slice introduces a `users` table (likely slice 30+), the migration will add `actor_user_id int FK → users(id)` alongside `actor` and backfill via the email match. Until then, `actor: text` is the right shape.

**No UPDATE / DELETE helpers exported.** The append-only guarantee is enforced by the helper API surface, not by a Postgres trigger. A reviewer (or a future contributor) who tries to call `db.update(activityEvents)` directly is bypassing the contract, the same way they'd be bypassing tenancy if they called `db.select().from(customers)` without an `eq(orgId, ...)` predicate.

### 3.2 String unions (no DB enum)

`entity_type` and `verb` are **text columns**, not Postgres enums. New event types appear during normal development (slice 25 adds `watchlist`, slice 27 adds `invoice`, slice 29 adds `payment`); a string column avoids one migration per addition. The whitelist lives in TS and is Zod-checked at `recordActivity`:

```ts
export const ACTIVITY_ENTITY_TYPES = [
  "customer", "deal", "inventory_item", "attachment", "circle", "bid", "org",
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

export const ACTIVITY_VERBS = [
  "created", "updated", "deleted", "archived", "restored",
  "invited", "joined", "left",
  "bid_placed", "bid_accepted", "bid_rejected", "bid_withdrawn",
  "commented", "comment_deleted",
  "viewed",  // reserved for future "X viewed your inventory" (slice 38 signal)
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];
```

Slice 24b/24c/25/27 etc. extend these arrays as they add events. New entries don't need a migration.

## 4. Helpers — `src/db/activityEvents.ts` (new)

### 4.1 Write — `recordActivity`

```ts
export async function recordActivity(db: Db, input: {
  orgId: number;
  actor: string | null;
  entityType: ActivityEntityType;
  entityId: number | null;
  verb: ActivityVerb;
  summary: string;                       // 1..240 chars
  payload?: Record<string, unknown>;     // ≤ 4 KB serialized
}): Promise<void>;
```

Validates input against a Zod schema at the boundary (whitelist check on entityType + verb, length check on summary, JSON.stringify size check on payload). Returns `void`; the caller doesn't need the event id.

**Failure mode.** `recordActivity` throws on ANY failure — validation error (wrong verb, oversized payload) OR DB error. It does no Sentry tagging itself. Catching + Sentry tagging + swallowing happens in `recordActivitySafely` (§5), the wrapper that action sites are required to use. This keeps the raw helper trivial to unit-test (one promise → throws or resolves; nothing else).

### 4.2 Read — `getOrgActivity`

```ts
export async function getOrgActivity(db: Db, viewerOrgId: number, opts?: {
  limit?: number;                                // default 50, max 200
  beforeId?: number;                             // keyset pagination cursor
  entityTypes?: readonly ActivityEntityType[];   // optional filter
}): Promise<ActivityEvent[]>;
```

- `WHERE org_id = $viewerOrgId` SQL-enforced (slice-3 invariant)
- Optional `AND entity_type = ANY($entityTypes)` when filter provided
- Optional `AND id < $beforeId` for keyset pagination — caller passes the smallest `id` from the prior page
- `ORDER BY created_at DESC, id DESC LIMIT $limit`
- Returns full `ActivityEvent` rows (includes parsed `payload`)

### 4.3 Read — `getEntityActivity`

```ts
export async function getEntityActivity(
  db: Db,
  viewerOrgId: number,
  entityType: ActivityEntityType,
  entityId: number,
  opts?: { limit?: number; beforeId?: number },
): Promise<ActivityEvent[]>;
```

Same shape as `getOrgActivity` but additionally `AND entity_type = $entityType AND entity_id = $entityId`. Drives the per-customer activity tab in slice 24c.

## 5. Action instrumentation pattern (Phase B)

Action sites call `recordActivitySafely(db, input, { action: "<action-tag>" })` — never the raw `recordActivity(...)`. The Safely wrapper is the catch-and-swallow layer; it uses the existing `withOrgScope` helper from `src/lib/observability/sentry.ts` to tag the captured exception with `orgId`, then `Sentry.withScope` to add an `action` sub-tag (matching the convention slice 22 established with `safeErrShape` + `run({ action })`).

```ts
// src/db/activityEvents.ts (new helper)
import * as Sentry from "@sentry/nextjs";
import { withOrgScope } from "@/lib/observability/sentry";

export async function recordActivitySafely(
  db: Db,
  input: RecordActivityInput,
  ctx: { action: string },
): Promise<void> {
  try {
    await recordActivity(db, input);
  } catch (e) {
    withOrgScope(input.orgId, () => {
      Sentry.withScope((scope) => {
        scope.setTag("action", ctx.action);
        scope.setTag("subStep", "recordActivity");
        Sentry.captureException(e);
      });
    });
    // Audit is best-effort. Swallow.
  }
}
```

And then in an action site (called from inside `runWithUser`, AFTER the mutation succeeds):

```ts
// src/lib/customers/actions.ts (excerpt — Phase B addition)
return run({ action: "customers.create" }, async (session) => {
  const [row] = await db.insert(customers).values(parsed.data).returning();

  await recordActivitySafely(
    db,
    {
      orgId: session.orgId,
      actor: session.user,
      entityType: "customer",
      entityId: row.id,
      verb: "created",
      summary: `Added ${row.name}`,
      payload: { name: row.name, businessName: row.businessName ?? null, email: row.email ?? null },
    },
    { action: "customers.create" },
  );

  return { ok: true, id: row.id };
});
```

Why action sites always reach for `recordActivitySafely` instead of `recordActivity`: it makes the "best-effort, never blocks business operation" guarantee enforceable by code review. If a reviewer sees `await recordActivity(...)` in an action handler, it's almost certainly a bug.

### 5.1 Summary phrasing

The `summary` is rendered as-is in the eventual UI. Phrasing convention (so the eventual list reads consistently):

- `created` → "Added {name}" (NOT "Created customer X")
- `updated` → "Updated {name}" or "Updated {name}: {fieldList}" if payload includes a `changedFields` array
- `deleted` → "Deleted {name}"
- `bid_placed` → "Placed bid on {dealTitle}"
- etc.

Don't include the entity type word — the UI groups by entity type and inserts it where needed.

### 5.2 PII in summary / payload

`summary` and `payload` may contain customer names, business names, emails (in `payload`). This is the same PII surface as the customers table itself — already tenant-scoped via `org_id`. Sentry breadcrumbs from this slice still go through `safeErrShape` (slice 22 pattern). No new PII concern beyond what slice 22 already addressed.

## 6. Phasing (what ships when)

| Phase | Scope | Slice |
|---|---|---|
| **A** | Schema + migration 0017 + helpers (`recordActivity`, `recordActivitySafely`, `getOrgActivity`, `getEntityActivity`) + demo seed + DB tests | **24** (this) |
| **B** | Instrument `src/lib/customers/actions.ts` to emit events on create/update/delete | **24** (this) |
| **C** | Instrument the other actions files (`deals/actions.ts`, `circles/actions.ts`, `inventory/actions.ts`, bid actions) + build `<ActivityPanel>` right-rail + `/activity` route + per-customer Activity tab on `/customers/[id]/edit` | **24b** (follow-up slice, claim separately) |

This slice = Phase A + Phase B. Phase C is a clean follow-up slice 24b.

## 7. Test plan (Phase A + B)

**Phase A — DB + helpers:**

- `test/db/activity-events-migration-smoke.test.ts`
  - Migration 0017 round-trip: applies, table exists, indexes named correctly
  - FK on `org_id` rejects rows with non-existent org
  - No FK on `entity_id` (entity-orphan rows accepted)
  - Default `created_at` populates

- `test/db/activityEvents.test.ts` (read helpers)
  - `getOrgActivity` cross-org isolation: org A's reader never sees org B's events
  - `getOrgActivity` ordering DESC by `created_at, id`
  - `getOrgActivity` `entityTypes` filter
  - `getOrgActivity` keyset pagination: page 2 via `beforeId` never overlaps page 1
  - `getOrgActivity` `limit` clamps at 200 even when caller asks for 500
  - `getEntityActivity` cross-org isolation
  - `getEntityActivity` only returns events matching both entityType AND entityId

- `test/lib/activity/recordActivity.test.ts`
  - Whitelist rejection: invalid `entityType` → throws
  - Whitelist rejection: invalid `verb` → throws
  - `summary` length cap: 241 chars → throws
  - `summary` length cap: empty string → throws
  - `payload` size cap: > 4 KB serialized → throws
  - Null `actor` accepted (system event path)
  - Null `entityId` accepted (entity-less event)
  - Successful insert returns `void` and row is queryable

- `test/lib/activity/recordActivitySafely.test.ts`
  - Wraps `recordActivity`: if underlying throws, swallows + tags Sentry via mock
  - On success, no Sentry tag emitted

**Phase B — customers instrumentation:**

- Extend `test/lib/customers/actions.test.ts` (do NOT add a new file — keep the truth-table together):
  - `createCustomer` success → one new `activity_events` row with `verb='created'`, correct `summary`, correct payload keys
  - `updateCustomer` success → one new row with `verb='updated'`, payload includes `changedFields`
  - `deleteCustomer` success → one new row with `verb='deleted'`, summary references the deleted customer's name (captured before delete)
  - `createCustomer` with mocked `recordActivitySafely` that throws → action still returns `{ ok: true, id }` (verifies best-effort guarantee)
  - Cross-org defense: a 0-row update still returns `ForbiddenError` AND emits zero activity rows

- Extend `test/lib/demo/seed.test.ts`:
  - `DEMO_ACTIVITY` has 10 entries, all bound to `DEMO_ORG_ID`, all `entityType='customer'`, all reference real `DEMO_CUSTOMERS` ids

## 8. Demo seed (Phase A)

`DEMO_ACTIVITY` extends `src/lib/demo/seed.ts` with 10 events on `DEMO_ORG_ID = 1`. All `entityType = "customer"`, mix of `created` (7), `updated` (2), `deleted` (1, against a synthetic "removed" id) verbs. `created_at` staggers 2 hours apart over the past 24 h so the eventual ActivityPanel renders a realistic timeline.

In demo mode (`isDemoMode() === true`), `getOrgActivity(db, 1, ...)` short-circuits to filter `DEMO_ACTIVITY` (same pattern as `getCustomers` and `getInventoryItems`). `getEntityActivity` filters `DEMO_ACTIVITY` by entity. `recordActivitySafely` is a no-op in demo mode (the demo seed is the source of truth; live writes would corrupt the demo narrative).

## 9. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Every action now does 2× writes (mutation + activity). | Activity write is best-effort + cheap (one row INSERT, no triggers). Latency impact ≤ 1 ms on pglite, ≤ ~10 ms on Neon. Acceptable given the audit value. |
| `payload` grows unbounded as we add fields. | 4 KB cap enforced at helper boundary; throws on overflow before INSERT. |
| Audit table grows fast (every CRUD). | Acknowledged. Retention/pruning policy is slice 38 (Sentinel) responsibility — Sentinel needs historical depth anyway. |
| Append-only enforcement is convention, not DB-level. | Acknowledged. Slice 48 (Provenance ledger) escalates to Postgres-level WORM. Until then, code review + linting catches bypass attempts. |
| Demo mode silently swallowing `recordActivitySafely` could hide bugs in test. | Tests explicitly run with `isDemoMode() === false` (override via env in test setup) so the real write path is exercised. |

## 10. Decisions made (no open questions)

- `actor: text NULL` (string from `session.user`) over `actor_user_id int FK → users(id)` (would require a `users` table that doesn't exist yet). When the users table lands (≥ slice 30), migrate to `actor_user_id` alongside.
- `verb` is text-column-with-whitelist rather than Postgres enum — easier to extend.
- Keyset pagination via `beforeId`, not OFFSET — predictable performance on a growing table.
- No `metadata` blob beyond `payload` — one JSONB column is enough; nesting two becomes confusing.
- `getOrgActivity` returns full rows (including `payload`) rather than a slim shape — callers like the per-customer Activity tab need the payload to render diffs. The overhead is small (≤ 4 KB JSON per row) and the alternative (a slim list + per-row detail fetch) adds N+1 query risk.
