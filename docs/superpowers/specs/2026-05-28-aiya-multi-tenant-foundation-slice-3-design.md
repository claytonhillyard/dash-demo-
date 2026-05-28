# AIYA Dashboard — Slice 3: Multi-Tenant Foundation — Design

**Date:** 2026-05-28
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market), #1a (AIYA dashboard + reskin), #2 (company data), #1b-1 (inventory), #1b-3 (diamond price lists), #1c (customizable layout), demo (Netlify simulation mode), slice 2 (Deal Room), and the three slice 2 hardening passes (keyboard reorder test, build-time fetch resilience, HTTP security headers) — all shipped on `main`.

---

## 1. Overview & Goals

Turn the single-org AIYA dashboard into a true multi-tenant platform — the seam every prior business table already telegraphs (`org_id integer NOT NULL default 1`). This slice replaces the `AIYA_ORG_ID = 1` constant with a real `orgs` table and a per-session `getCurrentOrgId()` async resolver that reads the org id off the signed JWT. The cut is deliberately tight: data model + auth seam + mechanical refactor + cross-org isolation tests. No `users` table, no admin UI for creating orgs, no per-user RBAC, no Circles, no login picker. Every existing business action and query keeps its current shape and behavior — only the source of its `orgId` changes from a module-level constant to an async per-request lookup.

**Goals:**

- New `orgs` table (Drizzle `pgTable`: id, name, slug unique, createdAt). Seeded with AIYA at `id=1, slug='aiya'` so every existing row with `org_id=1` is referentially valid the moment the FK lands.
- Add FK constraints from every existing tenanted table (`inventory_items`, `diamond_matrix_prices`, `diamond_price_points`, `diamond_index_history`, `deals`) to `orgs.id`. Backfill is a no-op (every existing row already has `org_id=1`, AIYA is seeded as `id=1`).
- `getCurrentOrgId(): Promise<number>` helper at `src/lib/auth/getCurrentOrgId.ts` — single async seam. In demo mode → AIYA's seeded id. Otherwise → JWT `orgId` claim.
- Extend the JWT payload from `{ user }` to `{ user, orgId }`. `createSession` accepts an `orgId`; `verifySession` returns `{ user, orgId }`. `requireSession()` returns `{ user, orgId }`.
- Login API hardcodes `orgId: 1` for now (single-org login). A future slice adds the picker.
- Mechanical refactor: every callsite that imports `AIYA_ORG_ID` becomes `await getCurrentOrgId()` (server contexts) or accepts `orgId` as a typed prop (RSC → client). The `currentOrgId()` sync helper at `src/db/org.ts` is removed; `AIYA_ORG_ID` is removed.
- Tenancy enforcement: every write (`insert/update/delete`) and every read carries `eq(table.orgId, currentOrgId) AND ...` in the WHERE clause. Audited in PR review.
- **Cross-org isolation tests** for inventory, diamonds (matrix + price points + index history), and deals. Each test inserts rows under `orgId=1` and `orgId=999`, queries scoped to `orgId=1`, and asserts zero `orgId=999` rows leak through. This is the security gate for the slice.
- Demo mode keeps short-circuiting to seed data — `getCurrentOrgId()` returns AIYA's id, no DB writes, no DB-backed second org.

**Non-Goals for Slice 3** (each has a named home — see §10):

`users` table, per-user RBAC, org creation UI, multi-org login picker, Circles / cross-org Deal Room visibility, invitations, admin onboarding, audit logging of cross-org access attempts, JWT refresh / rotation, full DataDog-style observability for tenancy events.

---

## 2. Data Model

### 2.1 New table: `orgs`

```typescript
// src/db/schema.ts (append below the existing tables)
export const orgs = pgTable(
  "orgs",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUniq: unique("orgs_slug_uniq").on(t.slug),
  })
);
```

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | Matches the existing `org_id integer` foreign key shape everywhere. |
| `name` | text NOT NULL | Human display name, e.g. "AIYA Designs". |
| `slug` | text NOT NULL UNIQUE | URL-safe handle, e.g. `"aiya"`. Used by future login routes; unique for safety. |
| `created_at` | timestamptz default now NOT NULL | |

**Rationale for excluding `updated_at` here:** orgs are nearly immutable for this slice — no UI to rename them. The column is cheap to add later in a one-line migration if any flow needs it. Mirrors the minimalist `projection_assumptions` style choice (we kept `updated_at` there only because the assumptions are edited regularly).

### 2.2 Foreign-key constraints

Every existing tenanted table gets an FK constraint from `org_id` to `orgs.id`. This is additive — no schema reshape, no column rename, no data backfill needed:

```sql
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_org_id_fk
  FOREIGN KEY (org_id) REFERENCES orgs(id);

ALTER TABLE diamond_matrix_prices
  ADD CONSTRAINT diamond_matrix_prices_org_id_fk
  FOREIGN KEY (org_id) REFERENCES orgs(id);

ALTER TABLE diamond_price_points
  ADD CONSTRAINT diamond_price_points_org_id_fk
  FOREIGN KEY (org_id) REFERENCES orgs(id);

ALTER TABLE diamond_index_history
  ADD CONSTRAINT diamond_index_history_org_id_fk
  FOREIGN KEY (org_id) REFERENCES orgs(id);

ALTER TABLE deals
  ADD CONSTRAINT deals_org_id_fk
  FOREIGN KEY (org_id) REFERENCES orgs(id);
```

Drizzle generates these via `.references(() => orgs.id)` on each existing `orgId` column definition:

```typescript
// every tenanted table's orgId becomes:
orgId: integer("org_id").notNull().default(1).references(() => orgs.id),
```

The `default(1)` stays — it's the back-compat path for any direct `INSERT` that omits `org_id` (mostly fixture / test paths). With AIYA seeded as `id=1`, the default is referentially valid.

**`ON DELETE` policy:** intentionally omitted (defaults to `NO ACTION`). Deleting an org with live tenanted data must fail loudly — there is no UI to delete an org in this slice, and a future slice that supports it must explicitly choose `CASCADE` vs. soft-delete. The default surfaces the issue at the DB level if anyone tries.

**No `users` column:** explicitly out of scope. Auth stays single-shared-credential per org. The path forward is a separate `users` table with `(orgId, userId)` membership rows; not this slice.

### 2.3 Seeding AIYA as `id=1`

The migration's last step inserts the AIYA row idempotently:

```sql
INSERT INTO orgs (id, name, slug)
VALUES (1, 'AIYA Designs', 'aiya')
ON CONFLICT (id) DO NOTHING;

-- bump the sequence past the seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('orgs', 'id'), GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM orgs)));
```

This must be in the same migration file as the `CREATE TABLE` so the FK constraints land in a state where every existing row's `org_id=1` is referentially valid in one atomic apply. If the seed lived in a later migration, the FK `ALTER TABLE` would fail mid-migration on prod (Neon) the moment it runs.

### 2.4 Migration

One generated file, `drizzle/0004_*.sql`, containing in this order:

1. `CREATE TABLE orgs ...` + unique index on `slug`.
2. The idempotent `INSERT INTO orgs (id=1, …)` + `setval` for AIYA — **hand-appended** between the CREATE TABLE and the ALTER TABLE blocks. **Do not regenerate via `npm run db:generate` after the manual edit lands.** This rule is documented at the top of `0004_*.sql` as an SQL comment.
3. Five `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY (org_id) REFERENCES orgs(id)` statements.

Drizzle Kit generates 1 + 3 automatically from the schema diff; step 2 is appended by hand (Drizzle Kit doesn't synthesize seed data). The migration commit must include the inspected `.sql` file with the manual block added — same workflow as the existing custom `down`-step-free migrations in this repo.

Rollback: `DROP TABLE orgs CASCADE` removes the table and every FK in one statement. Tenanted-table data is untouched. Safe even on prod, modulo lost org names.

---

## 3. Auth Layer

### 3.1 JWT payload shape

**Before (today):**
```typescript
// src/lib/auth/session.ts — current
{ user: string }
```

**After (this slice):**
```typescript
// src/lib/auth/session.ts — slice 3
{ user: string; orgId: number }
```

`orgId` is part of the signed payload — tampering produces a verification failure (jose's HS256 check), not a silent org switch. This is the single threat-model upgrade this slice ships.

### 3.2 `createSession` + `verifySession`

```typescript
// src/lib/auth/session.ts
import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const enc = (s: string) => new TextEncoder().encode(s);

export interface SessionPayload {
  user: string;
  orgId: number;
}

export async function createSession(
  user: string,
  orgId: number,
  secret: string,
): Promise<string> {
  return new SignJWT({ user, orgId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(enc(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, enc(secret), { algorithms: [ALG] });
    if (typeof payload.user !== "string") return null;
    if (typeof payload.orgId !== "number" || !Number.isInteger(payload.orgId) || payload.orgId < 1) {
      return null;
    }
    return { user: payload.user, orgId: payload.orgId };
  } catch {
    return null;
  }
}
```

**Defensive validation on read** — even though `orgId` is signed, `verifySession` re-checks that it's a positive integer. A malformed token (e.g. someone forgot to pass `orgId` to `createSession` in a future slice) returns `null` instead of silently producing `orgId = undefined as number`. This is cheap insurance.

**Back-compat for already-issued sessions:** there are no long-lived sessions in production — JWTs expire after 12h, and the slice ships behind a deploy that issues new tokens on next login. No JWT rotation logic required this slice. The implementation plan must include "log all users out by changing `SESSION_SECRET` on deploy" as a documented step — a stale token issued before slice 3 lacks `orgId` and `verifySession` returns `null`, redirecting to `/login`.

### 3.3 `requireSession()`

```typescript
// src/lib/auth/requireSession.ts
import { cookies } from "next/headers";
import { verifySession, type SessionPayload } from "./session";

export async function requireSession(): Promise<SessionPayload> {
  const token = (await cookies()).get("ccc_session")?.value;
  const session = token ? await verifySession(token, process.env.SESSION_SECRET!) : null;
  if (!session) throw new Error("Unauthorized");
  return session;
}
```

Signature change: returns `{ user, orgId }` instead of `{ user }`. Every existing caller that destructures `session.user` keeps working; new callers can additionally read `session.orgId`.

### 3.4 `getCurrentOrgId()` — the new seam

```typescript
// src/lib/auth/getCurrentOrgId.ts
import { isDemoMode } from "@/lib/demo/mode";
import { requireSession } from "./requireSession";

export const DEMO_ORG_ID = 1; // AIYA's seeded id, fixed across deploys

/**
 * Single source of truth for "which org is the caller acting on". Async because
 * it reads cookies + verifies the JWT. Throws "Unauthorized" if no valid session.
 * In demo mode short-circuits to AIYA's seeded id — same constant the seed uses.
 */
export async function getCurrentOrgId(): Promise<number> {
  if (isDemoMode()) return DEMO_ORG_ID;
  const session = await requireSession();
  return session.orgId;
}
```

**Why not return a sentinel for missing session?** Because every callsite is inside `run()` (the action wrapper) or behind the middleware (RSC pages) — both already gate on auth. Throwing here matches the existing `requireSession()` contract; the wrapping `try { ... } catch { return Unauthorized }` in `run()` covers it cleanly. The middleware redirects unauthenticated RSC requests to `/login` before any RSC page can call `getCurrentOrgId()`.

**Why async?** Resolving the cookie + verifying the JWT both require `await`. Sync `currentOrgId()` (the old shim at `src/db/org.ts`) is removed — it was always a lie about being multi-tenant-ready, and propagating async at the seam now is the right time, while there are still few callsites.

### 3.5 Login API

```typescript
// src/app/api/login/route.ts (modified)
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";

const AIYA_ORG_ID = 1; // hardcoded for slice 3; replaced by user→org lookup in users-slice

export async function POST(req: Request) {
  const { user, password } = await req.json();
  if (user !== process.env.DASHBOARD_USER || password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const token = await createSession(user, AIYA_ORG_ID, process.env.SESSION_SECRET!);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ccc_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
```

The local `AIYA_ORG_ID = 1` constant inside the login route is intentional and documented — it is the **one place** that knows "the shared dashboard credential maps to org 1" for this slice. The users-table slice replaces this with a real `SELECT orgId FROM users WHERE email = $1` lookup; nothing else in the codebase needs to change at that point.

`/api/logout` does not need to change — it just deletes the cookie.

---

## 4. Refactor Plan

### 4.1 Files that import `AIYA_ORG_ID` today

Exhaustive grep result from `src/`:

| File | Use |
|---|---|
| `src/app/page.tsx` | `getActiveDeals(db, AIYA_ORG_ID, 5)` |
| `src/app/(admin)/diamonds/page.tsx` | `where(eq(diamondPricePoints.orgId, AIYA_ORG_ID))` |
| `src/app/(admin)/deals/page.tsx` | `getAllDeals(db, AIYA_ORG_ID, filters)` |
| `src/lib/inventory/actions.ts` | `orgId: AIYA_ORG_ID` on insert + value builder |
| `src/lib/deals/queries.ts` | default param `orgId: number = AIYA_ORG_ID` |
| `src/lib/diamonds/actions.ts` | many: WHERE filters, insert values, `snapshotIndices(d, AIYA_ORG_ID)` |
| `src/lib/deals/actions.ts` | `orgId: AIYA_ORG_ID` on insert, WHERE on update/withdraw |
| `src/db/inventory.ts` | default param `orgId: number = AIYA_ORG_ID` |
| `src/db/diamonds.ts` | default params on `getDiamondSummary` and `getDiamondTrend` |
| `src/db/org.ts` | the constant itself, plus the unused sync `currentOrgId()` shim |

**`src/lib/inventory/queries.ts` and `src/lib/diamonds/queries.ts` do not exist** — read functions live under `src/db/inventory.ts` and `src/db/diamonds.ts`. The refactor touches the actual files; the spec accurately enumerates them.

### 4.2 Pattern: server actions (mutations)

Inside the `run()` wrapper of `src/lib/{inventory,diamonds,deals}/actions.ts`, resolve `orgId` once and thread it through:

**Before:**
```typescript
import { AIYA_ORG_ID } from "@/db/org";
// ...
await db().insert(inventoryItems).values({ orgId: AIYA_ORG_ID, ...values });
```

**After:**
```typescript
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
// ...
const orgId = await getCurrentOrgId(); // inside run()'s fn(), after requireSession() succeeded
await db().insert(inventoryItems).values({ orgId, ...values });
```

The `run()` wrapper is extended to resolve `orgId` and pass it into `fn()`:

```typescript
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<void>,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, orgId);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    console.error("[<domain> action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}
```

Each action's inner `fn` signature becomes `async (input, orgId) => { … }`. **Important:** the action wrapper resolves `orgId` from `requireSession()` directly rather than calling `getCurrentOrgId()`. This is intentional — `getCurrentOrgId()` is for places that don't already have a session in hand. The wrapper has the session; double-resolving the cookie is wasteful. **For demo mode, `run()` short-circuits before this code path runs**, so the demo seam is preserved without an extra branch.

For `src/lib/deals/actions.ts`, the existing `runWithUser` variant (which threads `session.user` for `postedByLabel`) also threads `session.orgId`:

```typescript
async function runWithUser<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, user: string, orgId: number) => Promise<void>,
): Promise<ActionResult> { /* ... same pattern */ }
```

### 4.3 Pattern: read functions (`src/db/inventory.ts`, `src/db/diamonds.ts`, `src/lib/deals/queries.ts`)

These functions already accept `orgId: number` as a parameter. The change is to **remove the default value** so every callsite must pass it explicitly:

**Before:**
```typescript
export async function getInventorySummary(
  db: Db,
  orgId: number = AIYA_ORG_ID,
): Promise<InventorySummary> { … }
```

**After:**
```typescript
export async function getInventorySummary(
  db: Db,
  orgId: number,
): Promise<InventorySummary> { … }
```

Removing the default forces a `tsc` error at every caller that forgot to pass it — the compiler is the safety net. (A default that silently equals `1` is the exact anti-pattern this slice is replacing.)

### 4.4 Pattern: RSC pages

RSC pages run server-side; they call `getCurrentOrgId()` directly at the top of the function body and pass the result into queries:

**`src/app/page.tsx` — Before:**
```typescript
import { AIYA_ORG_ID } from "@/db/org";
// ...
const [invSummary, dia, activeDeals] = await Promise.all([
  getInventorySummary(db),
  getDiamondSummary(db),
  getActiveDeals(db, AIYA_ORG_ID, 5),
]);
```

**After:**
```typescript
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
// ...
const orgId = await getCurrentOrgId();
const [invSummary, dia, activeDeals] = await Promise.all([
  getInventorySummary(db, orgId),
  getDiamondSummary(db, orgId),
  getActiveDeals(db, orgId, 5),
]);
```

**`src/app/(admin)/deals/page.tsx`** and **`src/app/(admin)/diamonds/page.tsx`** follow the same shape — `const orgId = await getCurrentOrgId();` then pass `orgId` into the queries / `eq(table.orgId, orgId)` filters.

**Note on middleware coverage:** every RSC page that calls `getCurrentOrgId()` is already behind `src/middleware.ts`'s matcher. The middleware redirects unauthenticated requests to `/login` before the RSC body executes, so `getCurrentOrgId()` won't throw on a real prod request. Demo mode bypasses the middleware (existing behavior) but `getCurrentOrgId()` short-circuits to `DEMO_ORG_ID` first — also safe.

### 4.5 Pattern: client components

**Client components must never call `getCurrentOrgId()` themselves.** It uses `next/headers` cookies — server-only. Client components either:

- Don't need `orgId` (most cases — they call server actions that resolve it themselves).
- Receive `orgId` as a typed prop from their parent RSC if they need it for a query string, link, or display label.

This slice does not introduce any new client-side `orgId` consumers — the existing client components (`DealList`, `PostDealForm`, `InventoryTable`, etc.) call server actions which resolve `orgId` internally. No client prop changes are needed.

### 4.6 Removal of `src/db/org.ts`

The file is deleted. `AIYA_ORG_ID` and `currentOrgId()` go away. Any future need for a literal AIYA-id constant lives at `DEMO_ORG_ID` in `src/lib/auth/getCurrentOrgId.ts`, which is the only legitimate use today (the demo seam). This deletion is the smoking gun the PR reviewer searches for: a successful slice 3 PR ends with `grep -rn "AIYA_ORG_ID" src/` returning **zero matches**, and `git log -p src/db/org.ts` showing the file removed. That grep is part of §6 below as an enforcement step.

---

## 5. Tests (TDD)

All test files follow the existing pattern: `// @vitest-environment node`, `vi.mock("next/cache", …)`, `vi.mock("@/lib/auth/requireSession", …)`, and `getSharedDb` / `resetSharedDb` / `closeSharedDb` from `test/helpers/shared-db.ts`. Shared-db now needs to seed the AIYA org at id=1 and an additional fixture org at id=999 for isolation tests — see §5.5.

### 5.1 `test/lib/auth/getCurrentOrgId.test.ts` (new)

- Returns `DEMO_ORG_ID` (= 1) when `process.env.NEXT_PUBLIC_DEMO_MODE = "true"`, without calling cookies/JWT.
- Returns `session.orgId` from the mocked `requireSession()` (e.g. mock returns `{ user: "boss", orgId: 7 }` → helper returns `7`).
- Throws `"Unauthorized"` when `requireSession()` rejects (no cookie / invalid token).
- Demo guard takes precedence over auth: if both demo mode is on AND `requireSession()` would throw, the helper still returns `DEMO_ORG_ID` (no throw, no DB call).

### 5.2 `test/lib/auth/session.test.ts` (new or extended)

- `createSession(user, orgId, secret)` produces a token that `verifySession` decodes back to `{ user, orgId }`.
- `verifySession` returns `null` for a token signed with a different secret.
- `verifySession` returns `null` for a token where `payload.orgId` is missing (back-compat token from before slice 3).
- `verifySession` returns `null` for a token where `payload.orgId` is a string instead of a number.
- `verifySession` returns `null` for a token where `payload.orgId` is `0` or negative.
- **JWT tampering test:** decode a valid token, edit `orgId` in the payload, re-encode without re-signing → `verifySession` returns `null`. This is the explicit "you cannot forge another org" assertion.

### 5.3 Cross-org isolation tests — the security gate

One test file per data domain, plus extensions to the deals isolation test that already exists. Each test:

1. Inserts the AIYA seed row (id=1) and a second fixture org (id=999) via shared-db setup.
2. Inserts rows into the tenanted table under both `orgId=1` and `orgId=999`.
3. Calls the read function scoped to `orgId=1`.
4. Asserts the returned rows contain **only** `orgId=1` data (length, ids, or domain-specific fields).
5. Calls the read function scoped to `orgId=999` and asserts the inverse.

**`test/db/inventory.test.ts` (new or extended):**
- Insert 3 items with `orgId=1`, 2 items with `orgId=999`.
- `getInventorySummary(db, 1)`: total === 3, counts reflect org-1 categories only.
- `getInventorySummary(db, 999)`: total === 2, counts reflect org-999 categories only.

**`test/db/diamonds.test.ts` (new or extended):**
- Insert benchmark matrix cells + price points for both `orgId=1` and `orgId=999`.
- `getDiamondSummary(db, 1)` returns only org-1 indices and points; org-999 labels never appear.
- `getDiamondTrend(db, "natural_index", 1)` returns only org-1 history snapshots.

**`test/lib/deals/queries.test.ts` (extended — slice 2 already has a tenancy test):**
- The existing test in slice 2 already covers `getActiveDeals` cross-org isolation. Extend with the same shape for `getAllDeals` across all three filter combos (status, kind, category) to confirm org scoping holds even when filters are active.

### 5.4 Action tenancy enforcement tests

For each action that does an `UPDATE` or `DELETE`, prove a row in `orgId=999` is unreachable when the session is `orgId=1`:

- `updateInventoryItem(id_in_org_999)` while `requireSession` returns `{ user: "boss", orgId: 1 }`: assert the org-999 row is unchanged after the call. (The action's WHERE clause is `eq(id, ...) AND eq(orgId, currentOrg)`; the update affects zero rows.)
- `deleteInventoryItem(id_in_org_999)` likewise: assert the org-999 row still exists.
- `upsertMatrixCell` while session is `orgId=1`: assert the insert lands with `orgId=1`, not whatever the caller tried to set (the action **never trusts the request body's orgId** — input schemas don't accept `orgId`; it's stamped from session).
- `savePricePoint` (update branch) with an org-999 row's id: assert the org-999 row is unchanged.
- `deletePricePoint(id_in_org_999)`: assert the org-999 row still exists.
- `postDeal` while session is `orgId=999`: assert the inserted row has `orgId=999` (the row's `org_id` is the session's, not a default-1).
- `markDealFilled(id_in_org_999)` while session is `orgId=1`: assert the org-999 deal is still Open.
- `withdrawDeal(id_in_org_999)` while session is `orgId=1`: assert the org-999 deal is still Open.

These tests use `vi.mock("@/lib/auth/requireSession", () => ({ requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })) }))` and then toggle the mock's return value per case. The action `run()` wrapper resolves `orgId` from the mocked session, so the tests need no other plumbing.

### 5.5 `test/helpers/shared-db.ts` extension

Add an `await db.execute(sql`INSERT INTO orgs (id, name, slug) VALUES (1, 'AIYA', 'aiya'), (999, 'Fixture Org', 'fixture') ON CONFLICT DO NOTHING; SELECT setval(...);`)` step inside `getSharedDb()` **after** migrations apply. Reason: the new FK constraints reject any tenanted insert whose `org_id` isn't present in `orgs`. Without seeding both orgs, every existing test that inserts a row with `orgId=1` (most of them) would fail FK validation. The two-org seed (id=1 + id=999) makes both single-org tests and cross-org isolation tests work out of the box.

`resetSharedDb()` truncates everything CASCADE — which also wipes orgs. After truncation, the helper must re-insert the AIYA + fixture-999 seed rows. This makes `resetSharedDb` slightly slower (two extra inserts, sub-ms) but keeps test isolation intact.

**Rationale for `id=999`** (rather than `id=2`): the fixture org id sits far above any plausible real org id that a near-future slice (users + multi-org admin) might allocate. This prevents accidental id collisions where a test fixture overlaps with a real org someone creates.

### 5.6 Existing tests stay green

Every existing test (inventory, diamonds, deals, panels, snapshots) must continue passing after the refactor. The only structural change visible to tests is:

- Mocked `requireSession` now returns `{ user, orgId }` instead of `{ user }`. Tests that destructure `session.user` keep working; tests that don't touch `orgId` continue to pass because the action wrapper handles it internally.
- `vi.mock("@/lib/auth/requireSession", () => ({ requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })) }))` is the single line every action test updates (one mechanical sweep across `test/lib/{inventory,diamonds,deals}/actions.test.ts`).

### 5.7 Middleware test (extended)

`test/middleware.test.ts` — must verify:

- A request with a valid JWT (`{ user: "boss", orgId: 1 }`) is allowed through.
- A request with a malformed JWT missing `orgId` is redirected to `/login` (because `verifySession` now returns `null` on missing `orgId`).
- A demo-mode request bypasses auth (unchanged).

---

## 6. Security & Threat Model

### 6.1 Tenancy enforcement — the critical invariant

Every read and every write in the tenanted layer (`inventory_items`, `diamond_*`, `deals`) carries `eq(table.orgId, orgId)` where `orgId` is resolved from the session, not the request body. **Never trust the client's `orgId`.** Action input schemas (Zod) deliberately exclude `orgId` — the field is stamped server-side. Adding `orgId` to any input schema is a vulnerability the PR review must reject.

**Enforcement step in the implementation plan:** the executor runs `grep -rn "AIYA_ORG_ID" src/` after the refactor lands. The expected output is **zero matches**. If any match remains, the slice is not complete. A second grep — `grep -rn "orgId" src/lib/*/validation.ts` — must also return zero matches (no input schema accepts an orgId from the wire).

### 6.2 JWT integrity

`orgId` is part of the signed JWT payload. Modifying the claim invalidates the HS256 signature → `verifySession` returns `null` → middleware redirects to `/login`. Tested explicitly (§5.2 "JWT tampering test"). The signing secret is `process.env.SESSION_SECRET` — the same secret already used by slice 0. If that env var is missing, both the login route and middleware fail closed (the `!` non-null assertion throws → 500 → no token issued, no session verified).

**Token lifetime:** 12h. Acceptable for the threat profile (no users table, no high-stakes operations). Future slice will add refresh + rotation if any deployment needs longer-lived sessions.

### 6.3 Session reuse across orgs

Each JWT is signed with exactly one `orgId`. There is no in-band mechanism for a single token to act on multiple orgs. A user logging into a different org gets a new token (signed with that org's id). This is documented and intentional. When the user-table slice adds multi-org membership, the design will need to choose between (a) one JWT per org with explicit "switch org" re-issue, or (b) a JWT with a list of `orgIds` plus a per-request `selectedOrgId`. That choice is deferred — option (a) is the default trajectory because it keeps `getCurrentOrgId()` synchronous-in-spirit (no extra header parse).

### 6.4 Demo mode

`getCurrentOrgId()` short-circuits to `DEMO_ORG_ID = 1` in demo mode without touching cookies or JWT. The seed data is and will remain single-org. The demo deploy never inserts a second org — the only way org=999 data exists is in tests with `getSharedDb()`. Documented in §9 explicitly.

### 6.5 Auth bypass for writes — never trust the body

The single most load-bearing security invariant of this slice. The implementation plan must verify by inspection:

- No Zod input schema in `src/lib/*/validation.ts` includes an `orgId` field.
- Every `INSERT` builds its `orgId` value from the resolved session — `orgId` (the local variable) — not from `input.orgId` (which doesn't exist) and not from a request header or query param.
- Every `UPDATE`/`DELETE` WHERE clause includes `eq(table.orgId, orgId)` **in addition to** any `eq(table.id, input.id)` filter. ID + orgId together; never id alone.

A unit test for the action layer (§5.4) proves this by attempting to update / delete a row whose id is from org 999 while the session is org 1, and asserting zero affected rows.

### 6.6 Race conditions

Not a concern at this layer. The new `orgs` table is read-mostly with no concurrent writes from the application (only the migration seed inserts AIYA; no UI to mutate the table). Tenanted-table operations were already concurrency-safe — adding `orgId` to the WHERE clause doesn't change ordering semantics.

### 6.7 Audit logging — explicit gap

This slice does **not** add audit logs for cross-org access attempts (e.g. "user from org 1 tried to update row id=X which belongs to org 999"). The action returns silently (`{ ok: true }` because zero rows were affected, no error thrown). A future hardening pass should:
- Log a warning when an `UPDATE` or `DELETE` affects zero rows but a session was active (might indicate a bug *or* an attack — both worth knowing about).
- Distinguish "no such id in any org" from "id exists in a different org you don't belong to".

Out of scope for slice 3; tracked as "tenancy audit logs" for a future slice.

### 6.8 PR review checklist (slice 3 exit gate)

Before merge:
- `grep -rn "AIYA_ORG_ID" src/` → 0 matches.
- `grep -rn "orgId" src/lib/*/validation.ts` → 0 matches.
- `git diff src/db/org.ts` shows the file deleted.
- All cross-org isolation tests (§5.3) pass.
- All action tenancy enforcement tests (§5.4) pass.
- JWT tampering test (§5.2) passes.
- `npm run build` and `npm test` green.

---

## 7. File Plan

### New files

| Path | Purpose |
|---|---|
| `src/lib/auth/getCurrentOrgId.ts` | The new async seam. Exports `getCurrentOrgId` + `DEMO_ORG_ID`. |
| `drizzle/0004_*.sql` | Generated migration: `CREATE TABLE orgs` + AIYA seed + 5 FK constraints. |
| `test/lib/auth/getCurrentOrgId.test.ts` | Helper unit tests (demo mode, session, throws). |
| `test/lib/auth/session.test.ts` | JWT payload tests incl. tampering assertion. |
| `test/db/inventory.test.ts` | Cross-org isolation for `getInventorySummary` (new file if absent; extended if present). |
| `test/db/diamonds.test.ts` | Cross-org isolation for `getDiamondSummary` / `getDiamondTrend`. |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema.ts` | Add `orgs` `pgTable`; add `.references(() => orgs.id)` to every existing `orgId` column on the five tenanted tables. |
| `src/lib/auth/session.ts` | Extend `createSession(user, orgId, secret)`; `verifySession` returns `{ user, orgId }` with defensive integer check. |
| `src/lib/auth/requireSession.ts` | Return type widened to `{ user, orgId }`. |
| `src/app/api/login/route.ts` | Pass hardcoded `AIYA_ORG_ID = 1` (local const) into `createSession`. |
| `src/lib/inventory/actions.ts` | `run()` wrapper threads `orgId`; insert / update / delete use it. Drop the `AIYA_ORG_ID` import. |
| `src/lib/diamonds/actions.ts` | Same: thread `orgId` through `run()`, `runWithUser`-style for `importMatrix`, and `snapshotIndices(d, orgId)`. |
| `src/lib/deals/actions.ts` | `run()` + `runWithUser` thread `orgId`. |
| `src/db/inventory.ts` | Remove default `= AIYA_ORG_ID` from `getInventorySummary(db, orgId)`. |
| `src/db/diamonds.ts` | Remove defaults from `getDiamondSummary` and `getDiamondTrend`. |
| `src/lib/deals/queries.ts` | Remove default from `getActiveDeals` and `getAllDeals`. |
| `src/app/page.tsx` | Call `await getCurrentOrgId()`; pass into all three queries. |
| `src/app/(admin)/deals/page.tsx` | Same pattern. |
| `src/app/(admin)/diamonds/page.tsx` | Same pattern; the inline `eq(...orgId, AIYA_ORG_ID)` becomes `eq(...orgId, orgId)`. |
| `test/helpers/shared-db.ts` | Seed AIYA (id=1) and a second fixture org (id=999) after migrations; re-seed after each `resetSharedDb()`. |
| `test/lib/inventory/actions.test.ts` | Update mocked `requireSession` to return `{ user, orgId }`; add the tenancy enforcement cases from §5.4. |
| `test/lib/diamonds/actions.test.ts` | Same. |
| `test/lib/deals/actions.test.ts` | Same. |
| `test/lib/deals/queries.test.ts` | Extend existing tenancy test with `getAllDeals` filter combinations. |

### Removed files

| Path | Reason |
|---|---|
| `src/db/org.ts` | Replaced by `src/lib/auth/getCurrentOrgId.ts`. The `AIYA_ORG_ID` constant and the unused sync `currentOrgId()` shim both go away. |

---

## 8. Migration Plan

1. Add the `orgs` `pgTable` definition to `src/db/schema.ts`.
2. Add `.references(() => orgs.id)` to the `orgId` column of `inventoryItems`, `diamondMatrixPrices`, `diamondPricePoints`, `diamondIndexHistory`, `deals` in `src/db/schema.ts`.
3. Run `npm run db:generate` — Drizzle Kit emits `drizzle/0004_*.sql` with the `CREATE TABLE orgs` + unique index + 5 `ALTER TABLE … FOREIGN KEY` statements.
4. **Append the AIYA seed by hand** to the generated `.sql` between the `CREATE TABLE` and the first `ALTER TABLE` (order matters — the FK constraints must apply *after* AIYA exists):

   ```sql
   INSERT INTO orgs (id, name, slug)
   VALUES (1, 'AIYA Designs', 'aiya')
   ON CONFLICT (id) DO NOTHING;
   SELECT setval(pg_get_serial_sequence('orgs','id'), GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM orgs)));
   ```

5. Inspect the final SQL: verify table created with `slug UNIQUE`, AIYA seeded, 5 FK constraints all present, no `ON DELETE CASCADE`.
6. **Critical:** Add an SQL comment to the top of `0004_*.sql` reading `-- DO NOT REGENERATE: contains hand-appended AIYA seed (lines NN-MM)`. This is the executor's tripwire against accidentally re-running `npm run db:generate` after the manual edit.
7. Local pglite (`getSharedDb`, `ensureDbReady`) applies the migration automatically on next boot — but `test/helpers/shared-db.ts` must re-seed AIYA + fixture org (#999) explicitly because the migration's hand-edit may not auto-replay cleanly across test re-imports of the migrations folder. Belt-and-suspenders seeding in the test helper is the right hedge.
8. Neon (prod): run `npm run db:migrate` before deploying the new code. Order matters — Neon must have the new schema before the new code that reads `orgs` lands.
9. **Deployment sequence (critical):** because slice 3 invalidates pre-existing JWTs (they lack `orgId`), all live users will be logged out on the next request — which is fine, the prompt is single-credential and re-login takes seconds. Document the choice in the slice's PR description. Optionally rotate `SESSION_SECRET` to make the cutover explicit.
10. Rollback: `DROP TABLE orgs CASCADE;` removes orgs + all 5 FK constraints. Tenanted data is untouched (only the constraint goes, not the column). Safe.

---

## 9. Demo Mode

| Area | Demo behavior |
|---|---|
| `getCurrentOrgId()` | Short-circuits to `DEMO_ORG_ID = 1` without touching cookies or JWT. Returns synchronously-fast. |
| `orgs` table in demo | Exists in the schema. The pglite test/dev fixture and any Neon prod deploy have AIYA at id=1. The Netlify demo deploy uses no DB at all (pglite never boots when demo flag is on), so the table is effectively unused there. |
| Seeded demo data | Stays single-org (AIYA, id=1). No fixture second org is seeded in demo — the second org only exists in tests. |
| Demo banner / inline provenance | Unchanged. The `DemoNotice` and shell `DemoBanner` continue rendering as today. |
| Action short-circuit | `run()` still checks `isDemoMode()` first → `{ ok: false, error: "Demo mode — changes are disabled" }`. The `orgId` resolution never runs. |
| Cross-org isolation tests in demo | N/A — isolation tests run under the test harness with `getSharedDb()`, not under the demo flag. The two-org test seed is explicitly separate from the demo seed. |

The boundary is: demo mode is single-org by definition; the multi-tenant infrastructure is alive in code but exercises only through tests and prod auth. Documented explicitly so the executor doesn't conflate the two.

---

## 10. Out of Scope (Explicit)

| Feature | Assigned to |
|---|---|
| `users` table + per-user RBAC | Slice 3a — Users |
| Org creation UI / admin onboarding flow | Slice 3b — Admin |
| Multi-org login picker / "switch org" UI | Slice 3a depends; UI in slice 3c |
| Per-user row ownership enforcement (deals + inventory) | Slice 3a (requires `users` table) |
| Cross-org Deal Room visibility ("private circles") | Slice 4 — Circles |
| Invitations + onboarding tokens | Slice 4b — Invitations |
| Audit logging of cross-org access attempts | Hardening pass after slice 4 |
| JWT refresh / rotation | Auth hardening slice (TBD) |
| Per-org branding, themes, custom logos | Branding slice (TBD) |
| Per-org rate limits | Slice 2g (existing slot — extended to per-org) |
| Soft-delete or `archived_at` on orgs | TBD; default is "deleting an org with live data raises a FK error" |
| `ON DELETE CASCADE` semantics | Deliberately deferred — see §2.2 |
| Per-org config / settings table | TBD |
| Org-level usage metering / billing | TBD |
| Tenant-aware logging (log-line prefix per request) | Observability hardening (TBD) |
| `postedByLabel` → display-name lookup | Slice 3a (depends on `users` table) |
| Migrating existing `AIYA_ORG_ID = 1` rows to a new id | N/A — AIYA stays id=1 forever; the constant going away doesn't change the underlying data. |
