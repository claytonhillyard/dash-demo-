# AIYA Slice 4 — Circles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the single-org Deal Room into a private cross-org B2B network. Add circles + circle_members tables, a nullable deals.visibility_circle_id, and widen every deals read with `OR visibility_circle_id IN (my circles)`. postDeal accepts an optional visibilityCircleId that is server-validated against actual circle membership before insert. Demo seeds AIYA + 2-3 partner orgs in an "AIYA Trusted Partners" circle.

**Architecture:** circles + circle_members are additive Drizzle tables. deals.visibility_circle_id is nullable with ON DELETE SET NULL. getCircleIdsForOrg + isOrgMemberOfCircle helpers feed both the read filter and the write-side membership check. UI gets a "Shared via [Circle]" badge per row + a "Connected to N circle(s)" header affordance. Zero-circles orgs hit identical slice-3 query plans (early return).

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind · Drizzle ORM · pglite (test) · Neon (prod) · jose (JWT) · Zod · Vitest · existing slice-2 Deal Room + slice-3 getCurrentOrgId() seam.

**Spec:** `docs/superpowers/specs/2026-05-28-aiya-circles-slice-4-design.md`

**Conventions:**
- Run a single test file: `npx vitest run <path>`
- DB/action tests use `// @vitest-environment node` and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` + `__setTestDb` pattern from `test/helpers/shared-db.ts`.
- All deals reads scope by **either** `eq(deals.orgId, currentOrgId)` (the slice-3 invariant) **or** `inArray(deals.visibilityCircleId, viewerCircleIds)` — never widen any further. The PR review confirms the left-OR clause is byte-identical to slice 3.
- Action input schemas (Zod) accept `visibilityCircleId` as the **one** new optional field. They never accept `orgId`. Membership is verified server-side from `requireSession().orgId`, never from the wire.
- No `/circles` admin route this slice (deferred to slice 4c "Circle Onboarding"). The plan deliberately does not implement that page.
- Commit after every green step.

> ## CRITICAL — Zero-circles SQL fallback (B3/B4 load-bearing branch)
>
> When `getCircleIdsForOrg(viewer)` returns `[]`, the widened query MUST fall back to **byte-identical** slice-3 SQL — `eq(deals.orgId, viewer)` with no `or(...)`, no `inArray(visibilityCircleId, [])`. Drizzle's `inArray(col, [])` and PG's `IN ()` are dialect-dependent (some bomb at parse, others reduce to `false` and silently drop every row including the viewer's own). Use an **explicit early-return branch** for the empty case. The B5 test "(d) zero-circles edge case — org 999 sees exactly its own deals" is the regression guard.

> ## CRITICAL — Membership-check / insert race (slice 4c sentinel)
>
> The pattern in postDeal is `if (!isOrgMemberOfCircle(orgId, circleId)) throw; await db.insert(deals)`. Slice 4 ships **no** API to mutate `circle_members`, so the race window only opens during admin SQL — acceptable. The B7 sentinel test asserts `addOrgToCircle` and `removeOrgFromCircle` helpers do NOT exist in this codebase. The moment slice 4c lands those helpers, the sentinel fails, forcing the slice 4c author to choose: (a) accept the race, (b) re-check inside a transaction, or (c) `SELECT … FOR UPDATE` on the membership row. Do NOT delete the sentinel test in slice 4 to "fix the test" — the failure IS the obligation.

> ## CRITICAL — Migration order dependency on slice 3
>
> `drizzle/0005_*.sql` runs against a DB that already has `0004_*.sql` applied (slice 3 orgs table + AIYA seed at id=1). The new FKs `circles.owner_org_id → orgs.id` and `circle_members.org_id → orgs.id` are referentially valid only because slice 3 already created `orgs` AND backfilled AIYA. This migration is **schema-only** — no seed data — and must include a `-- schema-only; no seed data in this migration` SQL comment at the top so a future executor does not infer a missing seed step.

> ## CRITICAL — Visibility badge name-leak guard
>
> `formatDealVisibility(visibilityCircleId, circleNamesById)` returns `kind: "private"` for any `visibilityCircleId` that is not in the viewer's `circleNamesById` map. The widened query (B3/B4) makes this unreachable in well-formed code — you only see a row whose `visibilityCircleId` is in your circle ids — but the defensive fallback prevents a future bug in the query path from surfacing a circle name to a viewer who shouldn't know it. The C6 "name-leak guard" test asserts this explicitly.

---

## Task 0: Set up worktree

**Files:** none (environment setup)

- [ ] **Step 1: From repo root, create the worktree.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root" && git worktree add -b feature/aiya-circles-4 .worktrees/aiya-circles-4 main`
  Expected: new worktree directory at `.worktrees/aiya-circles-4`, branch `feature/aiya-circles-4` checked out there.

- [ ] **Step 2: Switch to the worktree and install.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-circles-4" && npm install`
  Expected: clean install; no errors.

- [ ] **Step 3: Verify baseline tests pass.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-circles-4" && npm test -- --run`
  Expected: full suite green (the post-slice-3 baseline). If anything fails, STOP — the baseline is broken, not your code.

(All subsequent `cd` commands in this plan reference the worktree path. Use `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-circles-4"` before any command.)

---

## Phase A — Foundation (data model + helpers + demo seed)

Phase A adds the new `circles` + `circle_members` tables, the `deals.visibility_circle_id` column, the `getCircleIdsForOrg` / `isOrgMemberOfCircle` helpers, and the demo seed extension. **No deals read or write path changes behavior in Phase A.** Phase B widens the queries.

### Task A1: Add `circles` + `circle_members` tables + `deals.visibility_circle_id` column to schema

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `test/db/schema.test.ts`

- [ ] **Step 1: Failing schema assertions.** Append a new `it(...)` to the existing `describe("db schema", …)` in `test/db/schema.test.ts`:

```ts
  it("exports the circles table with id/name/slug/ownerOrgId/createdAt", () => {
    expect(schema.circles).toBeDefined();
    expect(schema.circles.id.columnType).toBe("PgSerial");
    expect(schema.circles.name.columnType).toBe("PgText");
    expect(schema.circles.slug.columnType).toBe("PgText");
    expect(schema.circles.ownerOrgId.columnType).toBe("PgInteger");
    expect(schema.circles.createdAt.columnType).toBe("PgTimestamp");
  });

  it("exports the circleMembers junction with circleId/orgId/createdAt", () => {
    expect(schema.circleMembers).toBeDefined();
    expect(schema.circleMembers.id.columnType).toBe("PgSerial");
    expect(schema.circleMembers.circleId.columnType).toBe("PgInteger");
    expect(schema.circleMembers.orgId.columnType).toBe("PgInteger");
    expect(schema.circleMembers.createdAt.columnType).toBe("PgTimestamp");
  });

  it("exports deals.visibilityCircleId as a nullable PgInteger", () => {
    expect(schema.deals.visibilityCircleId).toBeDefined();
    expect(schema.deals.visibilityCircleId.columnType).toBe("PgInteger");
    // notNull is false because the field is nullable (private = NULL).
    expect(schema.deals.visibilityCircleId.notNull).toBe(false);
  });
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/schema.test.ts`
Expected: FAIL — `schema.circles`, `schema.circleMembers`, and `schema.deals.visibilityCircleId` are undefined.

- [ ] **Step 3: Add `circles` + `circleMembers` tables.** Open `src/db/schema.ts`. Immediately after the `orgs` table definition (line 24, the closing `);`) and **before** `revenueMonths`, append:

```ts
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

- [ ] **Step 4: Add `visibilityCircleId` to the `deals` table.** In the same file, locate the `deals` table definition (currently ~line 159). Inside the column block, after `postedByLabel: text("posted_by_label").notNull(),` (currently ~line 175) and before `createdAt:` (currently ~line 176), insert:

```ts
    visibilityCircleId: integer("visibility_circle_id").references(
      () => circles.id,
      { onDelete: "set null" },
    ),
```

(No `.notNull()` — the column defaults to `NULL` for any existing row, which is the slice-2 "private" behavior.)

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/db/schema.test.ts`
Expected: PASS — all three new assertions green.

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean. `circles` is declared before `circleMembers` and `deals` references it via the arrow closure, so the forward reference resolves.

- [ ] **Step 7: Commit.**
```bash
git add src/db/schema.ts test/db/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): circles + circle_members tables + deals.visibility_circle_id column

circles records (id, name, slug UNIQUE, owner_org_id → orgs.id, created_at).
circle_members junction (circle_id, org_id, UNIQUE on the pair) with indexes
on org_id (hot read path) and circle_id (future member-list view).
deals.visibility_circle_id is nullable, references circles.id with
ON DELETE SET NULL, so a deleted circle preserves history.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration `drizzle/0005_*.sql` + schema-only header + smoke test

**Files:**
- Create: `drizzle/0005_*.sql` (generated, then hand-edited with header comment)
- Modify: `drizzle/meta/_journal.json` + new snapshot (generated)
- Create: `test/db/circles-migration.test.ts`

- [ ] **Step 1: Generate the migration.** Run: `npm run db:generate`
Expected: a new `drizzle/0005_<name>.sql` appears. It should contain, in order:
  - `CREATE TABLE "circles" (...)` + `CREATE UNIQUE INDEX "circles_slug_uniq" …` + `CREATE INDEX "circles_owner_org_idx" …`.
  - `CREATE TABLE "circle_members" (...)` + the three indexes (unique + 2 individual).
  - `ALTER TABLE "deals" ADD COLUMN "visibility_circle_id" integer REFERENCES "circles"("id") ON DELETE SET NULL;`

  If the command appears to hang waiting for input, report BLOCKED.

- [ ] **Step 2: Inspect the generated SQL.** Open `drizzle/0005_*.sql` and confirm:
  - `circles` is the first CREATE TABLE.
  - `circle_members` is the second CREATE TABLE.
  - The `deals.visibility_circle_id` ADD COLUMN explicitly emits `ON DELETE SET NULL`.
  - No seed INSERTs of any specific circle or membership (prod migration is schema-only).

- [ ] **Step 3: Hand-edit the migration to add the schema-only header.** Open `drizzle/0005_*.sql` and prepend, before any SQL:

```sql
-- schema-only; no seed data in this migration.
-- circles/circle_members start empty in prod; the demo seed lives in src/lib/demo/seed.ts.
-- See docs/superpowers/plans/2026-05-28-aiya-circles-slice-4.md for context.
```

(Unlike slice 3's `0004_*.sql`, this migration does NOT require regeneration discipline — there's no hand-appended INSERT block. Re-running `db:generate` here would just overwrite the SQL header comment, but the SQL itself would still be correct. The header is still important for human readers.)

- [ ] **Step 4: Failing migration smoke test.** Create `test/db/circles-migration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/client";
import { circles, circleMembers, deals } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("circles migration", () => {
  it("creates the circles + circle_members tables empty", async () => {
    const t = await createTestDb();
    close = t.close;
    expect(await t.db.select().from(circles)).toEqual([]);
    expect(await t.db.select().from(circleMembers)).toEqual([]);
  });

  it("enforces circles.slug uniqueness", async () => {
    const t = await createTestDb();
    close = t.close;
    await t.db.insert(circles).values({ name: "A", slug: "shared", ownerOrgId: 1 });
    await expect(
      t.db.insert(circles).values({ name: "B", slug: "shared", ownerOrgId: 1 })
    ).rejects.toThrow();
  });

  it("enforces circle_members (circle_id, org_id) uniqueness", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning({ id: circles.id });
    await t.db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    await expect(
      t.db.insert(circleMembers).values({ circleId: c.id, orgId: 1 })
    ).rejects.toThrow();
  });

  it("rejects a circle owner_org_id with no matching orgs row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    await expect(
      t.db.insert(circles).values({ name: "X", slug: "x", ownerOrgId: 99999 })
    ).rejects.toThrow();
  });

  it("rejects a circle_members.org_id with no matching orgs row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "Y", slug: "y", ownerOrgId: 1 })
      .returning({ id: circles.id });
    await expect(
      t.db.insert(circleMembers).values({ circleId: c.id, orgId: 99999 })
    ).rejects.toThrow();
  });

  it("rejects a deals.visibility_circle_id with no matching circles row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    await expect(
      t.db.execute(sql`
        INSERT INTO deals (org_id, kind, category, subject, quantity, price_cents,
          posted_by_label, visibility_circle_id)
        VALUES (1, 'SELL', 'Diamond', 'x', 1, 100, 'boss', 99999)
      `)
    ).rejects.toThrow();
  });

  it("ON DELETE SET NULL: deleting a circle nulls deals.visibility_circle_id without deleting the deal", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "Z", slug: "z", ownerOrgId: 1 })
      .returning({ id: circles.id });
    const [d] = await t.db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "shared",
      quantity: 1, priceCents: 100, postedByLabel: "boss",
      visibilityCircleId: c.id,
    }).returning({ id: deals.id });

    await t.db.execute(sql`DELETE FROM circles WHERE id = ${c.id}`);

    const rows = await t.db.select({
      id: deals.id, vis: deals.visibilityCircleId,
    }).from(deals);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(d.id);
    expect(rows[0].vis).toBeNull();
  });
});
```

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/db/circles-migration.test.ts`
Expected: PASS (7 tests). If "relation circles does not exist", Step 1 didn't run or the file wasn't generated.

- [ ] **Step 6: Commit.**
```bash
git add drizzle test/db/circles-migration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): generate 0005 migration (circles + circle_members + deals.visibility_circle_id)

Schema-only migration — circles and circle_members start empty in prod;
the demo circle seed lives in src/lib/demo/seed.ts and never touches the DB.
deals.visibility_circle_id uses ON DELETE SET NULL so deleting a circle
preserves history rather than cascading deletes onto the posting org's row.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Create `src/lib/circles/queries.ts` with `getCircleIdsForOrg` + `getCirclesForOrg` + `getCircleNamesForOrg`

**Files:**
- Create: `src/lib/circles/queries.ts`
- Create: `test/lib/circles/queries.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/circles/queries.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import {
  getCircleIdsForOrg,
  getCirclesForOrg,
  getCircleNamesForOrg,
} from "@/lib/circles/queries";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function makeCircle(name: string, slug: string, ownerOrgId = 1): Promise<number> {
  const [row] = await db.insert(circles)
    .values({ name, slug, ownerOrgId })
    .returning({ id: circles.id });
  return row.id;
}

describe("getCircleIdsForOrg", () => {
  it("returns [] for an org with no memberships", async () => {
    expect(await getCircleIdsForOrg(db, 1)).toEqual([]);
  });

  it("returns the full set of ids for an org in multiple circles", async () => {
    const a = await makeCircle("A", "a");
    const b = await makeCircle("B", "b");
    const c = await makeCircle("C", "c");
    await db.insert(circleMembers).values([
      { circleId: a, orgId: 1 },
      { circleId: b, orgId: 1 },
      { circleId: c, orgId: 999 },
    ]);
    const ids = await getCircleIdsForOrg(db, 1);
    expect(ids.sort()).toEqual([a, b].sort());
  });

  it("scopes to the requested org (org 999 sees only its own memberships)", async () => {
    const a = await makeCircle("A", "a");
    await db.insert(circleMembers).values([
      { circleId: a, orgId: 1 },
    ]);
    expect(await getCircleIdsForOrg(db, 999)).toEqual([]);
  });
});

describe("getCirclesForOrg", () => {
  it("returns joined CircleRow[] with name + slug populated", async () => {
    const a = await makeCircle("Alpha", "alpha");
    await db.insert(circleMembers).values({ circleId: a, orgId: 1 });
    const rows = await getCirclesForOrg(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: a, name: "Alpha", slug: "alpha", ownerOrgId: 1 });
  });

  it("returns [] for an org with no memberships", async () => {
    expect(await getCirclesForOrg(db, 1)).toEqual([]);
  });
});

describe("getCircleNamesForOrg", () => {
  it("returns a Map<id, name> for the viewer's circles", async () => {
    const a = await makeCircle("Alpha", "alpha");
    const b = await makeCircle("Beta", "beta");
    await db.insert(circleMembers).values([
      { circleId: a, orgId: 1 },
      { circleId: b, orgId: 1 },
    ]);
    const map = await getCircleNamesForOrg(db, 1);
    expect(map.get(a)).toBe("Alpha");
    expect(map.get(b)).toBe("Beta");
    expect(map.size).toBe(2);
  });

  it("returns an empty Map for an org with no memberships", async () => {
    const map = await getCircleNamesForOrg(db, 1);
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/queries.test.ts`
Expected: FAIL — module `@/lib/circles/queries` not found.

- [ ] **Step 3: Implement.** Create `src/lib/circles/queries.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circles, circleMembers } from "@/db/schema";

export interface CircleRow {
  id: number;
  name: string;
  slug: string;
  ownerOrgId: number;
}

/** Returns the circle ids that an org is currently a member of.
 *  Hot read path — feeds the widened deals query. */
export async function getCircleIdsForOrg(db: Db, orgId: number): Promise<number[]> {
  const rows = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(eq(circleMembers.orgId, orgId));
  return rows.map((r) => r.circleId);
}

/** Returns the full circle rows an org belongs to — used by the PostDealForm
 *  dropdown and the panel's circle-name lookup map. */
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

/** Convenience helper for the UI: returns a Map<circleId, name>. The map only
 *  ever contains circles the viewer is a member of, so it's safe to surface
 *  any value as a display label. */
export async function getCircleNamesForOrg(
  db: Db,
  orgId: number,
): Promise<Map<number, string>> {
  const rows = await getCirclesForOrg(db, orgId);
  return new Map(rows.map((r) => [r.id, r.name] as const));
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/queries.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/circles/queries.ts test/lib/circles/queries.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): getCircleIdsForOrg + getCirclesForOrg + getCircleNamesForOrg

Three helpers, one source of truth: getCircleIdsForOrg returns a flat
number[] for the hot read path (deals query widening); getCirclesForOrg
returns full CircleRow[] for UI dropdowns; getCircleNamesForOrg returns
a Map<id, name> for badge label lookup. The map only contains circles
the viewer is a member of, so it's safe to surface any value as a label.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Create `src/lib/circles/membership.ts` with `isOrgMemberOfCircle`

**Files:**
- Create: `src/lib/circles/membership.ts`
- Create: `test/lib/circles/membership.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/circles/membership.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { isOrgMemberOfCircle } from "@/lib/circles/membership";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function makeCircle(name: string, slug: string, ownerOrgId = 1): Promise<number> {
  const [row] = await db.insert(circles)
    .values({ name, slug, ownerOrgId })
    .returning({ id: circles.id });
  return row.id;
}

describe("isOrgMemberOfCircle", () => {
  it("returns true when the membership row exists", async () => {
    const c = await makeCircle("A", "a");
    await db.insert(circleMembers).values({ circleId: c, orgId: 1 });
    expect(await isOrgMemberOfCircle(db, 1, c)).toBe(true);
  });

  it("returns false when no membership row exists", async () => {
    const c = await makeCircle("A", "a");
    expect(await isOrgMemberOfCircle(db, 1, c)).toBe(false);
  });

  it("returns false when only the OTHER org is a member of the circle", async () => {
    const c = await makeCircle("A", "a");
    await db.insert(circleMembers).values({ circleId: c, orgId: 999 });
    expect(await isOrgMemberOfCircle(db, 1, c)).toBe(false);
  });

  it("returns false for a circle id that does not exist (no FK error leak)", async () => {
    expect(await isOrgMemberOfCircle(db, 1, 99999)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/membership.test.ts`
Expected: FAIL — module `@/lib/circles/membership` not found.

- [ ] **Step 3: Implement.** Create `src/lib/circles/membership.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circleMembers } from "@/db/schema";

/** Truth check used by post-time write authorization. Hits the
 *  (circle_id, org_id) unique-constraint composite index directly via the
 *  WHERE clause + LIMIT 1 — PG short-circuits on the first match.
 *
 *  Returns false for circle ids that do not exist (defense against id-guessing
 *  — we never let the FK throw a DB error that could leak which ids are valid). */
export async function isOrgMemberOfCircle(
  db: Db,
  orgId: number,
  circleId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: circleMembers.id })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, orgId)))
    .limit(1);
  return rows.length > 0;
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/membership.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/circles/membership.ts test/lib/circles/membership.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): isOrgMemberOfCircle authz primitive

Single-purpose helper for write-time membership check. Lives in its own
file (separate from queries.ts) so a security audit grep on
'isOrgMemberOfCircle' surfaces both the call site in postDeal and the
definition — nothing else. Returns false for nonexistent circle ids
without letting the FK throw, so attackers can't probe the id space
through error timing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Extend `test/helpers/shared-db.ts` to seed fixture org id=888 (for cross-circle isolation tests)

**Files:**
- Modify: `test/helpers/shared-db.ts`

- [ ] **Step 1: Verify the current seed.** Run:
```
grep -n "999" test/helpers/shared-db.ts
```
Expected: shows the existing seed inserts `999` as the fixture org. Slice 4 adds a **third** fixture org at id=888 so cross-circle tests can use a viewer that's not in any circle (888) against a viewer that IS in a circle (1).

- [ ] **Step 2: Failing assertion.** Add a one-off scratch test in `test/helpers/shared-db.test.ts` (new file) to motivate the change:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "./shared-db";
import { orgs } from "@/db/schema";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

describe("shared-db org seed", () => {
  it("seeds AIYA (id=1), fixture (id=999), and partner (id=888) on reset", async () => {
    await resetSharedDb();
    const rows = await db.select({ id: orgs.id, slug: orgs.slug }).from(orgs);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([1, 888, 999]);
    expect(rows.find((r) => r.id === 888)?.slug).toBe("partner");
  });
});
```

- [ ] **Step 3: Run to verify FAIL.** Run: `npx vitest run test/helpers/shared-db.test.ts`
Expected: FAIL — id=888 is missing from the seed.

- [ ] **Step 4: Extend the seed.** Open `test/helpers/shared-db.ts`. Locate `seedOrgs` (around line 33). Replace the two `db.execute(sql`…`)` calls with:

```ts
async function seedOrgs(db: Db): Promise<void> {
  // Idempotent: re-inserting after the migration is a no-op via ON CONFLICT.
  // id=1 = AIYA (slice 3), id=999 = primary fixture (slice 3 cross-org isolation),
  // id=888 = partner fixture (slice 4 cross-circle tests — viewer with no
  // circle memberships, paired with AIYA which IS in a circle).
  await db.execute(sql`
    INSERT INTO orgs (id, name, slug) VALUES
      (1,   'AIYA Designs', 'aiya'),
      (999, 'Fixture Org',  'fixture'),
      (888, 'Partner Org',  'partner')
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('orgs', 'id'),
      GREATEST(999, (SELECT COALESCE(MAX(id), 1) FROM orgs))
    );
  `);
}
```

Also update the docstring comment block at the top of the file (around line 19-28) — replace the slice-3 paragraph with:

```ts
 * Multi-tenant seeding (slice 3 + slice 4): the migration's hand-edited block
 * already seeds AIYA at id=1, but the post-migrate `seedOrgs()` step below
 * also inserts two fixture orgs:
 *   - id=999 ("Fixture Org") — original slice-3 cross-org isolation tests.
 *   - id=888 ("Partner Org") — slice-4 cross-circle tests use this as the
 *     "viewer with no circle memberships" or "partner that shares a circle
 *     with AIYA", depending on the test's setup.
 * After every `resetSharedDb()` we re-insert all three rows (TRUNCATE CASCADE
 * wipes them) so every test starts from the same baseline.
```

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/helpers/shared-db.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full deals + circles suite to confirm no regression.** Run:
```
npx vitest run test/lib/deals test/lib/circles test/db/inventory.test.ts test/db/diamonds.test.ts
```
Expected: green. The slice-3 tests still pass because id=888 is additive; they only ever insert with orgId=1 or 999, and the new row is ignored by their queries.

- [ ] **Step 7: Commit.**
```bash
git add test/helpers/shared-db.ts test/helpers/shared-db.test.ts
git commit -m "$(cat <<'EOF'
test(helpers): seed third fixture org (id=888) for slice-4 cross-circle tests

AIYA stays at id=1, primary fixture at id=999 (slice-3 cross-org isolation
unchanged). New id=888 is the cross-circle partner fixture: it joins
the test-fixture circle alongside AIYA so cross-circle visibility
assertions can use a real third party. Slice-3 tests are unaffected —
they only insert with orgId in {1, 999} and never query against 888.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: Extend `src/lib/demo/seed.ts` with circles + memberships + cross-circle demo deals

**Files:**
- Modify: `src/lib/demo/seed.ts`
- Modify: `src/lib/deals/queries.ts` (add `orgId` + `visibilityCircleId` to `DealRow` interface — needed so demo seed rows type-check)
- Modify: `test/lib/demo/seed.test.ts` (extend) — if no file exists yet, create one
- Modify: `test/lib/deals/queries.test.ts` (extend `insert()` helper signature — `orgId` is already supported, but the test fixture inserts now need to supply `visibilityCircleId: null` to clarify intent; the helper spread already handles missing fields)

> **Note:** A6 widens `DealRow` (`orgId` + `visibilityCircleId`) which is also needed for B3/B4. We add the field here so the demo seed compiles; B3/B4 wire the field into the actual SQL projection.

- [ ] **Step 1: Extend `DealRow`.** Open `src/lib/deals/queries.ts`. Add two fields to `interface DealRow`:

```ts
export interface DealRow {
  id: number;
  orgId: number;
  kind: DealKind;
  category: DealCategory;
  subject: string;
  quantity: number;
  priceCents: number;
  currency: string;
  status: DealStatus;
  postedByLabel: string;
  visibilityCircleId: number | null;
  createdAt: Date;
}
```

(B3/B4 will widen the `COLUMNS` projection to populate these fields from the DB.)

- [ ] **Step 2: Failing demo seed test.** Create or extend `test/lib/demo/seed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  getSeedDeals,
  getSeedCircles,
  getSeedCircleIdsForOrg,
  getSeedDealsVisibleTo,
  DEMO_AIYA_ORG_ID,
  DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
} from "@/lib/demo/seed";

describe("getSeedCircles", () => {
  it("returns exactly one demo circle: AIYA Trusted Partners", () => {
    const circles = getSeedCircles();
    expect(circles).toHaveLength(1);
    expect(circles[0]).toMatchObject({
      id: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      name: "AIYA Trusted Partners",
      slug: "aiya-trusted-partners",
      ownerOrgId: DEMO_AIYA_ORG_ID,
    });
  });
});

describe("getSeedCircleIdsForOrg", () => {
  it("returns the demo circle for AIYA", () => {
    expect(getSeedCircleIdsForOrg(DEMO_AIYA_ORG_ID))
      .toEqual([DEMO_TRUSTED_PARTNERS_CIRCLE_ID]);
  });

  it("returns the demo circle for each fixture partner org", () => {
    expect(getSeedCircleIdsForOrg(501)).toEqual([DEMO_TRUSTED_PARTNERS_CIRCLE_ID]);
    expect(getSeedCircleIdsForOrg(502)).toEqual([DEMO_TRUSTED_PARTNERS_CIRCLE_ID]);
  });

  it("returns [] for any unseeded org", () => {
    expect(getSeedCircleIdsForOrg(999)).toEqual([]);
    expect(getSeedCircleIdsForOrg(7777)).toEqual([]);
  });
});

describe("getSeedDeals (extended)", () => {
  it("includes AIYA's original 5 deals (slice 2) unchanged", () => {
    const deals = getSeedDeals();
    const aiyaIds = deals.filter((d) => d.orgId === DEMO_AIYA_ORG_ID).map((d) => d.id);
    expect(aiyaIds).toEqual([101, 102, 103, 104, 105]);
  });

  it("includes 3 cross-circle deals from partner orgs into the demo circle", () => {
    const deals = getSeedDeals();
    const partner = deals.filter((d) => d.orgId !== DEMO_AIYA_ORG_ID);
    expect(partner.map((d) => d.id).sort()).toEqual([106, 107, 108]);
    for (const d of partner) {
      expect(d.visibilityCircleId).toBe(DEMO_TRUSTED_PARTNERS_CIRCLE_ID);
    }
  });

  it("every cross-circle demo deal subject contains 'demo · simulated' (honest provenance)", () => {
    const deals = getSeedDeals();
    const cross = deals.filter((d) => d.orgId !== DEMO_AIYA_ORG_ID);
    for (const d of cross) {
      expect(d.subject.toLowerCase()).toContain("demo · simulated");
    }
  });

  it("AIYA's 5 original deals have visibilityCircleId = null (slice-2 private behavior)", () => {
    const deals = getSeedDeals();
    const aiya = deals.filter((d) => d.orgId === DEMO_AIYA_ORG_ID);
    for (const d of aiya) {
      expect(d.visibilityCircleId).toBeNull();
    }
  });
});

describe("getSeedDealsVisibleTo", () => {
  it("returns AIYA's private deals + cross-circle deals shared into circles AIYA is in", () => {
    const rows = getSeedDealsVisibleTo(DEMO_AIYA_ORG_ID);
    const ids = rows.map((d) => d.id).sort();
    expect(ids).toEqual([101, 102, 103, 104, 105, 106, 107, 108]);
  });

  it("an unseeded org sees no demo deals", () => {
    expect(getSeedDealsVisibleTo(9999)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify FAIL.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: FAIL — none of the new exports exist; `getSeedDeals()` still returns 5 rows without `orgId` / `visibilityCircleId`.

- [ ] **Step 4: Extend `src/lib/demo/seed.ts`.** Replace the file with:

```ts
import type { InventorySummary } from "@/db/inventory";
import type { DiamondSummary } from "@/db/diamonds";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";
import type { DealRow } from "@/lib/deals/queries";

const COUNTS: Record<InventoryCategory, number> = {
  Rings: 1240, Necklaces: 980, Earrings: 870, Bracelets: 620, Pendants: 450,
  Chains: 320, "Watch Bands": 150, Diamonds: 2350, Gems: 1120,
};

export function seedInventorySummary(): InventorySummary {
  const counts = { ...COUNTS };
  const total = INVENTORY_CATEGORIES.reduce((n, c) => n + counts[c], 0);
  return { counts, total, updatedAt: new Date() };
}

export function seedDiamondSummary(): DiamondSummary {
  return {
    naturalIndex: { cents: 645320, change24hPct: -0.62 },
    labIndex: { cents: 103210, change24hPct: 2.16 },
    points: [
      { label: "Pink Diamond 1ct", kind: "fancy_diamond", cents: 1265000 },
      { label: "Blue Diamond 1ct", kind: "fancy_diamond", cents: 1825000 },
      { label: "Yellow Diamond 1ct", kind: "fancy_diamond", cents: 798000 },
      { label: "Emerald (per ct)", kind: "gem", cents: 210000 },
      { label: "Sapphire (per ct)", kind: "gem", cents: 160000 },
    ],
    updatedAt: new Date(),
  };
}

// Fixed reference instant so relative ages are deterministic across renders.
// (Real `getActiveDeals` runs against the DB; this only fires when isDemoMode().)
const DEMO_REF = new Date("2026-05-28T12:00:00Z").getTime();

// --- Slice 4 demo seed: circles + memberships + cross-circle deals ---
// Demo-only ids; never collide with shared-db test fixtures (1, 999, 888)
// or with prod org ids (which all live below ~500 in practice).

/** AIYA's seeded id in demo mode — same constant getCurrentOrgId returns. */
export const DEMO_AIYA_ORG_ID = 1;

/** The single demo circle. id=201 is high enough to never collide with
 *  shared-db fixtures and low enough to read as obviously seeded. */
export const DEMO_TRUSTED_PARTNERS_CIRCLE_ID = 201;

/** Demo-only partner org ids — they only exist in this file's mental model
 *  (the Netlify demo never boots pglite). 501 / 502 / 503 are visually
 *  distinct from the shared-db 888/999 range. */
export const DEMO_PARTNER_ORG_IDS = {
  MEHTA: 501,    // Mehta Diamonds — Mumbai
  SAINT_CLOUD: 502, // Saint-Cloud Gems — Geneva
  MARATHI: 503,  // Marathi Trading — Surat
} as const;

export interface SeedCircle {
  id: number;
  name: string;
  slug: string;
  ownerOrgId: number;
}

export function getSeedCircles(): SeedCircle[] {
  return [
    {
      id: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      name: "AIYA Trusted Partners",
      slug: "aiya-trusted-partners",
      ownerOrgId: DEMO_AIYA_ORG_ID,
    },
  ];
}

/** Demo membership graph: AIYA + 3 partner orgs all belong to circle 201. */
export function getSeedCircleIdsForOrg(orgId: number): number[] {
  const memberships: Record<number, number[]> = {
    [DEMO_AIYA_ORG_ID]: [DEMO_TRUSTED_PARTNERS_CIRCLE_ID],
    [DEMO_PARTNER_ORG_IDS.MEHTA]: [DEMO_TRUSTED_PARTNERS_CIRCLE_ID],
    [DEMO_PARTNER_ORG_IDS.SAINT_CLOUD]: [DEMO_TRUSTED_PARTNERS_CIRCLE_ID],
    [DEMO_PARTNER_ORG_IDS.MARATHI]: [DEMO_TRUSTED_PARTNERS_CIRCLE_ID],
  };
  return memberships[orgId] ?? [];
}

export function getSeedDeals(): DealRow[] {
  return [
    // --- AIYA's original 5 deals (slice 2) — private (visibilityCircleId = null) ---
    {
      id: 101,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Diamond",
      subject: "Round 1.02ct G/VS1 natural — demo · simulated",
      quantity: 1,
      priceCents: 1240000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 2 * 3600 * 1000),
    },
    {
      id: 102,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "BUY",
      category: "Metal",
      subject: "18K gold chain lot, 10g per link — demo · simulated",
      quantity: 5,
      priceCents: 875000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 5 * 3600 * 1000),
    },
    {
      id: 103,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Gem",
      subject: "Colombian emerald 3.4ct, Gübelin cert — demo · simulated",
      quantity: 1,
      priceCents: 3400000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 26 * 3600 * 1000),
    },
    {
      id: 104,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Finished",
      subject: "Platinum diamond tennis bracelet — demo · simulated",
      quantity: 1,
      priceCents: 2250000,
      currency: "USD",
      status: "Filled",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 72 * 3600 * 1000),
    },
    {
      id: 105,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "BUY",
      category: "Diamond",
      subject: "Lab 2ct F/VVS2 any shape — demo · simulated",
      quantity: 3,
      priceCents: 620000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      visibilityCircleId: null,
      createdAt: new Date(DEMO_REF - 15 * 60 * 1000),
    },
    // --- Slice 4 cross-circle demo deals (partner orgs into AIYA Trusted Partners) ---
    {
      id: 106,
      orgId: DEMO_PARTNER_ORG_IDS.MEHTA,
      kind: "SELL",
      category: "Diamond",
      subject: "Round 2.51ct E/VVS1 GIA — Mumbai cutting — demo · simulated",
      quantity: 1,
      priceCents: 4850000,
      currency: "USD",
      status: "Open",
      postedByLabel: "Mehta Diamonds — Mumbai",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      createdAt: new Date(DEMO_REF - 45 * 60 * 1000),
    },
    {
      id: 107,
      orgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD,
      kind: "SELL",
      category: "Gem",
      subject: "Cushion Padparadscha 1.8ct, AGL cert — Geneva consignment — demo · simulated",
      quantity: 1,
      priceCents: 7200000,
      currency: "USD",
      status: "Open",
      postedByLabel: "Saint-Cloud Gems — Geneva",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      createdAt: new Date(DEMO_REF - 90 * 60 * 1000),
    },
    {
      id: 108,
      orgId: DEMO_PARTNER_ORG_IDS.MARATHI,
      kind: "BUY",
      category: "Metal",
      subject: "Looking for 24K bullion, 1kg bars — demo · simulated",
      quantity: 10,
      priceCents: 9700000,
      currency: "USD",
      status: "Open",
      postedByLabel: "Marathi Trading — Surat",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      createdAt: new Date(DEMO_REF - 180 * 60 * 1000),
    },
  ];
}

/** Mirror of the real widened query for the demo runtime. Returns the union
 *  of {rows where orgId === viewer} and {rows whose visibilityCircleId is in
 *  one of the viewer's seeded circles}. */
export function getSeedDealsVisibleTo(orgId: number): DealRow[] {
  const circleIds = new Set(getSeedCircleIdsForOrg(orgId));
  return getSeedDeals().filter(
    (d) =>
      d.orgId === orgId ||
      (d.visibilityCircleId !== null && circleIds.has(d.visibilityCircleId)),
  );
}
```

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit`
Expected: FAIL — `src/lib/deals/queries.ts` `COLUMNS` projection doesn't populate `orgId` / `visibilityCircleId` yet, and `getActiveDeals` / `getAllDeals` still return rows shaped like the old `DealRow`. This is a Phase-B fix; tsc will go green at the end of B4. **Do not commit yet** — combine the queries widening commit with the demo seed commit at B4's end? No — better to commit now and accept a momentarily red tsc on the queries cast (the demo seed itself is type-clean because the seed rows explicitly populate the new fields). Commit the seed + the `DealRow` interface widening together; B3/B4 closes the type gap on the SQL side.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/demo/seed.ts src/lib/deals/queries.ts test/lib/demo/seed.test.ts
git commit -m "$(cat <<'EOF'
feat(demo): seed AIYA Trusted Partners circle + 3 cross-circle partner deals

DealRow gains orgId + visibilityCircleId so the panel can render the
"Shared via [Circle]" badge and distinguish own-org from foreign-org rows.
Demo seed adds the AIYA Trusted Partners circle (id=201) with AIYA +
Mehta Diamonds (Mumbai) + Saint-Cloud Gems (Geneva) + Marathi Trading
(Surat) as members, plus 3 cross-circle deals (ids 106-108) each with
'demo · simulated' in the subject — honest provenance preserved.

getSeedDealsVisibleTo(orgId) mirrors the real widened query's WHERE
clause: union of own-org rows and visibility-circle rows the viewer is
a member of. The DB-side query widening (B3/B4) lands next, so the
queries.ts cast `as DealRow[]` stays red on tsc until B4 commits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A7: Phase A green-bar verification

**Files:** none (verification only)

- [ ] **Step 1: Run all Phase A test files.** Run:
```
npx vitest run test/db/schema.test.ts test/db/circles-migration.test.ts test/lib/circles test/lib/demo/seed.test.ts test/helpers/shared-db.test.ts
```
Expected: green.

- [ ] **Step 2: Confirm tsc is red ONLY on the deals-queries cast.** Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: errors point at `src/lib/deals/queries.ts` (the `as DealRow[]` cast because `COLUMNS` doesn't project `orgId` / `visibilityCircleId` yet). If errors point anywhere else, fix before moving to Phase B.

---

## Phase B — Server-side widening (the security-load-bearing slice)

Phase B is the actual feature. Every step here either widens a read or adds a write-side authz check. The PR review's load-bearing greps live in this phase.

> ## CRITICAL — Phase B order
>
> B1 (Zod) → B2 (postDeal authz) → B3 (getActiveDeals widening) → B4 (getAllDeals widening) → B5 (read isolation tests) → B6 (write isolation tests) → B7 (sentinel). **Do not skip ahead.** B5/B6 fail if B3/B4 isn't committed; B7 stands alone but must come last so the assertion's "do not exist" target is the final state.

### Task B1: Extend `postDealInput` Zod schema with optional `visibilityCircleId`

**Files:**
- Modify: `src/lib/deals/validation.ts`
- Modify: `test/lib/deals/validation.test.ts`

- [ ] **Step 1: Failing test.** Open `test/lib/deals/validation.test.ts` and append:

```ts
describe("postDealInput visibilityCircleId field", () => {
  it("accepts a positive integer visibilityCircleId", () => {
    const result = postDealInput.safeParse({
      kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 100, visibilityCircleId: 7,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.visibilityCircleId).toBe(7);
  });

  it("accepts an omitted visibilityCircleId (private deal)", () => {
    const result = postDealInput.safeParse({
      kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 100,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.visibilityCircleId).toBeUndefined();
  });

  it("accepts an explicit null visibilityCircleId (private deal)", () => {
    const result = postDealInput.safeParse({
      kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 100, visibilityCircleId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.visibilityCircleId).toBeNull();
  });

  it("rejects a non-positive visibilityCircleId", () => {
    expect(postDealInput.safeParse({
      kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 100, visibilityCircleId: 0,
    }).success).toBe(false);
    expect(postDealInput.safeParse({
      kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 100, visibilityCircleId: -1,
    }).success).toBe(false);
  });

  it("rejects a non-integer visibilityCircleId", () => {
    expect(postDealInput.safeParse({
      kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 100, visibilityCircleId: 1.5,
    }).success).toBe(false);
  });

  it("does not accept orgId in the input (slice-3 invariant preserved)", () => {
    const result = postDealInput.safeParse({
      kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 100, orgId: 999,
    });
    // Zod strips unknown fields by default; the parsed data must not contain orgId.
    expect(result.success).toBe(true);
    if (result.success) expect("orgId" in result.data).toBe(false);
  });
});
```

(Adjust the import at the top of the test file if `postDealInput` isn't already imported.)

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/deals/validation.test.ts`
Expected: FAIL — the "accepts positive integer" and "rejects non-positive" cases fail because the schema rejects the unknown field with `success: true` but drops it. (Zod doesn't reject unknown fields by default unless `.strict()`.) Specifically the "if (result.success) expect(result.data.visibilityCircleId).toBe(7)" fails because the field isn't in the schema.

- [ ] **Step 3: Implement.** Replace `src/lib/deals/validation.ts` with:

```ts
import { z } from "zod";
import { DEAL_KINDS, DEAL_CATEGORIES } from "./constants";

export const postDealInput = z.object({
  kind: z.enum(DEAL_KINDS),
  category: z.enum(DEAL_CATEGORIES),
  subject: z.string().trim().min(1, "subject is required").max(280, "subject must be 280 characters or fewer"),
  quantity: z.number().int().min(1),
  priceCents: z.number().int().min(0),
  currency: z.string().length(3).optional().default("USD"),
  // Slice 4: optional circle to share into. The schema only enforces shape —
  // server-side authz in postDeal verifies the orgId from session is actually
  // a member of this circle before the insert. See src/lib/deals/actions.ts.
  visibilityCircleId: z.number().int().positive().nullable().optional(),
});
export type PostDealInput = z.infer<typeof postDealInput>;

export const updateDealStatusInput = z.object({
  id: z.number().int(),
  // status is narrowed to terminal states only — "Open" is the insert default,
  // not a valid update target. Re-opening requires an audit trail (slice 2g).
  status: z.enum(["Filled", "Withdrawn"]),
});
export type UpdateDealStatusInput = z.infer<typeof updateDealStatusInput>;

export { firstZodError } from "@/lib/company/validation";
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/deals/validation.test.ts`
Expected: PASS (existing + 6 new cases).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/deals/validation.ts test/lib/deals/validation.test.ts
git commit -m "$(cat <<'EOF'
feat(deals): postDealInput accepts optional visibilityCircleId

z.number().int().positive().nullable().optional() — accepts undefined,
null, or a positive integer. The schema enforces only shape; the actual
membership check ("is the session's org a member of this circle?") runs
server-side in postDeal before the INSERT. orgId is NOT and never will
be in this schema — slice-3 invariant preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Extend `postDeal` with the membership pre-check

**Files:**
- Modify: `src/lib/deals/actions.ts`
- (No test changes here — B6 covers the post-side tenancy/authz tests.)

- [ ] **Step 1: Refactor `postDeal`.** Open `src/lib/deals/actions.ts`. Replace the `postDeal` function (lines 77-93) with:

```ts
export async function postDeal(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealInput, raw, async (input: PostDealInput, user, orgId) => {
    // Slice 4: if the caller wants the deal shared into a circle, the session's
    // org must actually be a member of that circle. Check runs against
    // session.orgId (never the wire) BEFORE the insert, so a rejected post
    // writes zero rows.
    if (input.visibilityCircleId !== undefined && input.visibilityCircleId !== null) {
      const allowed = await isOrgMemberOfCircle(db(), orgId, input.visibilityCircleId);
      if (!allowed) {
        console.warn(
          `[deals] forbidden post attempt by org=${orgId} user=${user}: ` +
          `not a member of circle=${input.visibilityCircleId}`
        );
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

- [ ] **Step 2: Add the `ForbiddenError` import + class.** At the top of `src/lib/deals/actions.ts`, add to the imports (after the `isDemoMode` import):

```ts
import { isOrgMemberOfCircle } from "@/lib/circles/membership";
```

Then add the `ForbiddenError` class directly inside `src/lib/deals/actions.ts`, just above the `ActionResult` type (around line 14):

```ts
/** Thrown inside a postDeal callback when the session's org is not a member
 *  of the requested visibility circle. Caught by runWithUser's catch and
 *  converted to { ok: false, error: "Forbidden" } with zero DB writes.
 *  Kept local to deals/actions.ts for slice 4 — promote to src/lib/auth/errors.ts
 *  if another action needs the same semantics. */
class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
```

- [ ] **Step 3: Extend `runWithUser` to translate `ForbiddenError` into a user-facing result.** In the same file, replace the `catch` block at the bottom of `runWithUser` (currently line 71-74) with:

```ts
  } catch (e) {
    if (e instanceof ForbiddenError) {
      // Audit-friendly log of the rejection; the warn already happened
      // inside the callback for full context (org + user + circle).
      return { ok: false, error: "Forbidden" };
    }
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
```

(Leave the `run` wrapper alone — slice 4 has no Forbidden semantics outside `postDeal`. If a future slice needs them in `run`, the same three-line edit applies.)

- [ ] **Step 4: Typecheck.** Run: `npx tsc --noEmit`
Expected: still red on the queries cast (B3/B4 closes it), but no new errors should appear from this edit. If new errors surface, fix before moving on.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/deals/actions.ts
git commit -m "$(cat <<'EOF'
feat(deals): postDeal verifies circle membership before INSERT

If postDealInput carries a non-null visibilityCircleId, postDeal calls
isOrgMemberOfCircle(session.orgId, circleId) BEFORE the INSERT. On
rejection it throws ForbiddenError, which runWithUser's catch translates
to { ok: false, error: "Forbidden" } with zero DB writes. Audit-friendly
console.warn logs every rejection with org + user + circle for prod
log discoverability (full audit-log table remains slice-3 §10 / 2-deferred).

ForbiddenError lives inline in deals/actions.ts because no other action
needs the semantics this slice. Promote to src/lib/auth/errors.ts when
a second use site appears.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Widen `getActiveDeals` with the OR-on-circles clause + early return on empty

**Files:**
- Modify: `src/lib/deals/queries.ts`

- [ ] **Step 1: Open `src/lib/deals/queries.ts`.** Replace the entire file with:

```ts
import { and, eq, or, desc, inArray, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedDealsVisibleTo } from "@/lib/demo/seed";
import { getCircleIdsForOrg } from "@/lib/circles/queries";
import type { DealKind, DealCategory, DealStatus } from "./constants";

export interface DealRow {
  id: number;
  orgId: number;
  kind: DealKind;
  category: DealCategory;
  subject: string;
  quantity: number;
  priceCents: number;
  currency: string;
  status: DealStatus;
  postedByLabel: string;
  visibilityCircleId: number | null;
  createdAt: Date;
}

export interface DealFilters {
  status?: DealStatus;
  kind?: DealKind;
  category?: DealCategory;
}

const COLUMNS = {
  id: deals.id,
  orgId: deals.orgId,
  kind: deals.kind,
  category: deals.category,
  subject: deals.subject,
  quantity: deals.quantity,
  priceCents: deals.priceCents,
  currency: deals.currency,
  status: deals.status,
  postedByLabel: deals.postedByLabel,
  visibilityCircleId: deals.visibilityCircleId,
  createdAt: deals.createdAt,
} as const;

/** Build the visibility OR clause for slice 4. When the viewer is in zero
 *  circles, returns the bare slice-3 clause `eq(deals.orgId, orgId)` —
 *  byte-identical to slice-3 behavior, no `or(...)`, no `inArray([])`. */
function visibilityClause(orgId: number, circleIds: number[]): SQL {
  if (circleIds.length === 0) {
    return eq(deals.orgId, orgId);
  }
  // Non-null assertion: or(...) with two truthy SQL fragments cannot return
  // undefined; Drizzle's overload only widens to undefined when given 0 args.
  return or(
    eq(deals.orgId, orgId),
    inArray(deals.visibilityCircleId, circleIds),
  )!;
}

export async function getActiveDeals(
  db: Db,
  orgId: number,
  limit: number = 5,
): Promise<DealRow[]> {
  if (isDemoMode()) {
    return getSeedDealsVisibleTo(orgId).filter((d) => d.status === "Open").slice(0, limit);
  }
  const circleIds = await getCircleIdsForOrg(db, orgId);
  const rows = await db
    .select(COLUMNS)
    .from(deals)
    .where(and(visibilityClause(orgId, circleIds), eq(deals.status, "Open")))
    .orderBy(desc(deals.createdAt))
    .limit(limit);
  return rows as DealRow[];
}

export async function getAllDeals(
  db: Db,
  orgId: number,
  filters: DealFilters = {},
): Promise<DealRow[]> {
  if (isDemoMode()) return getSeedDealsVisibleTo(orgId);
  const circleIds = await getCircleIdsForOrg(db, orgId);
  const clauses: SQL[] = [visibilityClause(orgId, circleIds)];
  if (filters.status) clauses.push(eq(deals.status, filters.status));
  if (filters.kind) clauses.push(eq(deals.kind, filters.kind));
  if (filters.category) clauses.push(eq(deals.category, filters.category));
  const rows = await db
    .select(COLUMNS)
    .from(deals)
    .where(and(...clauses))
    .orderBy(desc(deals.createdAt));
  return rows as DealRow[];
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean. The `as DealRow[]` cast now type-resolves because `COLUMNS` projects every `DealRow` field.

- [ ] **Step 3: Run the existing deals query tests.** Run: `npx vitest run test/lib/deals/queries.test.ts`
Expected: PASS — every slice-3 test still green. The viewer in zero circles hits the bare `eq(deals.orgId, orgId)` clause; the tenancy-isolation test passes unchanged. (The `insert()` helper in the existing test file always spreads `orgId: 1` by default; the rows it inserts have `visibilityCircleId: null` by Drizzle default, so no row matches a circle filter even if circleIds were non-empty — but since memberships aren't seeded, circleIds is `[]` everywhere in the existing tests.)

- [ ] **Step 4: Run the full panel/component tests.** Run: `npx vitest run test/components/dashboard test/components/deals`
Expected: PASS. The panel test still works because `DealRoomPanel` receives `deals: DealRow[]` and the new `orgId` + `visibilityCircleId` fields are optional in its render path (the panel ignores them until C1). If the panel test fixture's `makeDeal` helper omits `orgId` / `visibilityCircleId`, tsc surfaces a compile error — fix the fixture by adding both fields with sensible defaults.

  **If tsc fails on the panel test fixture:** open `test/components/dashboard/DealRoomPanel.test.tsx` and update `makeDeal` to spread `orgId: 1, visibilityCircleId: null` into the default object. C6 will exercise these fields explicitly.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/deals/queries.ts test/components/dashboard/DealRoomPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(deals): widen getActiveDeals + getAllDeals with OR-on-circles clause

visibilityClause(orgId, circleIds) returns the bare slice-3
eq(deals.orgId, orgId) when circleIds is empty (byte-identical to
slice 3), otherwise or(eq(orgId), inArray(visibilityCircleId, circleIds)).
Explicit early-return on the empty case avoids dialect-dependent
inArray([]) behavior — every dialect collapses inArray([]) to either a
SQL parse error or false (which would silently drop the viewer's own
rows). The early return is the load-bearing branch.

COLUMNS now projects orgId + visibilityCircleId so the panel can
distinguish own-org from circle-shared rows and render the badge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: This task is folded into B3 — verification only

**Files:** none

B3 already widened both `getActiveDeals` and `getAllDeals` (single shared `visibilityClause` helper). The original phase plan separated them; the implementation collapses them so the `or(...)` clause is built once and tested once. This task is the no-op verification that both helpers share the same clause.

- [ ] **Step 1: Confirm both helpers call `visibilityClause`.** Run:
```
grep -n "visibilityClause" src/lib/deals/queries.ts
```
Expected: 3 matches — the function definition + the two call sites in `getActiveDeals` and `getAllDeals`. No commit.

---

### Task B5: Cross-circle read visibility tests (the security gate)

**Files:**
- Create: `test/lib/circles/visibility.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/circles/visibility.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers, deals } from "@/db/schema";
import { getActiveDeals, getAllDeals } from "@/lib/deals/queries";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function makeCircle(name = "Trusted", slug = "trusted"): Promise<number> {
  const [row] = await db.insert(circles)
    .values({ name, slug, ownerOrgId: 1 })
    .returning({ id: circles.id });
  return row.id;
}

async function addMember(circleId: number, orgId: number): Promise<void> {
  await db.insert(circleMembers).values({ circleId, orgId });
}

async function insertDeal(over: Partial<typeof deals.$inferInsert>): Promise<number> {
  const [row] = await db.insert(deals).values({
    orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
    quantity: 1, priceCents: 100, postedByLabel: "boss",
    ...over,
  }).returning({ id: deals.id });
  return row.id;
}

describe("circle-aware visibility (getActiveDeals)", () => {
  it("(a) AIYA private deal visible to AIYA only", async () => {
    const d1 = await insertDeal({ orgId: 1, subject: "aiya-private", visibilityCircleId: null });
    await insertDeal({ orgId: 999, subject: "other-private", visibilityCircleId: null });

    expect((await getActiveDeals(db, 1)).map((r) => r.id)).toContain(d1);
    expect((await getActiveDeals(db, 999)).map((r) => r.id)).not.toContain(d1);
    expect((await getActiveDeals(db, 888)).map((r) => r.id)).not.toContain(d1);
  });

  it("(b) circle-shared deal visible to every member of the circle (AIYA + 888)", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);

    const shared = await insertDeal({
      orgId: 1, subject: "aiya-shared", visibilityCircleId: c,
    });

    expect((await getActiveDeals(db, 1)).map((r) => r.id)).toContain(shared);
    expect((await getActiveDeals(db, 888)).map((r) => r.id)).toContain(shared);
  });

  it("(c) circle-shared deal NOT visible to a non-member of the circle (org 999)", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);
    // 999 is deliberately NOT a member of c.

    const shared = await insertDeal({
      orgId: 1, subject: "aiya-shared", visibilityCircleId: c,
    });

    expect((await getActiveDeals(db, 999)).map((r) => r.id)).not.toContain(shared);
  });

  it("(d) zero-circles edge case — org 999 with no memberships sees exactly its own deals", async () => {
    // Regression guard: when circleIds is empty, the query must degenerate
    // to byte-identical slice-3 SQL — no OR, no inArray([]).
    const c = await makeCircle();
    await addMember(c, 1); // AIYA is in the circle.
    // 999 is in zero circles.

    await insertDeal({ orgId: 1, subject: "aiya-private", visibilityCircleId: null });
    await insertDeal({ orgId: 1, subject: "aiya-shared", visibilityCircleId: c });
    const own = await insertDeal({ orgId: 999, subject: "other-private", visibilityCircleId: null });

    const rows = await getActiveDeals(db, 999);
    expect(rows.map((r) => r.id)).toEqual([own]);
    expect(rows.map((r) => r.subject)).toEqual(["other-private"]);
  });

  it("(e) multi-circle viewer (AIYA in A and B) sees deals from BOTH circles, not just one", async () => {
    const a = await makeCircle("A", "a-slug");
    const b = await makeCircle("B", "b-slug");
    await addMember(a, 1);
    await addMember(b, 1);

    const inA = await insertDeal({ orgId: 888, subject: "in-A", visibilityCircleId: a });
    const inB = await insertDeal({ orgId: 999, subject: "in-B", visibilityCircleId: b });

    const ids = (await getActiveDeals(db, 1)).map((r) => r.id);
    expect(ids).toContain(inA);
    expect(ids).toContain(inB);
  });

  it("(f) cross-circle isolation — 888 (in A only) does NOT see deals shared into B", async () => {
    const a = await makeCircle("A", "a-slug");
    const b = await makeCircle("B", "b-slug");
    await addMember(a, 1);
    await addMember(a, 888);
    await addMember(b, 1); // 888 is NOT in B.

    await insertDeal({ orgId: 1, subject: "in-A", visibilityCircleId: a });
    const onlyInB = await insertDeal({ orgId: 1, subject: "in-B", visibilityCircleId: b });

    expect((await getActiveDeals(db, 888)).map((r) => r.id)).not.toContain(onlyInB);
  });

  it("(g) withdrawn cross-circle deal is hidden from getActiveDeals", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);

    const withdrawn = await insertDeal({
      orgId: 1, subject: "withdrawn", visibilityCircleId: c, status: "Withdrawn",
    });
    expect((await getActiveDeals(db, 888)).map((r) => r.id)).not.toContain(withdrawn);
  });
});

describe("circle-aware visibility (getAllDeals)", () => {
  it("widening composes with filters — kind=BUY across the OR-clause", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);

    await insertDeal({ orgId: 1, subject: "aiya-buy", kind: "BUY" });
    await insertDeal({ orgId: 1, subject: "aiya-sell", kind: "SELL" });
    await insertDeal({ orgId: 888, subject: "partner-buy", kind: "BUY", visibilityCircleId: c });
    await insertDeal({ orgId: 888, subject: "partner-sell-private", kind: "SELL", visibilityCircleId: null });

    const rows = await getAllDeals(db, 1, { kind: "BUY" });
    const subjects = rows.map((r) => r.subject).sort();
    expect(subjects).toEqual(["aiya-buy", "partner-buy"]);
  });

  it("widening composes with filters — status=Filled across the OR-clause", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);

    await insertDeal({ orgId: 1, subject: "aiya-filled", status: "Filled" });
    await insertDeal({ orgId: 888, subject: "partner-filled-shared", status: "Filled", visibilityCircleId: c });
    await insertDeal({ orgId: 888, subject: "partner-filled-private", status: "Filled" });

    const rows = await getAllDeals(db, 1, { status: "Filled" });
    const subjects = rows.map((r) => r.subject).sort();
    expect(subjects).toEqual(["aiya-filled", "partner-filled-shared"]);
  });

  it("empty-circles edge case for getAllDeals — bare slice-3 form", async () => {
    // 999 is in no circles. The widening must degenerate exactly.
    await insertDeal({ orgId: 1, subject: "aiya-private" });
    await insertDeal({ orgId: 999, subject: "other-private" });
    const rows = await getAllDeals(db, 999);
    expect(rows.map((r) => r.subject)).toEqual(["other-private"]);
  });
});
```

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/lib/circles/visibility.test.ts`
Expected: PASS (10 tests). If case (d) fails with "rows is empty" or "SQL parse error", the early-return branch in `visibilityClause` is wrong — re-read B3 §Critical block.

- [ ] **Step 3: Commit.**
```bash
git add test/lib/circles/visibility.test.ts
git commit -m "$(cat <<'EOF'
test(circles): cross-circle read visibility truth table

10 cases covering the load-bearing widened query:
(a) private deal — viewer-only
(b) circle-shared — every member sees it
(c) circle-shared — non-member does NOT see it
(d) zero-circles fallback — byte-identical slice-3 SQL
(e) multi-circle viewer — sees deals from ALL its circles
(f) cross-circle isolation — partner only in A does NOT see B's deals
(g) withdrawn circle deal — hidden from getActiveDeals
+ getAllDeals filter composition (status, kind) across the OR-clause.

Case (d) is the regression guard against inArray([]) dialect bugs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B6: postDeal write-side authz tests

**Files:**
- Create: `test/lib/circles/post-validation.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/circles/post-validation.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers, deals } from "@/db/schema";
import { postDeal, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

async function makeCircle(slug: string, owner = 1): Promise<number> {
  const [row] = await db.insert(circles)
    .values({ name: slug, slug, ownerOrgId: owner })
    .returning({ id: circles.id });
  return row.id;
}

describe("postDeal — circle membership authz", () => {
  it("succeeds when the session's org is a member of the requested circle", async () => {
    const c = await makeCircle("trusted");
    await db.insert(circleMembers).values({ circleId: c, orgId: 1 });

    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "shared deal",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
    });
    expect(res).toEqual({ ok: true });

    const rows = await db.select({
      orgId: deals.orgId, visibilityCircleId: deals.visibilityCircleId,
    }).from(deals);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
    expect(rows[0].visibilityCircleId).toBe(c);
  });

  it("rejects with Forbidden when the session's org is NOT a member (zero rows written)", async () => {
    const c = await makeCircle("private-to-999");
    await db.insert(circleMembers).values({ circleId: c, orgId: 999 });
    // Session is org 1 (the default mock); org 1 is NOT a member of c.

    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "attempted shared",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });

    const rows = await db.select({ id: deals.id }).from(deals);
    expect(rows).toHaveLength(0); // INSERT never ran.
  });

  it("rejects with Forbidden when the circle id does not exist (no FK error leak)", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "nonexistent",
      quantity: 1, priceCents: 100, visibilityCircleId: 99999,
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select({ id: deals.id }).from(deals)).toHaveLength(0);
  });

  it("succeeds with null visibilityCircleId (explicit private)", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "explicit private",
      quantity: 1, priceCents: 100, visibilityCircleId: null,
    });
    expect(res).toEqual({ ok: true });
    const rows = await db.select({
      visibilityCircleId: deals.visibilityCircleId,
    }).from(deals);
    expect(rows[0].visibilityCircleId).toBeNull();
  });

  it("succeeds with omitted visibilityCircleId (implicit private)", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "omitted",
      quantity: 1, priceCents: 100,
    });
    expect(res).toEqual({ ok: true });
    const rows = await db.select({
      visibilityCircleId: deals.visibilityCircleId,
    }).from(deals);
    expect(rows[0].visibilityCircleId).toBeNull();
  });

  it("never trusts orgId from the wire — circle membership is checked against session.orgId", async () => {
    const c = await makeCircle("aiya-only");
    await db.insert(circleMembers).values({ circleId: c, orgId: 1 });

    // Session is the default mock (org 1). The attacker tries to fool the
    // action into using "their" orgId (999) for the membership check by
    // including orgId in the payload. Zod strips unknown fields; the
    // membership check still runs against session.orgId = 1 (which IS a
    // member), so the post succeeds — and lands with orgId = 1, NOT 999.
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "smuggled orgId",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
      // Wire-supplied junk:
      orgId: 999,
    } as never);
    expect(res).toEqual({ ok: true });
    const rows = await db.select({
      orgId: deals.orgId, visibilityCircleId: deals.visibilityCircleId,
    }).from(deals);
    expect(rows[0].orgId).toBe(1);
    expect(rows[0].visibilityCircleId).toBe(c);
  });

  it("rejection-with-different-session — session=999 (member) succeeds, session=1 (non-member) fails", async () => {
    const c = await makeCircle("999-only");
    await db.insert(circleMembers).values({ circleId: c, orgId: 999 });

    // Session as 999: success.
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "alice", orgId: 999,
    });
    const ok = await postDeal({
      kind: "SELL", category: "Diamond", subject: "999 shares",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
    });
    expect(ok).toEqual({ ok: true });

    // Session as 1: forbidden.
    const denied = await postDeal({
      kind: "SELL", category: "Diamond", subject: "1 tries to share into 999s circle",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
    });
    expect(denied).toEqual({ ok: false, error: "Forbidden" });

    // Exactly one row was written (the 999 success).
    const rows = await db.select({ orgId: deals.orgId }).from(deals)
      .where(eq(deals.visibilityCircleId, c));
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(999);
  });
});
```

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/lib/circles/post-validation.test.ts`
Expected: PASS (7 tests). If "smuggled orgId" fails because Zod accepts unknown fields and the action uses them, the schema needs `.strict()` — but the slice-3 invariant relies on Zod stripping unknown fields, so this should be green out of the box.

- [ ] **Step 3: Commit.**
```bash
git add test/lib/circles/post-validation.test.ts
git commit -m "$(cat <<'EOF'
test(circles): postDeal authz truth table (write-side gate)

7 cases:
- success when session.orgId is a member
- Forbidden + zero rows when session.orgId is NOT a member
- Forbidden for nonexistent circle id (no FK error leak)
- success with explicit null visibilityCircleId
- success with omitted visibilityCircleId
- wire-supplied orgId is stripped (slice-3 invariant) — membership check
  runs against session.orgId, the row lands with session.orgId
- session-switching — same circle, different sessions yield success vs
  Forbidden as expected.

The "zero rows after Forbidden" assertion is the load-bearing check.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B7: Slice-4c race-sentinel test

**Files:**
- Create: `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`

- [ ] **Step 1: Create the sentinel.** Create `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`:

```ts
// @vitest-environment node
//
// SLICE-4C RACE SENTINEL
// ----------------------
// This test asserts that no membership-mutation helpers exist in the
// codebase today. Slice 4 ships *no* API to add or remove circle members
// (memberships are seeded via SQL or the demo seed file). That means the
// "isOrgMemberOfCircle check → INSERT INTO deals" pattern in postDeal has
// no race window in slice 4 — there is no concurrent membership mutation
// that could invalidate the check between read and write.
//
// When slice 4c ("Circle Onboarding") ships, it will introduce
// addOrgToCircle / removeOrgFromCircle helpers. At that moment THIS TEST
// FAILS, and the slice-4c author MUST choose one of:
//   (a) accept the race and document the user-visible window in the
//       postDeal call site,
//   (b) re-check membership inside a transaction wrapping the INSERT,
//   (c) take a `SELECT … FOR UPDATE` lock on the membership row before
//       the check.
// Do NOT delete this test to "fix" the failure — the failure IS the
// obligation. Mark the chosen mitigation in postDeal + this sentinel's
// docblock, then update the test to assert the chosen mitigation exists.
//
// See: docs/superpowers/specs/2026-05-28-aiya-circles-slice-4-design.md §8.9

import { describe, it, expect } from "vitest";

describe("slice-4c race sentinel — fails when membership mutation lands", () => {
  it("there is no membership-mutation module (slice 4c has not landed yet)", async () => {
    // Vitest treats a failed import as a rejected promise. We use a
    // dynamic import wrapped in a try/catch so the assertion phrasing
    // is "module not found" regardless of bundler error shape.
    let modulePresent = false;
    try {
      const mod = await import("@/lib/circles/membership-mutations");
      // If the module exists, check whether it exports either of the
      // expected helper names — that's the actual slice-4c signal.
      modulePresent =
        typeof (mod as Record<string, unknown>).addOrgToCircle === "function" ||
        typeof (mod as Record<string, unknown>).removeOrgFromCircle === "function";
    } catch {
      modulePresent = false;
    }
    expect(
      modulePresent,
      [
        "Slice-4c membership-mutation helpers detected.",
        "The 'isOrgMemberOfCircle check → INSERT INTO deals' race in postDeal",
        "now has a real window. Choose a mitigation (transaction re-check,",
        "FOR UPDATE lock, or accepted-race documentation) and update both",
        "src/lib/deals/actions.ts::postDeal AND this sentinel before merging.",
        "See: docs/superpowers/specs/2026-05-28-aiya-circles-slice-4-design.md §8.9",
      ].join("\n"),
    ).toBe(false);
  });

  it("isOrgMemberOfCircle still does NOT use a transaction (slice-4 assumption)", async () => {
    // Lightweight code-shape assertion: the helper file does not import
    // 'transaction' or use a SELECT FOR UPDATE. If a future maintainer
    // adds either without updating this sentinel, the test forces a
    // conscious review.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/membership.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/FOR\s+UPDATE/i);
    expect(src).not.toMatch(/\btransaction\s*\(/);
  });
});
```

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`
Expected: PASS (2 tests). The membership-mutations module doesn't exist (good — slice 4c hasn't shipped yet), so case 1 sees `modulePresent === false` and asserts `expect(false).toBe(false)` which passes. Case 2 reads `src/lib/circles/membership.ts` and confirms no transaction / FOR UPDATE language.

- [ ] **Step 3: Commit.**
```bash
git add test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts
git commit -m "$(cat <<'EOF'
test(circles): slice-4c race sentinel — enforces the next slice's design choice

The 'isOrgMemberOfCircle check → INSERT INTO deals' pattern has no race
window in slice 4 because slice 4 ships no API to mutate circle_members.
The moment slice 4c lands addOrgToCircle / removeOrgFromCircle helpers,
the window opens — and this sentinel fails, forcing the slice-4c author
to consciously choose a mitigation (transaction re-check, FOR UPDATE
lock, or accepted-race documentation).

The failure IS the obligation. Do not delete the sentinel to fix it;
mitigate the race + update the sentinel together.

Reference: spec §8.9 race conditions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — UI

Phase C wires the widened data through the existing panel + admin + form. No new pages this slice (no `/circles` route — deferred to slice 4c).

### Task C1: Add `formatDealVisibility` helper

**Files:**
- Create: `src/lib/deals/format.ts`
- Create: `test/lib/deals/format.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/deals/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatDealVisibility } from "@/lib/deals/format";

describe("formatDealVisibility", () => {
  it("returns kind=private for a null visibilityCircleId", () => {
    expect(formatDealVisibility(null, new Map())).toEqual({ kind: "private" });
  });

  it("returns kind=circle with the matching name when the id is in the map", () => {
    const map = new Map([[7, "Trusted Partners"]]);
    expect(formatDealVisibility(7, map)).toEqual({
      kind: "circle",
      circleName: "Trusted Partners",
    });
  });

  it("returns kind=private for an unknown id (name-leak guard)", () => {
    // The widened query only returns rows whose visibilityCircleId is in
    // the viewer's circle ids. If a bug ever surfaces a foreign id, the
    // helper must NOT render the name — it returns "private" so the badge
    // silently disappears rather than leaking a circle name the viewer
    // shouldn't know.
    const map = new Map([[1, "Mine"]]);
    expect(formatDealVisibility(99, map)).toEqual({ kind: "private" });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/deals/format.test.ts`
Expected: FAIL — module `@/lib/deals/format` not found.

- [ ] **Step 3: Implement.** Create `src/lib/deals/format.ts`:

```ts
export interface DealVisibility {
  kind: "private" | "circle";
  /** Present iff kind === "circle". */
  circleName?: string;
}

/**
 * Resolves a deal's visibility to a UI label.
 *
 * Defensive fallback: if `visibilityCircleId` is not in the viewer's
 * `circleNamesById` map, returns { kind: "private" } so the badge silently
 * disappears rather than rendering a circle name the viewer shouldn't know.
 * The widened deals query (slice 4) makes the unknown-id case unreachable
 * in well-formed code; this is belt-and-suspenders against a future bug.
 */
export function formatDealVisibility(
  visibilityCircleId: number | null,
  circleNamesById: Map<number, string>,
): DealVisibility {
  if (visibilityCircleId === null) return { kind: "private" };
  const name = circleNamesById.get(visibilityCircleId);
  if (!name) return { kind: "private" };
  return { kind: "circle", circleName: name };
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/deals/format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/deals/format.ts test/lib/deals/format.test.ts
git commit -m "$(cat <<'EOF'
feat(deals): formatDealVisibility helper + name-leak guard

Pure function that resolves (visibilityCircleId, circleNamesById Map) to
either { kind: "private" } or { kind: "circle", circleName }. The
defensive fallback returns "private" when the id isn't in the viewer's
map — even though the widened query makes that unreachable in
well-formed code, the helper is the last line of defense against a
future query bug surfacing a circle name the viewer shouldn't know.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: Extend `DealView` + `PanelCtx` types with `currentOrgId` + `circleNamesById`

**Files:**
- Modify: `src/lib/layout/types.ts`

- [ ] **Step 1: Open `src/lib/layout/types.ts`.** Replace the `DealView` interface (lines 28-30) with:

```ts
export interface DealView {
  deals: DealRow[];
  /** The session's org id — used by DealRoomPanel to distinguish own-org
   *  from foreign-org rows when rendering the "Shared via" badge. */
  currentOrgId: number;
  /** Map from circle id → display name, built once per page render from
   *  getCircleNamesForOrg(orgId). Only contains circles the viewer is a
   *  member of, so it's safe to surface any value as a UI label. */
  circleNamesById: Map<number, string>;
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: FAIL — `src/app/page.tsx` and `src/lib/layout/registry.tsx` construct `DealView` without the new fields. C3 and C4 close those holes.

(No commit yet — the type change is a prerequisite for C3/C4; commit at C3's end.)

---

### Task C3: Wire `getCircleNamesForOrg` through `src/app/page.tsx` + registry

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/lib/layout/registry.tsx`

- [ ] **Step 1: Refactor `src/app/page.tsx`.** Replace lines 14-43 with:

```tsx
export default async function Home() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [invSummary, dia, activeDeals, circleNamesById] = await Promise.all([
    getInventorySummary(db, orgId),
    getDiamondSummary(db, orgId),
    getActiveDeals(db, orgId, 5),
    getCircleNamesForOrg(db, orgId),
  ]);
  const inventory = {
    counts: invSummary.counts,
    total: invSummary.total,
    updatedLabel: updatedAgo(invSummary.updatedAt),
  };
  const diamond = {
    kpis: { naturalIndex: dia.naturalIndex, labIndex: dia.labIndex },
    rows: [
      ...(dia.naturalIndex ? [{ label: "Natural 1ct", cents: dia.naturalIndex.cents, change24hPct: dia.naturalIndex.change24hPct }] : []),
      ...(dia.labIndex ? [{ label: "Lab 1ct", cents: dia.labIndex.cents, change24hPct: dia.labIndex.change24hPct }] : []),
      ...dia.points.map((p) => ({ label: p.label, cents: p.cents, change24hPct: null })),
    ],
  };
  const deals = { deals: activeDeals, currentOrgId: orgId, circleNamesById };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} deals={deals} />
      </Shell>
    </QuotesProvider>
  );
}
```

Add the import at the top (after `getActiveDeals`):

```tsx
import { getCircleNamesForOrg } from "@/lib/circles/queries";
```

- [ ] **Step 2: Update the registry.** Open `src/lib/layout/registry.tsx`. Replace the `tradenet-exchange` entry (lines 56-64) with:

```tsx
  {
    // id "tradenet-exchange" reflects the original mockup-2 framing; title
    // "Deal Room" reflects the user-facing language. Both are stable.
    id: "tradenet-exchange",
    title: "Deal Room",
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

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit`
Expected: FAIL on `DealRoomPanel` props — C4 widens the component to accept the new props. Continue.

(No commit yet — the C2 + C3 + C4 trio commits together at C4's end so tsc never lingers red.)

---

### Task C4: Extend `DealRoomPanel` to render the visibility badge + header affordance

**Files:**
- Modify: `src/components/dashboard/DealRoomPanel.tsx`

- [ ] **Step 1: Replace `src/components/dashboard/DealRoomPanel.tsx` with:**

```tsx
import Link from "next/link";
import { Panel } from "@/components/Panel";
import { formatCents, timeAgo } from "@/lib/company/format";
import { formatDealVisibility } from "@/lib/deals/format";
import type { DealRow } from "@/lib/deals/queries";
import type { DealKind } from "@/lib/deals/constants";

// Fixed lookup so user input never reaches a className expression.
const KIND_CLASS: Record<DealKind, string> = {
  BUY: "text-ok",
  SELL: "text-gold",
};

/** Builds the panel subtitle. Driven by the viewer's circle map so the
 *  affordance is data-driven, not hardcoded. */
function circlesSubtitle(circleNamesById: Map<number, string>): string | null {
  if (circleNamesById.size === 0) return null;
  if (circleNamesById.size === 1) {
    // Mockup wording: "AIYA Trusted Partners (2 partner orgs)" — but we don't
    // have the member count cheaply here, so we render the circle name only.
    // The richer "N partner orgs" affordance ships in slice 4c with the
    // /circles route, where member counts are already loaded.
    const [name] = circleNamesById.values();
    return `Connected via ${name}`;
  }
  return `Connected to ${circleNamesById.size} circles`;
}

export function DealRoomPanel({
  deals,
  currentOrgId,
  circleNamesById,
}: {
  deals: DealRow[];
  currentOrgId: number;
  circleNamesById: Map<number, string>;
}) {
  const subtitle = circlesSubtitle(circleNamesById);

  if (deals.length === 0) {
    return (
      <Panel
        title="Deal Room"
        state="ready"
        action={
          <Link href="/deals" className="text-[10px] uppercase tracking-widest text-text/40 hover:text-gold">
            View all
          </Link>
        }
      >
        <div className="py-6 text-center text-sm text-text/40">
          No open deals — post one from the Deal Room.
        </div>
        {subtitle && (
          <div className="border-t border-text/10 pt-2 text-center text-[10px] uppercase tracking-widest text-text/40">
            {subtitle}
          </div>
        )}
      </Panel>
    );
  }
  return (
    <Panel
      title="Deal Room"
      state="ready"
      action={
        <Link href="/deals" className="text-[10px] uppercase tracking-widest text-text/40 hover:text-gold">
          View all
        </Link>
      }
    >
      {subtitle && (
        <div className="mb-1 text-[10px] uppercase tracking-widest text-text/40" data-testid="deal-room-circle-subtitle">
          {subtitle}
        </div>
      )}
      <ul className="divide-y divide-text/10 text-sm">
        {deals.map((d) => {
          const vis = formatDealVisibility(d.visibilityCircleId, circleNamesById);
          const isForeign = d.orgId !== currentOrgId;
          const badgeTooltip =
            vis.kind === "circle"
              ? isForeign
                ? `Shared by ${d.postedByLabel} via ${vis.circleName}`
                : `Shared with ${vis.circleName}`
              : undefined;
          return (
            <li key={d.id} className="flex items-center gap-2 py-2">
              <span className={`font-mono text-[10px] uppercase tracking-wider ${KIND_CLASS[d.kind]}`}>
                {d.kind}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-text/40">{d.category}</span>
              <span className="flex-1 truncate text-text/80" title={d.subject}>{d.subject}</span>
              {vis.kind === "circle" && (
                <span
                  className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80"
                  title={badgeTooltip}
                  data-testid="deal-visibility-badge"
                >
                  {vis.circleName}
                </span>
              )}
              <span className="font-mono text-text">{formatCents(d.priceCents)}</span>
              <span className="text-[10px] text-text/40">{timeAgo(d.createdAt)}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean. Component accepts the new props, `src/app/page.tsx` provides them, registry threads them.

- [ ] **Step 3: Run dashboard component tests (most will need fixture updates).** Run: `npx vitest run test/components/dashboard/DealRoomPanel.test.tsx`
Expected: FAIL — every existing test invokes `<DealRoomPanel deals={...} />` without `currentOrgId` / `circleNamesById`. C6 rewrites the test file; for now we accept the red.

- [ ] **Step 4: Commit C2 + C3 + C4 together** (the type + page + registry + component widening lands as one cohesive unit; the existing panel tests stay red until C6).

```bash
git add src/lib/layout/types.ts src/app/page.tsx src/lib/layout/registry.tsx src/components/dashboard/DealRoomPanel.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): DealRoomPanel renders circle visibility badge + subtitle

DealView gains currentOrgId + circleNamesById (Map<number, string>) so
the panel can resolve each row's visibilityCircleId to a display label
without re-querying. circlesSubtitle drives the "Connected via …"
affordance from the viewer's circle map — no hardcoded names.

Badge tooltip distinguishes own-org rows ("Shared with [Circle]") from
foreign-org rows ("Shared by [Poster] via [Circle]"). The XSS surface is
zero — circle names + posted-by labels render as text children, never
as className interpolation.

The richer "N partner orgs" header counter ships in slice 4c with the
/circles route, where member counts are already loaded.

DealRoomPanel tests rewritten in the next commit (C6).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C5: Extend `PostDealForm` with the "Share with circle" dropdown + thread through `/deals` page

**Files:**
- Modify: `src/components/deals/PostDealForm.tsx`
- Modify: `src/app/(admin)/deals/page.tsx`

- [ ] **Step 1: Refactor `src/components/deals/PostDealForm.tsx`.** Replace the file with:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { DEAL_KINDS, DEAL_CATEGORIES, type DealKind, type DealCategory } from "@/lib/deals/constants";
import type { ActionResult } from "@/lib/deals/actions";

export interface CircleOption {
  id: number;
  name: string;
}

export function PostDealForm({
  postAction,
  circles = [],
}: {
  postAction: (raw: unknown) => Promise<ActionResult>;
  /** The viewer's circles — drives the "Share with" dropdown. Pass [] (or omit)
   *  for an org with no memberships; the dropdown is hidden in that case. */
  circles?: CircleOption[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<DealKind>("SELL");
  const [category, setCategory] = useState<DealCategory>("Diamond");
  const [subject, setSubject] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priceDollars, setPriceDollars] = useState("");
  const [visibilityCircleId, setVisibilityCircleId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const raw = {
      kind,
      category,
      subject: subject.trim(),
      quantity: Math.round(Number(quantity || 0)),
      priceCents: Math.round(Number(priceDollars || 0) * 100),
      visibilityCircleId,
    };
    const res = await postAction(raw);
    setPending(false);
    if (res.ok) {
      setOk(true);
      setSubject("");
      setQuantity("1");
      setPriceDollars("");
      setVisibilityCircleId(null);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <form onSubmit={submit} className="surface-card mb-4 grid grid-cols-2 gap-2 rounded-xl p-4 text-sm md:grid-cols-3">
      <label className="flex flex-col">
        Kind
        <select aria-label="kind" className="bg-bg p-2" value={kind}
          onChange={(e) => setKind(e.target.value as DealKind)}>
          {DEAL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label className="flex flex-col">
        Category
        <select aria-label="category" className="bg-bg p-2" value={category}
          onChange={(e) => setCategory(e.target.value as DealCategory)}>
          {DEAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="flex flex-col md:col-span-1">
        Quantity
        <input aria-label="quantity" type="number" min={1} className="bg-bg p-2" value={quantity}
          onChange={(e) => setQuantity(e.target.value)} />
      </label>
      <label className="col-span-2 flex flex-col md:col-span-2">
        Subject
        <input aria-label="subject" maxLength={280} className="bg-bg p-2" value={subject}
          onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="flex flex-col">
        Price ($)
        <input aria-label="price" type="number" min={0} step="0.01" className="bg-bg p-2"
          value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)} />
      </label>
      {circles.length > 0 && (
        <label className="col-span-2 flex flex-col md:col-span-1">
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
      )}
      <div className="col-span-2 flex items-center justify-between md:col-span-3">
        <button type="submit" disabled={pending} className="rounded bg-gold p-2 text-black disabled:opacity-50">
          Post deal
        </button>
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Refactor `src/app/(admin)/deals/page.tsx`.** Replace lines 22-66 with:

```tsx
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters: DealFilters = {
    status: pickFilter(params.status, DEAL_STATUSES) as DealStatus | undefined,
    kind: pickFilter(params.kind, DEAL_KINDS) as DealKind | undefined,
    category: pickFilter(params.category, DEAL_CATEGORIES) as DealCategory | undefined,
  };

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [rows, myCircles] = await Promise.all([
    getAllDeals(db, orgId, filters),
    getCirclesForOrg(db, orgId),
  ]);
  const circleOptions = myCircles.map((c) => ({ id: c.id, name: c.name }));

  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Deal Room</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>

      <DemoNotice />

      {/* Filter chips */}
      <nav className="mb-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-widest" aria-label="Deal filters">
        <FilterLink label="All" href="/deals" active={!filters.status && !filters.kind && !filters.category} />
        {DEAL_STATUSES.map((s) => (
          <FilterLink key={s} label={s} href={`/deals?status=${s}`} active={filters.status === s} />
        ))}
        {DEAL_KINDS.map((k) => (
          <FilterLink key={k} label={k} href={`/deals?kind=${k}`} active={filters.kind === k} />
        ))}
        {DEAL_CATEGORIES.map((c) => (
          <FilterLink key={c} label={c} href={`/deals?category=${c}`} active={filters.category === c} />
        ))}
      </nav>

      <PostDealForm postAction={postDeal} circles={circleOptions} />

      <DealList deals={rows} markFilledAction={markDealFilled} withdrawAction={withdrawDeal} />
    </main>
  );
}
```

Add the import at the top (with the other `@/lib/*` imports):

```tsx
import { getCirclesForOrg } from "@/lib/circles/queries";
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run the existing PostDealForm tests.** Run: `npx vitest run test/components/deals/PostDealForm.test.tsx`
Expected: PASS (existing tests are unaffected — the new `circles` prop defaults to `[]`, so the dropdown is hidden and submit behavior matches slice 2). If the test file doesn't exist yet, skip this step; C7 adds dropdown-specific tests.

- [ ] **Step 5: Commit.**
```bash
git add src/components/deals/PostDealForm.tsx "src/app/(admin)/deals/page.tsx"
git commit -m "$(cat <<'EOF'
feat(deals): PostDealForm "Share with circle" dropdown

New optional prop circles: { id, name }[] — when non-empty, renders a
dropdown after the Price field. Default option "Private (your org only)"
sends visibilityCircleId: null; selecting a circle sends the id. The
server-side membership check in postDeal is the security gate — even
if a malicious client injects a foreign id, the action rejects with
Forbidden and writes zero rows.

/deals page now parallel-fetches getCirclesForOrg alongside getAllDeals
and threads the result into the form.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C6: Rewrite `DealRoomPanel` tests to cover the badge, name-leak, foreign-org, and subtitle

**Files:**
- Modify: `test/components/dashboard/DealRoomPanel.test.tsx`

- [ ] **Step 1: Replace `test/components/dashboard/DealRoomPanel.test.tsx` with:**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealRoomPanel } from "@/components/dashboard/DealRoomPanel";
import type { DealRow } from "@/lib/deals/queries";

function makeDeal(over: Partial<DealRow> = {}): DealRow {
  return {
    id: 1,
    orgId: 1,
    kind: "SELL",
    category: "Diamond",
    subject: "Round 1.02ct G/VS1",
    quantity: 1,
    priceCents: 1240000,
    currency: "USD",
    status: "Open",
    postedByLabel: "boss",
    visibilityCircleId: null,
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    ...over,
  };
}

const EMPTY_CIRCLES = new Map<number, string>();

describe("DealRoomPanel — slice 2 behavior preserved", () => {
  it("renders BUY and SELL kind badges", () => {
    render(<DealRoomPanel
      deals={[
        makeDeal({ id: 1, kind: "BUY", subject: "buy lot" }),
        makeDeal({ id: 2, kind: "SELL", subject: "sell lot" }),
      ]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();
  });

  it("renders the subject as plain text", () => {
    render(<DealRoomPanel
      deals={[makeDeal({ subject: "Emerald 3.4ct" })]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(screen.getByText("Emerald 3.4ct")).toBeInTheDocument();
  });

  it("does NOT execute script in subject (XSS)", () => {
    const subject = "<script>alert(1)</script>";
    const { container } = render(<DealRoomPanel
      deals={[makeDeal({ subject })]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(subject);
  });

  it("renders formatted price", () => {
    render(<DealRoomPanel
      deals={[makeDeal({ priceCents: 1240000 })]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(screen.getByText(/\$12,400/)).toBeInTheDocument();
  });

  it("renders an empty state when no deals", () => {
    render(<DealRoomPanel deals={[]} currentOrgId={1} circleNamesById={EMPTY_CIRCLES} />);
    expect(screen.getByText(/no open deals/i)).toBeInTheDocument();
  });

  it('"View all" link points to /deals', () => {
    render(<DealRoomPanel
      deals={[makeDeal()]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link).toHaveAttribute("href", "/deals");
  });
});

describe("DealRoomPanel — slice 4 visibility badge", () => {
  const circles = new Map<number, string>([[42, "AIYA Trusted Partners"]]);

  it("renders no badge when visibilityCircleId is null", () => {
    const { queryByTestId } = render(<DealRoomPanel
      deals={[makeDeal({ visibilityCircleId: null })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    expect(queryByTestId("deal-visibility-badge")).toBeNull();
  });

  it("renders the circle name as a badge when the id is in the map", () => {
    render(<DealRoomPanel
      deals={[makeDeal({ visibilityCircleId: 42 })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    const badge = screen.getByTestId("deal-visibility-badge");
    expect(badge.textContent).toBe("AIYA Trusted Partners");
  });

  it("XSS: circle name with markup renders as text, not HTML", () => {
    const malicious = new Map([[42, "<script>alert(1)</script>"]]);
    const { container } = render(<DealRoomPanel
      deals={[makeDeal({ visibilityCircleId: 42 })]}
      currentOrgId={1}
      circleNamesById={malicious}
    />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("name-leak guard: renders no badge when visibilityCircleId is NOT in the map", () => {
    // Defensive fallback: even if a query bug surfaces a foreign circle id,
    // the badge silently disappears rather than showing a name the viewer
    // shouldn't know.
    const { queryByTestId } = render(<DealRoomPanel
      deals={[makeDeal({ visibilityCircleId: 999 })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    expect(queryByTestId("deal-visibility-badge")).toBeNull();
  });

  it("own-org circle row: tooltip says 'Shared with [Circle]'", () => {
    render(<DealRoomPanel
      deals={[makeDeal({ orgId: 1, visibilityCircleId: 42 })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    const badge = screen.getByTestId("deal-visibility-badge");
    expect(badge.getAttribute("title")).toBe("Shared with AIYA Trusted Partners");
  });

  it("foreign-org circle row: tooltip includes posted-by label", () => {
    render(<DealRoomPanel
      deals={[makeDeal({
        orgId: 888,
        postedByLabel: "Mehta Diamonds — Mumbai",
        visibilityCircleId: 42,
      })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    const badge = screen.getByTestId("deal-visibility-badge");
    expect(badge.getAttribute("title"))
      .toBe("Shared by Mehta Diamonds — Mumbai via AIYA Trusted Partners");
  });

  it("renders no subtitle when the viewer is in zero circles", () => {
    const { queryByTestId } = render(<DealRoomPanel
      deals={[makeDeal()]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(queryByTestId("deal-room-circle-subtitle")).toBeNull();
  });

  it("renders 'Connected via [Name]' subtitle when the viewer is in one circle", () => {
    render(<DealRoomPanel
      deals={[makeDeal()]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    expect(screen.getByTestId("deal-room-circle-subtitle").textContent)
      .toBe("Connected via AIYA Trusted Partners");
  });

  it("renders 'Connected to N circles' subtitle when the viewer is in multiple", () => {
    const many = new Map([[42, "A"], [43, "B"], [44, "C"]]);
    render(<DealRoomPanel
      deals={[makeDeal()]}
      currentOrgId={1}
      circleNamesById={many}
    />);
    expect(screen.getByTestId("deal-room-circle-subtitle").textContent)
      .toBe("Connected to 3 circles");
  });
});
```

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/components/dashboard/DealRoomPanel.test.tsx`
Expected: PASS (15 tests).

- [ ] **Step 3: Commit.**
```bash
git add test/components/dashboard/DealRoomPanel.test.tsx
git commit -m "$(cat <<'EOF'
test(dashboard): DealRoomPanel badge + name-leak + subtitle coverage

Existing slice-2 behavior preserved (6 tests). New slice-4 coverage (9):
- badge renders only when visibilityCircleId is set
- badge XSS: malicious circle name renders as text, not HTML
- name-leak guard: unknown id renders NO badge (belt-and-suspenders)
- own-org tooltip "Shared with [Circle]"
- foreign-org tooltip "Shared by [Poster] via [Circle]"
- subtitle hidden when zero circles
- subtitle "Connected via [Name]" for one circle
- subtitle "Connected to N circles" for multiple

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C7: PostDealForm dropdown test

**Files:**
- Create: `test/components/deals/PostDealForm.test.tsx` (or extend if present)

- [ ] **Step 1: Check whether a test file exists.** Run:
```
ls test/components/deals/PostDealForm.test.tsx 2>/dev/null && echo "exists" || echo "missing"
```
If missing, create the file; if present, append the new `describe` block.

- [ ] **Step 2: Failing test.** Write `test/components/deals/PostDealForm.test.tsx` (full file if creating, else append the new describe):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PostDealForm } from "@/components/deals/PostDealForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("PostDealForm — dropdown hidden when no circles", () => {
  it("does NOT render the visibility dropdown when circles=[]", () => {
    render(<PostDealForm postAction={async () => ({ ok: true })} circles={[]} />);
    expect(screen.queryByLabelText(/visibility/i)).toBeNull();
  });

  it("does NOT render the visibility dropdown when circles prop is omitted", () => {
    render(<PostDealForm postAction={async () => ({ ok: true })} />);
    expect(screen.queryByLabelText(/visibility/i)).toBeNull();
  });
});

describe("PostDealForm — dropdown renders + submits", () => {
  const circles = [
    { id: 42, name: "AIYA Trusted Partners" },
    { id: 43, name: "Mumbai Cutters" },
  ];

  beforeEach(() => vi.clearAllMocks());

  it('renders "Private" as the default selected option', () => {
    render(<PostDealForm postAction={async () => ({ ok: true })} circles={circles} />);
    const select = screen.getByLabelText("visibility") as HTMLSelectElement;
    expect(select.value).toBe(""); // "" maps to null in the submit payload
    expect(select.options[0].textContent).toBe("Private (your org only)");
  });

  it("renders one <option> per circle", () => {
    render(<PostDealForm postAction={async () => ({ ok: true })} circles={circles} />);
    const select = screen.getByLabelText("visibility") as HTMLSelectElement;
    expect(select.options).toHaveLength(3); // Private + 2 circles
    expect(select.options[1].textContent).toBe("AIYA Trusted Partners");
    expect(select.options[2].textContent).toBe("Mumbai Cutters");
  });

  it("submits visibilityCircleId: null by default (Private)", async () => {
    const post = vi.fn(async () => ({ ok: true as const }));
    render(<PostDealForm postAction={post} circles={circles} />);

    fireEvent.change(screen.getByLabelText("subject"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "5" } });
    fireEvent.submit(screen.getByRole("button", { name: /post deal/i }).closest("form")!);

    // wait microtask for the async submit
    await Promise.resolve();
    await Promise.resolve();

    expect(post).toHaveBeenCalledTimes(1);
    const arg = post.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.visibilityCircleId).toBeNull();
  });

  it("submits the selected circle id when a non-Private option is chosen", async () => {
    const post = vi.fn(async () => ({ ok: true as const }));
    render(<PostDealForm postAction={post} circles={circles} />);

    fireEvent.change(screen.getByLabelText("subject"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("visibility"), { target: { value: "43" } });
    fireEvent.submit(screen.getByRole("button", { name: /post deal/i }).closest("form")!);

    await Promise.resolve();
    await Promise.resolve();

    const arg = post.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.visibilityCircleId).toBe(43);
  });
});
```

- [ ] **Step 3: Run to verify PASS.** Run: `npx vitest run test/components/deals/PostDealForm.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 4: Commit.**
```bash
git add test/components/deals/PostDealForm.test.tsx
git commit -m "$(cat <<'EOF'
test(deals): PostDealForm dropdown + submit-payload coverage

- dropdown hidden when circles=[] or prop omitted (no-membership orgs
  see a clean form, identical to slice 2)
- dropdown renders one option per circle plus the default "Private"
- default submit sends visibilityCircleId: null
- selecting a non-Private option submits the id as a number

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Verification + ship

### Task D1: Enforcement greps + full suite + tsc + build

**Files:** none (verification only)

- [ ] **Step 1: Deals reads go through the widened helpers.** Run:
```
grep -rn "from(deals)" src/
```
Expected: every match is inside `src/lib/deals/queries.ts` (the two widened helpers + their `COLUMNS` projection) or `src/lib/deals/actions.ts` (an UPDATE/DELETE with `eq(deals.orgId, sessionOrgId)`). Any raw select from a route or page is a bug — fix immediately.

- [ ] **Step 2: `owner_org_id` is not used for authz.** Run:
```
grep -rn "owner_org_id\|ownerOrgId" src/lib/circles/
```
Expected: matches only in `src/lib/circles/queries.ts` (the `CircleRow.ownerOrgId` projection). No use in any authorization decision this slice. If `isOrgMemberOfCircle` or any other helper reads `ownerOrgId`, that's a spec violation — fix.

- [ ] **Step 3: `visibilityCircleId` is in exactly one validation schema.** Run:
```
grep -rn "visibilityCircleId" src/lib/deals/validation.ts
```
Expected: exactly one match — the `z.number().int().positive().nullable().optional()` line in `postDealInput`.

- [ ] **Step 4: No read endpoint accepts a circleId.** Run:
```
grep -rn "circleId" src/lib/*/validation.ts
```
Expected: only the `visibilityCircleId` match in `src/lib/deals/validation.ts`. Any other match means a read endpoint is taking circle ids from the wire — fix.

- [ ] **Step 5: AIYA_ORG_ID is still only in the login route.** Run:
```
grep -rn "AIYA_ORG_ID" src/
```
Expected: one match — the local `const AIYA_ORG_ID = 1` inside `src/app/api/login/route.ts`. (Slice 3 invariant preserved.)

- [ ] **Step 6: Full suite.** Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-circles-4" && npm test -- --run`
Expected: full green. The slice-3 cross-org isolation tests pass unchanged (org 999 is in zero circles → degenerates to slice-3 SQL → identical query plan → identical results).

- [ ] **Step 7: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Build.** Run: `rm -rf .next && npm run build`
Expected: success. RSC pages render once with `force-dynamic`; if `getCircleNamesForOrg` blows up anywhere, this is where it surfaces.

- [ ] **Step 9: Dev smoke (auth path).** Run: `npm run dev`. Log in. Then:
  - `/` loads, Deal Room panel renders. Because AIYA is in zero real circles (only the demo seed has memberships), the subtitle is hidden and rows render exactly like slice 2.
  - `/deals` loads, post a SELL Diamond: subject "Smoke 1.0ct", qty 1, price 5000. The "Share with" dropdown is **hidden** (zero circle memberships in prod DB).
  - Open psql and verify the row landed with `visibility_circle_id IS NULL`:

```sql
SELECT id, org_id, subject, visibility_circle_id FROM deals WHERE subject = 'Smoke 1.0ct';
```

  Expected: one row, `org_id = 1`, `visibility_circle_id IS NULL`.

  Then via psql, seed a test circle:

```sql
INSERT INTO circles (id, name, slug, owner_org_id) VALUES (1, 'Test Circle', 'test', 1);
INSERT INTO circle_members (circle_id, org_id) VALUES (1, 1);
```

  Reload `/deals` — the "Share with" dropdown now shows "Test Circle". Post another deal selecting it. Verify the row landed with `visibility_circle_id = 1`. Reload `/` — the Deal Room panel shows the "Connected via Test Circle" subtitle and the badge on the new row.

- [ ] **Step 10: Dev smoke (demo path).** Run: `NEXT_PUBLIC_DEMO_MODE=true npm run dev`:
  - `/` loads, no login required. Deal Room panel shows 5 AIYA deals (statuses Open + Filled mixed — the Open ones land in the top-5) plus the 3 cross-circle partner deals (ids 106-108) all labeled with the "AIYA Trusted Partners" badge.
  - Subtitle reads "Connected via AIYA Trusted Partners".
  - `/deals` shows the full 8-deal seed. PostDealForm shows the dropdown with "AIYA Trusted Partners" as an option; posting anything returns "Demo mode — changes are disabled".

---

### Task D2: Whole-slice code review + merge + cleanup

**Files:** none (process)

- [ ] **Step 1: Whole-slice code review.** Spawn a code-review subagent with this prompt (paste verbatim):

> Review every change on branch `feature/aiya-circles-4` against `main` for the AIYA Circles slice (slice 4). Spec: `docs/superpowers/specs/2026-05-28-aiya-circles-slice-4-design.md`. Plan: `docs/superpowers/plans/2026-05-28-aiya-circles-slice-4.md`. Verify each: (a) `grep -rn "from(deals)" src/` returns matches only in `src/lib/deals/queries.ts` (the widened helpers' projections) and `src/lib/deals/actions.ts` (UPDATE/DELETE with `eq(deals.orgId, sessionOrgId)`); (b) `grep -rn "circleId" src/lib/*/validation.ts` returns only the one `visibilityCircleId` match in `src/lib/deals/validation.ts`; (c) `grep -rn "owner_org_id\|ownerOrgId" src/lib/` returns matches only in `src/lib/circles/queries.ts` for the `CircleRow` projection; (d) the left side of every `or(...)` in `visibilityClause` is `eq(deals.orgId, orgId)` — byte-identical to slice 3; (e) `visibilityClause(orgId, [])` returns the bare slice-3 form (no `or`, no `inArray([])`); (f) `isOrgMemberOfCircle` is called exactly once in `src/lib/deals/actions.ts` (inside `postDeal`) and never from any read path; (g) the membership check runs BEFORE the `db.insert(deals)` call — verify via `grep -n "isOrgMemberOfCircle\|insert(deals)" src/lib/deals/actions.ts`; (h) `postDeal` rejects with `ForbiddenError` (not `Error`) so the wrapper's catch can distinguish authz failure from DB failure; (i) `runWithUser`'s catch translates `ForbiddenError` to `{ ok: false, error: "Forbidden" }`; (j) the migration `drizzle/0005_*.sql` is schema-only (no INSERTs) and carries the `-- schema-only` header; (k) the `deals.visibility_circle_id` FK uses `ON DELETE SET NULL`; (l) `test/helpers/shared-db.ts` seeds three orgs (1, 999, 888); (m) `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts` exists and passes (i.e. the `addOrgToCircle`/`removeOrgFromCircle` helpers do NOT exist in slice 4); (n) `formatDealVisibility` returns `kind: "private"` for unknown circle ids (name-leak guard); (o) the slice-3 cross-org isolation tests pass unchanged. Report findings, no fixes.

- [ ] **Step 2: Apply review fixes** (if any). For each finding, fix + add a failing-first test + commit with a `fix(<domain>): …` message ending in the Co-Authored-By trailer.

- [ ] **Step 3: Push the branch.**
```bash
git push -u origin feature/aiya-circles-4
```

- [ ] **Step 4: Merge to main.** From the worktree:
```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git checkout main
git merge --no-ff feature/aiya-circles-4 -m "$(cat <<'EOF'
merge: AIYA Circles slice 4

Widens the single-org Deal Room into a private cross-org B2B network.
Adds circles + circle_members tables, a nullable deals.visibility_circle_id,
and widens every deals read with `OR visibility_circle_id IN (my circles)`.
postDeal accepts an optional visibilityCircleId that is server-validated
against actual circle membership before insert.

Orgs in zero circles hit byte-identical slice-3 SQL — no behavior change
for unconnected tenants. Slice-3 cross-org isolation tests pass unchanged.

Demo seeds AIYA + 3 partner orgs (Mehta Mumbai, Saint-Cloud Geneva,
Marathi Surat) in "AIYA Trusted Partners".

NO new /circles admin route this slice — invitations + membership UI
ship in slice 4c "Circle Onboarding".

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 5: Cleanup.**
```bash
git worktree remove "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-circles-4"
git branch -d feature/aiya-circles-4
git push origin --delete feature/aiya-circles-4
```

- [ ] **Step 6: Confirm done.** Run from main: `npm test -- --run && npx tsc --noEmit && npm run build`
Expected: green + clean + build succeeds.

---

## Done criteria

- All new tests green; full suite green; `tsc --noEmit` clean; build succeeds.
- `circles` and `circle_members` tables exist, with the unique `(circle_id, org_id)` constraint on the junction.
- `deals.visibility_circle_id INTEGER REFERENCES circles(id) ON DELETE SET NULL` exists; nullable; defaults to NULL.
- `getCircleIdsForOrg`, `getCirclesForOrg`, `getCircleNamesForOrg` live in `src/lib/circles/queries.ts`.
- `isOrgMemberOfCircle` lives in `src/lib/circles/membership.ts`; returns `false` for nonexistent circle ids (no FK error leak).
- `getActiveDeals` and `getAllDeals` widen their WHERE clause with `or(eq(orgId), inArray(visibilityCircleId, viewerCircleIds))`; when `viewerCircleIds` is empty, the clause degenerates to byte-identical slice-3 `eq(orgId)`.
- `postDealInput` accepts an optional `visibilityCircleId: z.number().int().positive().nullable().optional()`. No other validation schema has any `circleId`-shaped field.
- `postDeal` calls `isOrgMemberOfCircle(session.orgId, circleId)` **before** the insert when the field is non-null; on rejection throws `ForbiddenError`; `runWithUser` catches and returns `{ ok: false, error: "Forbidden" }` with zero rows written.
- `DealRoomPanel` accepts `currentOrgId` + `circleNamesById` props; renders the visibility badge with own-vs-foreign tooltip variants; renders a "Connected via …" / "Connected to N circles" subtitle.
- `PostDealForm` accepts an optional `circles` prop; the dropdown is hidden when the array is empty.
- `/deals` admin RSC parallel-fetches `getCirclesForOrg` and threads circle options into `PostDealForm`.
- `src/app/page.tsx` parallel-fetches `getCircleNamesForOrg` and threads the map into `DealView`.
- Demo seed has the `AIYA Trusted Partners` circle (id 201), 3 partner orgs (501/502/503), and 3 cross-circle deals (106/107/108) with `demo · simulated` subject suffix.
- `test/helpers/shared-db.ts` seeds three orgs: AIYA (1), fixture (999), partner (888).
- `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts` exists and passes — the moment slice 4c adds membership-mutation helpers, this test fails and forces a conscious mitigation choice.
- The slice-3 cross-org isolation tests (`test/db/inventory.test.ts`, `test/db/diamonds.test.ts`, `test/lib/deals/queries.test.ts` tenancy block) pass without modification.
- `grep -rn "from(deals)" src/` returns matches only inside `src/lib/deals/queries.ts` and `src/lib/deals/actions.ts`.
- `grep -rn "owner_org_id\|ownerOrgId" src/lib/` returns matches only in `src/lib/circles/queries.ts` for the `CircleRow` projection.
- Next: Slice 4b — TradeNet Inventory · Slice 4c — Circle Onboarding (which inherits the race sentinel) · Slice 4d — Circle Roles.
