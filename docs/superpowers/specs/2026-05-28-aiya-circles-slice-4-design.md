# AIYA Dashboard — Slice 4: Circles (Cross-Org Deal Room Visibility) — Design

**Date:** 2026-05-28
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market), #1a (AIYA dashboard + reskin), #2 (company data), #1b-1 (inventory), #1b-3 (diamond price lists), #1c (customizable layout), demo (Netlify simulation mode), slice 2 (Deal Room), slice 2 hardening passes (keyboard reorder test, build-time fetch resilience, HTTP security headers), and slice 3 (Multi-Tenant Foundation: real `orgs` table, `getCurrentOrgId()` async seam, JWT `{user, orgId}`, cross-org isolation tests) — all shipped on `main`.

---

## 1. Overview & Goals

Widen the slice-2 Deal Room from a single-org board into a **private cross-org network**: orgs that share a "Circle" can see each other's deals. This is the smallest honest cut of mockup 2's "TradeNet Exchange" — the same `tradenet-exchange` panel id that slice 2 renamed "Deal Room" finally earns the original name. The slice ships one new join shape (`circles` + `circle_members`), one new column on `deals` (`visibility_circle_id`), one new helper (`getCircleIdsForOrg`), and one new server invariant (`isOrgMemberOfCircle` is checked at post time). Every existing slice-3 tenancy enforcement is preserved verbatim — slice 4 **widens** read visibility along a strictly-bounded, explicitly-listed set of circle ids; it never replaces the per-org WHERE clause.

The cut is tight by design: **no invitations, no per-circle RBAC, no cross-circle inventory, no bidding, no notifications, no public marketplace, no leave/delete UI**. An org joins a circle by being seeded (or by a future onboarding slice); circle ownership is recorded but does not enable any actions in this slice.

**Goals:**

- New `circles` table (id, name, slug unique, ownerOrgId → `orgs.id`, createdAt).
- New `circle_members` junction (circleId → `circles.id`, orgId → `orgs.id`, unique on the pair, createdAt). Many-to-many membership.
- New nullable column `deals.visibility_circle_id INTEGER REFERENCES circles(id) ON DELETE SET NULL` (no default).
- New helper `getCircleIdsForOrg(db, orgId): Promise<number[]>` — single source of truth for "which circles does this org belong to" used by both the read widening and the post-time membership check.
- New helper `isOrgMemberOfCircle(db, orgId, circleId): Promise<boolean>` — point check; implemented in terms of `getCircleIdsForOrg` or a direct `SELECT 1 FROM circle_members WHERE …` (the design picks the direct form — see §4.2).
- Widen `getActiveDeals` and `getAllDeals` to return `WHERE deals.org_id = currentOrgId OR (deals.visibility_circle_id IS NOT NULL AND deals.visibility_circle_id IN (SELECT circle_id FROM circle_members WHERE org_id = currentOrgId))`. The left side of the `OR` is the slice-3 tenancy invariant verbatim.
- Add optional `visibilityCircleId?: number` to `postDealInput` Zod schema. If present, `postDeal` verifies the posting org is a member of that circle **before** the insert; rejection produces `{ ok: false, error: "Forbidden" }` and writes nothing.
- `DealRoomPanel` + `DealList` render a "Shared via [Circle Name]" badge on rows where `visibilityCircleId != null`. Cross-circle rows are visually distinct without leaking any data the viewer shouldn't already have access to (circle names are looked up once per render; only names of circles the viewer is in are ever surfaced).
- `PostDealForm` gains a "Share with circle" dropdown sourced from the viewer's circle memberships. Default selection is `null` (private — current slice-2 behavior).
- Demo seed: 2 fixture partner orgs ("Mehta Diamonds — Mumbai" + "Saint-Cloud Gems — Geneva"), one circle ("AIYA Trusted Partners") with AIYA + both partners as members, and 2-3 cross-circle deals so the Netlify demo demonstrates the feature.
- Tests prove: (a) reads return own + circle-shared rows, never rows from a circle the viewer isn't in; (b) writes with an unauthorized `visibilityCircleId` are rejected without DB writes; (c) the slice-3 cross-org isolation tests stay green (an org that's in no circles still sees only its own data — slice 4 is strictly additive).

**Non-Goals for Slice 4** (each has a named home — see §10):

Circle invitations / accept-decline flow, per-circle RBAC (read-only vs read-write), cross-circle inventory share, bidding / counter-offers, notifications when a new circle deal is posted, leaving / withdrawing from a circle (no UI), circle deletion (no UI), public marketplace visibility, per-org branding within circles, audit logging of cross-circle access attempts, rate limit per circle, mockup 3 "Website Overview".

---

## 2. Data Model

### 2.1 New table: `circles`

```typescript
// src/db/schema.ts (append below `orgs`)
export const circles = pgTable(
  "circles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ownerOrgId: integer("owner_org_id").notNull().references(() => orgs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUniq: unique("circles_slug_uniq").on(t.slug),
    ownerIdx: index("circles_owner_org_idx").on(t.ownerOrgId),
  })
);
```

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text NOT NULL | Human display name shown in badges + dropdown, e.g. `"AIYA Trusted Partners"`. |
| `slug` | text NOT NULL UNIQUE | URL-safe handle, e.g. `"aiya-trusted-partners"`. Reserved for a future `/circles/[slug]` route; unused by routes in this slice. |
| `owner_org_id` | integer NOT NULL → `orgs.id` | The org that created the circle. Recorded but unused for authorization in this slice — every member sees everything in the circle. Future slices (4c "Circle Onboarding", 4d "Circle Roles") gate management actions on `owner_org_id`. |
| `created_at` | timestamptz default now NOT NULL | |

**Why `slug` unique now?** Same rationale as `orgs.slug`: cheap to enforce while there are zero rows in prod; expensive to retrofit once names exist. Future routes (`/circles/[slug]`, deep links into a circle view) can rely on it.

**No `updated_at`:** Circles are nearly immutable for this slice — no rename UI. Mirrors the slice-3 `orgs` choice. Trivial to add later.

**`ownerOrgId` deliberately not used for authz this slice:** documented as a forward-compat field. The PR review checklist (§8.8) confirms no read or write codepath gates on `circles.owner_org_id` — every authorization decision goes through `circle_members`. This avoids "owner has special powers" semantics leaking in before the RBAC slice (4d) gets to design them properly.

### 2.2 New table: `circle_members`

```typescript
export const circleMembers = pgTable(
  "circle_members",
  {
    id: serial("id").primaryKey(),
    circleId: integer("circle_id").notNull().references(() => circles.id),
    orgId: integer("org_id").notNull().references(() => orgs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    memberUniq: unique("circle_members_circle_org_uniq").on(t.circleId, t.orgId),
    orgIdx: index("circle_members_org_idx").on(t.orgId),
    circleIdx: index("circle_members_circle_idx").on(t.circleId),
  })
);
```

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `circle_id` | integer NOT NULL → `circles.id` | |
| `org_id` | integer NOT NULL → `orgs.id` | |
| `created_at` | timestamptz default now NOT NULL | Used in future audit / "joined on" labels; not surfaced this slice. |

**Unique constraint `(circle_id, org_id)`** prevents the same org appearing twice in the same circle. Important because `getCircleIdsForOrg` does a `SELECT DISTINCT … FROM circle_members WHERE org_id = $1` — without the unique constraint, a duplicate row could inflate the IN-clause but wouldn't change semantics; nonetheless we enforce the invariant at the DB level (cheap insurance + a clear domain constraint).

**Two indexes:** `circle_members_org_idx` is the hot path (`getCircleIdsForOrg(orgId)` is on every authenticated request that hits a deals query); `circle_members_circle_idx` accelerates the future "list members of this circle" view in the `/circles` route. The unique constraint creates a composite index `(circle_id, org_id)` automatically, which serves a `(circleId, orgId)` lookup directly — `isOrgMemberOfCircle` uses it.

**No `ON DELETE CASCADE` on either FK:** consistent with slice 3's `orgs` policy. Deleting an org or a circle with live memberships must fail at the DB level for now; UI delete paths don't exist in this slice. Slice 4c will choose the soft-delete vs cascade policy when it ships circle deletion.

### 2.3 New column on `deals`: `visibility_circle_id`

```typescript
// src/db/schema.ts — modify the existing `deals` table definition
export const deals = pgTable(
  "deals",
  {
    // … existing columns unchanged …
    visibilityCircleId: integer("visibility_circle_id").references(() => circles.id, { onDelete: "set null" }),
    // … existing indexes unchanged …
  },
  // …
);
```

| Column | Type | Notes |
|---|---|---|
| `visibility_circle_id` | integer NULLABLE → `circles.id` ON DELETE SET NULL | `NULL` = org-private (slice-2 default). Non-null = visible to every org that's a member of the circle. |

**Nullable, no default:** the column must default to "private" without an explicit default expression — Drizzle's `.notNull()` is intentionally omitted so the column is `NULL` for any existing row migrated from slice 2/3. Application-side every existing `INSERT` path omits the field, which lands as `NULL` (current behavior preserved). The PostDealForm sends `null` (or omits the field) by default; only an explicit "share with circle" picks a non-null value.

**`ON DELETE SET NULL`** is the policy choice for this column. If the future slice 4c lets a user delete a circle, historical deals shared into it must remain visible **to their posting org only** — not vanish. `SET NULL` preserves the row; `CASCADE` would delete the deal too, which is wrong (a circle being deleted shouldn't destroy a posting org's record of their own offer). The opposite extreme — refusing to delete a circle that has deals shared into it — is overly strict and forecloses on the design of the future circle-deletion flow. `SET NULL` is the middle path that keeps history intact without entangling deletion semantics.

**Index recommendation:** add a partial index `CREATE INDEX deals_visibility_circle_idx ON deals (visibility_circle_id, status, created_at DESC) WHERE visibility_circle_id IS NOT NULL;` This is the hot path of the widened read — the right side of the `OR`. The partial-index `WHERE visibility_circle_id IS NOT NULL` filter keeps the index tiny while every existing slice-2 row stays NULL. The existing `deals_org_status_created_idx` already serves the left side of the `OR` (`deals.org_id = currentOrgId AND status = 'Open' ORDER BY created_at DESC`) and stays unchanged.

A non-partial composite index `(visibility_circle_id, status, created_at)` would also work but indexes the NULL rows (every existing row), which costs storage without benefit. The partial form is preferred. If the implementer finds the partial index unwieldy with the pglite test driver (PGlite supports partial indexes — verified — but executors should confirm), a plain composite is acceptable as a fallback documented inline.

### 2.4 Migration (`drizzle/0005_*.sql`)

Generated by `npm run db:generate` after the schema edits. The expected file contains, in this order:

1. `CREATE TABLE circles (…)` + `CREATE UNIQUE INDEX circles_slug_uniq …` + `CREATE INDEX circles_owner_org_idx …`.
2. `CREATE TABLE circle_members (…)` + the three indexes (unique + 2 individual).
3. `ALTER TABLE deals ADD COLUMN visibility_circle_id INTEGER REFERENCES circles(id) ON DELETE SET NULL;`
4. `CREATE INDEX deals_visibility_circle_idx ON deals (visibility_circle_id, status, created_at DESC) WHERE visibility_circle_id IS NOT NULL;`

**Hand-appended demo-circle seed.** The same pattern slice 3 used for the AIYA org seed — between steps 2 and 3 above (so any seeded `circle_members` references exist before the FK comes alive — though this slice's seed lives in `src/lib/demo/seed.ts` for the Netlify deploy, not in the SQL migration, see §5). For prod the migration is **schema-only**: no idempotent INSERT of any specific circle. The implementation plan must add a top-of-file SQL comment reading `-- schema-only; no seed data in this migration` so a future executor doesn't accidentally infer "missing seed step".

This is a deliberate divergence from slice 3 (where AIYA had to be seeded inline so the FK constraints could land referentially). Slice 4's FKs (`circles.owner_org_id → orgs.id`, `circle_members.org_id → orgs.id`) reference `orgs.id`, which is already seeded; the new tables themselves are empty at migration time and no FK targets them yet (the `deals.visibility_circle_id` column is `NULL` for every existing row). The order works without a seed step.

**Rollback:** `DROP TABLE circle_members; DROP TABLE circles; ALTER TABLE deals DROP COLUMN visibility_circle_id;` — safe; tenanted deals data untouched (only the optional `visibility_circle_id` column goes, all values were either `NULL` or pointed at a now-deleted circle).

---

## 3. Server Layer — Read Filter Widening

This is the single load-bearing security change of the slice. Every other change is plumbing in service of getting this filter right.

### 3.1 `getCircleIdsForOrg(db, orgId)` — `src/lib/circles/queries.ts` (new)

```typescript
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circles, circleMembers } from "@/db/schema";

export interface CircleRow {
  id: number;
  name: string;
  slug: string;
  ownerOrgId: number;
}

/** Returns the circle ids that an org is currently a member of. */
export async function getCircleIdsForOrg(db: Db, orgId: number): Promise<number[]> {
  const rows = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(eq(circleMembers.orgId, orgId));
  return rows.map((r) => r.circleId);
}

/** Returns the full circle rows an org belongs to — used by the PostDealForm
 *  dropdown and the "Shared via …" badge name lookup. */
export async function getCirclesForOrg(db: Db, orgId: number): Promise<CircleRow[]> {
  const rows = await db
    .select({
      id: circles.id,
      name: circles.name,
      slug: circles.slug,
      ownerOrgId: circles.ownerOrgId,
    })
    .from(circles)
    .innerJoin(circleMembers, eq(circleMembers.circleId, circles.id))
    .where(eq(circleMembers.orgId, orgId));
  return rows;
}
```

**Two helpers, not one:** `getCircleIdsForOrg` returns a flat `number[]` because the widened deals query and the `isOrgMemberOfCircle` check both want only the ids. `getCirclesForOrg` returns the full rows for the UI (dropdown labels + badge name lookups). Bundling them into one helper that returns `CircleRow[]` and forces callers to map to ids would be wasteful on the hot read path (every `getActiveDeals` call would hydrate `name` + `slug` columns it never uses).

**Demo seam.** In demo mode, `getCircleIdsForOrg(_, DEMO_ORG_ID)` returns the ids of the seeded demo circles; `getCirclesForOrg` returns the seeded rows. Both seams live in `src/lib/demo/seed.ts` (see §5) and are dispatched from the helpers via `if (isDemoMode())` at the top — same pattern as `getActiveDeals` today. Any orgId other than `DEMO_ORG_ID` returns `[]` in demo (defensive default — the Netlify demo only seeds AIYA's perspective).

### 3.2 `isOrgMemberOfCircle(db, orgId, circleId)` — `src/lib/circles/membership.ts` (new)

```typescript
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circleMembers } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedCircleIdsForOrg } from "@/lib/demo/seed";

/** Truth check used by post-time write authorization. Hits the
 *  (circle_id, org_id) unique-constraint composite index directly. */
export async function isOrgMemberOfCircle(
  db: Db,
  orgId: number,
  circleId: number,
): Promise<boolean> {
  if (isDemoMode()) {
    return getSeedCircleIdsForOrg(orgId).includes(circleId);
  }
  const rows = await db
    .select({ id: circleMembers.id })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, orgId)))
    .limit(1);
  return rows.length > 0;
}
```

**Why a separate helper rather than `(await getCircleIdsForOrg(db, orgId)).includes(circleId)`?** The post path runs this check once per `postDeal` and shouldn't pay for an over-fetch of every circle id when one boolean is the answer. The DB cost is identical (both queries hit `circle_members` once), but the `LIMIT 1` form lets PG short-circuit on the unique index. More importantly, the helper makes the security invariant readable at the call site: `if (!(await isOrgMemberOfCircle(orgId, circleId))) return Forbidden;` reads as exactly the authorization check it is.

**File location:** `src/lib/circles/membership.ts` is separate from `src/lib/circles/queries.ts` because membership is the authz primitive — keeping it in its own file makes the security audit grep easy (`grep -rn "isOrgMemberOfCircle"` returns the membership check call site + its single definition file, nothing else).

### 3.3 Widened `getActiveDeals` and `getAllDeals` — `src/lib/deals/queries.ts` (modified)

**Before (slice 3):**

```typescript
const rows = await db
  .select(COLUMNS)
  .from(deals)
  .where(and(eq(deals.orgId, orgId), eq(deals.status, "Open")))
  .orderBy(desc(deals.createdAt))
  .limit(limit);
```

**After (slice 4):**

```typescript
import { or, inArray } from "drizzle-orm";
import { getCircleIdsForOrg } from "@/lib/circles/queries";

// inside getActiveDeals (and analogously inside getAllDeals):
const circleIds = await getCircleIdsForOrg(db, orgId);

const visibilityClause = circleIds.length > 0
  ? or(
      eq(deals.orgId, orgId),
      inArray(deals.visibilityCircleId, circleIds),
    )
  : eq(deals.orgId, orgId);

const rows = await db
  .select(COLUMNS)
  .from(deals)
  .where(and(visibilityClause, eq(deals.status, "Open")))
  .orderBy(desc(deals.createdAt))
  .limit(limit);
```

The widened `COLUMNS` projection adds `visibilityCircleId: deals.visibilityCircleId` so the UI can render the "Shared via …" badge. The `DealRow` interface gains `visibilityCircleId: number | null`.

**Critical invariants:**

1. **The left side of the `OR` is the slice-3 tenancy clause, byte-for-byte unchanged.** Slice 4 is strictly additive — it widens, never replaces. The PR review must visually diff this line against slice 3 to confirm.
2. **When `circleIds` is empty, the query degenerates to the slice-3 form.** No `OR`, no `inArray`. This is the "an org in zero circles sees exactly what it did in slice 3" guarantee, and it's enforced at compile time by the early return rather than by an empty `inArray` (which Drizzle's `inArray([])` would treat as `false` — fine, but the explicit form is auditable). This is also why the existing slice-3 cross-org isolation tests stay green without modification.
3. **`inArray(deals.visibilityCircleId, circleIds)` automatically excludes NULL rows** because PG's `IN (…)` semantics return NULL (falsy) for `NULL IN (…)`. No explicit `IS NOT NULL` guard needed in the WHERE clause; the index's partial-NULL filter (§2.3) is the storage-side mirror.
4. **`getAllDeals` applies the same widening before applying user filters.** The `status` / `kind` / `category` filters in `DealFilters` AND on top of the OR-clause: a user filtering by `status=Filled` sees their own filled deals plus circle-shared filled deals. Withdrawn-status guard from slice 2 is unchanged (`getActiveDeals` filters to `Open` only; widened-or-not, Withdrawn cross-circle deals are hidden).

**Demo seam.** `getActiveDeals` / `getAllDeals` already short-circuit on `isDemoMode()` at the top — both return `getSeedDeals()` slices. The seed helper now returns the cross-circle demo rows alongside AIYA's own. The widening logic doesn't run in demo (no DB call), so the demo data has to be hand-curated to look like the widened result would. See §5.

### 3.4 `formatDealVisibility` — `src/lib/deals/format.ts` (new)

A small helper, used by both the panel and the admin row, that resolves a deal's visibility to a display label:

```typescript
export interface DealVisibility {
  kind: "private" | "circle";
  circleName?: string;     // present iff kind === "circle"
}

export function formatDealVisibility(
  visibilityCircleId: number | null,
  circleNamesById: Map<number, string>,
): DealVisibility {
  if (visibilityCircleId === null) return { kind: "private" };
  const name = circleNamesById.get(visibilityCircleId);
  if (!name) return { kind: "private" }; // defensive fall-back
  return { kind: "circle", circleName: name };
}
```

**Why the defensive fall-back to "private"?** If a row was somehow returned with `visibility_circle_id` set to a circle the viewer is NOT in, the badge **must not** display the circle's name — that would leak the name to a non-member. The widened query (§3.3) makes this state unreachable in well-formed code (you only see a row whose `visibility_circle_id` is in your `circleIds`), but the format helper treats unknown ids as "private" so a future bug in the query path can't surface a foreign circle name. This is belt-and-suspenders; the test in §7 asserts it explicitly.

---

## 4. Server Layer — Write-Side Validation

### 4.1 `postDealInput` Zod schema — `src/lib/deals/validation.ts` (modified)

**Before (slice 2):**

```typescript
export const postDealInput = z.object({
  kind: z.enum(DEAL_KINDS),
  category: z.enum(DEAL_CATEGORIES),
  subject: z.string().trim().min(1).max(280),
  quantity: z.number().int().min(1),
  priceCents: z.number().int().min(0),
  currency: z.string().length(3).optional().default("USD"),
});
```

**After (slice 4):**

```typescript
export const postDealInput = z.object({
  kind: z.enum(DEAL_KINDS),
  category: z.enum(DEAL_CATEGORIES),
  subject: z.string().trim().min(1).max(280),
  quantity: z.number().int().min(1),
  priceCents: z.number().int().min(0),
  currency: z.string().length(3).optional().default("USD"),
  visibilityCircleId: z.number().int().positive().nullable().optional(),
});
```

Zod accepts `undefined`, `null`, or a positive integer. The action's downstream insert maps `undefined` → `null` so the DB column lands as `NULL` (private) in both cases. **Critically, the Zod schema only enforces *shape*** — it does not verify that the integer is a circle the caller is allowed to share into. That check is server-side runtime authz (§4.2), deliberately outside the schema, because Zod doesn't have DB access and shouldn't pretend to.

### 4.2 `postDeal` runtime authz — `src/lib/deals/actions.ts` (modified)

```typescript
import { isOrgMemberOfCircle } from "@/lib/circles/membership";

export async function postDeal(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealInput, raw, async (input: PostDealInput, user, orgId) => {
    if (input.visibilityCircleId !== undefined && input.visibilityCircleId !== null) {
      const allowed = await isOrgMemberOfCircle(db(), orgId, input.visibilityCircleId);
      if (!allowed) {
        // Throw an Error subclass so run()'s catch produces a stable, audit-friendly message.
        throw new ForbiddenError("Forbidden");
      }
    }
    await db().insert(deals).values({
      orgId,
      kind: input.kind,
      category: input.category,
      subject: input.subject,
      quantity: input.quantity,
      priceCents: input.priceCents,
      currency: input.currency,
      visibilityCircleId: input.visibilityCircleId ?? null,
      postedByLabel: user,
    });
    console.log(
      `[deals] posted deal kind=${input.kind} category=${input.category} ` +
      `by=${user} org=${orgId} visibility=${input.visibilityCircleId ?? "private"}`
    );
  });
}
```

**`ForbiddenError`** — a thin `Error` subclass exported from `src/lib/auth/errors.ts` (new). The action wrapper's `catch` distinguishes it from `Database error`:

```typescript
// src/lib/auth/errors.ts
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
```

`runWithUser` extension (mechanical):

```typescript
try {
  await fn(parsed.data, user, orgId);
  revalidatePath("/");
  revalidatePath("/deals");
  return { ok: true };
} catch (e) {
  if (e instanceof ForbiddenError) {
    console.warn(
      `[deals] forbidden post attempt by org=${orgId} user=${user}: ${e.message}`
    );
    return { ok: false, error: "Forbidden" };
  }
  console.error("[deals action] database error:", e);
  return { ok: false, error: "Database error" };
}
```

The same wrapper modification applies to `run` if any future action needs Forbidden semantics — slice 4 only needs it in `runWithUser` for `postDeal`. The implementation plan should update both for symmetry; the test suite asserts both.

**Critical invariants (the security gate):**

1. **`orgId` for the row owner is from session, never wire.** Unchanged from slice 3. Confirmed by the absence of `orgId` in `postDealInput`.
2. **`visibilityCircleId` is the one new wire field, and it's validated against actual membership before the insert.** The check happens *before* the `db().insert`, so a rejected post writes zero rows. The test in §7 asserts row count.
3. **The check runs against the **session orgId**, never against any value supplied by the caller.** `isOrgMemberOfCircle(db(), orgId, input.visibilityCircleId)` passes the session-resolved `orgId` from the wrapper, not anything the client could influence.
4. **Audit log on rejection.** The `console.warn` line surfaces every Forbidden attempt with the offending org + user. This is the only new line of audit logging slice 4 ships — proper audit tables remain deferred (slice 3 §10 "tenancy audit logs").
5. **Demo mode.** `runWithUser` short-circuits on `isDemoMode()` before any of this runs — demo posts return `{ ok: false, error: "Demo mode — changes are disabled" }` exactly as today.

### 4.3 No new write paths

`markDealFilled` and `withdrawDeal` are **unchanged**. They operate on a single deal id with `WHERE id = $1 AND org_id = currentOrg`. Slice 4 does not widen update authority — a circle member cannot withdraw or mark filled a deal owned by another org, even if both are in the same circle. This is intentional and documented: the only thing a circle grants is **read** visibility. Mutating a foreign org's deal requires per-circle RBAC (slice 4d). The existing slice-3 tenancy enforcement test for these actions stays green without modification.

---

## 5. Demo Mode

### 5.1 Seeded circles + memberships

Extend `src/lib/demo/seed.ts` with three new exports:

```typescript
export interface SeedCircle {
  id: number;
  name: string;
  slug: string;
  ownerOrgId: number;
}

export function getSeedCircles(): SeedCircle[] {
  return [
    { id: 201, name: "AIYA Trusted Partners", slug: "aiya-trusted-partners", ownerOrgId: DEMO_ORG_ID },
  ];
}

// Returns circle ids an org is a member of, in demo mode.
// AIYA + the two fixture partner orgs all belong to circle 201.
export function getSeedCircleIdsForOrg(orgId: number): number[] {
  const memberships: Record<number, number[]> = {
    [DEMO_ORG_ID]: [201],   // AIYA
    501: [201],              // Mehta Diamonds — Mumbai
    502: [201],              // Saint-Cloud Gems — Geneva
  };
  return memberships[orgId] ?? [];
}
```

`501` and `502` are fixture demo-only org ids — they only exist in the seed file's mental model. They never get inserted into the demo deploy's nonexistent DB (the Netlify demo doesn't boot pglite), and they're outside the test-fixture id range (`999`) so they cannot collide. Their `postedByLabel` values appear on cross-circle deal rows.

### 5.2 Cross-circle demo deals

Extend `getSeedDeals()` with 2-3 additional rows that look like they're shared into circle `201` by the fixture partner orgs. Keep the existing 5 AIYA rows unchanged. New rows:

| id | orgId | kind | category | subject | postedByLabel | visibilityCircleId | status |
|---|---|---|---|---|---|---|---|
| 106 | 501 | SELL | Diamond | Round 2.51ct E/VVS1 GIA — Mumbai cutting — demo · simulated | Mehta Diamonds — Mumbai | 201 | Open |
| 107 | 502 | SELL | Gem | Cushion Padparadscha 1.8ct, AGL cert — Geneva consignment — demo · simulated | Saint-Cloud Gems — Geneva | 201 | Open |
| 108 | 501 | BUY | Metal | Looking for 24K bullion, 1kg bars — demo · simulated | Mehta Diamonds — Mumbai | 201 | Open |

`DealRow` gains `visibilityCircleId` and `orgId` — both required for the UI to render the badge and (visually only) distinguish "another org posted this into our shared circle". `orgId` is **not surfaced as a numeric id in the UI** — only the `postedByLabel` is — but it lives on the row so the panel can confirm the deal is foreign without re-querying.

Wait — `orgId` is already on the DB row but **not** projected through `getActiveDeals` / `getAllDeals` today. To keep the projection honest, slice 4 adds both fields to `COLUMNS` and to `DealRow`:

```typescript
const COLUMNS = {
  // … existing …
  orgId: deals.orgId,
  visibilityCircleId: deals.visibilityCircleId,
} as const;

export interface DealRow {
  // … existing …
  orgId: number;
  visibilityCircleId: number | null;
}
```

The panel uses `orgId === currentOrgId` (passed in as a prop alongside `deals`) to decide whether the row is "own" or "shared". The badge logic is then:

- `visibilityCircleId === null` → no badge (private to the viewer's org; this is the slice-2 default).
- `visibilityCircleId !== null && orgId === currentOrgId` → "Shared with [Circle Name]" badge (the viewer posted this into the circle).
- `visibilityCircleId !== null && orgId !== currentOrgId` → "Shared via [Circle Name] · [postedByLabel]" — visual cue that another org posted this.

### 5.3 Demo widening invariant

`getActiveDeals` / `getAllDeals` in demo mode return the union of `{rows where orgId === DEMO_ORG_ID}` and `{rows where visibilityCircleId ∈ getSeedCircleIdsForOrg(DEMO_ORG_ID)}`. The seed helper does this filtering inline so the demo accurately mirrors the widened-read behavior of the real query. Concretely:

```typescript
export function getSeedDealsVisibleTo(orgId: number): DealRow[] {
  const circleIds = new Set(getSeedCircleIdsForOrg(orgId));
  return getSeedDeals().filter(
    (d) => d.orgId === orgId || (d.visibilityCircleId !== null && circleIds.has(d.visibilityCircleId)),
  );
}
```

`getActiveDeals` demo branch now calls `getSeedDealsVisibleTo(orgId).filter((d) => d.status === "Open").slice(0, limit)`. `getAllDeals` calls `getSeedDealsVisibleTo(orgId)` and the caller applies its filter UI on the result.

### 5.4 Demo mode boundaries

| Area | Demo behavior |
|---|---|
| Seed circles + memberships | Live in `src/lib/demo/seed.ts`; no DB writes; the Netlify demo never boots pglite. |
| Read widening | `getActiveDeals` / `getAllDeals` apply `getSeedDealsVisibleTo(DEMO_ORG_ID)` filtering — the demo demonstrates the widened semantics. |
| Write attempts (`postDeal` with `visibilityCircleId`) | Short-circuit at the top of `runWithUser` with `{ ok: false, error: "Demo mode — changes are disabled" }`. The membership check never runs. |
| `isOrgMemberOfCircle` | Demo branch: `getSeedCircleIdsForOrg(orgId).includes(circleId)`. Used only for the PostDealForm's client-side dropdown population — never as a security gate in demo (writes are off). |
| `getCirclesForOrg` | Demo branch returns the seeded `SeedCircle[]` rows for `DEMO_ORG_ID`. The PostDealForm dropdown shows "AIYA Trusted Partners" + "(private)" — the form's submit button still shows demo-disabled state. |
| UI badges | Render against the seeded data. Cross-circle rows visibly distinct. |

The demo demonstrates the feature without ever issuing a real write — the same honesty contract slice 2's demo holds.

---

## 6. UI Layer

### 6.1 `DealRoomPanel` — `src/components/dashboard/DealRoomPanel.tsx` (modified)

Receives `deals: DealRow[]`, `currentOrgId: number`, and `circleNamesById: Map<number, string>` from `PanelCtx`. The new map is computed once in the RSC page from `getCirclesForOrg(db, currentOrgId)` so the panel doesn't re-query per row.

Each row's render logic gains:

```tsx
const vis = formatDealVisibility(d.visibilityCircleId, circleNamesById);
const isForeign = d.orgId !== currentOrgId;
// …
<li key={d.id} className="flex items-center gap-2 py-2">
  <span className={`font-mono text-[10px] uppercase tracking-wider ${KIND_CLASS[d.kind]}`}>
    {d.kind}
  </span>
  <span className="text-[10px] uppercase tracking-wider text-text/40">{d.category}</span>
  <span className="flex-1 truncate text-text/80" title={d.subject}>{d.subject}</span>
  {vis.kind === "circle" && (
    <span
      className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80"
      title={isForeign ? `Shared by ${d.postedByLabel} via ${vis.circleName}` : `Shared with ${vis.circleName}`}
    >
      {vis.circleName}
    </span>
  )}
  <span className="font-mono text-text">{formatCents(d.priceCents)}</span>
  <span className="text-[10px] text-text/40">{timeAgo(d.createdAt)}</span>
</li>
```

**XSS guard:** `vis.circleName` comes from a server-trusted `circleNamesById` map — names are DB-sourced and rendered as text children (React escapes). Even though the lookup map already excludes circles the viewer isn't in (the map is built from `getCirclesForOrg(currentOrgId)`), the `formatDealVisibility` defensive fallback (§3.4) returns `kind: "private"` for any unknown id — the badge silently disappears rather than rendering an empty pill or a foreign name.

**No `className` interpolation from user data.** Circle name is rendered as a child, never as a class — same discipline as slice 2.

### 6.2 `DealList` — `src/components/deals/DealList.tsx` (modified)

The admin table gains a "Visibility" column rendering the same `formatDealVisibility` result. Display:

- Private → muted text "Private".
- Circle → small gold pill with the circle name; tooltip identifies the poster when foreign.

Filter chips are not extended in this slice (no "show only circle deals" filter — out of scope; users can mentally filter on the badge for now). Future enhancement.

### 6.3 `PostDealForm` — `src/components/deals/PostDealForm.tsx` (modified)

Accepts a new prop `circles: { id: number; name: string }[]` populated by the parent RSC. Adds a dropdown:

```tsx
<label className="flex flex-col">
  Share with
  <select
    aria-label="visibility"
    className="bg-bg p-2"
    value={visibilityCircleId ?? ""}
    onChange={(e) => setVisibilityCircleId(e.target.value ? Number(e.target.value) : null)}
  >
    <option value="">Private (your org only)</option>
    {circles.map((c) => (
      <option key={c.id} value={c.id}>{c.name}</option>
    ))}
  </select>
</label>
```

The submitted raw payload now includes `visibilityCircleId: visibilityCircleId` (number or `null`). The action validates + authz-checks.

**Defense in depth:** even if a malicious client injects a `<option value="9999">` into the DOM and submits a circleId the user isn't in, the server-side `isOrgMemberOfCircle` check rejects it with Forbidden. The dropdown is for UX, never for authorization.

### 6.4 `/deals` admin page — `src/app/(admin)/deals/page.tsx` (modified)

```typescript
export default async function DealsPage({ /* … */ }) {
  // … existing filter parsing …
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [rows, myCircles] = await Promise.all([
    getAllDeals(db, orgId, filters),
    getCirclesForOrg(db, orgId),
  ]);
  const circleNamesById = new Map(myCircles.map((c) => [c.id, c.name]));
  // …
  return (
    // …
    <PostDealForm postAction={postDeal} circles={myCircles.map(c => ({ id: c.id, name: c.name }))} />
    <DealList
      deals={rows}
      currentOrgId={orgId}
      circleNamesById={circleNamesById}
      markFilledAction={markDealFilled}
      withdrawAction={withdrawDeal}
    />
    // …
  );
}
```

### 6.5 `src/app/page.tsx` (dashboard home) (modified)

Same pattern: parallel-fetch `getCirclesForOrg(db, orgId)` alongside the existing `Promise.all`, build the `circleNamesById` map, thread it into the panel context.

### 6.6 `PanelCtx` extension — `src/lib/layout/types.ts` (modified)

```typescript
export interface DealView {
  deals: DealRow[];
  currentOrgId: number;
  circleNamesById: Map<number, string>;
}
```

The widened `DealView` is the cleanest place for these props because `PanelCtx` is the existing channel between the RSC page and the registry-rendered panel. The `DealRoomPanel`'s registry entry (slice 2) gets a one-line update to pass through the new fields.

### 6.7 Registry — `src/lib/layout/registry.tsx` (modified)

```typescript
{
  id: "tradenet-exchange",
  title: "Deal Room",            // unchanged title — see §6.8 for rename decision
  defaultSize: 1,
  render: (ctx) =>
    ctx.deals
      ? <DealRoomPanel
          deals={ctx.deals.deals}
          currentOrgId={ctx.deals.currentOrgId}
          circleNamesById={ctx.deals.circleNamesById}
        />
      : <BusinessPlaceholder title="Deal Room" testid="panel-tradenet-exchange" />,
},
```

### 6.8 Naming decision: "Deal Room" stays, no new "TradeNet Exchange" panel

The original prompt asked whether to rename or add a separate panel. **Recommended call: keep `title: "Deal Room"`** and **do not add a separate `tradenet-exchange` panel.** Reasoning:

- Adding a second panel for circle-only visibility splits a single mental model ("my deals + my circle deals") into two views that show overlapping data. Users would have to reason about which view shows what.
- The Deal Room *becomes* the TradeNet Exchange the moment circle visibility lands. The panel id `tradenet-exchange` was always going to mean this — slice 2 was a stepping stone with the right id and the wrong title; slice 4 finishes the rename. A future slice (5 "Auctions" or 4d "Circle Roles") may justify a separate panel for richer cross-org views.
- A small section at the top of `/deals` ("In your circles: AIYA Trusted Partners (2 partner orgs)") makes the cross-org aspect discoverable without dedicating a panel slot.

The implementation plan should add a one-line note above the registry entry: `// id "tradenet-exchange" reflects the original mockup-2 framing; title "Deal Room" reflects the user-facing language. Both are stable.`

### 6.9 `/circles` admin route (optional this slice)

A minimal RSC at `src/app/(admin)/circles/page.tsx` that lists the viewer's circles + member orgs. No mutation UI. Useful for self-service discovery of "which orgs are in my circles". **Marked optional** for slice 4 — if scope tightens, defer to slice 4c. If included this slice:

```typescript
export default async function CirclesPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const circles = await getCirclesForOrg(db, orgId);
  const memberCounts = await Promise.all(
    circles.map(async (c) => ({ circle: c, members: await listCircleMemberOrgs(db, c.id, orgId) }))
  );
  // render a simple list of circles + members
}
```

`listCircleMemberOrgs(db, circleId, viewerOrgId)` — defined in `src/lib/circles/queries.ts` — returns the org names of the members, **only if the viewer is also a member of that circle** (defense in depth: the page already only iterates over `circles` the viewer is in, but the helper double-checks). This prevents a future bug in the page from leaking member lists across circles.

If the implementer keeps this route, add `"/circles"` to the middleware matcher and a Nav entry. If deferred, mark `circles` page work in slice 4c.

---

## 7. Tests (TDD)

All test files follow the existing pattern: `// @vitest-environment node`, `vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))`, `vi.mock("@/lib/auth/requireSession", () => ({ requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })) }))`, and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` / `__setTestDb` pattern from `test/helpers/shared-db.ts`.

**Shared-db extension:** `test/helpers/shared-db.ts` already seeds orgs id=1 (AIYA) + id=999 (fixture). Slice 4 needs a third fixture org for cross-circle isolation tests. Either extend `seedOrgs()` to also insert id=888 ("Other Fixture Org"), or have individual tests insert it directly via `db.insert(orgs).values(...)`. The design picks **extending `seedOrgs()`** — every cross-circle test needs the same third org, so centralizing the seed keeps tests terse. The extension is a one-line addition.

Per-test data (circles + memberships + cross-circle deals) is inserted in each test's `beforeEach`, after `resetSharedDb()` re-seeds the three orgs.

### 7.1 `test/lib/circles/membership.test.ts` (new)

- `isOrgMemberOfCircle(db, 1, C)` returns `true` when org 1 is in circle C (insert one membership row first).
- `isOrgMemberOfCircle(db, 1, C)` returns `false` when no membership row exists.
- `isOrgMemberOfCircle(db, 1, C)` returns `false` when org 999 is the only member of C.
- Demo mode: `isOrgMemberOfCircle(db, DEMO_ORG_ID, 201)` returns `true` (seeded demo circle) without touching the DB.
- Demo mode: `isOrgMemberOfCircle(db, 999, 201)` returns `false` (fixture org has no demo memberships).

### 7.2 `test/lib/circles/queries.test.ts` (new)

- `getCircleIdsForOrg(db, 1)` returns `[]` when org 1 has zero memberships.
- `getCircleIdsForOrg(db, 1)` returns the full set of ids when org 1 is in multiple circles. Insert 3 circles + 3 memberships → assert exact array contents (order-independent).
- `getCircleIdsForOrg(db, 999)` returns only org 999's memberships, not org 1's.
- `getCirclesForOrg(db, 1)` returns the joined `CircleRow[]` with `name` and `slug` populated.
- `getCirclesForOrg(db, 1)` returns `[]` for an org with no memberships.
- Demo mode: `getCircleIdsForOrg(_, DEMO_ORG_ID)` returns the seed ids without DB access (assert by setting `NEXT_PUBLIC_DEMO_MODE=true` in `beforeEach`).

### 7.3 `test/lib/deals/queries.test.ts` (extended — the security gate)

The existing slice-2/3 tests stay verbatim. Extend with:

- **Three-org, one-circle scenario.** Insert orgs (already seeded: 1, 999, 888). Create circle "Trusted Partners" (id=C). Insert memberships: (1, C) and (888, C); NO membership for 999. Insert deals: D1 owned by org 1, `visibility_circle_id = NULL` (private); D2 owned by org 1, `visibility_circle_id = C`; D3 owned by org 999, `visibility_circle_id = NULL`; D4 owned by org 888, `visibility_circle_id = C`. Expected:
  - `getActiveDeals(db, 1)` returns `{D1, D2, D4}` — own + circle-shared from a partner.
  - `getActiveDeals(db, 999)` returns `{D3}` — only own; 999 is not in the circle.
  - `getActiveDeals(db, 888)` returns `{D2, D4}` — 888 has no private deals, sees both circle deals (own circle deal D4 + AIYA's circle deal D2).
- **Multi-circle viewer.** Org 1 is in circles A and B. Deals: D_A in A, D_B in B. `getActiveDeals(db, 1)` returns both. Org 888 is in A only. `getActiveDeals(db, 888)` returns only `{D_A}` — proves no leak across circles when the viewer happens to be in one of two circles.
- **`getAllDeals` filter composition.** Same scenario; assert `getAllDeals(db, 1, { status: "Open" })` returns only Open rows from the widened union; `getAllDeals(db, 1, { kind: "BUY" })` filters across the widened union without losing the visibility constraint.
- **Withdrawn cross-circle deal is hidden from `getActiveDeals`.** Insert a circle-shared deal with status=Withdrawn → not returned. Confirms slice-2's Withdrawn-hiding behavior is preserved through the widening.
- **Empty circles edge case.** Org 1 is in circle C, but no deals are shared into C. `getActiveDeals(db, 1)` returns only org-1 private deals; the `inArray(visibilityCircleId, [C])` clause finds nothing — proves the query handles empty matches gracefully.
- **Zero-circles edge case.** Org 1 has zero memberships. The widened query degenerates to the slice-3 form (just `eq(orgId, 1)`). All existing slice-3 isolation tests still pass — assert by re-running one slice-3 test verbatim with the slice-4 query.

### 7.4 `test/lib/deals/actions.test.ts` (extended — the write-authz gate)

- **Authorized post into a circle.** Seed org 1 + circle C + membership (1, C). Mock `requireSession` to return `{user: "boss", orgId: 1}`. `postDeal({...valid, visibilityCircleId: C})` returns `{ ok: true }`; the inserted row has `visibility_circle_id = C`.
- **Unauthorized post.** Seed org 1, circle C, membership (999, C) (org 1 is NOT in C). Mock session as org 1. `postDeal({...valid, visibilityCircleId: C})` returns `{ ok: false, error: "Forbidden" }`; **assert zero rows in deals table after the call** (the insert never ran).
- **Nonexistent circle id.** `postDeal({...valid, visibilityCircleId: 99999})` (no such circle) returns `{ ok: false, error: "Forbidden" }` — `isOrgMemberOfCircle` returns false for a circle that doesn't exist; the FK never gets a chance to throw.
- **Null `visibilityCircleId`.** `postDeal({...valid, visibilityCircleId: null})` succeeds and inserts a row with `visibility_circle_id IS NULL` — confirms private posts unchanged.
- **Omitted `visibilityCircleId`.** `postDeal({...valid})` (no field) succeeds and inserts a row with `visibility_circle_id IS NULL` — confirms Zod's `.optional()` flows to `null`.
- **Slice-3 cross-org isolation preserved.** `postDeal` while session is `{orgId: 999}` inserts with `orgId=999` — never with the body's. (This is the slice-3 test recapitulated.)
- **Demo guard.** With `NEXT_PUBLIC_DEMO_MODE=true`, `postDeal({...valid, visibilityCircleId: 201})` returns `{ ok: false, error: "Demo mode — changes are disabled" }` — short-circuit beats authz; the membership check never runs.

### 7.5 `test/lib/deals/format.test.ts` (new)

- `formatDealVisibility(null, …)` returns `{ kind: "private" }`.
- `formatDealVisibility(C, mapWithCnamed)` returns `{ kind: "circle", circleName: "name" }`.
- `formatDealVisibility(C_unknown, emptyMap)` returns `{ kind: "private" }` (defensive fall-back; assertion is the load-bearing protection against name leaks).

### 7.6 `test/components/dashboard/DealRoomPanel.test.tsx` (extended)

- Renders no badge when `visibilityCircleId === null`.
- Renders the circle name as a `<span>` (text content assertion) when `visibilityCircleId` is in `circleNamesById`.
- **XSS assertion:** circle name `"<script>alert(1)</script>"` renders as the literal string in `textContent`, not as an executable tag in `innerHTML`.
- Foreign-org row (`orgId !== currentOrgId`) shows a tooltip including `postedByLabel`; own-org circle row shows "Shared with …" tooltip — assert tooltip strings via `title` attribute.
- **Name-leak guard:** when a row has `visibilityCircleId = C_unknown` (not in the map), the badge renders nothing — assert no `gold/80` pill in the DOM.

### 7.7 `test/components/deals/PostDealForm.test.tsx` (new or extended)

- Dropdown lists every passed-in circle by name; "Private (your org only)" is the default selected option.
- Selecting a circle sets `visibilityCircleId` to that id in the submitted raw payload (mock `postAction`, assert call args).
- Selecting "Private" submits `visibilityCircleId: null`.
- When `circles=[]` is passed in (org has no memberships), the dropdown is hidden or shows only the "Private" option (design pick: hide entirely so the form is a one-row layout — see §6.3 implementation).

### 7.8 Demo seed tests — `test/lib/demo/seed.test.ts` (extended)

- `getSeedCircles()` returns exactly 1 row with `id=201`, `name="AIYA Trusted Partners"`.
- `getSeedCircleIdsForOrg(DEMO_ORG_ID)` returns `[201]`.
- `getSeedCircleIdsForOrg(999)` returns `[]` (fixture org has no demo memberships).
- `getSeedCircleIdsForOrg(501)` and `(502)` return `[201]`.
- `getSeedDealsVisibleTo(DEMO_ORG_ID)` returns AIYA's 5 deals + the 3 cross-circle demo deals (8 total).
- All cross-circle demo deals (`id` 106-108) have `visibilityCircleId === 201` and `orgId !== DEMO_ORG_ID`.
- Subjects of cross-circle deals contain `"demo · simulated"` — honest provenance preserved.

### 7.9 Existing tests stay green

The slice-3 cross-org isolation tests (inventory, diamonds, deals) **must** pass without modification. The implementation plan should call out: run the full slice-3 test suite against the slice-4 code before claiming the slice is complete. Any green-→-red transition means the widening regressed slice-3's invariant.

The slice-2 `getActiveDeals` tenancy isolation test (org 1's deals don't leak to org 2's read) becomes a special case of "org 999 is in zero circles → degenerates to slice-3 form" — still green, structurally validated by §7.3's "zero-circles edge case".

---

## 8. Security & Threat Model

This is the load-bearing section of the slice. The risk surface is exactly: **a cross-org read or write that the membership graph would not authorize**. Every other change is plumbing.

### 8.1 Tenancy enforcement preserved

The slice-3 invariant — every read scoped to `currentOrgId` — is **preserved as the LEFT side of the OR**. Slice 4 widens visibility along an explicitly-bounded set of circle ids; it never replaces or relaxes the per-org clause. The widened query in the empty-circles case (`circleIds.length === 0`) is byte-identical to slice 3. Every test from slice 3 stays green.

The PR review must visually compare the widened `WHERE` clause to the slice-3 form. Acceptance criterion: the slice-3 `eq(deals.orgId, orgId)` term is present, unmodified, on the left of every new `or(...)`.

### 8.2 Read leakage via crafted input

There are no `orgId` or `circleId` parameters accepted by any read endpoint. Reads are scoped entirely by the **session-resolved** `orgId` (via `getCurrentOrgId()`). No client-side parameter can widen visibility beyond what the session's circle memberships allow.

The set of circle ids the query unions over is derived inside the server from `getCircleIdsForOrg(db, sessionOrgId)`. The client never sends a circle id to a read endpoint. URL search params (`?status=`, `?kind=`, `?category=`) AND on top of the widening; they cannot escape it.

The PR review's enforcement grep: `grep -rn "visibility" src/lib/deals/queries.ts` and `grep -rn "circleId" src/lib/*/validation.ts`. The second grep must show `visibilityCircleId` only inside `postDealInput` (the one write field) and nowhere in any read endpoint's input shape.

### 8.3 Auth bypass for write — never trust the body for membership

`visibilityCircleId` is the **one new wire field accepted by `postDeal`**, and it's validated by `isOrgMemberOfCircle(db, sessionOrgId, visibilityCircleId)` **before** the `INSERT`. The check:

- Runs against the **session-resolved** orgId, not anything the client supplies. Slice 3's invariant — orgId is never trusted from the wire — is preserved.
- Runs **before** the database insert, so a rejected post writes zero rows. The test in §7.4 asserts this by counting rows.
- Throws `ForbiddenError`, which the action wrapper translates to `{ ok: false, error: "Forbidden" }` and a `console.warn` audit log line.
- Returns `false` for circle ids that don't exist (defense against id-guessing — the FK never gets a chance to throw a database error that might leak information about which ids are valid).

Equally important: **slice 4 adds no new write paths for circle membership itself.** There is no API to insert into or delete from `circle_members` in this slice. Memberships are seeded via SQL or via a future onboarding slice (4c). The membership graph is read-mostly from the application's perspective, so the read-widening attack surface is well-bounded.

### 8.4 Cross-circle leakage between circles

The §7.3 multi-circle viewer test is the explicit assertion: if AIYA is in Circle A AND Circle B, a deal shared into A does NOT appear to a partner who's in B but not A. The widening filter uses **the viewer's** circle list (`getCircleIdsForOrg(viewerOrgId)`), not the union of all circles AIYA touches.

The risk pattern guarded against: "AIYA is in two circles, posts a deal into Circle A, a partner only-in-Circle-B sees it because they're 'connected' to AIYA". The widened query never joins on AIYA's circle list — it joins on the *viewer's* circle list. The test asserts the partner sees nothing.

### 8.5 Withdrawn deals

A deal in `Withdrawn` status remains in the table but is hidden from `getActiveDeals` (existing slice-2 behavior — the `eq(status, 'Open')` filter). The widening AND-clauses with the status filter, so Withdrawn cross-circle deals are also hidden from the panel. `getAllDeals` (admin view) shows Withdrawn rows when the filter chip is set to "Withdrawn" — the widened query returns Withdrawn cross-circle rows in that view too, which is the intended behavior (audit trail of circle-shared posts).

### 8.6 Circle name leakage in the UI

`formatDealVisibility` returns `kind: "private"` when the row's `visibility_circle_id` is not in the viewer's `circleNamesById` map. This is the belt-and-suspenders against a query bug surfacing a foreign circle name in the badge. The map itself is built from `getCirclesForOrg(viewerOrgId)`, which already excludes circles the viewer isn't in. The defensive fall-back means even if a future bug somewhere widens the query incorrectly, the UI silently degrades to "no badge" rather than rendering a name the viewer shouldn't know.

The test in §7.6 ("Name-leak guard") asserts the empty render path explicitly.

### 8.7 JWT integrity

Unchanged from slice 3. `orgId` stays in the signed JWT payload; the membership graph is a server-side join keyed on the session-resolved `orgId`. There is no in-band mechanism for a JWT to lie about circle membership — the `circle_members` table is the single source of truth, and `getCircleIdsForOrg` is the only path through it.

A user signing in as org 1 and forging a JWT with `orgId: 888` would not get 888's circle memberships, because the HS256 signature would fail verification — `verifySession` returns `null`, middleware redirects to `/login`.

### 8.8 PR review checklist (slice 4 exit gate)

Before merge:

- `grep -rn "from(deals)" src/` → every match goes through one of the widened helpers (`getActiveDeals`, `getAllDeals`) **or** is inside a write path that uses `eq(deals.orgId, sessionOrgId)`. No raw `SELECT * FROM deals` without the org or visibility filter.
- `grep -rn "circleId" src/lib/*/validation.ts` → matches only inside `postDealInput` (one write field). No read endpoint input schema accepts a circleId.
- `grep -rn "owner_org_id\|ownerOrgId" src/lib/` → either zero matches or matches only in `src/lib/circles/queries.ts` for the `CircleRow` projection. **`owner_org_id` is not used in any authorization decision this slice** — the PR review confirms this.
- The slice-3 cross-org isolation tests (`test/db/inventory.test.ts`, `test/db/diamonds.test.ts`, the original slice-2/3 `getActiveDeals` test) pass without modification.
- The new `isOrgMemberOfCircle` is called exactly once in `src/lib/deals/actions.ts` (inside `postDeal`). It is not called from any read path (read uses `getCircleIdsForOrg`).
- The widened `getActiveDeals` and `getAllDeals` left-OR clause is `eq(deals.orgId, orgId)` (byte-identical to slice 3).
- `npm run build` and `npm test` green.

### 8.9 Race conditions

A circle membership row could in principle be deleted between the `isOrgMemberOfCircle` check and the `INSERT INTO deals`. In that narrow window, a deal would be posted with a `visibility_circle_id` that the posting org is no longer a member of — meaning the posting org wouldn't see the deal in its own widened query (because it's no longer in the circle).

This is **not** a security issue (the membership-loss is in good faith; the deal is still org-owned and visible to the org's private clause), but it is a UX wart. Acceptable for this slice — there is no membership-mutation API in slice 4, so the race window only opens during admin SQL maintenance. When slice 4c adds the membership-mutation API, that slice's design must explicitly choose between (a) accepting this race, (b) re-checking inside a transaction, or (c) using a row-level `FOR UPDATE` lock on the membership row. Tracked as a slice-4c open question.

### 8.10 Demo mode

Seeded circles + cross-circle deals exist in the demo runtime but cannot be mutated (the `run`/`runWithUser` short-circuit at the top kills every write before it reaches the membership check). No UI path bypasses the demo guard — the PostDealForm's submit button still calls `postDeal`, which still returns the demo-disabled error first.

The demo widening filter (`getSeedDealsVisibleTo`) is itself a security-equivalent shape: it mirrors the real query's WHERE clause. A bug in `getSeedDealsVisibleTo` would be a demo-only display issue, never a real-data leak.

### 8.11 Audit logging — explicit gap

This slice adds one new audit line: the `console.warn` in `runWithUser`'s `ForbiddenError` branch (rejected circle posts). This is more than slice 3 had for cross-org access attempts but is still console-only. A proper audit-log table is tracked under slice 3's deferred "tenancy audit logs" + slice 2's deferred "deal_audit_log" — slice 4 does not unify them. The implementation plan should explicitly note: the warn line is for prod log discoverability only, not for compliance.

---

## 9. File Plan

### New files

| Path | Purpose |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/circles/queries.ts` | `getCircleIdsForOrg`, `getCirclesForOrg`, `listCircleMemberOrgs` (last one optional with the `/circles` route), `CircleRow` interface |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/circles/membership.ts` | `isOrgMemberOfCircle` — the authz primitive |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/auth/errors.ts` | `ForbiddenError` class for action-layer authz rejections |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/format.ts` | `formatDealVisibility` + `DealVisibility` type |
| `/Users/claytonhillyard/Downloads/dashboard project /root/drizzle/0005_*.sql` | Generated migration: `circles` + `circle_members` + `deals.visibility_circle_id` column + partial index |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/membership.test.ts` | `isOrgMemberOfCircle` truth table |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/queries.test.ts` | `getCircleIdsForOrg` + `getCirclesForOrg` tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/deals/format.test.ts` | `formatDealVisibility` tests including name-leak guard |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/deals/PostDealForm.test.tsx` | Dropdown + submit-payload tests (or extended if file exists) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/circles/page.tsx` | **OPTIONAL** — minimal list view of viewer's circles + members |

### Modified files

| Path | Change |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/schema.ts` | Add `circles` + `circleMembers` pgTables; add nullable `visibilityCircleId` column with `ON DELETE SET NULL` reference to `circles.id` on `deals` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/validation.ts` | Add `visibilityCircleId: z.number().int().positive().nullable().optional()` to `postDealInput` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/actions.ts` | Import `isOrgMemberOfCircle` + `ForbiddenError`; add membership pre-check in `postDeal`; thread `visibilityCircleId` into insert; extend `runWithUser` (and `run`) catch to map `ForbiddenError` → `{ ok: false, error: "Forbidden" }` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/queries.ts` | Widen `getActiveDeals` + `getAllDeals` with `or(eq(orgId), inArray(visibilityCircleId, circleIds))`; project `orgId` + `visibilityCircleId` through `COLUMNS`; extend `DealRow` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/demo/seed.ts` | Add `getSeedCircles`, `getSeedCircleIdsForOrg`, `getSeedDealsVisibleTo`; extend `getSeedDeals` with 3 cross-circle rows; add `orgId` + `visibilityCircleId` to every existing `DealRow` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/DealRoomPanel.tsx` | Accept `currentOrgId` + `circleNamesById`; render visibility badge with name-leak guard |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/deals/DealList.tsx` | Add Visibility column; pass `currentOrgId` + `circleNamesById` from page |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/deals/PostDealForm.tsx` | Add `circles` prop + "Share with" dropdown; submit `visibilityCircleId` in raw payload |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/deals/page.tsx` | Parallel-fetch `getCirclesForOrg`; build `circleNamesById`; thread into both child components |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/page.tsx` | Parallel-fetch `getCirclesForOrg`; build map; pass into `DashboardGrid.deals` ctx |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/DashboardGrid.tsx` | Widen `deals` prop type to `DealView` with `currentOrgId` + `circleNamesById` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/types.ts` | Extend `DealView` interface with `currentOrgId: number` + `circleNamesById: Map<number, string>` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/registry.tsx` | Thread new ctx fields into the `DealRoomPanel` render call |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/helpers/shared-db.ts` | Add third fixture org (id=888) to `seedOrgs()` — used by multi-circle isolation tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/deals/queries.test.ts` | Add multi-org / multi-circle widening tests (§7.3) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/deals/actions.test.ts` | Add authorized + unauthorized + nonexistent-circle post tests (§7.4); demo-guard precedence test |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/demo/seed.test.ts` | Extend with circles + memberships + `getSeedDealsVisibleTo` assertions |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/dashboard/DealRoomPanel.test.tsx` | Add badge render + XSS + name-leak tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/middleware.ts` | Add `"/circles"` to matcher **only if** the optional route lands this slice |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/Nav.tsx` | Add `"Circles": "/circles"` to `ROUTES` **only if** the optional route lands this slice |

### Removed files

None.

---

## 10. Out of Scope (Explicit)

| Feature | Assigned to |
|---|---|
| Cross-circle inventory share (TradeNet Inventory) | Slice 4b — TradeNet Inventory |
| Circle invitations / accept-decline flow | Slice 4c — Circle Onboarding |
| Per-circle RBAC (read-only vs read-write members) | Slice 4d — Circle Roles |
| Bidding / counter-offers on deals | Slice 5 — Auctions |
| Notifications when a new circle-visible deal is posted | Notifications slice (TBD) |
| Withdrawing membership / leaving a circle (UI) | Slice 4c |
| Circle deletion (UI) | Slice 4c |
| Per-org branding within circles (logo, theme) | Slice 4d or Branding slice (TBD) |
| Rate limit per circle | Existing slice-2g rate-limit slot, extended |
| Audit logging of cross-circle access attempts | Tenancy audit log slice (descended from slice 3 §10) |
| Public marketplace visibility (visible to ALL orgs, not a circle) | TBD — would extend `visibility_circle_id` semantics with a sentinel; deliberately not built this slice |
| Mockup 3 "Website Overview" | Slice 5 "Website Analytics" (different track) |
| `/circles/[slug]` deep-link route | Slice 4c |
| Circle membership audit trail (`created_at` is in the column but unused) | Slice 4c |
| Updating a deal's `visibility_circle_id` after posting (re-share) | TBD; semantics need design (re-share to a wider circle? to a different circle?) |
| Searching across circles | Slice 5 or later |
| Per-circle analytics ("which circles drive the most deal volume") | Reports slice (TBD) |
| `circles.owner_org_id` enabling owner-only mutations | Slice 4c |
| Cross-org diamond price-list sharing | Diamond-pricing future slice |
| Real-time circle deal feed (WebSocket) | Slice 2f — Live (deferred from slice 2) |

---
