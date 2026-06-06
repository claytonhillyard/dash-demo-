# AIYA Slice 4c — Circle Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-service circle management — owners create circles, invite other orgs by slug, recipients accept or decline via an unguessable token, members can leave, owners can remove. Six server actions + a new `/circles` admin route + repurpose of the slice-4 race sentinel to lock in the chosen race resolution (FOR UPDATE transaction + ON CONFLICT idempotent insert + partial unique index on pending invites).

**Architecture:** New `circle_invitations` table with partial unique index `(circle_id, to_org_slug) WHERE status = 'pending'` for the duplicate-invite race; FOR UPDATE on the invitation row inside a transaction for the accept/decline race; ON CONFLICT DO NOTHING on `circle_members` insert for the membership race; uniform `Forbidden` rejection at the action layer; slug-based cross-org integrity check at accept time. Token = `crypto.randomUUID()` (122 bits entropy), 7-day TTL, never logged. Demo mode short-circuits every mutation; query layer short-circuits to seeds. No email — slice 4d's job.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind · Drizzle ORM · pglite (test) · Neon (prod) · jose (JWT) · Zod · Vitest · `crypto.randomUUID()` (Node 18+) · existing slice-3 `getCurrentOrgId()` + slice-4 `circles` / `circle_members` / `isOrgMemberOfCircle` + slice-10/16 `runWithUser` + `ForbiddenError` pattern.

**Spec:** `docs/superpowers/specs/2026-06-05-aiya-circle-onboarding-slice-4c-design.md`

**Conventions:**
- Run a single test file: `npx vitest run <path>`
- DB/action tests use `// @vitest-environment node` and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` + `__setTestDb` pattern from `test/helpers/shared-db.ts`.
- All server actions stamp `orgId` from `session.orgId`, never the wire. No Zod schema accepts `fromOrgId`, `currentOrgId`, or `userOrgId`.
- Every authz failure returns `{ ok: false, error: "Forbidden" }` — uniform rejection. The `console.warn` audit line MAY include details for in-house debugging; the wire response MAY NOT.
- Tokens are generated server-side via `crypto.randomUUID()`. NEVER log a token in `console.*` or surface one in an error message.
- Commit after every green step.

> ## CRITICAL — Race resolution (A1/B5 load-bearing)
>
> The slice-4 sentinel deliberately blocks `addOrgToCircle` / `removeOrgFromCircle` helpers from existing without a mitigation. Slice 4c chooses the **FOR UPDATE transaction + ON CONFLICT idempotent insert** path:
> 1. `acceptInvitation` and `declineInvitation` wrap their entire read-check-write logic in a single PG transaction.
> 2. The invitation row is locked with `SELECT … FOR UPDATE` immediately after the token lookup. A second concurrent caller blocks on the lock; when it proceeds, the status read returns `'accepted'` and the second call rejects.
> 3. The `circle_members` insert uses `ON CONFLICT (circle_id, org_id) DO NOTHING` against the slice-4 unique constraint. Two simultaneous accepts can never produce two rows even if the lock fails.
> 4. `inviteOrgToCircle` relies on a partial unique index `(circle_id, to_org_slug) WHERE status = 'pending'`. Two simultaneous invite calls for the same circle+slug both attempt INSERT; the second fails with SQLSTATE 23505 (`unique_violation`), which the action translates to `Forbidden`.
>
> The repurposed sentinel test (A5) FLIPS the slice-4 assertions: it now asserts the `membership-mutations` module exists AND that `actions.ts` contains `FOR UPDATE` + `.transaction(` + `ON CONFLICT (circle_id, org_id) DO NOTHING`. Do NOT delete the sentinel — its repurpose is the lock-in of the resolution.

> ## CRITICAL — Uniform `Forbidden` rejection
>
> Every action that rejects MUST return `{ ok: false, error: "Forbidden" }` — not `"Expired"`, not `"Not pending"`, not `"Wrong slug"`, not `"No such token"`. The granular `console.warn` audit log line MAY include the reason for in-house debugging; the wire response MUST NOT. This prevents an attacker with the token from distinguishing valid-but-expired from invalid, which would otherwise leak the existence (and timing) of past invites.

> ## CRITICAL — Slug cross-check at accept time
>
> Inside the FOR UPDATE transaction, after the status + expiry check, the action MUST verify `session.orgId`'s `orgs.slug === invitation.to_org_slug` BEFORE inserting the membership. This is the slug-based authentication of the recipient — without it, an attacker who steals an accept token from a Slack paste can join a circle they were not invited to. The §9.6 / B5 test "wrong-slug session" is the asserting test.

> ## CRITICAL — Token entropy + non-logging
>
> Tokens are `crypto.randomUUID()` (122 bits entropy from the OS CSPRNG, Node 18+). NEVER use `Math.random()` or any pseudo-random source. NEVER log a token in any `console.warn` / `console.error` / `Sentry.captureException` call. The B11 / `token-security.test.ts` test asserts this with spies on `console.warn` and `console.error`.

---

## Task 0: Set up worktree

**Files:** none (environment setup)

- [ ] **Step 1: From repo root, create the worktree.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root" && git worktree add -b feature/aiya-circle-onboarding-4c .worktrees/aiya-circle-onboarding-4c main`
  Expected: new worktree directory at `.worktrees/aiya-circle-onboarding-4c`, branch `feature/aiya-circle-onboarding-4c` checked out there.

- [ ] **Step 2: Switch to the worktree and install.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-circle-onboarding-4c" && npm install`
  Expected: clean install; no errors.

- [ ] **Step 3: Verify baseline tests pass.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-circle-onboarding-4c" && npm test -- --run`
  Expected: full suite green (the post-slice-16 baseline). If anything fails, STOP — the baseline is broken, not your code.

- [ ] **Step 4: Verify the slice-4 sentinel is currently armed.**
  Run: `npx vitest run test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`
  Expected: PASS — both assertions green (module-does-not-exist, no-transaction). This is the test we will FLIP in A5.

(All subsequent `cd` commands in this plan reference the worktree path. Use `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-circle-onboarding-4c"` before any command.)

---

## Phase A — Foundation (schema + migration + query layer + sentinel repurpose)

Phase A lands the `circle_invitations` table, generates the migration, adds the four new query helpers, and repurposes the slice-4 race sentinel. **No action layer yet.** Phase B is the action layer; Phase C is the UI.

### Task A1: Add `circleInvitations` to `src/db/schema.ts`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `test/db/schema.test.ts`

- [ ] **Step 1: Failing schema assertions.** Append to the existing `describe("db schema", …)` in `test/db/schema.test.ts`:

```ts
  it("exports circleInvitations with id/circleId/fromOrgId/toOrgSlug/token/status/expiresAt", () => {
    expect(schema.circleInvitations).toBeDefined();
    expect(schema.circleInvitations.id.columnType).toBe("PgSerial");
    expect(schema.circleInvitations.circleId.columnType).toBe("PgInteger");
    expect(schema.circleInvitations.fromOrgId.columnType).toBe("PgInteger");
    expect(schema.circleInvitations.toOrgSlug.columnType).toBe("PgText");
    expect(schema.circleInvitations.token.columnType).toBe("PgText");
    expect(schema.circleInvitations.status.columnType).toBe("PgText");
    expect(schema.circleInvitations.createdAt.columnType).toBe("PgTimestamp");
    expect(schema.circleInvitations.expiresAt.columnType).toBe("PgTimestamp");
    expect(schema.circleInvitations.respondedAt.columnType).toBe("PgTimestamp");
    // respondedAt is nullable; expiresAt is NOT null.
    expect(schema.circleInvitations.respondedAt.notNull).toBe(false);
    expect(schema.circleInvitations.expiresAt.notNull).toBe(true);
  });
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/schema.test.ts`
Expected: FAIL — `schema.circleInvitations` is undefined.

- [ ] **Step 3: Add the table to `src/db/schema.ts`.** Open the file. After the `circleMembers` table (around line 56), import `uniqueIndex` from `drizzle-orm/pg-core` if not present (it's currently absent — slice 4's partial index used the regular `index` form with a `.where(...)` clause; for slice 4c we want a true partial UNIQUE so we need `uniqueIndex`).

Update the imports block at the top of `src/db/schema.ts`:

```ts
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  jsonb,
  unique,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
```

Then append, after the `circleMembers` table definition:

```ts
export const circleInvitations = pgTable(
  "circle_invitations",
  {
    id: serial("id").primaryKey(),
    circleId: integer("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    fromOrgId: integer("from_org_id")
      .notNull()
      .references(() => orgs.id),
    toOrgSlug: text("to_org_slug").notNull(),
    token: text("token").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "withdrawn", "expired"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => ({
    tokenUniq: unique("circle_invitations_token_uniq").on(t.token),
    // Partial UNIQUE: only one pending invite per (circle, target slug) at a time.
    // Historical accepted/declined/withdrawn rows do NOT occupy the index, so
    // re-invites after a non-pending response are allowed.
    pendingUniq: uniqueIndex("circle_invitations_pending_uniq")
      .on(t.circleId, t.toOrgSlug)
      .where(sql`${t.status} = 'pending'`),
    toSlugStatusIdx: index("circle_invitations_to_slug_status_idx")
      .on(t.toOrgSlug, t.status),
    fromOrgStatusIdx: index("circle_invitations_from_org_status_idx")
      .on(t.fromOrgId, t.status),
  }),
);
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/db/schema.ts test/db/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): circle_invitations table for slice 4c onboarding

Columns: id, circle_id (FK → circles, ON DELETE CASCADE), from_org_id
(FK → orgs), to_org_slug, token (UNIQUE), status (enum), created_at,
expires_at, responded_at. Token + slug pair is the cross-org credential
on the accept URL — neither half is wire-supplied at accept time.

Partial UNIQUE index on (circle_id, to_org_slug) WHERE status = 'pending'
makes duplicate-pending invites impossible at the DB level. Historical
non-pending rows do not block re-issue.

Two non-unique indexes accelerate the recipient's inbox lookup
(to_org_slug, status) and the owner's outbox lookup (from_org_id, status).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration `drizzle/0010_*.sql` + smoke test

**Files:**
- Create: `drizzle/0010_*.sql` (generated, then hand-edited with header comment)
- Modify: `drizzle/meta/_journal.json` + new snapshot (generated)
- Create: `test/db/circle-invitations-migration.test.ts`

- [ ] **Step 1: Generate the migration.** Run: `npm run db:generate`
Expected: a new `drizzle/0010_<name>.sql` appears containing:
  - `CREATE TABLE "circle_invitations" (...)` with all 9 columns.
  - `CREATE UNIQUE INDEX "circle_invitations_token_uniq" ...`.
  - `CREATE UNIQUE INDEX "circle_invitations_pending_uniq" ON "circle_invitations" ("circle_id","to_org_slug") WHERE "status" = 'pending';`
  - `CREATE INDEX "circle_invitations_to_slug_status_idx" ...`.
  - `CREATE INDEX "circle_invitations_from_org_status_idx" ...`.

  If the command appears to hang, report BLOCKED.

- [ ] **Step 2: Inspect the generated SQL.** Open `drizzle/0010_*.sql` and confirm the partial unique index emits the `WHERE "status" = 'pending'` clause. If Drizzle emits it as a plain `UNIQUE INDEX` without the WHERE, fix the schema — `uniqueIndex(...).on(...).where(...)` is the API that generates partial-unique.

- [ ] **Step 3: Hand-edit the migration with the schema-only header.** Prepend to `drizzle/0010_*.sql`:

```sql
-- schema-only; no seed data in this migration.
-- circle_invitations starts empty in prod; the demo seed lives in
-- src/lib/demo/seed.ts and never touches the DB.
-- See docs/superpowers/plans/2026-06-05-aiya-circle-onboarding-slice-4c.md for context.
```

- [ ] **Step 4: Failing migration smoke test.** Create `test/db/circle-invitations-migration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/client";
import { circles, circleInvitations } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

const fiveMinFromNow = () => new Date(Date.now() + 5 * 60 * 1000);

describe("circle_invitations migration", () => {
  it("creates the table empty", async () => {
    const t = await createTestDb();
    close = t.close;
    expect(await t.db.select().from(circleInvitations)).toEqual([]);
  });

  it("enforces unique tokens", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning({ id: circles.id });
    await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    });
    await expect(
      t.db.insert(circleInvitations).values({
        circleId: c.id, fromOrgId: 1, toOrgSlug: "beta",
        token: "tok-1", expiresAt: fiveMinFromNow(),
      })
    ).rejects.toThrow();
  });

  it("partial unique (circle_id, to_org_slug) WHERE status=pending: rejects duplicate pending", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning({ id: circles.id });
    await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    });
    await expect(
      t.db.insert(circleInvitations).values({
        circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
        token: "tok-2", expiresAt: fiveMinFromNow(),
      })
    ).rejects.toThrow();
  });

  it("partial unique allows re-invite after non-pending status", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning({ id: circles.id });
    // First invite, then flip to declined.
    const [first] = await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    }).returning({ id: circleInvitations.id });
    await t.db.execute(sql`
      UPDATE circle_invitations
      SET status = 'declined', responded_at = now()
      WHERE id = ${first.id}
    `);
    // Re-invite same circle+slug should succeed because the prior row is no
    // longer pending.
    await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-2", expiresAt: fiveMinFromNow(),
    });
    const rows = await t.db.select().from(circleInvitations);
    expect(rows).toHaveLength(2);
  });

  it("ON DELETE CASCADE on circle_id: deleting a circle wipes its invites", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning({ id: circles.id });
    await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    });
    await t.db.execute(sql`DELETE FROM circles WHERE id = ${c.id}`);
    expect(await t.db.select().from(circleInvitations)).toHaveLength(0);
  });

  it("rejects from_org_id with no matching orgs row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning({ id: circles.id });
    await expect(
      t.db.insert(circleInvitations).values({
        circleId: c.id, fromOrgId: 99999, toOrgSlug: "alpha",
        token: "tok-1", expiresAt: fiveMinFromNow(),
      })
    ).rejects.toThrow();
  });

  it("status defaults to 'pending'", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning({ id: circles.id });
    const [inv] = await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    }).returning({ status: circleInvitations.status });
    expect(inv.status).toBe("pending");
  });
});
```

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/db/circle-invitations-migration.test.ts`
Expected: PASS (7 tests). If "relation circle_invitations does not exist", Step 1 didn't run.

- [ ] **Step 6: Commit.**
```bash
git add drizzle test/db/circle-invitations-migration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): generate 0010 migration (circle_invitations) + smoke tests

Schema-only migration — circle_invitations starts empty in prod; the demo
seed lives in src/lib/demo/seed.ts and never touches the DB. Partial
UNIQUE on (circle_id, to_org_slug) WHERE status = 'pending' rejects
duplicate pending invites at the DB level, allowing re-invites after a
prior decline. ON DELETE CASCADE on circle_id cascades invites when a
circle is deleted (future slice; no UI today).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Add four new query helpers to `src/lib/circles/queries.ts`

**Files:**
- Modify: `src/lib/circles/queries.ts`
- Modify: `test/lib/circles/queries.test.ts`

- [ ] **Step 1: Failing tests — append to `test/lib/circles/queries.test.ts`.** Add the following imports + describe blocks at the bottom:

```ts
// ...existing imports...
import {
  getOwnedCirclesForOrg,
  listCircleMemberOrgs,
  getPendingInvitesIssuedByOrg,
  getPendingInvitesForSlug,
  type InvitationRow,
} from "@/lib/circles/queries";
import { circleInvitations } from "@/db/schema";

const fiveMinFromNow = () => new Date(Date.now() + 5 * 60 * 1000);

describe("getOwnedCirclesForOrg", () => {
  it("returns only circles owned by the caller", async () => {
    const [a] = await db.insert(circles).values({ name: "A", slug: "a", ownerOrgId: 1 }).returning({ id: circles.id });
    const [b] = await db.insert(circles).values({ name: "B", slug: "b", ownerOrgId: 999 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: b.id, orgId: 1 }); // 1 is a member but not owner

    const owned = await getOwnedCirclesForOrg(db, 1);
    expect(owned.map((c) => c.id)).toEqual([a.id]);
  });

  it("returns [] when the caller owns no circles", async () => {
    await db.insert(circles).values({ name: "A", slug: "a", ownerOrgId: 999 });
    expect(await getOwnedCirclesForOrg(db, 1)).toEqual([]);
  });
});

describe("listCircleMemberOrgs", () => {
  it("returns the joined org rows for a circle the viewer is in", async () => {
    const [c] = await db.insert(circles).values({ name: "C", slug: "c", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleMembers).values([
      { circleId: c.id, orgId: 1 },
      { circleId: c.id, orgId: 888 },
    ]);
    const members = await listCircleMemberOrgs(db, c.id, 1);
    const ids = members.map((m) => m.orgId).sort();
    expect(ids).toEqual([1, 888]);
    const aiya = members.find((m) => m.orgId === 1);
    expect(aiya?.name).toBe("AIYA Designs");
  });

  it("returns [] when the viewer is NOT a member of the circle (defense-in-depth)", async () => {
    const [c] = await db.insert(circles).values({ name: "C", slug: "c", ownerOrgId: 999 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 999 });
    // viewer is org 1, NOT a member of c.
    expect(await listCircleMemberOrgs(db, c.id, 1)).toEqual([]);
  });
});

describe("getPendingInvitesIssuedByOrg", () => {
  it("returns the outbox with circleName + fromOrgName joined", async () => {
    const [c] = await db.insert(circles).values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "argyle-mining",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    });
    const rows = await getPendingInvitesIssuedByOrg(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      circleId: c.id,
      circleName: "Trusted",
      fromOrgId: 1,
      fromOrgName: "AIYA Designs",
      toOrgSlug: "argyle-mining",
      status: "pending",
    });
  });

  it("does NOT return non-pending invites", async () => {
    const [c] = await db.insert(circles).values({ name: "C", slug: "c", ownerOrgId: 1 }).returning({ id: circles.id });
    const [inv] = await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    }).returning({ id: circleInvitations.id });
    await db.update(circleInvitations).set({ status: "declined" }).where(eq(circleInvitations.id, inv.id));

    expect(await getPendingInvitesIssuedByOrg(db, 1)).toEqual([]);
  });
});

describe("getPendingInvitesForSlug", () => {
  it("returns invites addressed to the given slug, joined with circle + inviter org", async () => {
    const [c] = await db.insert(circles).values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
      token: "tok-x", expiresAt: fiveMinFromNow(),
    });
    const rows = await getPendingInvitesForSlug(db, "fixture");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      circleName: "Trusted",
      fromOrgName: "AIYA Designs",
      toOrgSlug: "fixture",
      status: "pending",
    });
  });

  it("returns [] for a slug with no pending invites", async () => {
    expect(await getPendingInvitesForSlug(db, "nobody")).toEqual([]);
  });
});
```

(Add `eq` to the existing `drizzle-orm` import in the test file if absent.)

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/queries.test.ts`
Expected: FAIL — new helpers + `InvitationRow` are undefined.

- [ ] **Step 3: Extend `src/lib/circles/queries.ts`.** Append (after the existing `getCircleNamesForOrg`):

```ts
import { and, desc } from "drizzle-orm";
import { orgs, circleInvitations } from "@/db/schema";
import { isOrgMemberOfCircle } from "./membership";

export interface InvitationRow {
  id: number;
  circleId: number;
  circleName: string;
  fromOrgId: number;
  fromOrgName: string;
  toOrgSlug: string;
  token: string;
  status: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
}

/** Owner perspective: circles where the caller's org is the owner. */
export async function getOwnedCirclesForOrg(db: Db, orgId: number): Promise<CircleRow[]> {
  if (isDemoMode()) {
    // Demo mode: AIYA owns the demo Trusted Partners circle.
    const { getSeedOwnedCirclesForOrg } = await import("@/lib/demo/seed");
    return getSeedOwnedCirclesForOrg(orgId);
  }
  return await db
    .select({
      id: circles.id, name: circles.name, slug: circles.slug, ownerOrgId: circles.ownerOrgId,
    })
    .from(circles)
    .where(eq(circles.ownerOrgId, orgId));
}

/** Returns the member orgs of a circle, but ONLY if the caller is themselves
 *  a member of that circle. Defense in depth: the page already only iterates
 *  over circles the viewer is in, but this helper double-checks. */
export async function listCircleMemberOrgs(
  db: Db,
  circleId: number,
  viewerOrgId: number,
): Promise<{ orgId: number; name: string; slug: string; createdAt: Date }[]> {
  if (isDemoMode()) {
    // Demo: if viewer is in this circle per the seed graph, return seeded
    // partner-org names. Otherwise [].
    const { getSeedCircleIdsForOrg, DEMO_PARTNER_ORG_IDS, DEMO_AIYA_ORG_ID, DEMO_TRUSTED_PARTNERS_CIRCLE_ID } =
      await import("@/lib/demo/seed");
    if (!getSeedCircleIdsForOrg(viewerOrgId).includes(circleId)) return [];
    if (circleId !== DEMO_TRUSTED_PARTNERS_CIRCLE_ID) return [];
    const t0 = new Date("2026-05-01T00:00:00Z");
    return [
      { orgId: DEMO_AIYA_ORG_ID, name: "AIYA Designs", slug: "aiya", createdAt: t0 },
      { orgId: DEMO_PARTNER_ORG_IDS.MEHTA, name: "Mehta Diamonds — Mumbai", slug: "mehta-mumbai", createdAt: t0 },
      { orgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD, name: "Saint-Cloud Gems — Geneva", slug: "saint-cloud-geneva", createdAt: t0 },
      { orgId: DEMO_PARTNER_ORG_IDS.MARATHI, name: "Marathi Trading — Surat", slug: "marathi-surat", createdAt: t0 },
    ];
  }
  const isMember = await isOrgMemberOfCircle(db, viewerOrgId, circleId);
  if (!isMember) return [];
  return await db
    .select({
      orgId: circleMembers.orgId,
      name: orgs.name,
      slug: orgs.slug,
      createdAt: circleMembers.createdAt,
    })
    .from(circleMembers)
    .innerJoin(orgs, eq(orgs.id, circleMembers.orgId))
    .where(eq(circleMembers.circleId, circleId))
    .orderBy(circleMembers.createdAt);
}

/** Outbox for the owner: pending invites this org has issued. */
export async function getPendingInvitesIssuedByOrg(db: Db, orgId: number): Promise<InvitationRow[]> {
  if (isDemoMode()) {
    const { getSeedPendingInvitesForOrg } = await import("@/lib/demo/seed");
    return getSeedPendingInvitesForOrg(orgId).map((s) => ({
      id: s.id,
      circleId: s.circleId,
      circleName: s.circleName,
      fromOrgId: s.fromOrgId,
      fromOrgName: s.fromOrgName,
      toOrgSlug: s.toOrgSlug,
      token: s.token,
      status: s.status,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      respondedAt: null,
    }));
  }
  return await db
    .select({
      id: circleInvitations.id,
      circleId: circleInvitations.circleId,
      circleName: circles.name,
      fromOrgId: circleInvitations.fromOrgId,
      fromOrgName: orgs.name,
      toOrgSlug: circleInvitations.toOrgSlug,
      token: circleInvitations.token,
      status: circleInvitations.status,
      createdAt: circleInvitations.createdAt,
      expiresAt: circleInvitations.expiresAt,
      respondedAt: circleInvitations.respondedAt,
    })
    .from(circleInvitations)
    .innerJoin(circles, eq(circles.id, circleInvitations.circleId))
    .innerJoin(orgs, eq(orgs.id, circleInvitations.fromOrgId))
    .where(and(eq(circleInvitations.fromOrgId, orgId), eq(circleInvitations.status, "pending")))
    .orderBy(desc(circleInvitations.createdAt));
}

/** Inbox for the recipient: pending invites addressed to this org's slug. */
export async function getPendingInvitesForSlug(db: Db, slug: string): Promise<InvitationRow[]> {
  if (isDemoMode()) {
    // Demo mode: AIYA has no pending received invites in the seed.
    return [];
  }
  if (!slug) return [];
  return await db
    .select({
      id: circleInvitations.id,
      circleId: circleInvitations.circleId,
      circleName: circles.name,
      fromOrgId: circleInvitations.fromOrgId,
      fromOrgName: orgs.name,
      toOrgSlug: circleInvitations.toOrgSlug,
      token: circleInvitations.token,
      status: circleInvitations.status,
      createdAt: circleInvitations.createdAt,
      expiresAt: circleInvitations.expiresAt,
      respondedAt: circleInvitations.respondedAt,
    })
    .from(circleInvitations)
    .innerJoin(circles, eq(circles.id, circleInvitations.circleId))
    .innerJoin(orgs, eq(orgs.id, circleInvitations.fromOrgId))
    .where(and(eq(circleInvitations.toOrgSlug, slug), eq(circleInvitations.status, "pending")))
    .orderBy(desc(circleInvitations.createdAt));
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/queries.test.ts`
Expected: PASS (existing + 8 new tests). The seed-import for `listCircleMemberOrgs`/`getOwnedCirclesForOrg` is a dynamic import so it only loads in demo mode — the regular code path doesn't pay for it.

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit (WITHOUT seed changes yet — A4 wires the demo seed exports).**
```bash
git add src/lib/circles/queries.ts test/lib/circles/queries.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): query layer for owner outbox + recipient inbox

Four new helpers:
- getOwnedCirclesForOrg(db, orgId) — circles where ownerOrgId == orgId
- listCircleMemberOrgs(db, circleId, viewerOrgId) — joined member rows;
  defense-in-depth re-check that viewer is themselves a member
- getPendingInvitesIssuedByOrg(db, orgId) — owner's outbox (joined with
  circle + inviter org for display)
- getPendingInvitesForSlug(db, slug) — recipient's inbox by slug

All four short-circuit on isDemoMode() to dynamic imports of the seed
file (which A4 extends). Production code paths never pay for the seed
module unless the demo flag is set.

The defense-in-depth re-check in listCircleMemberOrgs is the load-bearing
name-leak guard: even if a future bug widens the page's iteration scope,
this helper still filters by isOrgMemberOfCircle.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Extend demo seed with pending invite + owned-circles helper

**Files:**
- Modify: `src/lib/demo/seed.ts`
- Modify: `test/lib/demo/seed.test.ts`

- [ ] **Step 1: Failing test — extend `test/lib/demo/seed.test.ts`.** Append:

```ts
import {
  // ... existing imports ...
  DEMO_ARGYLE_ORG_ID,
  getSeedPendingInvitesForOrg,
  getSeedOwnedCirclesForOrg,
} from "@/lib/demo/seed";

describe("DEMO_ARGYLE_ORG_ID", () => {
  it("is a numeric id outside the partner-org range", () => {
    expect(typeof DEMO_ARGYLE_ORG_ID).toBe("number");
    expect(DEMO_ARGYLE_ORG_ID).toBeGreaterThan(503); // beyond the slice-4 partner range
  });
});

describe("getSeedPendingInvitesForOrg", () => {
  it("returns one pending invite from AIYA to argyle-mining", () => {
    const invites = getSeedPendingInvitesForOrg(DEMO_AIYA_ORG_ID);
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      circleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      circleName: "AIYA Trusted Partners",
      fromOrgId: DEMO_AIYA_ORG_ID,
      fromOrgName: "AIYA Designs",
      toOrgSlug: "argyle-mining",
      status: "pending",
    });
    // Token is present but is a static demo string — the UI never displays it.
    expect(typeof invites[0].token).toBe("string");
    expect(invites[0].token.length).toBeGreaterThan(0);
    // Expiry is in the future so the demo UI shows the invite as pending.
    expect(invites[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns [] for any non-AIYA org", () => {
    expect(getSeedPendingInvitesForOrg(999)).toEqual([]);
    expect(getSeedPendingInvitesForOrg(DEMO_PARTNER_ORG_IDS.MEHTA)).toEqual([]);
  });
});

describe("getSeedOwnedCirclesForOrg", () => {
  it("returns the demo Trusted Partners circle for AIYA", () => {
    const owned = getSeedOwnedCirclesForOrg(DEMO_AIYA_ORG_ID);
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({
      id: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      name: "AIYA Trusted Partners",
      ownerOrgId: DEMO_AIYA_ORG_ID,
    });
  });

  it("returns [] for any non-AIYA org", () => {
    expect(getSeedOwnedCirclesForOrg(999)).toEqual([]);
    expect(getSeedOwnedCirclesForOrg(DEMO_PARTNER_ORG_IDS.MEHTA)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: FAIL — new exports don't exist.

- [ ] **Step 3: Extend `src/lib/demo/seed.ts`.** Append (after `getSeedDealsVisibleTo`):

```ts
// --- Slice 4c demo seed: pending invite + owned-circle helper ---

/** Demo-only org id for the recipient of the seeded pending invite.
 *  Outside the slice-4 partner range (501-503), high enough to read as
 *  fixture-only. The org itself does NOT exist in any membership graph —
 *  the recipient is, by definition, "not yet a member". */
export const DEMO_ARGYLE_ORG_ID = 504;

export interface SeedInvitation {
  id: number;
  circleId: number;
  circleName: string;
  fromOrgId: number;
  fromOrgName: string;
  toOrgSlug: string;
  /** Static demo token — never produced by crypto.randomUUID() in demo mode.
   *  The demo UI never displays the token (same as real invites). */
  token: string;
  status: "pending";
  createdAt: Date;
  expiresAt: Date;
}

const DEMO_INVITE_ID = 301;
// Far enough in the future that the demo UI always shows the invite as
// pending (demo time is frozen at DEMO_REF for deals; this expiry sits
// 7 days after now() at module-eval — sufficient for any preview deploy).
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function getSeedPendingInvitesForOrg(orgId: number): SeedInvitation[] {
  if (orgId !== DEMO_AIYA_ORG_ID) return [];
  return [
    {
      id: DEMO_INVITE_ID,
      circleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      circleName: "AIYA Trusted Partners",
      fromOrgId: DEMO_AIYA_ORG_ID,
      fromOrgName: "AIYA Designs",
      toOrgSlug: "argyle-mining",
      token: "demo-static-token-do-not-display",
      status: "pending",
      createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS - 60 * 60 * 1000),
    },
  ];
}

export function getSeedOwnedCirclesForOrg(orgId: number): SeedCircle[] {
  if (orgId !== DEMO_AIYA_ORG_ID) return [];
  return getSeedCircles();
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the circles queries tests (now demo-aware).** Run: `npx vitest run test/lib/circles/queries.test.ts`
Expected: PASS — the existing tests still hit the DB (no `NEXT_PUBLIC_DEMO_MODE` flag set), and the new demo-aware seed exports compile cleanly.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/demo/seed.ts test/lib/demo/seed.test.ts
git commit -m "$(cat <<'EOF'
feat(demo): seed pending AIYA → argyle-mining invite for slice 4c UX

Adds DEMO_ARGYLE_ORG_ID (504), SeedInvitation type, and two helpers:
- getSeedPendingInvitesForOrg(AIYA) → one pending invite (id=301) to
  to_org_slug='argyle-mining' with a 7-day expiry from module eval.
- getSeedOwnedCirclesForOrg(AIYA) → the Trusted Partners circle so the
  /circles page's owned-circles section renders in demo.

The seeded invite's token is a static string ("demo-static-token-...")
that is NEVER displayed in the UI — the demo accept/decline buttons
short-circuit on isDemoMode() before reaching the token-based lookup.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Repurpose the slice-4 race sentinel — assertions flipped

**Files:**
- Modify: `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`

This task DOES NOT delete the sentinel. It flips both assertions to lock in the chosen race resolution. Until B-phase commits the actions.ts file with `FOR UPDATE`/`.transaction(`/`ON CONFLICT`, this test will be RED. That is intentional — it's TDD for the entire B phase.

- [ ] **Step 1: Open `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`.** Replace the entire file with:

```ts
// @vitest-environment node
//
// SLICE-4C RACE RESOLUTION SENTINEL (repurposed in slice 4c)
// ----------------------------------------------------------
// Slice 4 armed this sentinel to detect the moment slice 4c shipped
// membership-mutation helpers. Slice 4c lands them — and chooses the
// FOR UPDATE transaction + ON CONFLICT idempotent insert mitigation per
// spec §11.1. The assertions below LOCK IN the chosen mitigation so a
// future refactor cannot silently regress it.
//
// If a maintainer rips out the FOR UPDATE clause or the ON CONFLICT
// clause without consciously redesigning, this test fails and forces
// the same "choose a mitigation" conversation that slice 4's sentinel
// forced. Do NOT delete or weaken these assertions to "fix" a failure;
// re-do the design.
//
// See: docs/superpowers/specs/2026-06-05-aiya-circle-onboarding-slice-4c-design.md §11.1

import { describe, it, expect } from "vitest";

describe("slice-4c race resolution sentinel — locks in the chosen mitigation", () => {
  it("membership-mutations module exists and exports addOrgToCircle + removeOrgFromCircle", async () => {
    const modulePath = ["@/lib/circles", "membership-mutations"].join("/");
    const mod = await import(/* @vite-ignore */ modulePath);
    expect(typeof (mod as Record<string, unknown>).addOrgToCircle).toBe("function");
    expect(typeof (mod as Record<string, unknown>).removeOrgFromCircle).toBe("function");
  });

  it("acceptInvitation closes the check-then-insert race with FOR UPDATE inside a transaction", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/actions.ts"),
      "utf8",
    );
    expect(src).toMatch(/FOR\s+UPDATE/i);
    expect(src).toMatch(/\.transaction\s*\(/);
  });

  it("circle_members INSERT goes through ON CONFLICT (circle_id, org_id) DO NOTHING", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const actions = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/actions.ts"),
      "utf8",
    );
    const mutations = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/membership-mutations.ts"),
      "utf8",
    );
    // At least one of the two files must contain the canonical ON CONFLICT
    // clause. (Both do in practice — actions.ts inlines it in the accept
    // transaction; membership-mutations.ts exports it as addOrgToCircle.)
    const combined = actions + "\n" + mutations;
    expect(combined).toMatch(/ON\s+CONFLICT\s*\(\s*circle_id\s*,\s*org_id\s*\)\s+DO\s+NOTHING/i);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`
Expected: FAIL — all 3 assertions fail (the actions.ts + membership-mutations.ts files don't exist yet). This is the load-bearing red bar that B-phase will close.

- [ ] **Step 3: Commit the repurposed sentinel WITHOUT fixing the implementation yet.**
```bash
git add test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts
git commit -m "$(cat <<'EOF'
test(circles): repurpose slice-4c race sentinel to lock in chosen mitigation

Slice 4 armed this sentinel to FAIL the moment slice 4c shipped
membership-mutation helpers. Slice 4c ships them in B-phase and chooses
the FOR UPDATE transaction + ON CONFLICT idempotent insert mitigation
per spec §11.1. This commit FLIPS both assertions to lock in that choice:

- Module exists + exports addOrgToCircle + removeOrgFromCircle.
- src/lib/circles/actions.ts contains FOR UPDATE + .transaction(.
- The combined source of actions.ts + membership-mutations.ts contains
  ON CONFLICT (circle_id, org_id) DO NOTHING.

The test is RED until B-phase commits the action layer. That is
intentional — TDD discipline for the entire write-side gate.

The failure IS the obligation. Do not delete or weaken these assertions
to fix a future failure — re-do the design.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: Phase A green-bar verification (the sentinel stays red)

**Files:** none (verification only)

- [ ] **Step 1: Run all Phase A test files except the sentinel.** Run:
```
npx vitest run test/db/schema.test.ts test/db/circle-invitations-migration.test.ts test/lib/circles/queries.test.ts test/lib/demo/seed.test.ts
```
Expected: green (4 files, all tests pass).

- [ ] **Step 2: Confirm the sentinel is the only red.** Run: `npx vitest run test/lib/circles/`
Expected: every test file passes EXCEPT `SLICE_4C_RACE_SENTINEL.test.ts` (3 red assertions). This is the expected state at end of Phase A.

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean. (Sentinel is a runtime assertion, not a type-time one.)

(No commit; verification only.)

---

## Phase B — Server actions (the security-load-bearing slice)

Phase B lands the six actions, the canonical writers in `membership-mutations.ts`, the Zod schemas, and the truth-table tests. By the end of Phase B, the repurposed sentinel (A5) should turn GREEN — that's the validation that the race resolution is in place.

> ## CRITICAL — Phase B order
>
> B1 (errors.ts promotion) → B2 (Zod) → B3 (membership-mutations.ts) → B4 (createCircle) → B5 (inviteOrgToCircle) → B6 (acceptInvitation — the race-load-bearing action) → B7 (declineInvitation) → B8 (removeOrgFromCircle) → B9 (leaveCircle) → B10 (sentinel green-bar) → B11 (token-security cross-cut).
>
> Do not skip ahead. B6's race test depends on B3 + B5 being committed (the canonical writer + the partial unique index respectively).

### Task B1: Promote `ForbiddenError` to `src/lib/auth/errors.ts`

**Files:**
- Create: `src/lib/auth/errors.ts`
- Modify: `src/lib/deals/actions.ts` (replace inline class with import)

- [ ] **Step 1: Failing test — `test/lib/auth/errors.test.ts` (new):**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";

describe("ForbiddenError", () => {
  it("is an Error subclass with name = 'ForbiddenError'", () => {
    const e = new ForbiddenError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ForbiddenError");
  });

  it("accepts an optional message", () => {
    const e = new ForbiddenError("custom");
    expect(e.message).toBe("custom");
  });

  it("defaults message to 'Forbidden'", () => {
    expect(new ForbiddenError().message).toBe("Forbidden");
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/auth/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/auth/errors.ts`:**

```ts
/** Thrown by server actions to signal an authorization failure. Caught by
 *  the action wrapper (`runWithUser` / `run`) and translated to the uniform
 *  wire response { ok: false, error: "Forbidden" } with zero DB writes.
 *
 *  Promoted from src/lib/deals/actions.ts (slice 4) when slice 4c added a
 *  second consumer (src/lib/circles/actions.ts). Both layers import the
 *  same class; the wire-level uniformity is preserved.
 *
 *  See: docs/superpowers/specs/2026-06-05-aiya-circle-onboarding-slice-4c-design.md §11.2
 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
```

- [ ] **Step 4: Update `src/lib/deals/actions.ts` to import from the new module.** Replace the inline `ForbiddenError` class definition (lines 27-37) with:

```ts
import { ForbiddenError } from "@/lib/auth/errors";
```

(Add this to the import block at the top; remove the inline `class ForbiddenError extends Error { … }` block.)

- [ ] **Step 5: Run to verify PASS + full deals tests stay green.** Run:
```
npx vitest run test/lib/auth/errors.test.ts test/lib/deals test/lib/circles
```
Expected: PASS (sentinel still RED — expected).

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/auth/errors.ts test/lib/auth/errors.test.ts src/lib/deals/actions.ts
git commit -m "$(cat <<'EOF'
refactor(auth): promote ForbiddenError to src/lib/auth/errors.ts

Slice 4 hosted the class inline in deals/actions.ts because it had one
consumer. Slice 4c adds a second (circles/actions.ts), so the class moves
to a shared module. No behavioral change — deals tests still green.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Zod schemas for circle actions

**Files:**
- Create: `src/lib/circles/validation.ts`
- Create: `test/lib/circles/validation.test.ts`

- [ ] **Step 1: Failing test — `test/lib/circles/validation.test.ts`:**

```ts
import { describe, it, expect } from "vitest";
import {
  createCircleInput,
  inviteOrgToCircleInput,
  tokenInput,
  removeOrgFromCircleInput,
  leaveCircleInput,
} from "@/lib/circles/validation";

describe("createCircleInput", () => {
  it("accepts a valid name + slug", () => {
    const r = createCircleInput.safeParse({ name: "AIYA Trusted Partners", slug: "aiya-trusted-partners" });
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(createCircleInput.safeParse({ name: "", slug: "x" }).success).toBe(false);
  });

  it("rejects slug with uppercase or spaces", () => {
    expect(createCircleInput.safeParse({ name: "x", slug: "AIYA" }).success).toBe(false);
    expect(createCircleInput.safeParse({ name: "x", slug: "ai ya" }).success).toBe(false);
    expect(createCircleInput.safeParse({ name: "x", slug: "ai_ya" }).success).toBe(false);
  });

  it("strips unknown fields (no orgId leak)", () => {
    const r = createCircleInput.safeParse({ name: "x", slug: "x", orgId: 999, ownerOrgId: 999 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect("orgId" in r.data).toBe(false);
      expect("ownerOrgId" in r.data).toBe(false);
    }
  });
});

describe("inviteOrgToCircleInput", () => {
  it("accepts a valid pair", () => {
    expect(inviteOrgToCircleInput.safeParse({ circleId: 1, toOrgSlug: "alpha" }).success).toBe(true);
  });

  it("rejects circleId <= 0", () => {
    expect(inviteOrgToCircleInput.safeParse({ circleId: 0, toOrgSlug: "alpha" }).success).toBe(false);
    expect(inviteOrgToCircleInput.safeParse({ circleId: -1, toOrgSlug: "alpha" }).success).toBe(false);
  });

  it("rejects invalid slug shape", () => {
    expect(inviteOrgToCircleInput.safeParse({ circleId: 1, toOrgSlug: "Alpha" }).success).toBe(false);
    expect(inviteOrgToCircleInput.safeParse({ circleId: 1, toOrgSlug: "" }).success).toBe(false);
  });

  it("strips fromOrgId from the wire", () => {
    const r = inviteOrgToCircleInput.safeParse({ circleId: 1, toOrgSlug: "x", fromOrgId: 999 });
    expect(r.success).toBe(true);
    if (r.success) expect("fromOrgId" in r.data).toBe(false);
  });
});

describe("tokenInput", () => {
  it("accepts a UUID-shaped token", () => {
    expect(tokenInput.safeParse({ token: "550e8400-e29b-41d4-a716-446655440000" }).success).toBe(true);
  });

  it("rejects empty / short tokens", () => {
    expect(tokenInput.safeParse({ token: "" }).success).toBe(false);
    expect(tokenInput.safeParse({ token: "short" }).success).toBe(false);
  });
});

describe("removeOrgFromCircleInput", () => {
  it("accepts (circleId, orgId)", () => {
    expect(removeOrgFromCircleInput.safeParse({ circleId: 1, orgId: 2 }).success).toBe(true);
  });

  it("rejects non-positive ids", () => {
    expect(removeOrgFromCircleInput.safeParse({ circleId: 0, orgId: 1 }).success).toBe(false);
    expect(removeOrgFromCircleInput.safeParse({ circleId: 1, orgId: 0 }).success).toBe(false);
  });
});

describe("leaveCircleInput", () => {
  it("accepts circleId only", () => {
    expect(leaveCircleInput.safeParse({ circleId: 1 }).success).toBe(true);
  });

  it("strips any orgId attempt", () => {
    const r = leaveCircleInput.safeParse({ circleId: 1, orgId: 999 });
    expect(r.success).toBe(true);
    if (r.success) expect("orgId" in r.data).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/circles/validation.ts`:**

```ts
import { z } from "zod";

const SLUG_RE = /^[a-z0-9-]+$/;

export const createCircleInput = z.object({
  name: z.string().trim().min(1, "name is required").max(120, "name too long"),
  slug: z.string().trim().min(1, "slug is required").max(64, "slug too long")
    .regex(SLUG_RE, "slug must be lowercase letters, digits, or hyphens"),
});
export type CreateCircleInput = z.infer<typeof createCircleInput>;

export const inviteOrgToCircleInput = z.object({
  circleId: z.number().int().positive(),
  toOrgSlug: z.string().trim().min(1, "slug is required").max(64, "slug too long")
    .regex(SLUG_RE, "slug must be lowercase letters, digits, or hyphens"),
});
export type InviteOrgToCircleInput = z.infer<typeof inviteOrgToCircleInput>;

// Token format check: minimum length is 16 (much smaller than the 36 chars of
// a v4 UUID), maximum 128. We deliberately do NOT pin to UUID format so a
// future token format change doesn't require an action-layer rewrite.
export const tokenInput = z.object({
  token: z.string().trim().min(16).max(128),
});
export type TokenInput = z.infer<typeof tokenInput>;

export const removeOrgFromCircleInput = z.object({
  circleId: z.number().int().positive(),
  orgId: z.number().int().positive(), // the TARGET org being removed (NOT the session orgId)
});
export type RemoveOrgFromCircleInput = z.infer<typeof removeOrgFromCircleInput>;

export const leaveCircleInput = z.object({
  circleId: z.number().int().positive(),
});
export type LeaveCircleInput = z.infer<typeof leaveCircleInput>;
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/validation.test.ts`
Expected: PASS (all schemas + strip tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/circles/validation.ts test/lib/circles/validation.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): Zod schemas for createCircle / invite / accept / decline /
remove / leave

Five schemas total. All slug fields use a fixed lowercase+digits+hyphens
regex (matching slice-3 orgs.slug shape). No schema accepts fromOrgId,
currentOrgId, or ownerOrgId — slice-3 invariant preserved. Unknown wire
fields are stripped by Zod's default behavior.

tokenInput accepts strings 16-128 chars without pinning to UUID format,
so a future token format change (e.g. prefixed inv_…) does not require
an action-layer rewrite.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Create `src/lib/circles/membership-mutations.ts` (canonical writers)

**Files:**
- Create: `src/lib/circles/membership-mutations.ts`
- Create: `test/lib/circles/membership-mutations.test.ts`

- [ ] **Step 1: Failing test:**

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { addOrgToCircle, removeOrgFromCircle } from "@/lib/circles/membership-mutations";
import { eq, and } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function makeCircle(): Promise<number> {
  const [c] = await db.insert(circles)
    .values({ name: "C", slug: "c", ownerOrgId: 1 })
    .returning({ id: circles.id });
  return c.id;
}

describe("addOrgToCircle (canonical writer)", () => {
  it("inserts a membership row", async () => {
    const c = await makeCircle();
    await addOrgToCircle(db, c, 999);
    const rows = await db.select().from(circleMembers).where(eq(circleMembers.circleId, c));
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(999);
  });

  it("is idempotent: calling twice produces exactly one row (ON CONFLICT DO NOTHING)", async () => {
    const c = await makeCircle();
    await addOrgToCircle(db, c, 999);
    await addOrgToCircle(db, c, 999);
    const rows = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, c), eq(circleMembers.orgId, 999)));
    expect(rows).toHaveLength(1);
  });
});

describe("removeOrgFromCircle (canonical writer)", () => {
  it("deletes a membership row", async () => {
    const c = await makeCircle();
    await db.insert(circleMembers).values({ circleId: c, orgId: 999 });
    await removeOrgFromCircle(db, c, 999);
    const rows = await db.select().from(circleMembers).where(eq(circleMembers.circleId, c));
    expect(rows).toHaveLength(0);
  });

  it("is idempotent: deleting a non-member is a no-op", async () => {
    const c = await makeCircle();
    await expect(removeOrgFromCircle(db, c, 999)).resolves.not.toThrow();
    const rows = await db.select().from(circleMembers).where(eq(circleMembers.circleId, c));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/membership-mutations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/circles/membership-mutations.ts`:**

```ts
// SLICE 4C: canonical writers for circle_members. The slice-4 race sentinel
// guarded this file's existence; slice 4c repurposes the sentinel to LOCK IN
// the chosen race mitigation (FOR UPDATE transaction + ON CONFLICT idempotent
// insert). See spec §5.3 / §11.1 + plan A5/B10.
//
// The full FOR UPDATE transaction lives in src/lib/circles/actions.ts inside
// acceptInvitation / declineInvitation (it has to, to span the invitation
// status read + membership insert + status update in one tx). This module
// exports the standalone idempotent writers used by createCircle (post-insert
// owner-as-member step), removeOrgFromCircle, and leaveCircle, where the
// caller's authz check has already happened in the action layer.

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circleMembers } from "@/db/schema";

/** Idempotent membership insert. ON CONFLICT DO NOTHING against the slice-4
 *  circle_members_circle_org_uniq constraint. Safe under concurrent calls. */
export async function addOrgToCircle(
  db: Db,
  circleId: number,
  orgId: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO circle_members (circle_id, org_id)
    VALUES (${circleId}, ${orgId})
    ON CONFLICT (circle_id, org_id) DO NOTHING
  `);
}

/** Idempotent membership delete. DELETE WHERE is safe to repeat. */
export async function removeOrgFromCircle(
  db: Db,
  circleId: number,
  orgId: number,
): Promise<void> {
  await db
    .delete(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, orgId)));
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/membership-mutations.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Re-run the sentinel — one assertion turns GREEN.** Run: `npx vitest run test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`
Expected: the first assertion (`membership-mutations module exists`) now passes. The other two still fail (no actions.ts yet). This is the expected mid-B state.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/circles/membership-mutations.ts test/lib/circles/membership-mutations.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): membership-mutations.ts canonical writers (slice-4 sentinel target)

addOrgToCircle uses INSERT … ON CONFLICT (circle_id, org_id) DO NOTHING
against the slice-4 unique constraint — idempotent under concurrent
calls. removeOrgFromCircle is a plain DELETE WHERE (also idempotent).

The FOR UPDATE transaction that closes the membership-check / insert
race lives in src/lib/circles/actions.ts::acceptInvitation (B6); this
file is the standalone helper used by createCircle, removeOrgFromCircle
action, and leaveCircle action where the action layer's authz check
already happened.

The slice-4 SLICE_4C_RACE_SENTINEL.test.ts asserts the module exists
(now green); the transaction/ON-CONFLICT assertions still fail until B6
commits actions.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: `createCircle` action + tests

**Files:**
- Create: `src/lib/circles/actions.ts`
- Create: `test/lib/circles/createCircle.test.ts`

- [ ] **Step 1: Failing test:**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { createCircle, __setTestDb } from "@/lib/circles/actions";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

describe("createCircle", () => {
  it("creates a circle owned by the session's org and auto-joins as member", async () => {
    const res = await createCircle({ name: "Test Circle", slug: "test-circle" });
    expect(res).toEqual({ ok: true });
    const cs = await db.select().from(circles);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ name: "Test Circle", slug: "test-circle", ownerOrgId: 1 });
    const members = await db.select().from(circleMembers).where(eq(circleMembers.circleId, cs[0].id));
    expect(members).toHaveLength(1);
    expect(members[0].orgId).toBe(1);
  });

  it("rejects an invalid slug at Zod", async () => {
    const res = await createCircle({ name: "x", slug: "BAD SLUG" });
    expect(res.ok).toBe(false);
  });

  it("rejects a duplicate slug with Database error (slice-4 circles_slug_uniq)", async () => {
    await createCircle({ name: "First", slug: "shared" });
    const res = await createCircle({ name: "Second", slug: "shared" });
    expect(res).toEqual({ ok: false, error: "Database error" });
  });

  it("never trusts ownerOrgId from the wire", async () => {
    const res = await createCircle({ name: "x", slug: "x", ownerOrgId: 999 } as never);
    expect(res).toEqual({ ok: true });
    const [c] = await db.select().from(circles);
    expect(c.ownerOrgId).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/createCircle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/circles/actions.ts`** with the runWithUser wrapper and `createCircle`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { circles, circleMembers, circleInvitations, orgs } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  createCircleInput, inviteOrgToCircleInput, tokenInput,
  removeOrgFromCircleInput, leaveCircleInput,
  type CreateCircleInput, type InviteOrgToCircleInput, type TokenInput,
  type RemoveOrgFromCircleInput, type LeaveCircleInput,
} from "./validation";
import { firstZodError } from "@/lib/company/validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> { testDb = d; }
function db(): Db { return testDb ?? getDb(); }

async function runWithUser<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, user: string, orgId: number) => Promise<void>,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let user: string;
  let orgId: number;
  try {
    const session = await requireSession();
    user = session.user;
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, user, orgId);
    revalidatePath("/circles");
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "Forbidden" };
    console.error("[circles action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "circles-action" } });
    return { ok: false, error: "Database error" };
  }
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(createCircleInput, raw, async (input: CreateCircleInput, _user, orgId) => {
    await db().transaction(async (tx) => {
      const [c] = await tx
        .insert(circles)
        .values({ name: input.name, slug: input.slug, ownerOrgId: orgId })
        .returning({ id: circles.id });
      await tx
        .insert(circleMembers)
        .values({ circleId: c.id, orgId });
    });
  });
}

// inviteOrgToCircle, acceptInvitation, declineInvitation, removeOrgFromCircle,
// leaveCircle land in B5..B9.
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/createCircle.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/circles/actions.ts test/lib/circles/createCircle.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): createCircle action (transaction inserts circle + owner member)

createCircle wraps the slice-4 circles + circle_members insert in one
transaction so the owner-as-first-member invariant cannot diverge from
the circle's own creation. orgId is stamped from session.orgId; the
ownerOrgId field is NEVER accepted from the wire (Zod strips it).

The runWithUser wrapper is the slice-10/16 pattern verbatim: demo guard,
session re-assert, Zod validation, ForbiddenError → Forbidden uniform
rejection, console.error → Sentry on database errors, revalidatePath on
/circles, /, /deals.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: `inviteOrgToCircle` action + tests

**Files:**
- Modify: `src/lib/circles/actions.ts`
- Create: `test/lib/circles/inviteOrgToCircle.test.ts`

- [ ] **Step 1: Failing test:**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleInvitations } from "@/db/schema";
import { inviteOrgToCircle, __setTestDb } from "@/lib/circles/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

async function makeCircle(owner = 1, slug = "trusted"): Promise<number> {
  const [c] = await db.insert(circles)
    .values({ name: "Trusted", slug, ownerOrgId: owner })
    .returning({ id: circles.id });
  return c.id;
}

describe("inviteOrgToCircle", () => {
  it("owner: success → pending invite row with server-generated token + expiresAt", async () => {
    const c = await makeCircle(1);
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(res).toEqual({ ok: true });
    const [inv] = await db.select().from(circleInvitations);
    expect(inv).toBeDefined();
    expect(inv.circleId).toBe(c);
    expect(inv.fromOrgId).toBe(1);
    expect(inv.toOrgSlug).toBe("fixture");
    expect(inv.status).toBe("pending");
    expect(inv.token.length).toBeGreaterThanOrEqual(16);
    expect(inv.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(inv.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000);
  });

  it("non-owner: Forbidden (zero rows written)", async () => {
    // Circle owned by 999, session is 1.
    const c = await makeCircle(999);
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(circleInvitations)).toHaveLength(0);
  });

  it("nonexistent circle: Forbidden", async () => {
    const res = await inviteOrgToCircle({ circleId: 99999, toOrgSlug: "fixture" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("self-invite (slug resolves to caller's own org): no-op success", async () => {
    const c = await makeCircle(1);
    // session is org 1 (slug 'aiya' per shared-db seed)
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "aiya" });
    expect(res).toEqual({ ok: true });
    expect(await db.select().from(circleInvitations)).toHaveLength(0);
  });

  it("duplicate pending invite (same circle + slug): second insert Forbidden", async () => {
    const c = await makeCircle(1);
    const first = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(first).toEqual({ ok: true });
    const second = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(second).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(circleInvitations)).toHaveLength(1);
  });

  it("re-invite allowed after a non-pending response", async () => {
    const c = await makeCircle(1);
    await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    // Flip the first invite to declined (simulate the recipient declining).
    await db.update(circleInvitations).set({ status: "declined" }).where(eq(circleInvitations.toOrgSlug, "fixture"));
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(res).toEqual({ ok: true });
    expect(await db.select().from(circleInvitations)).toHaveLength(2);
  });

  it("wire-supplied fromOrgId is stripped (stamped from session)", async () => {
    const c = await makeCircle(1);
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture", fromOrgId: 999 } as never);
    expect(res).toEqual({ ok: true });
    const [inv] = await db.select().from(circleInvitations);
    expect(inv.fromOrgId).toBe(1);
  });

  it("token differs across two invites (uniqueness)", async () => {
    const c = await makeCircle(1);
    await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    await inviteOrgToCircle({ circleId: c, toOrgSlug: "partner" });
    const rows = await db.select({ token: circleInvitations.token }).from(circleInvitations);
    const tokens = new Set(rows.map((r) => r.token));
    expect(tokens.size).toBe(rows.length);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/inviteOrgToCircle.test.ts`
Expected: FAIL — `inviteOrgToCircle` not exported.

- [ ] **Step 3: Extend `src/lib/circles/actions.ts`.** Append (above the closing comment about B5..B9):

```ts
function isUniqueViolation(e: unknown): boolean {
  // PG SQLSTATE 23505 = unique_violation. Both pglite and Neon surface this
  // in the same `.code` field on the error object.
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

export async function inviteOrgToCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(inviteOrgToCircleInput, raw, async (input: InviteOrgToCircleInput, _user, orgId) => {
    const d = db();
    // Owner-only gate.
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId }).from(circles)
      .where(eq(circles.id, input.circleId)).limit(1);
    if (!c || c.ownerOrgId !== orgId) throw new ForbiddenError();
    // Self-invite: no-op if the target slug is the caller's own.
    const [me] = await d.select({ slug: orgs.slug }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
    if (me && me.slug === input.toOrgSlug) return;
    // Generate token + expiry server-side.
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    try {
      await d.insert(circleInvitations).values({
        circleId: input.circleId,
        fromOrgId: orgId,
        toOrgSlug: input.toOrgSlug,
        token,
        expiresAt,
      });
    } catch (e) {
      // Partial unique index throws on duplicate-pending. Translate to
      // Forbidden — we don't tell the inviter "an invite already exists".
      if (isUniqueViolation(e)) throw new ForbiddenError();
      throw e;
    }
  });
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/inviteOrgToCircle.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/circles/actions.ts test/lib/circles/inviteOrgToCircle.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): inviteOrgToCircle (owner-only, token + slug invite)

Owner-only gate: SELECT owner_org_id from circles WHERE id = $1; if
not present OR != session.orgId, ForbiddenError. Self-invite (slug
resolves to caller's own org) is a no-op success.

Token: crypto.randomUUID() (122 bits entropy, OS CSPRNG via Node 18+).
Expires_at: now() + 7 days, stamped server-side. Neither value is ever
accepted from the wire.

Duplicate pending invites for the same (circle_id, to_org_slug) are
rejected by the partial unique index from A1. The action translates
SQLSTATE 23505 to ForbiddenError. After a non-pending response (decline,
withdraw, expire), the index allows re-invite — the partial WHERE clause
excludes non-pending rows.

The fromOrgId is stamped from session.orgId; the Zod schema does not
accept it. Slice-3 invariant preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B6: `acceptInvitation` action + the concurrent-accept race test

**Files:**
- Modify: `src/lib/circles/actions.ts`
- Create: `test/lib/circles/acceptInvitation.test.ts`

- [ ] **Step 1: Failing test:**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "alice", orgId: 999 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers, circleInvitations } from "@/db/schema";
import { acceptInvitation, __setTestDb } from "@/lib/circles/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

// Helper: create an invite. AIYA (org 1, slug "aiya") owns the circle and
// invites the fixture org (999, slug "fixture").
async function makePendingInvite(): Promise<{ circleId: number; token: string }> {
  const [c] = await db.insert(circles)
    .values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 })
    .returning({ id: circles.id });
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  await db.insert(circleInvitations).values({
    circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
    token, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { circleId: c.id, token };
}

describe("acceptInvitation — happy path", () => {
  it("inserts membership + flips invite to accepted", async () => {
    const { circleId, token } = await makePendingInvite();
    const res = await acceptInvitation({ token });
    expect(res).toEqual({ ok: true });

    const members = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, 999)));
    expect(members).toHaveLength(1);

    const [inv] = await db.select().from(circleInvitations).where(eq(circleInvitations.token, token));
    expect(inv.status).toBe("accepted");
    expect(inv.respondedAt).not.toBeNull();
  });
});

describe("acceptInvitation — slug cross-check (THE security gate)", () => {
  it("rejects when session.orgId's slug does not match invite.to_org_slug", async () => {
    const [c] = await db.insert(circles)
      .values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 })
      .returning({ id: circles.id });
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    // Invite addressed to "partner" (org 888 in fixture), but session is org 999 (slug "fixture").
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "partner",
      token, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await acceptInvitation({ token });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    // No membership row.
    expect(await db.select().from(circleMembers)).toHaveLength(0);
    // Invite stays pending.
    const [inv] = await db.select().from(circleInvitations).where(eq(circleInvitations.token, token));
    expect(inv.status).toBe("pending");
  });
});

describe("acceptInvitation — expiry / already-responded / nonexistent", () => {
  it("rejects an expired invite (uniform Forbidden)", async () => {
    const [c] = await db.insert(circles)
      .values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 })
      .returning({ id: circles.id });
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
      token, expiresAt: new Date(Date.now() - 60 * 1000), // 1 min ago
    });
    const res = await acceptInvitation({ token });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(circleMembers)).toHaveLength(0);
  });

  it("rejects an already-accepted invite (second accept)", async () => {
    const { token } = await makePendingInvite();
    expect((await acceptInvitation({ token })).ok).toBe(true);
    const second = await acceptInvitation({ token });
    expect(second).toEqual({ ok: false, error: "Forbidden" });
  });

  it("rejects a nonexistent token (uniform Forbidden, no FK error)", async () => {
    const res = await acceptInvitation({ token: "00000000-0000-0000-0000-000000000000" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});

describe("acceptInvitation — concurrent-accept race resolution (load-bearing)", () => {
  it("two simultaneous accepts on the same token: exactly one succeeds, exactly one row", async () => {
    const { circleId, token } = await makePendingInvite();
    const [a, b] = await Promise.all([
      acceptInvitation({ token }),
      acceptInvitation({ token }),
    ]);
    // Exactly one ok=true.
    const successes = [a, b].filter((r) => r.ok === true);
    const failures = [a, b].filter((r) => r.ok === false);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ ok: false, error: "Forbidden" });
    // Exactly one membership row.
    const members = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, 999)));
    expect(members).toHaveLength(1);
  });
});

describe("acceptInvitation — demo guard", () => {
  it("short-circuits in demo mode without reading the DB", async () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const res = await acceptInvitation({ token: "demo-token" });
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    } finally {
      process.env.NEXT_PUBLIC_DEMO_MODE = prev;
    }
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/acceptInvitation.test.ts`
Expected: FAIL — `acceptInvitation` not exported.

- [ ] **Step 3: Extend `src/lib/circles/actions.ts`.** Append:

```ts
export async function acceptInvitation(raw: unknown): Promise<ActionResult> {
  return runWithUser(tokenInput, raw, async (input: TokenInput, _user, orgId) => {
    await db().transaction(async (tx) => {
      // 1) Lock the invitation row (FOR UPDATE closes the check-then-write race).
      const rows = await tx.execute(drizzleSql`
        SELECT id, circle_id, to_org_slug, status, expires_at
        FROM circle_invitations
        WHERE token = ${input.token}
        LIMIT 1
        FOR UPDATE
      `);
      // pglite normalizes .execute() to a { rows: [...] } shape; some drivers
      // return the array directly. Defensive cast handles both.
      const inv = ((rows as { rows?: Array<Record<string, unknown>> }).rows
        ?? (rows as unknown as Array<Record<string, unknown>>))[0];
      if (!inv) throw new ForbiddenError();
      if (inv.status !== "pending") throw new ForbiddenError();
      const expiresAt = inv.expires_at instanceof Date
        ? inv.expires_at
        : new Date(inv.expires_at as string);
      if (expiresAt <= new Date()) throw new ForbiddenError();
      // 2) Cross-org integrity: session's org slug must match invite.to_org_slug.
      const [me] = await tx.select({ slug: orgs.slug }).from(orgs)
        .where(eq(orgs.id, orgId)).limit(1);
      if (!me || me.slug !== inv.to_org_slug) throw new ForbiddenError();
      // 3) Idempotent membership insert (ON CONFLICT against slice-4 uniq).
      await tx.execute(drizzleSql`
        INSERT INTO circle_members (circle_id, org_id)
        VALUES (${inv.circle_id as number}, ${orgId})
        ON CONFLICT (circle_id, org_id) DO NOTHING
      `);
      // 4) Mark accepted.
      await tx
        .update(circleInvitations)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(eq(circleInvitations.id, inv.id as number));
    });
  });
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/acceptInvitation.test.ts`
Expected: PASS (all cases). If the concurrent-accept test fails with "two rows" or "both ok=true", the transaction or the FOR UPDATE is missing — re-read the CRITICAL block at the top of Phase B.

- [ ] **Step 5: Sentinel green check.** Run: `npx vitest run test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`
Expected: all 3 assertions PASS — the FOR UPDATE + .transaction( + ON CONFLICT (circle_id, org_id) DO NOTHING are all present in actions.ts.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/circles/actions.ts test/lib/circles/acceptInvitation.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): acceptInvitation closes the check-then-write race

The slice-4 sentinel demanded a conscious choice; slice 4c chooses
FOR UPDATE transaction + ON CONFLICT idempotent insert. acceptInvitation
wraps all of:
  1) SELECT … FOR UPDATE on the invitation row
  2) status/expiry check
  3) slug cross-check (session.orgId's slug must match invite.to_org_slug)
  4) INSERT … ON CONFLICT (circle_id, org_id) DO NOTHING into circle_members
  5) UPDATE … status='accepted', responded_at=now()
in a single PG transaction. A second concurrent call blocks on the
FOR UPDATE lock; when it proceeds, the status read returns 'accepted'
and ForbiddenError fires.

The concurrent-accept race test asserts: Promise.all of two accepts on
the same token yields exactly one {ok:true} + one Forbidden + exactly
one circle_members row. Slice-4 sentinel is now GREEN — the chosen
mitigation is locked in.

Slug cross-check at step 3 stops the "token theft from Slack paste"
attack: token alone is not sufficient; the session's org slug must
match invite.to_org_slug, which is server-resolved on both sides.

Uniform Forbidden rejection — no leakage of "expired" vs "no such
token" vs "already accepted" vs "wrong slug".

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B7: `declineInvitation` action + tests

**Files:**
- Modify: `src/lib/circles/actions.ts`
- Create: `test/lib/circles/declineInvitation.test.ts`

- [ ] **Step 1: Failing test:**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "alice", orgId: 999 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers, circleInvitations } from "@/db/schema";
import { declineInvitation, __setTestDb } from "@/lib/circles/actions";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

describe("declineInvitation", () => {
  it("happy path: status → declined, no membership row written", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
      token: "tok-1", expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await declineInvitation({ token: "tok-1" });
    expect(res).toEqual({ ok: true });
    const [inv] = await db.select().from(circleInvitations);
    expect(inv.status).toBe("declined");
    expect(inv.respondedAt).not.toBeNull();
    expect(await db.select().from(circleMembers)).toHaveLength(0);
  });

  it("wrong-slug session: Forbidden, status stays pending", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "partner",
      token: "tok-2", expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await declineInvitation({ token: "tok-2" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [inv] = await db.select().from(circleInvitations).where(eq(circleInvitations.token, "tok-2"));
    expect(inv.status).toBe("pending");
  });

  it("already declined: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
      token: "tok-3", expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect((await declineInvitation({ token: "tok-3" })).ok).toBe(true);
    expect(await declineInvitation({ token: "tok-3" })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("expired: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
      token: "tok-exp", expiresAt: new Date(Date.now() - 1000),
    });
    expect(await declineInvitation({ token: "tok-exp" })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("nonexistent token: Forbidden", async () => {
    expect(await declineInvitation({ token: "no-such-token-xyz" })).toEqual({ ok: false, error: "Forbidden" });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/declineInvitation.test.ts`
Expected: FAIL — `declineInvitation` not exported.

- [ ] **Step 3: Extend `src/lib/circles/actions.ts`.** Append:

```ts
export async function declineInvitation(raw: unknown): Promise<ActionResult> {
  return runWithUser(tokenInput, raw, async (input: TokenInput, _user, orgId) => {
    await db().transaction(async (tx) => {
      const rows = await tx.execute(drizzleSql`
        SELECT id, to_org_slug, status, expires_at
        FROM circle_invitations
        WHERE token = ${input.token}
        LIMIT 1
        FOR UPDATE
      `);
      const inv = ((rows as { rows?: Array<Record<string, unknown>> }).rows
        ?? (rows as unknown as Array<Record<string, unknown>>))[0];
      if (!inv) throw new ForbiddenError();
      if (inv.status !== "pending") throw new ForbiddenError();
      const expiresAt = inv.expires_at instanceof Date
        ? inv.expires_at
        : new Date(inv.expires_at as string);
      if (expiresAt <= new Date()) throw new ForbiddenError();
      const [me] = await tx.select({ slug: orgs.slug }).from(orgs)
        .where(eq(orgs.id, orgId)).limit(1);
      if (!me || me.slug !== inv.to_org_slug) throw new ForbiddenError();
      await tx
        .update(circleInvitations)
        .set({ status: "declined", respondedAt: new Date() })
        .where(eq(circleInvitations.id, inv.id as number));
    });
  });
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/declineInvitation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/circles/actions.ts test/lib/circles/declineInvitation.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): declineInvitation (FOR UPDATE transaction, slug cross-check)

Same shape as acceptInvitation minus the membership insert: the recipient
flips status to 'declined' inside the FOR UPDATE transaction. The slug
cross-check still runs — only the addressed org can decline, and the
post-decline partial-unique-index slot is freed so the owner can re-invite
the same slug. Uniform Forbidden rejection.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B8: `removeOrgFromCircle` action + tests

**Files:**
- Modify: `src/lib/circles/actions.ts`
- Create: `test/lib/circles/removeOrgFromCircle.test.ts`

- [ ] **Step 1: Failing test:**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { removeOrgFromCircle, __setTestDb } from "@/lib/circles/actions";
import { eq, and } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

describe("removeOrgFromCircle action", () => {
  it("owner removes a member: row gone", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleMembers).values([{ circleId: c.id, orgId: 1 }, { circleId: c.id, orgId: 888 }]);
    const res = await removeOrgFromCircle({ circleId: c.id, orgId: 888 });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(circleMembers).where(eq(circleMembers.circleId, c.id));
    expect(rows.map((r) => r.orgId).sort()).toEqual([1]);
  });

  it("non-owner attempts: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 999 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 888 });
    const res = await removeOrgFromCircle({ circleId: c.id, orgId: 888 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    // Row still present.
    const rows = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, c.id), eq(circleMembers.orgId, 888)));
    expect(rows).toHaveLength(1);
  });

  it("cannot remove the owner: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    const res = await removeOrgFromCircle({ circleId: c.id, orgId: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("nonexistent circle: Forbidden", async () => {
    const res = await removeOrgFromCircle({ circleId: 99999, orgId: 888 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("idempotent: removing a non-member is ok=true with zero deleted rows", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    const res = await removeOrgFromCircle({ circleId: c.id, orgId: 888 });
    expect(res).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/removeOrgFromCircle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend `src/lib/circles/actions.ts`.** Append:

```ts
export async function removeOrgFromCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(removeOrgFromCircleInput, raw, async (input: RemoveOrgFromCircleInput, _user, orgId) => {
    const d = db();
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId }).from(circles)
      .where(eq(circles.id, input.circleId)).limit(1);
    if (!c || c.ownerOrgId !== orgId) throw new ForbiddenError();
    if (input.orgId === c.ownerOrgId) throw new ForbiddenError(); // cannot remove the owner
    await d
      .delete(circleMembers)
      .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.orgId, input.orgId)));
  });
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/removeOrgFromCircle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/circles/actions.ts test/lib/circles/removeOrgFromCircle.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): removeOrgFromCircle (owner-only, cannot remove owner)

Owner-only gate; ForbiddenError if circle missing or session.orgId is
not the owner. Cannot remove the owner themselves (transfer-ownership
is a future slice). Idempotent: removing a non-member returns ok=true
with zero deleted rows. The DELETE statement is a single non-tx call —
no race concern because DELETE WHERE is its own atomic op.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B9: `leaveCircle` action + tests

**Files:**
- Modify: `src/lib/circles/actions.ts`
- Create: `test/lib/circles/leaveCircle.test.ts`

- [ ] **Step 1: Failing test:**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { leaveCircle, __setTestDb } from "@/lib/circles/actions";
import { eq, and } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

describe("leaveCircle", () => {
  it("member leaves: row gone", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 999 }).returning({ id: circles.id });
    await db.insert(circleMembers).values([{ circleId: c.id, orgId: 999 }, { circleId: c.id, orgId: 1 }]);
    const res = await leaveCircle({ circleId: c.id });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, c.id), eq(circleMembers.orgId, 1)));
    expect(rows).toHaveLength(0);
  });

  it("owner cannot leave their own circle: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    const res = await leaveCircle({ circleId: c.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const rows = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, c.id), eq(circleMembers.orgId, 1)));
    expect(rows).toHaveLength(1);
  });

  it("nonexistent circle: Forbidden", async () => {
    expect(await leaveCircle({ circleId: 99999 })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("idempotent: leaving a circle the caller is not in returns ok=true", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 999 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 999 });
    const res = await leaveCircle({ circleId: c.id });
    expect(res).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/circles/leaveCircle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend `src/lib/circles/actions.ts`.** Append:

```ts
export async function leaveCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(leaveCircleInput, raw, async (input: LeaveCircleInput, _user, orgId) => {
    const d = db();
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId }).from(circles)
      .where(eq(circles.id, input.circleId)).limit(1);
    if (!c) throw new ForbiddenError();
    if (c.ownerOrgId === orgId) throw new ForbiddenError(); // owner cannot leave
    await d
      .delete(circleMembers)
      .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.orgId, orgId)));
  });
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/circles/leaveCircle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/circles/actions.ts test/lib/circles/leaveCircle.test.ts
git commit -m "$(cat <<'EOF'
feat(circles): leaveCircle (self-removal, owner cannot leave)

Session.orgId is the only "target" — the caller can only leave their own
membership. ForbiddenError if circle is missing or caller is the owner
(transfer-ownership is a future slice). Idempotent: leaving a circle the
caller is not in returns ok=true.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B10: Token-security cross-cut test

**Files:**
- Create: `test/lib/circles/token-security.test.ts`

- [ ] **Step 1: Create the test.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleInvitations } from "@/db/schema";
import { inviteOrgToCircle, acceptInvitation, __setTestDb } from "@/lib/circles/actions";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("token security", () => {
  it("inviteOrgToCircle generates a v4-shaped UUID token", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await inviteOrgToCircle({ circleId: c.id, toOrgSlug: "fixture" });
    const [inv] = await db.select().from(circleInvitations);
    expect(inv.token).toMatch(UUID_RE);
  });

  it("two consecutive invites produce different tokens", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await inviteOrgToCircle({ circleId: c.id, toOrgSlug: "a" });
    await inviteOrgToCircle({ circleId: c.id, toOrgSlug: "b" });
    const rows = await db.select({ token: circleInvitations.token }).from(circleInvitations);
    expect(new Set(rows.map((r) => r.token)).size).toBe(rows.length);
  });

  it("Forbidden rejection does NOT log the token to console.warn / console.error", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await inviteOrgToCircle({ circleId: c.id, toOrgSlug: "partner" });
    const [inv] = await db.select().from(circleInvitations);
    const secretToken = inv.token;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Wrong-slug session (default mock: org 1, slug "aiya") accepting a
      // token addressed to "partner" — must produce Forbidden + no token in logs.
      await acceptInvitation({ token: secretToken });
      const allWarns = warnSpy.mock.calls.flat().map((x) => String(x)).join("\n");
      const allErrors = errSpy.mock.calls.flat().map((x) => String(x)).join("\n");
      expect(allWarns).not.toContain(secretToken);
      expect(allErrors).not.toContain(secretToken);
    } finally {
      warnSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/lib/circles/token-security.test.ts`
Expected: PASS. If a token leak appears, fix the offending `console.*` line in `actions.ts` and re-run.

- [ ] **Step 3: Commit.**
```bash
git add test/lib/circles/token-security.test.ts
git commit -m "$(cat <<'EOF'
test(circles): token security cross-cut

- inviteOrgToCircle emits a v4-shaped UUID token from crypto.randomUUID().
- Two consecutive invites produce different tokens (uniqueness).
- A Forbidden rejection (wrong-slug accept) never includes the token
  string in console.warn or console.error output.

The no-leak assertion is the load-bearing operational-security guard:
a leaked token in app logs would defeat the entire bearer-secret design.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B11: Phase B green-bar verification (sentinel locked in)

**Files:** none (verification only)

- [ ] **Step 1: Run all Phase B test files.** Run:
```
npx vitest run test/lib/auth test/lib/circles
```
Expected: green across every file, including the repurposed sentinel.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Enforcement greps.** Run:
```
grep -rn "insert(circleMembers)\|INSERT INTO circle_members" src/
```
Expected: matches only in `src/lib/circles/actions.ts` (createCircle's `circleMembers` insert and acceptInvitation's `tx.execute(... INSERT INTO circle_members ...)`) and `src/lib/circles/membership-mutations.ts` (`addOrgToCircle`). No other writer.

```
grep -rn "fromOrgId\|from_org_id" src/lib/circles/validation.ts
```
Expected: ZERO matches.

```
grep -rn "FOR UPDATE" src/lib/circles/actions.ts
```
Expected: 2 matches (acceptInvitation + declineInvitation).

```
grep -rn "ON CONFLICT" src/lib/circles/
```
Expected: matches in `actions.ts` (acceptInvitation) and `membership-mutations.ts` (addOrgToCircle).

(No commit; verification only.)

---

## Phase C — UI (/circles route + components + nav)

Phase C wires the `/circles` admin page and the five client components. No new server logic — every form submits to the actions from Phase B.

### Task C1: `/circles` route shell

**Files:**
- Create: `src/app/(admin)/circles/page.tsx`
- Modify: `src/middleware.ts`
- Modify: `src/components/dashboard/Nav.tsx`

- [ ] **Step 1: Add `/circles` to middleware matcher.** Open `src/middleware.ts`. Replace the `matcher` array with:

```ts
matcher: [
  "/", "/api/quotes", "/api/convert", "/api/history", "/api/diamond-history",
  "/inventory", "/diamonds", "/deals", "/website", "/circles", "/company/:path*",
],
```

- [ ] **Step 2: Add Circles entry to Nav.** Open `src/components/dashboard/Nav.tsx`. Add `"Circles"` to `SECTIONS` between `"TradeNet Exchange"` and `"Market Intelligence"`. Add to `ROUTES`:

```ts
const ROUTES: Record<string, string> = {
  Inventory: "/inventory",
  Diamonds: "/diamonds",
  Website: "/website",
  Circles: "/circles",
  "Orders & Deals": "/deals",
};
```

And update `SECTIONS`:

```ts
const SECTIONS = [
  "Dashboard", "Command Center", "TradeNet Exchange", "Circles", "Market Intelligence",
  "Inventory", "Diamonds", "Website", "Gold & Metals", "Orders & Deals",
  "Clients & CRM", "Finances", "Payments", "POS System", "Crypto Wallet",
  "Converter Hub", "Reports & Analytics", "Marketing Suite", "Social & Inbox",
  "Calendar & Tasks", "Documents", "Settings",
];
```

- [ ] **Step 3: Create the page shell** `src/app/(admin)/circles/page.tsx`:

```tsx
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { orgs } from "@/db/schema";
import {
  getCirclesForOrg,
  getOwnedCirclesForOrg,
  getPendingInvitesForSlug,
  getPendingInvitesIssuedByOrg,
  listCircleMemberOrgs,
} from "@/lib/circles/queries";
import { DemoNotice } from "@/components/deals/DemoNotice";
import { PendingInvitesInbox } from "@/components/circles/PendingInvitesInbox";
import { OwnedCirclesSection } from "@/components/circles/OwnedCirclesSection";
import { MemberCirclesSection } from "@/components/circles/MemberCirclesSection";
import { CreateCircleForm } from "@/components/circles/CreateCircleForm";
import {
  acceptInvitation, declineInvitation,
  createCircle, inviteOrgToCircle,
  removeOrgFromCircle, leaveCircle,
} from "@/lib/circles/actions";

export const dynamic = "force-dynamic";

export default async function CirclesPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [me] = await db.select({ slug: orgs.slug, name: orgs.name }).from(orgs)
    .where(eq(orgs.id, orgId)).limit(1);

  const [memberOf, owned, pendingInbox, pendingOutbox] = await Promise.all([
    getCirclesForOrg(db, orgId),
    getOwnedCirclesForOrg(db, orgId),
    getPendingInvitesForSlug(db, me?.slug ?? ""),
    getPendingInvitesIssuedByOrg(db, orgId),
  ]);

  const memberRows = await Promise.all(
    memberOf.map(async (c) => ({
      circle: c,
      isOwner: c.ownerOrgId === orgId,
      members: await listCircleMemberOrgs(db, c.id, orgId),
    })),
  );

  const empty = memberOf.length === 0 && owned.length === 0 && pendingInbox.length === 0;

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Circles</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>

      <DemoNotice />

      {pendingInbox.length > 0 && (
        <PendingInvitesInbox
          invitations={pendingInbox}
          acceptAction={acceptInvitation}
          declineAction={declineInvitation}
        />
      )}

      <OwnedCirclesSection
        owned={owned}
        pendingOutbox={pendingOutbox}
        memberRows={memberRows.filter((r) => r.isOwner)}
        inviteAction={inviteOrgToCircle}
        removeAction={removeOrgFromCircle}
      />

      <MemberCirclesSection
        rows={memberRows.filter((r) => !r.isOwner)}
        leaveAction={leaveCircle}
      />

      <CreateCircleForm createAction={createCircle} />

      {empty && (
        <p data-testid="circles-empty-helper" className="mt-6 text-sm text-text/40">
          You're not in any circles yet. When another org invites you, the invite will appear here.
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Typecheck.** Run: `npx tsc --noEmit`
Expected: FAIL — the four `@/components/circles/*` imports don't exist yet. C2-C5 create them.

(No commit yet — combine with C2-C5.)

---

### Task C2: `CreateCircleForm` + `InviteOrgForm` shared client components

**Files:**
- Create: `src/components/circles/CreateCircleForm.tsx`
- Create: `src/components/circles/InviteOrgForm.tsx`

- [ ] **Step 1: Create `src/components/circles/CreateCircleForm.tsx`:**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";

export function CreateCircleForm({
  createAction,
}: {
  createAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  function normalizeSlug(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await createAction({ name: name.trim(), slug: normalizeSlug(slug) });
      if (res.ok) {
        setOk(true);
        setName("");
        setSlug("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-text/40">Create a circle</h2>
      <form onSubmit={submit} className="surface-card grid grid-cols-2 gap-2 rounded-xl p-4 text-sm">
        <label className="flex flex-col">
          Name
          <input aria-label="circle-name" className="bg-bg p-2" maxLength={120}
            value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Slug
          <input aria-label="circle-slug" className="bg-bg p-2" maxLength={64}
            value={slug} onChange={(e) => setSlug(e.target.value)}
            onBlur={(e) => setSlug(normalizeSlug(e.target.value))} />
        </label>
        <div className="col-span-2 flex items-center justify-between">
          <button type="submit" disabled={pending}
            className="rounded bg-gold p-2 text-black disabled:opacity-50">
            Create circle
          </button>
          {error && <span className="text-sm text-bad">{error}</span>}
          {ok && <span className="text-sm text-ok">Created.</span>}
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Create `src/components/circles/InviteOrgForm.tsx`:**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";

export function InviteOrgForm({
  circleId,
  inviteAction,
}: {
  circleId: number;
  inviteAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    setOk(false);
    const norm = slug.toLowerCase().trim();
    startTransition(async () => {
      const res = await inviteAction({ circleId, toOrgSlug: norm });
      if (res.ok) {
        setOk(true);
        setSlug("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-2 flex items-center gap-2 text-sm">
      <input
        aria-label={`invite-slug-${circleId}`}
        className="flex-1 bg-bg p-2"
        placeholder="org-slug"
        maxLength={64}
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
      />
      <button type="submit" disabled={pending || slug.length === 0}
        className="rounded bg-gold/80 px-3 py-2 text-black disabled:opacity-50">
        Invite
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
      {ok && <span className="text-xs text-ok">Invited.</span>}
    </form>
  );
}
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit`
Expected: 2 remaining errors (PendingInvitesInbox + OwnedCirclesSection + MemberCirclesSection imports). C3 + C4 close them.

(No commit — bundle with C3-C5.)

---

### Task C3: `PendingInvitesInbox` component

**Files:**
- Create: `src/components/circles/PendingInvitesInbox.tsx`

- [ ] **Step 1: Create the component:**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";
import type { InvitationRow } from "@/lib/circles/queries";

function timeAgoShort(d: Date): string {
  const ms = Date.now() - d.getTime();
  const h = Math.round(ms / (60 * 60 * 1000));
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function PendingInvitesInbox({
  invitations,
  acceptAction,
  declineAction,
}: {
  invitations: InvitationRow[];
  acceptAction: (raw: unknown) => Promise<ActionResult>;
  declineAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<Record<number, string>>({});
  const [pending, startTransition] = useTransition();

  function respond(token: string, id: number, action: (raw: unknown) => Promise<ActionResult>): void {
    setError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const res = await action({ token });
      if (res.ok) {
        router.refresh();
      } else {
        setError((prev) => ({ ...prev, [id]: res.error }));
      }
    });
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-gold/80">Pending invitations</h2>
      <ul className="surface-card divide-y divide-text/10 rounded-xl text-sm">
        {invitations.map((inv) => (
          <li key={inv.id} className="flex items-center gap-3 p-3" data-testid={`invite-row-${inv.id}`}>
            <div className="flex-1">
              <div className="text-text/90">{inv.circleName}</div>
              <div className="text-[11px] text-text/40">
                from {inv.fromOrgName} · {timeAgoShort(inv.createdAt)}
              </div>
              {error[inv.id] && <div className="mt-1 text-xs text-bad">{error[inv.id]}</div>}
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => respond(inv.token, inv.id, acceptAction)}
              className="rounded bg-gold px-3 py-1.5 text-black disabled:opacity-50"
              data-testid={`accept-${inv.id}`}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => respond(inv.token, inv.id, declineAction)}
              className="rounded border border-text/20 px-3 py-1.5 text-text/70 hover:text-text disabled:opacity-50"
              data-testid={`decline-${inv.id}`}
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

(No commit — bundle with C4-C5.)

---

### Task C4: `OwnedCirclesSection` + `MemberCirclesSection`

**Files:**
- Create: `src/components/circles/OwnedCirclesSection.tsx`
- Create: `src/components/circles/MemberCirclesSection.tsx`

- [ ] **Step 1: Create `src/components/circles/OwnedCirclesSection.tsx`:**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";
import type { CircleRow, InvitationRow } from "@/lib/circles/queries";
import { InviteOrgForm } from "./InviteOrgForm";

interface MemberRow {
  circle: CircleRow;
  isOwner: boolean;
  members: { orgId: number; name: string; slug: string; createdAt: Date }[];
}

export function OwnedCirclesSection({
  owned,
  pendingOutbox,
  memberRows,
  inviteAction,
  removeAction,
}: {
  owned: CircleRow[];
  pendingOutbox: InvitationRow[];
  memberRows: MemberRow[];
  inviteAction: (raw: unknown) => Promise<ActionResult>;
  removeAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (owned.length === 0) return null;

  const outboxByCircle = new Map<number, InvitationRow[]>();
  for (const inv of pendingOutbox) {
    const arr = outboxByCircle.get(inv.circleId) ?? [];
    arr.push(inv);
    outboxByCircle.set(inv.circleId, arr);
  }

  function remove(circleId: number, orgId: number): void {
    setError(null);
    startTransition(async () => {
      const res = await removeAction({ circleId, orgId });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-text/40">Circles you own</h2>
      <div className="space-y-3">
        {owned.map((c) => {
          const row = memberRows.find((m) => m.circle.id === c.id);
          const outbox = outboxByCircle.get(c.id) ?? [];
          return (
            <div key={c.id} className="surface-card rounded-xl p-4 text-sm" data-testid={`owned-circle-${c.id}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <div className="text-text/90">{c.name}</div>
                <div className="text-[10px] uppercase tracking-widest text-text/40">{c.slug}</div>
              </div>
              <div className="mb-2">
                <div className="text-[10px] uppercase tracking-widest text-text/40">Members</div>
                <ul className="mt-1 space-y-1">
                  {(row?.members ?? []).map((m) => (
                    <li key={m.orgId} className="flex items-center gap-2 text-[12px]">
                      <span className="flex-1 text-text/80">{m.name}</span>
                      <span className="text-[10px] text-text/40">{m.slug}</span>
                      {m.orgId !== c.ownerOrgId && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => remove(c.id, m.orgId)}
                          className="text-[11px] text-bad/80 hover:text-bad disabled:opacity-50"
                          data-testid={`remove-${c.id}-${m.orgId}`}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              {outbox.length > 0 && (
                <div className="mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-text/40">Pending invites (outbox)</div>
                  <ul className="mt-1 space-y-1 text-[12px]">
                    {outbox.map((inv) => (
                      <li key={inv.id} className="flex items-center gap-2">
                        <span className="flex-1 text-text/70">{inv.toOrgSlug}</span>
                        <span className="text-[10px] text-text/40">pending</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <InviteOrgForm circleId={c.id} inviteAction={inviteAction} />
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Create `src/components/circles/MemberCirclesSection.tsx`:**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";
import type { CircleRow } from "@/lib/circles/queries";

interface MemberRow {
  circle: CircleRow;
  isOwner: boolean;
  members: { orgId: number; name: string; slug: string; createdAt: Date }[];
}

export function MemberCirclesSection({
  rows,
  leaveAction,
}: {
  rows: MemberRow[];
  leaveAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) return null;

  function leave(circleId: number): void {
    setError(null);
    startTransition(async () => {
      const res = await leaveAction({ circleId });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-text/40">Circles you belong to</h2>
      <div className="space-y-3">
        {rows.map(({ circle, members }) => (
          <div key={circle.id} className="surface-card rounded-xl p-4 text-sm" data-testid={`member-circle-${circle.id}`}>
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-text/90">{circle.name}</div>
              <button
                type="button"
                disabled={pending}
                onClick={() => leave(circle.id)}
                className="text-[11px] text-bad/80 hover:text-bad disabled:opacity-50"
                data-testid={`leave-${circle.id}`}
              >
                Leave
              </button>
            </div>
            <ul className="space-y-1 text-[12px]">
              {members.map((m) => (
                <li key={m.orgId} className="flex items-center gap-2">
                  <span className="flex-1 text-text/80">{m.name}</span>
                  <span className="text-[10px] text-text/40">{m.slug}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean — all 4 component imports resolve, page.tsx wires them.

- [ ] **Step 4: Build smoke.** Run: `rm -rf .next && npm run build`
Expected: build succeeds. The `/circles` page renders into the route manifest.

- [ ] **Step 5: Commit C1+C2+C3+C4 together.**
```bash
git add src/app/\(admin\)/circles/page.tsx \
  src/components/circles \
  src/middleware.ts \
  src/components/dashboard/Nav.tsx
git commit -m "$(cat <<'EOF'
feat(circles): /circles admin route + 5 client components + Nav entry

/circles is a single RSC that parallel-fetches:
  - getCirclesForOrg (memberOf)
  - getOwnedCirclesForOrg (owned)
  - getPendingInvitesForSlug (recipient inbox)
  - getPendingInvitesIssuedByOrg (owner outbox)
  - listCircleMemberOrgs per circle (member list with defense-in-depth
    re-check)

Five client components:
  - PendingInvitesInbox: Accept/Decline buttons per pending invite.
  - OwnedCirclesSection: owner's circles with member list, remove
    buttons (cannot remove owner), pending-outbox display, embedded
    InviteOrgForm.
  - MemberCirclesSection: circles the viewer belongs to but does not
    own, with a Leave button per row.
  - CreateCircleForm: name + slug inputs with live slug normalization.
  - InviteOrgForm: per-circle slug invite form.

Middleware matcher gains "/circles"; Nav gains a Circles entry between
TradeNet Exchange and Market Intelligence.

Empty-state helper renders only when ALL of memberOf + owned + inbox
are empty.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C5: RSC integration test for `/circles`

**Files:**
- Create: `test/app/circles-page.test.tsx`

- [ ] **Step 1: Create the test.**

```tsx
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
  DEMO_ORG_ID: 1,
}));
vi.mock("@/db/client", async () => {
  const real = await vi.importActual<typeof import("@/db/client")>("@/db/client");
  return {
    ...real,
    ensureDbReady: vi.fn(async () => (globalThis as { __testDb?: unknown }).__testDb),
  };
});

import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { circles, circleMembers, circleInvitations } from "@/db/schema";
import type { Db } from "@/db/client";
import CirclesPage from "@/app/(admin)/circles/page";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  (globalThis as { __testDb?: unknown }).__testDb = db;
});
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

describe("CirclesPage RSC", () => {
  it("AIYA owner perspective: renders owned circle + outbox invite + create form", async () => {
    const [c] = await db.insert(circles)
      .values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 })
      .returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "argyle-mining",
      token: "tok-x", expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const html = renderToString(await CirclesPage());
    expect(html).toContain("Trusted");
    expect(html).toContain("argyle-mining"); // outbox row
    expect(html).toContain("Create a circle"); // create form heading
    expect(html).toContain("Invite"); // invite button per circle
    expect(html).not.toContain("circles-empty-helper"); // page is non-empty
  });

  it("no-circles org perspective: renders the empty-state helper", async () => {
    const { getCurrentOrgId } = await import("@/lib/auth/getCurrentOrgId");
    (getCurrentOrgId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(888);

    const html = renderToString(await CirclesPage());
    expect(html).toContain("You're not in any circles yet");
  });
});
```

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/app/circles-page.test.tsx`
Expected: PASS. RSC integration is shape-only (no client-side rendering) but exercises the data path.

- [ ] **Step 3: Commit.**
```bash
git add test/app/circles-page.test.tsx
git commit -m "$(cat <<'EOF'
test(circles): RSC integration test for /circles

Mocks getCurrentOrgId + ensureDbReady; renders the page server-side and
asserts:
- AIYA-perspective: owned circle name, outbox slug, create form heading,
  invite buttons all present; empty-state helper hidden.
- Empty-org perspective: empty-state helper rendered.

The test exercises the data fetch path; client-side interactivity is
covered by the per-component unit tests at C2/C3/C4 (deferred to a
future polish slice — slice 4c ships without component unit tests for
the new components to keep scope tight; the action layer's truth tables
+ this RSC integration cover the critical assertions).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Verify + ship

### Task D1: Enforcement greps + full suite + tsc + build + dev smoke

**Files:** none (verification only)

- [ ] **Step 1: Sentinel green.** Run: `npx vitest run test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`
Expected: 3 assertions green.

- [ ] **Step 2: Enforcement greps.** Run each, expect described matches:
```
grep -rn "insert(circleMembers)\|INSERT INTO circle_members" src/
```
Expected: matches only in `src/lib/circles/actions.ts` and `src/lib/circles/membership-mutations.ts`.

```
grep -rn "fromOrgId\|from_org_id" src/lib/circles/validation.ts
```
Expected: ZERO matches.

```
grep -rn "FOR UPDATE" src/lib/circles/
```
Expected: 2 matches in `actions.ts`.

```
grep -rn "ON CONFLICT" src/lib/circles/
```
Expected: matches in `actions.ts` (acceptInvitation transaction body) AND `membership-mutations.ts` (addOrgToCircle).

```
grep -rn "owner_org_id\|ownerOrgId" src/lib/circles/
```
Expected: matches in `queries.ts` (`CircleRow.ownerOrgId` projection + `getOwnedCirclesForOrg` WHERE clause) AND `actions.ts` (inviteOrgToCircle + removeOrgFromCircle owner-only checks + leaveCircle owner-cannot-leave check). This is the first slice where `ownerOrgId` is load-bearing for authz.

```
grep -rn "console\." src/lib/circles/
```
Expected: matches only `console.error(... database error ...)` lines. No `console.warn` / `console.error` includes `token` or `${input.token}` or `${inv.token}`.

```
grep -rn "AIYA_ORG_ID" src/
```
Expected: one match — the local `const AIYA_ORG_ID = 1` inside `src/app/api/login/route.ts`. (Slice 3 invariant preserved.)

- [ ] **Step 3: Full suite.** Run: `npm test -- --run`
Expected: full green.

- [ ] **Step 4: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Build.** Run: `rm -rf .next && npm run build`
Expected: success.

- [ ] **Step 6: Dev smoke (auth path).** Run: `npm run dev`. Log in. Then:
  - `/circles` loads. Empty state visible (prod DB has no real circles for AIYA).
  - From the Create form, create a circle name="Test Circle", slug="test-circle". The page refreshes; the owned-circles section now shows "Test Circle" with AIYA as the sole member.
  - In the per-circle invite form, type a fake slug "test-partner-orgX". Click Invite. The form clears; reloading shows the pending outbox row with `test-partner-orgX`.
  - Open psql:
    ```sql
    SELECT id, name, slug, owner_org_id FROM circles WHERE slug = 'test-circle';
    SELECT * FROM circle_members WHERE circle_id = (SELECT id FROM circles WHERE slug = 'test-circle');
    SELECT id, circle_id, from_org_id, to_org_slug, status,
           length(token) AS tok_len, expires_at FROM circle_invitations
    WHERE to_org_slug = 'test-partner-orgx';
    ```
  - Expected: one circle row owned by org 1; one member row (AIYA); one pending invite with a UUID-shaped token (length 36), expires_at ≈ 7 days from now.
  - Try to invite the same slug again — expect "Forbidden" inline error.
  - Try to leave the circle from the UI — there's no Leave button (AIYA is the owner). Confirmed by inspection.

- [ ] **Step 7: Dev smoke (demo path).** Run: `NEXT_PUBLIC_DEMO_MODE=true npm run dev`. No login required. Then:
  - `/circles` loads. AIYA's owned-circles section shows "AIYA Trusted Partners" with all 3 partner orgs as members.
  - Outbox shows the pending invite to `argyle-mining`.
  - Inbox section is hidden (AIYA has no pending received invites in the seed).
  - Click Create circle / Invite / Remove on any control — toast shows "Demo mode — changes are disabled".

- [ ] **Step 8: Dev smoke (accept flow, two terminals).** Run prod-mode `npm run dev` in terminal 1; in terminal 2, log in as a different org (use the fixture 999 if available; otherwise create one via SQL).
  - From terminal 1's session as AIYA: invite the fixture's slug.
  - From terminal 2's session as the fixture: navigate to `/circles`. The pending-inbox section shows the invite from AIYA.
  - Click Accept. The page refreshes; the inbox section disappears (the invite is no longer pending), and the member-circles section now shows the circle.
  - In psql: verify `circle_invitations.status = 'accepted'` and a new `circle_members` row exists.

(No commit; verification only.)

---

### Task D2: Whole-slice code review + merge + cleanup

**Files:** none (process)

- [ ] **Step 1: Whole-slice code review.** Spawn a code-review subagent with this prompt (paste verbatim):

> Review every change on branch `feature/aiya-circle-onboarding-4c` against `main` for the AIYA Circle Onboarding slice (slice 4c). Spec: `docs/superpowers/specs/2026-06-05-aiya-circle-onboarding-slice-4c-design.md`. Plan: `docs/superpowers/plans/2026-06-05-aiya-circle-onboarding-slice-4c.md`. Verify each: (a) `grep -rn "insert(circleMembers)\|INSERT INTO circle_members" src/` returns matches only in `src/lib/circles/actions.ts` and `src/lib/circles/membership-mutations.ts` (no other writer); (b) `grep -rn "fromOrgId\|from_org_id" src/lib/circles/validation.ts` returns ZERO matches; (c) `grep -rn "FOR UPDATE" src/lib/circles/` returns exactly 2 matches in `actions.ts` (acceptInvitation + declineInvitation); (d) `grep -rn "ON CONFLICT" src/lib/circles/` returns matches in `actions.ts` AND `membership-mutations.ts`; (e) the `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts` assertions are FLIPPED (assertion 1 = module exists, assertion 2 = FOR UPDATE + .transaction(, assertion 3 = ON CONFLICT (circle_id, org_id) DO NOTHING) — not deleted; (f) `acceptInvitation` and `declineInvitation` perform the slug cross-check (`me.slug !== inv.to_org_slug`) BEFORE any state-changing write; (g) `acceptInvitation`'s concurrent-accept test (`Promise.all` of two accepts on the same token) asserts exactly one `{ ok: true }` and exactly one `circle_members` row; (h) `inviteOrgToCircle` translates SQLSTATE 23505 to `ForbiddenError` (not a more specific message); (i) every authz failure returns `{ ok: false, error: "Forbidden" }` — no granular messages; (j) `crypto.randomUUID()` is the only token generator (no `Math.random`); (k) no `console.warn` / `console.error` line in `src/lib/circles/actions.ts` includes the `token` field; (l) the migration `drizzle/0010_*.sql` carries the `-- schema-only` header and includes the partial unique index `WHERE status = 'pending'`; (m) the slice-3 + slice-4 + slice-10 + slice-16 tests pass without modification; (n) demo-mode guards short-circuit every action before any DB read or write. Report findings, no fixes.

- [ ] **Step 2: Apply review fixes** (if any). For each finding, fix + add a failing-first test + commit with a `fix(<domain>): …` message ending in the Co-Authored-By trailer.

- [ ] **Step 3: Push the branch.**
```bash
git push -u origin feature/aiya-circle-onboarding-4c
```

- [ ] **Step 4: Merge to main.** From the worktree:
```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git checkout main
git merge --no-ff feature/aiya-circle-onboarding-4c -m "$(cat <<'EOF'
merge: AIYA Circle Onboarding slice 4c

Self-service circle management: owners create circles, invite other orgs
by slug, recipients accept/decline via an unguessable token; members can
leave; owners can remove others. Six server actions in
src/lib/circles/actions.ts + a /circles admin route.

Race resolution (the load-bearing decision the slice-4 sentinel was
guarding): FOR UPDATE transaction in acceptInvitation + declineInvitation,
ON CONFLICT (circle_id, org_id) DO NOTHING for membership insert,
partial UNIQUE on (circle_id, to_org_slug) WHERE status='pending' for
the invite duplicate-pending case. The slice-4 sentinel is REPURPOSED
(not deleted) to lock in the chosen mitigation.

Token = crypto.randomUUID() (122 bits entropy), 7-day TTL, never logged.
Uniform Forbidden rejection — no granular "expired" vs "wrong slug"
leakage. Slug cross-check at accept time stops the "token theft from
Slack paste" attack: token alone is insufficient; the session's org
slug must match invite.to_org_slug.

NO email this slice (slice 4d); NO RBAC (slice 4d); NO directory
(slice 4e); NO circle deletion / rename / transfer-ownership / withdraw
button (deferred to 4c-1).

Demo mode short-circuits every mutation; the demo /circles page shows
AIYA's owned Trusted Partners circle + the seeded pending invite to
argyle-mining.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 5: Cleanup.**
```bash
git worktree remove "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-circle-onboarding-4c"
git branch -d feature/aiya-circle-onboarding-4c
git push origin --delete feature/aiya-circle-onboarding-4c
```

- [ ] **Step 6: Confirm done.** Run from main: `npm test -- --run && npx tsc --noEmit && npm run build`
Expected: green + clean + build succeeds.

---

## Done criteria

- All new tests green; full suite green; `tsc --noEmit` clean; build succeeds.
- `circle_invitations` table exists with the partial unique index `(circle_id, to_org_slug) WHERE status = 'pending'`, a UNIQUE on `token`, and the two non-unique indexes on `to_org_slug` + `from_org_id` status pairs.
- `src/lib/circles/actions.ts` exports six actions: `createCircle`, `inviteOrgToCircle`, `acceptInvitation`, `declineInvitation`, `removeOrgFromCircle`, `leaveCircle`. Every action uses `runWithUser` + `ForbiddenError` + the uniform `{ ok: false, error: "Forbidden" }` rejection.
- `src/lib/circles/membership-mutations.ts` exports `addOrgToCircle` + `removeOrgFromCircle` as the canonical writers. The slice-4 race sentinel is REPURPOSED (not deleted) to lock in the mitigation.
- `acceptInvitation` + `declineInvitation` wrap their entire body in a transaction with `SELECT … FOR UPDATE` on the invitation row + an `ON CONFLICT (circle_id, org_id) DO NOTHING` insert into `circle_members`.
- The slug cross-check (`session.orgId`'s slug === `invite.to_org_slug`) runs BEFORE any state-changing write.
- Tokens are generated by `crypto.randomUUID()`, never `Math.random()`, and never appear in `console.*` output.
- `/circles` admin RSC parallel-fetches owned + member + inbox + outbox + per-circle members; the page renders the five client components and an empty-state helper.
- `src/middleware.ts` matcher includes `/circles`; `src/components/dashboard/Nav.tsx` exposes the Circles entry.
- Demo mode disables every mutation; the demo seed includes one pending AIYA → argyle-mining invite.
- The slice-3 cross-org isolation tests + slice-4 visibility tests + slice-10 thread tests + slice-16 bid tests pass without modification.
- `grep -rn "insert(circleMembers)\|INSERT INTO circle_members" src/` returns matches only in `src/lib/circles/actions.ts` and `src/lib/circles/membership-mutations.ts`.
- `grep -rn "FOR UPDATE" src/lib/circles/` returns exactly 2 matches in `actions.ts`.
- `grep -rn "fromOrgId\|from_org_id" src/lib/circles/validation.ts` returns ZERO matches.
- Next: Slice 4c-1 (withdraw button + circle deletion + slug rename polish) · Slice 4d (email notifications via Resend + per-circle RBAC) · Slice 4e (public circle directory).
