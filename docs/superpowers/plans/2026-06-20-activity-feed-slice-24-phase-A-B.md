# Slice 24 — Activity Feed (Phase A + B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the append-only per-org audit log primitive (`activity_events` table + write/read helpers + demo seed + customer-action instrumentation) so subsequent slices (24b UI, 36 Health Score, 38 Sentinel) have a contract to consume.

**Architecture:** Single table with org_id FK + indexed (org_id, created_at DESC, id DESC) for keyset pagination. Append-only enforced at the application boundary (no `update`/`delete` helpers exported). All writes flow through `recordActivitySafely` — a thin try/catch wrapper around `recordActivity` that tags + swallows so audit failure never breaks business operation. Reader functions take explicit `viewerOrgId` and SQL-filter on org. Demo mode short-circuits reads to a `DEMO_ACTIVITY` array (same pattern as `DEMO_CUSTOMERS` from slice 22) and no-ops writes.

**Tech Stack:** Drizzle ORM (pgTable), drizzle-kit (migration generation), PGlite (test DB), Vitest, Sentry (via existing `withOrgScope` helper), Zod (input validation at helper boundary), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-06-20-activity-feed-slice-24-design.md`

**Branch / worktree:** `feature/slice-24-activity-feed` at `.worktrees/slice-24-activity-feed/`

**Working directory for every shell command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-24-activity-feed`

**Existing patterns to mirror:**
- `src/db/customers.ts` (slice 22) — query helper shape + demo-mode short-circuit
- `src/lib/customers/actions.ts` (slice 22) — `runWithUser` + `safeErrShape` + action tagging
- `src/lib/observability/sentry.ts` — `withOrgScope` for tagging captures
- `drizzle/0016_left_starbolt.sql` (slice 22) — most recent migration; this slice adds `0017_*.sql`

---

## File Structure (added or modified in this plan)

**New files:**
- `src/db/activityEvents.ts` — read helpers + ActivityEvent type + entity-type/verb whitelists
- `src/lib/activity/recordActivity.ts` — append helper (validation + insert)
- `src/lib/activity/recordActivitySafely.ts` — catch+swallow wrapper
- `src/lib/activity/types.ts` — shared Zod schemas + types (so helpers + tests share)
- `drizzle/0017_<drizzle-name>.sql` — migration (drizzle-kit names; commit as-generated)
- `test/db/activity-events-migration-smoke.test.ts`
- `test/db/activityEvents.test.ts`
- `test/lib/activity/recordActivity.test.ts`
- `test/lib/activity/recordActivitySafely.test.ts`

**Modified files:**
- `src/db/schema.ts` — append `activityEvents` pgTable
- `src/lib/customers/actions.ts` — emit events on create/update/delete
- `src/lib/demo/seed.ts` — add `DEMO_ACTIVITY` array
- `test/lib/customers/actions.test.ts` — extend truth-table with activity assertions
- `test/lib/demo/seed.test.ts` — extend with DEMO_ACTIVITY integrity tests

---

## Task A1 — Schema + types + migration generation

**Files:**
- Modify: `src/db/schema.ts` (append at end)
- Create: `src/lib/activity/types.ts`
- Generate: `drizzle/0017_*.sql`

- [ ] **Step 1: Add the schema definition to `src/db/schema.ts`**

Open `src/db/schema.ts`. After the last `pgTable` definition in the file, append:

```ts
export const activityEvents = pgTable(
  "activity_events",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    actor: text("actor"),                 // session.user label; NULL = system event
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    verb: text("verb").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index("activity_events_org_created_idx").on(
      t.orgId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    orgEntityIdx: index("activity_events_org_entity_idx").on(
      t.orgId,
      t.entityType,
      t.entityId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  }),
);
```

If `jsonb` is not already imported at the top of the file, add it to the existing drizzle-orm import (look for the line importing `pgTable, serial, integer, text, ...` and add `jsonb`).

- [ ] **Step 2: Create `src/lib/activity/types.ts` with the whitelists + Zod schema**

```ts
import { z } from "zod";

/** Whitelist of entity types audit events can reference. Extend as new
 *  domains gain instrumentation (slice 25 adds "watchlist", slice 27
 *  adds "invoice", etc.). */
export const ACTIVITY_ENTITY_TYPES = [
  "customer",
  "deal",
  "inventory_item",
  "attachment",
  "circle",
  "bid",
  "org",
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/** Whitelist of verbs. Extend as new event kinds are introduced. */
export const ACTIVITY_VERBS = [
  "created",
  "updated",
  "deleted",
  "archived",
  "restored",
  "invited",
  "joined",
  "left",
  "bid_placed",
  "bid_accepted",
  "bid_rejected",
  "bid_withdrawn",
  "commented",
  "comment_deleted",
  "viewed",
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];

/** 4 KB cap on serialized payload — guard against pathological writers
 *  (e.g. dumping a full row diff) bloating the audit table. */
export const ACTIVITY_PAYLOAD_MAX_BYTES = 4096;
/** 240-char cap on summary — fits a one-line list-view rendering. */
export const ACTIVITY_SUMMARY_MAX_LEN = 240;

export const recordActivityInputSchema = z.object({
  orgId: z.number().int().positive(),
  actor: z.string().min(1).max(200).nullable(),
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: z.number().int().positive().nullable(),
  verb: z.enum(ACTIVITY_VERBS),
  summary: z.string().min(1).max(ACTIVITY_SUMMARY_MAX_LEN),
  payload: z.record(z.unknown()).optional(),
});

export type RecordActivityInput = z.infer<typeof recordActivityInputSchema>;

/** Shape returned by readers — mirrors the row exactly. */
export type ActivityEvent = {
  id: number;
  orgId: number;
  actor: string | null;
  entityType: ActivityEntityType;
  entityId: number | null;
  verb: ActivityVerb;
  summary: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};
```

- [ ] **Step 3: Generate the migration**

Run:
```bash
npx drizzle-kit generate
```

Expected output (the file name's middle word is randomly generated — capture whatever drizzle-kit produces):
```
drizzle/0017_<adjective>_<noun>.sql
```

Verify the migration file exists and contains:
- `CREATE TABLE "activity_events"`
- `"org_id" integer NOT NULL`
- `"actor" text`
- `"entity_type" text NOT NULL`
- `"entity_id" integer`
- `"verb" text NOT NULL`
- `"summary" text NOT NULL`
- `"payload" jsonb`
- `"created_at" timestamp with time zone DEFAULT now() NOT NULL`
- FK constraint on `org_id` references `orgs(id)`
- Two `CREATE INDEX` statements (`activity_events_org_created_idx`, `activity_events_org_entity_idx`)

If any of those are missing or shaped wrong, revisit step 1.

- [ ] **Step 4: Run tsc to verify nothing else broke**

```bash
npx tsc --noEmit
```

Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/lib/activity/types.ts drizzle/0017_*.sql drizzle/meta/
git commit -m "feat(db): activity_events table + types (slice 24 A1)"
```

---

## Task A2 — Migration smoke test

**Files:**
- Create: `test/db/activity-events-migration-smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Mirror the slice 22 smoke test pattern (`test/db/migration-customers-smoke.test.ts`). Create the file with:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

describe("activity_events migration (slice 24)", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  it("creates the activity_events table with the expected columns", async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'activity_events'
       ORDER BY ordinal_position
    `);
    const byName = new Map(cols.rows.map((r) => [r.column_name as string, r]));
    expect(byName.get("id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("org_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("actor")).toMatchObject({ data_type: "text", is_nullable: "YES" });
    expect(byName.get("entity_type")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("entity_id")).toMatchObject({ data_type: "integer", is_nullable: "YES" });
    expect(byName.get("verb")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("summary")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("payload")).toMatchObject({ data_type: "jsonb", is_nullable: "YES" });
  });

  it("indexes activity_events_org_created_idx and activity_events_org_entity_idx exist", async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'activity_events'
    `);
    const names = idx.rows.map((r) => r.indexname as string);
    expect(names).toContain("activity_events_org_created_idx");
    expect(names).toContain("activity_events_org_entity_idx");
  });

  it("rejects inserts with a non-existent org_id (FK)", async () => {
    await expect(
      db.execute(sql`
        INSERT INTO activity_events (org_id, entity_type, verb, summary)
        VALUES (99999, 'customer', 'created', 'orphan org')
      `),
    ).rejects.toThrow();
  });

  it("allows entity_id to be NULL (orphan entity rows are intentional)", async () => {
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A')`);
    await db.execute(sql`
      INSERT INTO activity_events (org_id, entity_type, verb, summary)
      VALUES (1, 'org', 'created', 'org bootstrap')
    `);
    const rows = await db.execute(sql`SELECT entity_id FROM activity_events`);
    expect(rows.rows[0]?.entity_id).toBeNull();
  });

  it("created_at defaults to now() and round-trips as a Date", async () => {
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A')`);
    await db.insert(schema.activityEvents).values({
      orgId: 1, entityType: "customer", verb: "created", summary: "x",
    });
    const [row] = await db.select().from(schema.activityEvents);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
npx vitest run test/db/activity-events-migration-smoke.test.ts
```

Expected: 5 tests pass.

If any fail, the most common causes are:
- Drizzle didn't emit the index — verify in `drizzle/0017_*.sql`
- The FK constraint syntax differs — check the `references()` call in `src/db/schema.ts`

- [ ] **Step 3: Commit**

```bash
git add test/db/activity-events-migration-smoke.test.ts
git commit -m "test(db): activity_events migration smoke (slice 24 A2)"
```

---

## Task A3 — recordActivity (raw helper)

**Files:**
- Create: `src/lib/activity/recordActivity.ts`
- Create: `test/lib/activity/recordActivity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/lib/activity/recordActivity.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { recordActivity } from "@/lib/activity/recordActivity";
import { ACTIVITY_PAYLOAD_MAX_BYTES } from "@/lib/activity/types";

async function freshDb() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A')`);
  return db;
}

describe("recordActivity", () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => { db = await freshDb(); });

  it("inserts a valid event and returns void", async () => {
    const result = await recordActivity(db, {
      orgId: 1,
      actor: "user@example.com",
      entityType: "customer",
      entityId: 5,
      verb: "created",
      summary: "Added Priya Mehta",
    });
    expect(result).toBeUndefined();
    const [row] = await db.select().from(schema.activityEvents);
    expect(row).toMatchObject({
      orgId: 1,
      actor: "user@example.com",
      entityType: "customer",
      entityId: 5,
      verb: "created",
      summary: "Added Priya Mehta",
    });
  });

  it("accepts null actor (system event)", async () => {
    await recordActivity(db, {
      orgId: 1, actor: null, entityType: "org", entityId: null,
      verb: "created", summary: "Seed bootstrap",
    });
    const [row] = await db.select().from(schema.activityEvents);
    expect(row.actor).toBeNull();
    expect(row.entityId).toBeNull();
  });

  it("persists payload as parsed JSON", async () => {
    await recordActivity(db, {
      orgId: 1, actor: "u", entityType: "customer", entityId: 1,
      verb: "updated", summary: "x",
      payload: { changedFields: ["email"], previousEmail: "a@b.com" },
    });
    const [row] = await db.select().from(schema.activityEvents);
    expect(row.payload).toEqual({ changedFields: ["email"], previousEmail: "a@b.com" });
  });

  it("throws on invalid entityType", async () => {
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null,
        entityType: "not-a-real-type" as never,
        entityId: 1, verb: "created", summary: "x",
      }),
    ).rejects.toThrow();
  });

  it("throws on invalid verb", async () => {
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null, entityType: "customer", entityId: 1,
        verb: "exploded" as never, summary: "x",
      }),
    ).rejects.toThrow();
  });

  it("throws on summary longer than 240 chars", async () => {
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null, entityType: "customer", entityId: 1,
        verb: "created", summary: "x".repeat(241),
      }),
    ).rejects.toThrow();
  });

  it("throws on empty summary", async () => {
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null, entityType: "customer", entityId: 1,
        verb: "created", summary: "",
      }),
    ).rejects.toThrow();
  });

  it("throws on payload exceeding 4 KB serialized", async () => {
    const big = "y".repeat(ACTIVITY_PAYLOAD_MAX_BYTES);
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null, entityType: "customer", entityId: 1,
        verb: "created", summary: "x",
        payload: { huge: big },
      }),
    ).rejects.toThrow(/payload/i);
  });

  it("throws when org_id violates FK (defense-in-depth)", async () => {
    await expect(
      recordActivity(db, {
        orgId: 99999, actor: null, entityType: "customer", entityId: 1,
        verb: "created", summary: "x",
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/lib/activity/recordActivity.test.ts
```

Expected: FAIL — module `@/lib/activity/recordActivity` not found.

- [ ] **Step 3: Implement `src/lib/activity/recordActivity.ts`**

```ts
import type { Db } from "@/db/client";
import { activityEvents } from "@/db/schema";
import {
  ACTIVITY_PAYLOAD_MAX_BYTES,
  recordActivityInputSchema,
  type RecordActivityInput,
} from "./types";

/**
 * Append a single audit row. Validates input at the boundary (Zod
 * whitelist + length + payload-size cap), then INSERTs. Returns void —
 * callers do not need the event id.
 *
 * Throws on any failure (validation OR DB). Action sites use
 * `recordActivitySafely` (this module's sibling) to swallow + tag.
 */
export async function recordActivity(
  db: Db,
  input: RecordActivityInput,
): Promise<void> {
  const parsed = recordActivityInputSchema.parse(input);
  if (parsed.payload !== undefined) {
    const size = Buffer.byteLength(JSON.stringify(parsed.payload), "utf8");
    if (size > ACTIVITY_PAYLOAD_MAX_BYTES) {
      throw new Error(
        `recordActivity: payload ${size} bytes exceeds ${ACTIVITY_PAYLOAD_MAX_BYTES}-byte cap`,
      );
    }
  }
  await db.insert(activityEvents).values({
    orgId: parsed.orgId,
    actor: parsed.actor,
    entityType: parsed.entityType,
    entityId: parsed.entityId,
    verb: parsed.verb,
    summary: parsed.summary,
    payload: parsed.payload ?? null,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run test/lib/activity/recordActivity.test.ts
```

Expected: 9 tests pass.

If the payload size test fails ("expected to throw / matching /payload/i") — verify the error message in step 3 contains the word "payload" (case-insensitive).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity/recordActivity.ts test/lib/activity/recordActivity.test.ts
git commit -m "feat(activity): recordActivity append helper (slice 24 A3)"
```

---

## Task A4 — getOrgActivity (org-wide reader)

**Files:**
- Create: `src/db/activityEvents.ts`
- Create: `test/db/activityEvents.test.ts`

- [ ] **Step 1: Write the failing test (org-wide reader portion)**

Create `test/db/activityEvents.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getOrgActivity, getEntityActivity } from "@/db/activityEvents";

async function freshDb() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'one', 'One'), (2, 'two', 'Two')`);
  return db;
}

async function insertEvents(
  db: Awaited<ReturnType<typeof freshDb>>,
  rows: Array<Partial<typeof schema.activityEvents.$inferInsert>>,
) {
  for (const r of rows) {
    await db.insert(schema.activityEvents).values({
      orgId: 1, entityType: "customer", entityId: 1, verb: "created", summary: "x",
      ...r,
    });
    // Force monotonic created_at when iterating fast — pglite resolves to
    // microseconds but we want guaranteed ordering for assertions.
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("getOrgActivity — org-wide reader", () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => { db = await freshDb(); });

  it("returns only events for the viewer's org (cross-org isolation)", async () => {
    await insertEvents(db, [
      { orgId: 1, summary: "org1-a" },
      { orgId: 2, summary: "org2-a" },
      { orgId: 1, summary: "org1-b" },
    ]);
    const rows = await getOrgActivity(db, 1);
    expect(rows.map((r) => r.summary).sort()).toEqual(["org1-a", "org1-b"]);
  });

  it("orders DESC by created_at then id", async () => {
    await insertEvents(db, [
      { orgId: 1, summary: "first" },
      { orgId: 1, summary: "second" },
      { orgId: 1, summary: "third" },
    ]);
    const rows = await getOrgActivity(db, 1);
    expect(rows.map((r) => r.summary)).toEqual(["third", "second", "first"]);
  });

  it("default limit is 50 — clamps to 200 maximum", async () => {
    for (let i = 0; i < 220; i++) {
      await db.insert(schema.activityEvents).values({
        orgId: 1, entityType: "customer", entityId: i + 1, verb: "created", summary: `c${i}`,
      });
    }
    expect((await getOrgActivity(db, 1)).length).toBe(50);
    expect((await getOrgActivity(db, 1, { limit: 100 })).length).toBe(100);
    expect((await getOrgActivity(db, 1, { limit: 500 })).length).toBe(200);
  });

  it("filters by entityTypes when provided", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", summary: "c1" },
      { orgId: 1, entityType: "deal", summary: "d1" },
      { orgId: 1, entityType: "inventory_item", summary: "i1" },
      { orgId: 1, entityType: "customer", summary: "c2" },
    ]);
    const rows = await getOrgActivity(db, 1, { entityTypes: ["customer"] });
    expect(rows.map((r) => r.summary).sort()).toEqual(["c1", "c2"]);

    const mixed = await getOrgActivity(db, 1, { entityTypes: ["customer", "deal"] });
    expect(mixed.length).toBe(3);
  });

  it("paginates via beforeId cursor — page 2 never overlaps page 1", async () => {
    for (let i = 0; i < 5; i++) {
      await db.insert(schema.activityEvents).values({
        orgId: 1, entityType: "customer", entityId: i + 1, verb: "created", summary: `c${i}`,
      });
    }
    const page1 = await getOrgActivity(db, 1, { limit: 2 });
    expect(page1.length).toBe(2);
    const cursor = page1[page1.length - 1]!.id;
    const page2 = await getOrgActivity(db, 1, { limit: 2, beforeId: cursor });
    expect(page2.length).toBe(2);
    const overlap = page1.map((r) => r.id).filter((id) => page2.some((r) => r.id === id));
    expect(overlap).toEqual([]);
  });
});
```

(`getEntityActivity` tests come in Task A5 — leave them out of this file for now.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/db/activityEvents.test.ts
```

Expected: FAIL — module `@/db/activityEvents` not found.

- [ ] **Step 3: Implement `src/db/activityEvents.ts` (getOrgActivity only)**

```ts
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activityEvents } from "@/db/schema";
import {
  type ActivityEntityType,
  type ActivityEvent,
  type ActivityVerb,
} from "@/lib/activity/types";

export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 200;

function clampLimit(requested?: number): number {
  if (requested === undefined) return ACTIVITY_DEFAULT_LIMIT;
  if (requested < 1) return 1;
  if (requested > ACTIVITY_MAX_LIMIT) return ACTIVITY_MAX_LIMIT;
  return Math.floor(requested);
}

function toActivityEvent(row: typeof activityEvents.$inferSelect): ActivityEvent {
  return {
    id: row.id,
    orgId: row.orgId,
    actor: row.actor,
    entityType: row.entityType as ActivityEntityType,
    entityId: row.entityId,
    verb: row.verb as ActivityVerb,
    summary: row.summary,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Paginated org-wide audit feed. Most recent first. Slice-3 invariant:
 * `org_id = $viewerOrgId` is SQL-enforced; no application-layer filter.
 */
export async function getOrgActivity(
  db: Db,
  viewerOrgId: number,
  opts?: {
    limit?: number;
    beforeId?: number;
    entityTypes?: readonly ActivityEntityType[];
  },
): Promise<ActivityEvent[]> {
  const conds = [eq(activityEvents.orgId, viewerOrgId)];
  if (opts?.beforeId !== undefined) {
    conds.push(lt(activityEvents.id, opts.beforeId));
  }
  if (opts?.entityTypes && opts.entityTypes.length > 0) {
    conds.push(inArray(activityEvents.entityType, [...opts.entityTypes]));
  }
  const rows = await db
    .select()
    .from(activityEvents)
    .where(and(...conds))
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(clampLimit(opts?.limit));
  return rows.map(toActivityEvent);
}

// getEntityActivity comes in Task A5 (do not implement yet).
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run test/db/activityEvents.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/activityEvents.ts test/db/activityEvents.test.ts
git commit -m "feat(activity): getOrgActivity reader with pagination (slice 24 A4)"
```

---

## Task A5 — getEntityActivity (entity-scoped reader)

**Files:**
- Modify: `src/db/activityEvents.ts` (append `getEntityActivity` + export)
- Modify: `test/db/activityEvents.test.ts` (append a new `describe` block)

- [ ] **Step 1: Append the failing tests to `test/db/activityEvents.test.ts`**

Append (at the end of the file, after the closing `});` of `describe("getOrgActivity ...")`):

```ts
describe("getEntityActivity — entity-scoped reader", () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => { db = await freshDb(); });

  it("returns only events for the given (entityType, entityId) pair", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", entityId: 7, summary: "c7-a" },
      { orgId: 1, entityType: "customer", entityId: 8, summary: "c8-a" },
      { orgId: 1, entityType: "deal", entityId: 7, summary: "d7" },
      { orgId: 1, entityType: "customer", entityId: 7, summary: "c7-b" },
    ]);
    const rows = await getEntityActivity(db, 1, "customer", 7);
    expect(rows.map((r) => r.summary).sort()).toEqual(["c7-a", "c7-b"]);
  });

  it("enforces cross-org isolation (org 2 events never returned to org 1 viewer)", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", entityId: 5, summary: "org1-c5" },
      { orgId: 2, entityType: "customer", entityId: 5, summary: "org2-c5" },
    ]);
    const rows = await getEntityActivity(db, 1, "customer", 5);
    expect(rows.map((r) => r.summary)).toEqual(["org1-c5"]);
  });

  it("paginates via beforeId on the entity-scoped path", async () => {
    for (let i = 0; i < 4; i++) {
      await db.insert(schema.activityEvents).values({
        orgId: 1, entityType: "customer", entityId: 9, verb: "updated", summary: `u${i}`,
      });
    }
    const page1 = await getEntityActivity(db, 1, "customer", 9, { limit: 2 });
    expect(page1.length).toBe(2);
    const page2 = await getEntityActivity(db, 1, "customer", 9, { limit: 2, beforeId: page1.at(-1)!.id });
    expect(page2.length).toBe(2);
    expect(page1.map((r) => r.id).filter((id) => page2.some((r) => r.id === id))).toEqual([]);
  });

  it("returns empty array when no matching events exist", async () => {
    await insertEvents(db, [{ orgId: 1, entityType: "deal", entityId: 1, summary: "d1" }]);
    const rows = await getEntityActivity(db, 1, "customer", 99);
    expect(rows).toEqual([]);
  });

  it("clamps limit at 200", async () => {
    for (let i = 0; i < 220; i++) {
      await db.insert(schema.activityEvents).values({
        orgId: 1, entityType: "customer", entityId: 1, verb: "updated", summary: `u${i}`,
      });
    }
    const rows = await getEntityActivity(db, 1, "customer", 1, { limit: 999 });
    expect(rows.length).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/db/activityEvents.test.ts
```

Expected: FAIL — `getEntityActivity` is not exported from `@/db/activityEvents`.

- [ ] **Step 3: Append the implementation to `src/db/activityEvents.ts`**

Replace the placeholder comment `// getEntityActivity comes in Task A5 (do not implement yet).` with:

```ts
/**
 * Entity-scoped audit feed — "show me everything that ever happened to
 * customer 17". Slice-3 invariant: SQL-enforced org filter.
 */
export async function getEntityActivity(
  db: Db,
  viewerOrgId: number,
  entityType: ActivityEntityType,
  entityId: number,
  opts?: { limit?: number; beforeId?: number },
): Promise<ActivityEvent[]> {
  const conds = [
    eq(activityEvents.orgId, viewerOrgId),
    eq(activityEvents.entityType, entityType),
    eq(activityEvents.entityId, entityId),
  ];
  if (opts?.beforeId !== undefined) {
    conds.push(lt(activityEvents.id, opts.beforeId));
  }
  const rows = await db
    .select()
    .from(activityEvents)
    .where(and(...conds))
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(clampLimit(opts?.limit));
  return rows.map(toActivityEvent);
}
```

- [ ] **Step 4: Run all activity tests to verify both readers pass**

```bash
npx vitest run test/db/activityEvents.test.ts
```

Expected: 10 tests pass (5 from A4 + 5 new from A5).

- [ ] **Step 5: Commit**

```bash
git add src/db/activityEvents.ts test/db/activityEvents.test.ts
git commit -m "feat(activity): getEntityActivity reader (slice 24 A5)"
```

---

## Task A6 — recordActivitySafely (catch+tag+swallow wrapper)

**Files:**
- Create: `src/lib/activity/recordActivitySafely.ts`
- Create: `test/lib/activity/recordActivitySafely.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/lib/activity/recordActivitySafely.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

// Mock the Sentry SDK BEFORE importing the helper so vi.mock hoists correctly.
vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: { setTag: (k: string, v: unknown) => void }) => void) => {
    const tags: Record<string, unknown> = {};
    fn({ setTag: (k, v) => { tags[k] = v; } });
    (globalThis as Record<string, unknown>).__lastSentryTags = tags;
  },
  captureException: (e: unknown) => {
    (globalThis as Record<string, unknown>).__lastSentryError = e;
  },
}));

// Mock recordActivity so we can force failure deterministically.
vi.mock("@/lib/activity/recordActivity", () => ({
  recordActivity: vi.fn(),
}));

import { recordActivity } from "@/lib/activity/recordActivity";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";

async function freshDb() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A')`);
  return db;
}

describe("recordActivitySafely", () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => {
    db = await freshDb();
    vi.mocked(recordActivity).mockReset();
    (globalThis as Record<string, unknown>).__lastSentryError = undefined;
    (globalThis as Record<string, unknown>).__lastSentryTags = undefined;
  });

  it("calls recordActivity on the happy path and returns void", async () => {
    vi.mocked(recordActivity).mockResolvedValueOnce(undefined);
    const result = await recordActivitySafely(
      db,
      { orgId: 1, actor: "u", entityType: "customer", entityId: 1, verb: "created", summary: "x" },
      { action: "customers.create" },
    );
    expect(result).toBeUndefined();
    expect(recordActivity).toHaveBeenCalledOnce();
    expect((globalThis as Record<string, unknown>).__lastSentryError).toBeUndefined();
  });

  it("swallows errors from recordActivity (returns void, does not throw)", async () => {
    vi.mocked(recordActivity).mockRejectedValueOnce(new Error("boom"));
    await expect(
      recordActivitySafely(
        db,
        { orgId: 1, actor: "u", entityType: "customer", entityId: 1, verb: "created", summary: "x" },
        { action: "customers.create" },
      ),
    ).resolves.toBeUndefined();
  });

  it("tags Sentry with orgId, action, and subStep=recordActivity on failure", async () => {
    const err = new Error("db unavailable");
    vi.mocked(recordActivity).mockRejectedValueOnce(err);
    await recordActivitySafely(
      db,
      { orgId: 42, actor: "u", entityType: "deal", entityId: 5, verb: "bid_placed", summary: "x" },
      { action: "deals.bid" },
    );
    expect((globalThis as Record<string, unknown>).__lastSentryError).toBe(err);
    expect((globalThis as Record<string, unknown>).__lastSentryTags).toMatchObject({
      orgId: 42,
      action: "deals.bid",
      subStep: "recordActivity",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/lib/activity/recordActivitySafely.test.ts
```

Expected: FAIL — module `@/lib/activity/recordActivitySafely` not found.

- [ ] **Step 3: Implement `src/lib/activity/recordActivitySafely.ts`**

```ts
import * as Sentry from "@sentry/nextjs";
import type { Db } from "@/db/client";
import { recordActivity } from "./recordActivity";
import type { RecordActivityInput } from "./types";

/**
 * Action-safe wrapper around `recordActivity`. Catches every failure,
 * tags Sentry with orgId + action + subStep, and SWALLOWS so audit
 * failure never blocks the user-facing action.
 *
 * Action sites MUST use this wrapper, not `recordActivity` directly.
 * Calling the raw helper inside a `runWithUser` block is a bug — audit
 * failure would propagate up and surface as an action error.
 */
export async function recordActivitySafely(
  db: Db,
  input: RecordActivityInput,
  ctx: { action: string },
): Promise<void> {
  try {
    await recordActivity(db, input);
  } catch (e) {
    Sentry.withScope((scope) => {
      scope.setTag("orgId", input.orgId);
      scope.setTag("action", ctx.action);
      scope.setTag("subStep", "recordActivity");
      Sentry.captureException(e);
    });
    // Audit is best-effort. Do not re-throw.
  }
}
```

> **Note on the Sentry pattern.** The spec mentioned `withOrgScope` as the existing org-tagging helper, but for the recordActivitySafely path we set the orgId tag inline inside the same `withScope` block so all three tags (orgId, action, subStep) land on the same scope instance. `withOrgScope` would create a nested scope that re-tags orgId but loses the action/subStep tags unless we re-stacked the scopes — simpler to set all three together here.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run test/lib/activity/recordActivitySafely.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity/recordActivitySafely.ts test/lib/activity/recordActivitySafely.test.ts
git commit -m "feat(activity): recordActivitySafely wrapper (slice 24 A6)"
```

---

## Task A7 — DEMO_ACTIVITY seed + demo-mode wiring + seed integrity tests

**Files:**
- Modify: `src/lib/demo/seed.ts` (add `DEMO_ACTIVITY` export)
- Modify: `src/db/activityEvents.ts` (demo-mode short-circuit in both readers)
- Modify: `src/lib/activity/recordActivitySafely.ts` (no-op in demo mode)
- Modify: `test/lib/demo/seed.test.ts` (extend with DEMO_ACTIVITY integrity tests)

- [ ] **Step 1: Add `DEMO_ACTIVITY` to `src/lib/demo/seed.ts`**

Open `src/lib/demo/seed.ts`. Find the `DEMO_CUSTOMERS` export (added in slice 22 C1). Just below it, append:

```ts
import type { ActivityEvent } from "@/lib/activity/types";

/**
 * 10 authored activity events on DEMO_ORG_ID, all `entityType: "customer"`,
 * mix of created/updated/deleted, staggered 2 hours apart over the past
 * day. Drives the future ActivityPanel rendering in demo mode (slice 24c).
 *
 * Slice 24 ships the seed; slice 24c ships the panel.
 */
const NOW = new Date();
const HOURS_AGO = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

export const DEMO_ACTIVITY: ActivityEvent[] = [
  { id: 9001, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2201, verb: "created", summary: "Added Priya Mehta",          payload: { name: "Priya Mehta", businessName: "Mehta Diamonds Pvt Ltd" },     createdAt: HOURS_AGO(22) },
  { id: 9002, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2202, verb: "created", summary: "Added Jean-Marc Auclair",    payload: { name: "Jean-Marc Auclair", businessName: "Saint-Cloud Atelier" },  createdAt: HOURS_AGO(20) },
  { id: 9003, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2203, verb: "created", summary: "Added Anita Sharma",         payload: { name: "Anita Sharma", businessName: null },                        createdAt: HOURS_AGO(18) },
  { id: 9004, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2204, verb: "created", summary: "Added Yuki Tanaka",          payload: { name: "Yuki Tanaka", businessName: "Ginza Pearl House" },          createdAt: HOURS_AGO(16) },
  { id: 9005, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2201, verb: "updated", summary: "Updated Priya Mehta",        payload: { changedFields: ["email"] },                                        createdAt: HOURS_AGO(14) },
  { id: 9006, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2205, verb: "created", summary: "Added Marcus Klein",         payload: { name: "Marcus Klein", businessName: null },                        createdAt: HOURS_AGO(12) },
  { id: 9007, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2206, verb: "created", summary: "Added Rohan Patel",          payload: { name: "Rohan Patel", businessName: null },                         createdAt: HOURS_AGO(10) },
  { id: 9008, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2207, verb: "created", summary: "Added Sofia Russo",          payload: { name: "Sofia Russo", businessName: "Russo Goldsmiths" },           createdAt: HOURS_AGO(8) },
  { id: 9009, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 2202, verb: "updated", summary: "Updated Jean-Marc Auclair",  payload: { changedFields: ["phone", "address"] },                             createdAt: HOURS_AGO(6) },
  { id: 9010, orgId: 1, actor: "owner@aiya.demo", entityType: "customer", entityId: 9999, verb: "deleted", summary: "Deleted Test Account",       payload: { name: "Test Account" },                                            createdAt: HOURS_AGO(2) },
];
```

> **Note on demo `entityId` values.** Events 9001–9009 reference real `DEMO_CUSTOMERS` ids 2201–2207 (verified to exist in the slice-22 seed). Event 9010 references `9999` (intentionally orphan) to demonstrate the "deleted entity / orphan audit row" case the spec calls out. If you regenerate the demo customers and the ids shift, update these to match.

- [ ] **Step 2: Wire demo-mode short-circuit into `src/db/activityEvents.ts`**

At the top of `src/db/activityEvents.ts`, add to the existing imports:

```ts
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_ACTIVITY } from "@/lib/demo/seed";
```

In `getOrgActivity`, after the `clampLimit` call but BEFORE the `db.select(...)`, insert a demo branch. Replace the existing function body with:

```ts
export async function getOrgActivity(
  db: Db,
  viewerOrgId: number,
  opts?: {
    limit?: number;
    beforeId?: number;
    entityTypes?: readonly ActivityEntityType[];
  },
): Promise<ActivityEvent[]> {
  const limit = clampLimit(opts?.limit);

  if (isDemoMode()) {
    let pool = DEMO_ACTIVITY.filter((e) => e.orgId === viewerOrgId);
    if (opts?.entityTypes && opts.entityTypes.length > 0) {
      const allow = new Set(opts.entityTypes);
      pool = pool.filter((e) => allow.has(e.entityType));
    }
    if (opts?.beforeId !== undefined) {
      pool = pool.filter((e) => e.id < opts.beforeId!);
    }
    pool = [...pool].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
    );
    return pool.slice(0, limit);
  }

  const conds = [eq(activityEvents.orgId, viewerOrgId)];
  if (opts?.beforeId !== undefined) {
    conds.push(lt(activityEvents.id, opts.beforeId));
  }
  if (opts?.entityTypes && opts.entityTypes.length > 0) {
    conds.push(inArray(activityEvents.entityType, [...opts.entityTypes]));
  }
  const rows = await db
    .select()
    .from(activityEvents)
    .where(and(...conds))
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit);
  return rows.map(toActivityEvent);
}
```

Similarly, replace the existing `getEntityActivity` body with:

```ts
export async function getEntityActivity(
  db: Db,
  viewerOrgId: number,
  entityType: ActivityEntityType,
  entityId: number,
  opts?: { limit?: number; beforeId?: number },
): Promise<ActivityEvent[]> {
  const limit = clampLimit(opts?.limit);

  if (isDemoMode()) {
    let pool = DEMO_ACTIVITY.filter(
      (e) =>
        e.orgId === viewerOrgId &&
        e.entityType === entityType &&
        e.entityId === entityId,
    );
    if (opts?.beforeId !== undefined) {
      pool = pool.filter((e) => e.id < opts.beforeId!);
    }
    pool = [...pool].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
    );
    return pool.slice(0, limit);
  }

  const conds = [
    eq(activityEvents.orgId, viewerOrgId),
    eq(activityEvents.entityType, entityType),
    eq(activityEvents.entityId, entityId),
  ];
  if (opts?.beforeId !== undefined) {
    conds.push(lt(activityEvents.id, opts.beforeId));
  }
  const rows = await db
    .select()
    .from(activityEvents)
    .where(and(...conds))
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit);
  return rows.map(toActivityEvent);
}
```

- [ ] **Step 3: No-op `recordActivitySafely` in demo mode**

Open `src/lib/activity/recordActivitySafely.ts`. Add to the imports:

```ts
import { isDemoMode } from "@/lib/demo/mode";
```

Modify the function body to short-circuit:

```ts
export async function recordActivitySafely(
  db: Db,
  input: RecordActivityInput,
  ctx: { action: string },
): Promise<void> {
  if (isDemoMode()) return;
  try {
    await recordActivity(db, input);
  } catch (e) {
    Sentry.withScope((scope) => {
      scope.setTag("orgId", input.orgId);
      scope.setTag("action", ctx.action);
      scope.setTag("subStep", "recordActivity");
      Sentry.captureException(e);
    });
  }
}
```

- [ ] **Step 4: Extend `test/lib/demo/seed.test.ts` with DEMO_ACTIVITY integrity**

Open `test/lib/demo/seed.test.ts`. Add to the existing imports:

```ts
import { DEMO_ACTIVITY } from "@/lib/demo/seed";
import { ACTIVITY_ENTITY_TYPES, ACTIVITY_VERBS } from "@/lib/activity/types";
```

Append a new `describe` block at the end of the file:

```ts
describe("DEMO_ACTIVITY (slice 24)", () => {
  it("has exactly 10 events", () => {
    expect(DEMO_ACTIVITY.length).toBe(10);
  });

  it("all events are scoped to DEMO_ORG_ID = 1", () => {
    for (const e of DEMO_ACTIVITY) {
      expect(e.orgId).toBe(1);
    }
  });

  it("all entityTypes are valid against the whitelist", () => {
    for (const e of DEMO_ACTIVITY) {
      expect(ACTIVITY_ENTITY_TYPES).toContain(e.entityType);
    }
  });

  it("all verbs are valid against the whitelist", () => {
    for (const e of DEMO_ACTIVITY) {
      expect(ACTIVITY_VERBS).toContain(e.verb);
    }
  });

  it("all summaries are within the 240-char cap", () => {
    for (const e of DEMO_ACTIVITY) {
      expect(e.summary.length).toBeGreaterThan(0);
      expect(e.summary.length).toBeLessThanOrEqual(240);
    }
  });

  it("ids are unique", () => {
    const ids = DEMO_ACTIVITY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 5: Add a demo-mode end-to-end test in `test/db/activityEvents.test.ts`**

Append a new `describe` block at the bottom of `test/db/activityEvents.test.ts`:

```ts
describe("getOrgActivity / getEntityActivity — demo mode", () => {
  const ORIGINAL_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    vi.resetModules();
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = ORIGINAL_DEMO;
    vi.resetModules();
  });

  it("getOrgActivity returns DEMO_ACTIVITY entries in DESC order", async () => {
    const mod = await import("@/db/activityEvents");
    const db = await freshDb();
    const rows = await mod.getOrgActivity(db, 1, { limit: 50 });
    expect(rows.length).toBe(10);
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[1]!.createdAt.getTime());
  });

  it("getEntityActivity filters DEMO_ACTIVITY by entity (customer 2201 has 2 events)", async () => {
    const mod = await import("@/db/activityEvents");
    const db = await freshDb();
    const rows = await mod.getEntityActivity(db, 1, "customer", 2201);
    expect(rows.length).toBe(2); // created (9001) + updated (9005)
    expect(rows.every((r) => r.entityType === "customer" && r.entityId === 2201)).toBe(true);
  });
});
```

Note: import `vi, afterEach` at the top of `test/db/activityEvents.test.ts` if not already there. The current top imports are `describe, it, expect, beforeEach` — extend that line to add `vi, afterEach`.

- [ ] **Step 6: Run the full test set for slice 24 and verify all pass**

```bash
npx vitest run test/db/activityEvents.test.ts test/db/activity-events-migration-smoke.test.ts test/lib/activity/recordActivity.test.ts test/lib/activity/recordActivitySafely.test.ts test/lib/demo/seed.test.ts
```

Expected: all tests pass — the existing seed tests (slice 22), plus 6 new DEMO_ACTIVITY integrity tests, plus the 2 new demo-mode end-to-end tests, plus all earlier activity tests still green.

- [ ] **Step 7: tsc sanity**

```bash
npx tsc --noEmit
```

Expected: exit 0, no output.

- [ ] **Step 8: Commit**

```bash
git add src/lib/demo/seed.ts src/db/activityEvents.ts src/lib/activity/recordActivitySafely.ts test/lib/demo/seed.test.ts test/db/activityEvents.test.ts
git commit -m "feat(activity): DEMO_ACTIVITY seed + demo-mode reader/writer wiring (slice 24 A7)"
```

---

## Task B1 — Instrument customers actions to emit activity events

**Files:**
- Modify: `src/lib/customers/actions.ts` (add `recordActivitySafely` calls inside the three actions)
- Modify: `test/lib/customers/actions.test.ts` (extend truth-table with activity assertions)

- [ ] **Step 1: Read the current `src/lib/customers/actions.ts`**

```bash
cat src/lib/customers/actions.ts | head -200
```

Find the three handler bodies: `createCustomer`, `updateCustomer`, `deleteCustomer`. Each runs inside `run({ action: "..." }, async (session) => { ... })`. Note the `session.user` field and `session.orgId` (slice 22 pattern).

- [ ] **Step 2: Add the import at the top of `src/lib/customers/actions.ts`**

Add (after the existing imports):

```ts
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
```

- [ ] **Step 3: Instrument `createCustomer`**

In the `createCustomer` handler, after the successful `db.insert(...).returning()` line and BEFORE the `return { ok: true, id: row.id }` line, insert:

```ts
await recordActivitySafely(
  db,
  {
    orgId: session.orgId,
    actor: session.user,
    entityType: "customer",
    entityId: row.id,
    verb: "created",
    summary: `Added ${row.name}`,
    payload: {
      name: row.name,
      businessName: row.businessName ?? null,
      email: row.email ?? null,
    },
  },
  { action: "customers.create" },
);
```

- [ ] **Step 4: Instrument `updateCustomer`**

In the `updateCustomer` handler:

1. Compute `changedFields` from the parsed input — the parsed Zod object has only the fields the user submitted. The pattern: take the keys of `parsed.data` after stripping the `id` field.
2. After the successful UPDATE (where the existing code asserts that a row was affected — the slice-22 cross-org-defense path), insert:

```ts
const changedFields = Object.keys(parsed.data).filter((k) => k !== "id");
await recordActivitySafely(
  db,
  {
    orgId: session.orgId,
    actor: session.user,
    entityType: "customer",
    entityId: parsed.data.id,
    verb: "updated",
    summary: changedFields.length === 1
      ? `Updated ${updated.name}: ${changedFields[0]}`
      : `Updated ${updated.name}`,
    payload: { changedFields },
  },
  { action: "customers.update" },
);
```

Where `updated` is the row returned from the UPDATE (the existing slice 22 action already names it `updated` — if it doesn't, name the `.returning()` result `updated`).

- [ ] **Step 5: Instrument `deleteCustomer`**

In the `deleteCustomer` handler, the delete pattern is:
1. Find the row by id (and assert org match — slice 22's defense-in-depth)
2. Delete it
3. Return ok

Activity emission for delete must happen **after** confirming the delete succeeded and BEFORE returning. CRITICALLY: capture `row.name` BEFORE the delete so the summary can reference it. The slice 22 code already does this `SELECT` for the cross-org check; reuse that variable.

Insert after the DELETE-returning-row pattern, before the return:

```ts
await recordActivitySafely(
  db,
  {
    orgId: session.orgId,
    actor: session.user,
    entityType: "customer",
    entityId: parsed.data.id,
    verb: "deleted",
    summary: `Deleted ${existing.name}`,
    payload: { name: existing.name },
  },
  { action: "customers.delete" },
);
```

Where `existing` is the row variable from the pre-delete SELECT (the slice 22 code already has one — verify the variable name matches and rename in your edit if needed).

- [ ] **Step 6: Run tsc to verify nothing broke**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 7: Extend `test/lib/customers/actions.test.ts` with activity assertions**

The existing file already has a truth-table covering create/update/delete authz. For each successful happy-path test, add an assertion that exactly one new `activity_events` row exists with the expected shape.

Pattern to add (do NOT change existing assertions — append after the existing happy-path body):

For the createCustomer-happy-path test:
```ts
const [actRow] = await db
  .select()
  .from(activityEvents)
  .where(eq(activityEvents.entityType, "customer"))
  .orderBy(desc(activityEvents.id));
expect(actRow).toMatchObject({
  orgId: <expectedOrgId>,
  entityType: "customer",
  entityId: <newCustomerId>,
  verb: "created",
});
expect(actRow.summary).toMatch(/^Added /);
```

For the updateCustomer-happy-path test:
```ts
const actRows = await db
  .select()
  .from(activityEvents)
  .where(and(eq(activityEvents.entityType, "customer"), eq(activityEvents.verb, "updated")));
expect(actRows.length).toBe(1);
expect((actRows[0]!.payload as Record<string, unknown>).changedFields).toBeInstanceOf(Array);
```

For the deleteCustomer-happy-path test:
```ts
const [actRow] = await db
  .select()
  .from(activityEvents)
  .where(and(eq(activityEvents.entityType, "customer"), eq(activityEvents.verb, "deleted")));
expect(actRow.summary).toMatch(/^Deleted /);
```

Top-of-file imports to add:
```ts
import { activityEvents } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
```

(`eq` may already be imported — check, don't duplicate.)

- [ ] **Step 8: Add a best-effort guarantee test in `test/lib/customers/actions.test.ts`**

At the end of the file, add a new `describe` block:

```ts
describe("createCustomer — audit best-effort", () => {
  it("still returns { ok: true } when recordActivitySafely throws", async () => {
    vi.doMock("@/lib/activity/recordActivitySafely", () => ({
      recordActivitySafely: vi.fn(() => Promise.reject(new Error("sentry boom"))),
    }));
    vi.resetModules();
    // Re-import the actions module so it picks up the doMock
    const actions = await import("@/lib/customers/actions");
    const db = await /* the existing freshDb helper used in this file */;
    // ... call createCustomer with valid input, assert result is { ok: true, id: <number> }
    // (Detailed test scaffold mirrors the existing happy-path setup in this file.)
    vi.doUnmock("@/lib/activity/recordActivitySafely");
  });
});
```

> **IMPORTANT — implementation note for the executing agent.** `recordActivitySafely` SWALLOWS internally — it should never re-throw. So this test verifies the contract: even if a future bug allowed it to throw, the action handler should still return ok. The action handler's `await recordActivitySafely(...)` is intentionally NOT wrapped in a try/catch because the wrapper guarantees no-throw. This test is the safety net for that guarantee.

If implementing the doMock-based test pattern proves fiddly in this codebase's existing test layout (the file may use a setup-per-describe pattern), an acceptable alternative: assert at the unit level that `recordActivitySafely` ALWAYS resolves with `undefined`, even when its inner `recordActivity` throws (this is already covered by Task A6's `recordActivitySafely.test.ts`). If you go with the alternative, add a one-line comment in `actions.test.ts` noting the guarantee lives in `recordActivitySafely.test.ts`.

- [ ] **Step 9: Run the customers test file to verify everything passes**

```bash
npx vitest run test/lib/customers/actions.test.ts
```

Expected: all existing tests still pass, plus the new activity assertions pass.

- [ ] **Step 10: Run the FULL test suite to confirm no regressions across the codebase**

Use the detached pattern (the wrapper-kill issue from slice 22 may still apply):

```bash
rm -f /tmp/slice24-final-vitest.log /tmp/slice24-final-vitest.done
nohup bash -c 'npx vitest run > /tmp/slice24-final-vitest.log 2>&1; echo "VITEST_EXIT=$?" > /tmp/slice24-final-vitest.done' > /dev/null 2>&1 & disown
```

Wait for `/tmp/slice24-final-vitest.done` to exist (use a `until [ -f ... ]; do sleep 10; done` watcher). Then:

```bash
cat /tmp/slice24-final-vitest.done
grep -E "Test Files|^      Tests|FAIL" /tmp/slice24-final-vitest.log | tail -10
```

Expected: `VITEST_EXIT=0` and `Test Files NN passed (NN)` `Tests MMM passed (MMM)` with zero failures. Total test count should be original 1071 + (5 migration smoke + 9 recordActivity + 10 reader + 3 safely + 6 demo seed integrity + 2 demo end-to-end + 3 customer instrumentation = 38 new) = 1109 tests. Allow ±3 if some count is approximate.

- [ ] **Step 11: tsc sanity**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 12: Commit**

```bash
git add src/lib/customers/actions.ts test/lib/customers/actions.test.ts
git commit -m "feat(customers): emit activity events on CRUD (slice 24 B1)"
```

---

## Plan completion checklist

After all tasks ship + are committed:

- [ ] `git log --oneline main..feature/slice-24-activity-feed` shows ~8 commits (one per task, plus the spec)
- [ ] `npx vitest run` exits 0 with ~1109 tests
- [ ] `npx tsc --noEmit` exits 0
- [ ] `drizzle/0017_*.sql` exists and is committed
- [ ] `src/lib/activity/` directory exists with `types.ts`, `recordActivity.ts`, `recordActivitySafely.ts`
- [ ] `src/db/activityEvents.ts` exists with `getOrgActivity` + `getEntityActivity` + demo-mode short-circuit
- [ ] `DEMO_ACTIVITY` is exported from `src/lib/demo/seed.ts` with 10 events
- [ ] `src/lib/customers/actions.ts` calls `recordActivitySafely` in all three handlers

When all are checked, slice 24 Phase A + B is ready for two-stage review (spec-compliance + code-quality) before merging to main. Phase C (UI + remaining action files) becomes slice 24b in the ROADMAP queue.
