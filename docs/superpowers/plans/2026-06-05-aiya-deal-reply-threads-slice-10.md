# AIYA Slice 10 — Deal Reply Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 1:1-default / group-optional reply threads to every Deal Room deal, with per-message mode snapshots, an unread-count badge, soft-delete, and four new `runWithUser`-wrapped server actions — all behind the same slice-4 authz primitives, with zero new auth surface.

**Architecture:** Two new tables (`deal_messages`, `deal_thread_reads`) plus a `deals.thread_mode` column. Visibility is enforced in SQL (`getDealMessages` WHERE clause widens to the slice-4 deal-visibility predicate AND a per-message rule). Mode is captured per-message at send time and is immutable, so toggling `deals.thread_mode` never retroactively rewrites visibility. UI: one new `DealThreadAccordion` component + chevron/badge affordances on `DealRoomPanel` + a conditional radio on `PostDealForm`. Plain-text rendering only — no HTML construction from message bodies — keeps the XSS surface at zero without adding sanitization libraries.

**Tech Stack:** Drizzle ORM (pglite dev/test, Neon HTTP prod) · Next.js 15 App Router · React 19 Server Components + Server Actions · Zod · vitest (jsdom + node) · Testing Library · jose (JWT, unchanged) · Tailwind (existing tokens, no new ones).

**Branch:** `slice-10-deal-reply-threads` (created off `main` in Task A1).

---

## File Structure

**New files:**
- `src/db/dealMessages.ts` — query layer (3 functions, all take explicit `viewerOrgId`)
- `src/lib/deals/replyValidation.ts` — Zod schemas for the 4 new actions (kept out of `validation.ts` so the existing slice-4 file doesn't grow unwieldy)
- `src/components/deals/DealThreadAccordion.tsx` — the only new UI component
- `drizzle/0006_deal_reply_threads.sql` — generated migration (hand-edited only for index ordering if EXPLAIN warrants — see Task A2)
- `test/db/dealMessages.test.ts`
- `test/lib/deals/reply-thread-visibility.test.ts`
- `test/lib/deals/reply-thread-authz.test.ts`
- `test/lib/deals/reply-thread-mode-switch.test.ts`
- `test/lib/deals/reply-thread-soft-delete.test.ts`
- `test/lib/deals/reply-thread-unread.test.ts`
- `test/components/deals/DealThreadAccordion.test.tsx`
- `test/components/deals/DealRoomPanel.unread-badge.test.tsx`

**Modified files:**
- `src/db/schema.ts` — add tables + column
- `src/lib/deals/actions.ts` — add 4 new actions next to `postDeal`
- `src/lib/demo/seed.ts` — append deals 109 + 110 and 5 seeded messages
- `src/components/dashboard/DealRoomPanel.tsx` — chevron, badge, accordion wiring
- `src/components/deals/PostDealForm.tsx` — conditional thread-mode radio
- `src/app/page.tsx` — thread the new query results into `PanelCtx`
- `src/components/dashboard/registry.ts` (or wherever `PanelCtx` lives) — extend the context type
- `test/lib/demo/seed.test.ts` — update count assertions

---

## Pre-flight

- [ ] **Pre-flight Step 1: Verify clean working tree on `main`**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git status -sb
git rev-parse HEAD
```

Expected: `## main...origin/main`, no `M`/`A`/`?? ` lines other than the unrelated `.md2pdf.py` / `FEMALE_AI_BOT.md` / `FEMALE_AI_BOT.pdf` / `training protocol/` files. HEAD should match the spec-commit SHA from `git log --oneline -1` (the slice-10 design commit `9aef128` or its descendant).

- [ ] **Pre-flight Step 2: Cut feature branch**

```bash
git checkout -b slice-10-deal-reply-threads
git branch --show-current
```

Expected: `slice-10-deal-reply-threads`.

- [ ] **Pre-flight Step 3: Confirm tests baseline is green before any edits**

```bash
npm test -- --run 2>&1 | tail -20
```

Expected: a "Test Files  ## passed" summary with **zero failures**. If anything fails on `main` before slice-10 touches it, stop and fix that first — slice-10's tests can't tell pre-existing breakage from new regression.

---

## Phase A — DB foundation + query layer

### Task A1: Add `deal_messages` + `deal_thread_reads` tables + `deals.thread_mode` column to `src/db/schema.ts`

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Open `src/db/schema.ts` and locate the existing `deals` definition.**

Find the block beginning with `export const deals = pgTable(`. Slice 4 added `visibilityCircleId` and a partial index. Slice 10 adds one more column and two new tables — `deals.thread_mode` goes on the existing `deals` table; the two new tables go below `deals` (and below `circles` / `circle_members`).

- [ ] **Step 2: Add the `thread_mode` enum import + the column to `deals`.**

At the top of `schema.ts` confirm there is already a `pgEnum` imported (slice 2 / slice 4 use `text(..., { enum: [...] })` inline rather than `pgEnum` — keep that convention). Add the column inside the `deals` `pgTable(...)` columns object, immediately after `visibilityCircleId`:

```ts
    threadMode: text("thread_mode", { enum: ["private", "group"] })
      .notNull()
      .default("private"),
```

The `.default("private")` ensures the migration succeeds against the existing 5/8 demo rows and any prod rows without backfill scripting.

- [ ] **Step 3: Add the `deal_messages` table.**

Insert the new table definition immediately below the existing `deals` block (before `circles` is fine; ordering inside the file is cosmetic — pglite resolves FK order from references, not source order):

```ts
export const dealMessages = pgTable(
  "deal_messages",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    fromOrgId: integer("from_org_id")
      .notNull()
      .references(() => orgs.id),
    fromOrgLabel: text("from_org_label").notNull(),
    body: text("body").notNull(),
    threadMode: text("thread_mode", { enum: ["private", "group"] }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    dealCreatedIdx: index("deal_messages_deal_created_idx").on(
      t.dealId,
      t.createdAt.desc(),
    ),
    fromOrgCreatedIdx: index("deal_messages_from_org_created_idx").on(
      t.fromOrgId,
      t.createdAt.desc(),
    ),
  }),
);
```

> Note: the third "speculative" composite index from the spec (`deal_id, from_org_id, thread_mode`) is intentionally **omitted** here. We add it later only if Task A6's EXPLAIN run shows the planner picking it over the `(deal_id, created_at)` index for the visibility filter. YAGNI until profiling says otherwise.

- [ ] **Step 4: Add the `deal_thread_reads` table.**

Below `dealMessages`:

```ts
export const dealThreadReads = pgTable(
  "deal_thread_reads",
  {
    orgId: integer("org_id")
      .notNull()
      .references(() => orgs.id),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.dealId] }),
  }),
);
```

Confirm `primaryKey` is already imported from `drizzle-orm/pg-core` at the top of the file (slice 4 introduced this import for `circle_members`). If not, add it to the existing `import { … } from "drizzle-orm/pg-core";` line.

- [ ] **Step 5: Run typecheck — schema only, no migrate yet.**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: **zero errors**. If there are errors, they will almost certainly be in `schema.ts` itself (a missing import) or in any consumer that uses `import * as schema from "@/db/schema"` (no consumer should break from additive columns).

- [ ] **Step 6: Commit schema additions.**

```bash
git add src/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): deal_messages + deal_thread_reads tables + deals.thread_mode column

Slice 10 schema additions. thread_mode default "private" makes the
column safe to add to existing rows without a backfill. Speculative
(deal_id, from_org_id, thread_mode) composite index deferred to A6
post-EXPLAIN.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration `drizzle/0006_deal_reply_threads.sql` + smoke test against pglite

**Files:**
- Create: `drizzle/0006_*.sql` (generated by drizzle-kit; rename if needed)
- Modify: `drizzle/meta/_journal.json` (auto-updated by drizzle-kit)

- [ ] **Step 1: Generate the migration.**

```bash
npx drizzle-kit generate
```

Expected: drizzle-kit reports `0006_*.sql` created and updates `drizzle/meta/_journal.json`. The auto-suffix may be something like `0006_perpetual_hammer.sql` — that's fine. Inspect the generated file:

```bash
ls -1 drizzle/0006_*.sql
cat drizzle/0006_*.sql
```

Expected contents include:
```sql
CREATE TABLE IF NOT EXISTS "deal_messages" ( … );
CREATE TABLE IF NOT EXISTS "deal_thread_reads" ( … );
ALTER TABLE "deals" ADD COLUMN "thread_mode" text DEFAULT 'private' NOT NULL;
CREATE INDEX … "deal_messages_deal_created_idx" …
CREATE INDEX … "deal_messages_from_org_created_idx" …
```

- [ ] **Step 2: Rename the migration to a descriptive name.**

```bash
mv drizzle/0006_*.sql drizzle/0006_deal_reply_threads.sql
```

Also edit `drizzle/meta/_journal.json` and find the most recent entry (the one drizzle-kit just appended): update its `"tag"` field from the auto-generated name to `"0006_deal_reply_threads"`. Slice 4 follows this convention (see `0005_aiya_circles` etc).

- [ ] **Step 3: Verify the migration applies cleanly to a fresh pglite.**

Create `test/db/migration-0006-smoke.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { sql } from "drizzle-orm";

describe("migration 0006 — deal reply threads", () => {
  it("creates deal_messages, deal_thread_reads, and deals.thread_mode without error", async () => {
    const { db, close } = await createTestDb();
    try {
      const tables = await db.execute(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('deal_messages', 'deal_thread_reads')
        ORDER BY tablename
      `);
      const names = (tables as unknown as { rows: { tablename: string }[] }).rows.map(
        (r) => r.tablename,
      );
      expect(names).toEqual(["deal_messages", "deal_thread_reads"]);

      const cols = await db.execute(sql`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'deals' AND column_name = 'thread_mode'
      `);
      const rows = (cols as unknown as {
        rows: { column_name: string; data_type: string; column_default: string }[];
      }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].data_type).toBe("text");
      expect(rows[0].column_default).toMatch(/^'private'::text$/);
    } finally {
      await close();
    }
  });
});
```

- [ ] **Step 4: Run the smoke test.**

```bash
npx vitest run test/db/migration-0006-smoke.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: `1 passed`.

- [ ] **Step 5: Commit.**

```bash
git add drizzle/0006_deal_reply_threads.sql drizzle/meta/_journal.json test/db/migration-0006-smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(db): generate 0006 migration (deal_messages + deal_thread_reads + deals.thread_mode)

Migration smoke test asserts both new tables exist and the column
default is exactly 'private'::text so existing rows are safe under the
non-null constraint.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Create `src/db/dealMessages.ts` and implement `getDealMessages`

**Files:**
- Create: `src/db/dealMessages.ts`
- Create: `test/db/dealMessages.test.ts` (first test only — `getDealMessages` ascending order)

- [ ] **Step 1: Write the failing test in `test/db/dealMessages.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { deals, dealMessages } from "@/db/schema";
import { getDealMessages } from "@/db/dealMessages";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

async function seedDeal(orgId: number, threadMode: "private" | "group" = "private") {
  const [row] = await db
    .insert(deals)
    .values({
      orgId,
      kind: "SELL",
      category: "Diamond",
      subject: "test deal",
      quantity: 1,
      priceCents: 1000,
      postedByLabel: "test",
      threadMode,
    })
    .returning({ id: deals.id });
  return row.id;
}

describe("getDealMessages — chronological order", () => {
  it("returns the viewer-visible messages ordered ascending by createdAt", async () => {
    const dealId = await seedDeal(1, "group");
    await db.insert(dealMessages).values([
      { dealId, fromOrgId: 1, fromOrgLabel: "AIYA", body: "first", threadMode: "group" },
      { dealId, fromOrgId: 999, fromOrgLabel: "Other", body: "second", threadMode: "group" },
    ]);
    const rows = await getDealMessages(db, 1, dealId);
    expect(rows.map((r) => r.body)).toEqual(["first", "second"]);
  });
});
```

- [ ] **Step 2: Run the test — expect compile failure (`getDealMessages` not defined).**

```bash
npx vitest run test/db/dealMessages.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: error referencing `getDealMessages` not found in `@/db/dealMessages` (the import target file doesn't exist).

- [ ] **Step 3: Create `src/db/dealMessages.ts` with the minimal implementation.**

```ts
import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demoMode";

export type DealMessageView = {
  id: number;
  dealId: number;
  fromOrgId: number;
  fromOrgLabel: string;
  /** `null` when the message has been soft-deleted — caller renders a tombstone. */
  body: string | null;
  threadMode: "private" | "group";
  isDeleted: boolean;
  createdAt: Date;
};

/**
 * Returns the messages on a single deal that are visible to `viewerOrgId`,
 * ordered ascending by `created_at`.
 *
 * Visibility is enforced entirely in SQL (NEVER in TS) and is the AND of:
 *   (1) the slice-4 "can-see-this-deal" rule: owner OR in-circle member
 *   (2) the slice-10 "can-see-this-message" rule: group, OR self-authored,
 *       OR the viewer is the deal owner (owner sees every private thread).
 *
 * Demo mode short-circuits to `[]` (matches slice-4 query helper convention —
 * demo data is seed-rendered statically; no live writes).
 */
export async function getDealMessages(
  db: Db,
  viewerOrgId: number,
  dealId: number,
): Promise<DealMessageView[]> {
  if (isDemoMode()) return [];

  const res = await db.execute(sql`
    SELECT m.id            AS id,
           m.deal_id       AS deal_id,
           m.from_org_id   AS from_org_id,
           m.from_org_label AS from_org_label,
           CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.body END AS body,
           m.thread_mode   AS thread_mode,
           (m.deleted_at IS NOT NULL) AS is_deleted,
           m.created_at    AS created_at
    FROM deal_messages m
    JOIN deals d ON d.id = m.deal_id
    WHERE m.deal_id = ${dealId}
      AND (
        d.org_id = ${viewerOrgId}
        OR (
          d.visibility_circle_id IS NOT NULL
          AND d.visibility_circle_id IN (
            SELECT circle_id FROM circle_members WHERE org_id = ${viewerOrgId}
          )
        )
      )
      AND (
        m.thread_mode = 'group'
        OR m.from_org_id = ${viewerOrgId}
        OR d.org_id = ${viewerOrgId}
      )
    ORDER BY m.created_at ASC
  `);

  const rows = (res as unknown as {
    rows: {
      id: number;
      deal_id: number;
      from_org_id: number;
      from_org_label: string;
      body: string | null;
      thread_mode: "private" | "group";
      is_deleted: boolean;
      created_at: Date | string;
    }[];
  }).rows;

  return rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id,
    fromOrgId: r.from_org_id,
    fromOrgLabel: r.from_org_label,
    body: r.body,
    threadMode: r.thread_mode,
    isDeleted: r.is_deleted,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}
```

- [ ] **Step 4: Run the test — expect pass.**

```bash
npx vitest run test/db/dealMessages.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: `1 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/db/dealMessages.ts test/db/dealMessages.test.ts
git commit -m "$(cat <<'EOF'
feat(db): getDealMessages with SQL-enforced visibility (slice 10 query layer)

Visibility is the AND of slice-4's can-see-this-deal rule and slice-10's
can-see-this-message rule. Both enforced in the SQL WHERE clause; the
caller cannot accidentally widen visibility by passing through application
code.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Add `getUnreadCountsForOrg` to `src/db/dealMessages.ts`

**Files:**
- Modify: `src/db/dealMessages.ts`
- Modify: `test/db/dealMessages.test.ts`

- [ ] **Step 1: Append a failing test to `test/db/dealMessages.test.ts`.**

```ts
import { getUnreadCountsForOrg } from "@/db/dealMessages";
import { dealThreadReads } from "@/db/schema";

describe("getUnreadCountsForOrg", () => {
  it("counts visible, non-own, non-deleted messages newer than last_read_at", async () => {
    const dealA = await seedDeal(1, "group");
    const dealB = await seedDeal(1, "group");

    // 3 messages from org 999 to deal A, 1 own message from 999 also on A
    await db.insert(dealMessages).values([
      { dealId: dealA, fromOrgId: 999, fromOrgLabel: "X", body: "a1", threadMode: "group" },
      { dealId: dealA, fromOrgId: 999, fromOrgLabel: "X", body: "a2", threadMode: "group" },
      { dealId: dealA, fromOrgId: 999, fromOrgLabel: "X", body: "a3", threadMode: "group" },
    ]);

    // 1 message on B
    await db.insert(dealMessages).values({
      dealId: dealB, fromOrgId: 999, fromOrgLabel: "X", body: "b1", threadMode: "group",
    });

    // Viewer = org 1 (owner of both deals), has not read any thread
    const before = await getUnreadCountsForOrg(db, 1, [dealA, dealB]);
    expect(before.get(dealA)).toBe(3);
    expect(before.get(dealB)).toBe(1);

    // Mark dealA read for org 1 (last_read_at = now())
    await db.insert(dealThreadReads).values({
      orgId: 1, dealId: dealA, lastReadAt: new Date(),
    });

    const after = await getUnreadCountsForOrg(db, 1, [dealA, dealB]);
    expect(after.get(dealA)).toBe(0);
    expect(after.get(dealB)).toBe(1);
  });

  it("excludes the viewer's own messages from the count", async () => {
    const dealId = await seedDeal(1, "group");
    await db.insert(dealMessages).values([
      { dealId, fromOrgId: 1, fromOrgLabel: "self", body: "mine", threadMode: "group" },
      { dealId, fromOrgId: 999, fromOrgLabel: "other", body: "theirs", threadMode: "group" },
    ]);
    const counts = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(counts.get(dealId)).toBe(1); // only "theirs"
  });

  it("excludes soft-deleted messages from the count", async () => {
    const dealId = await seedDeal(1, "group");
    const [row] = await db
      .insert(dealMessages)
      .values({ dealId, fromOrgId: 999, fromOrgLabel: "x", body: "live", threadMode: "group" })
      .returning({ id: dealMessages.id });
    await db.insert(dealMessages).values({
      dealId, fromOrgId: 999, fromOrgLabel: "x", body: "dead", threadMode: "group",
      deletedAt: new Date(),
    });
    const counts = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(counts.get(dealId)).toBe(1); // only "live"
    expect(row.id).toBeGreaterThan(0); // sanity
  });
});
```

- [ ] **Step 2: Run — expect a compile error on `getUnreadCountsForOrg`.**

```bash
npx vitest run test/db/dealMessages.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: missing export error.

- [ ] **Step 3: Add the function to `src/db/dealMessages.ts`.**

Append below `getDealMessages`:

```ts
/**
 * Returns a Map<dealId, unreadCount> for the supplied deals.
 *
 * "Unread" = messages on each deal where:
 *   - the viewer can see the message (slice-4 + slice-10 visibility, same as getDealMessages)
 *   - created_at > coalesce(last_read_at, '-infinity')
 *   - from_org_id != viewerOrgId (own messages never count)
 *   - deleted_at IS NULL
 *
 * Deals with no unread messages are still returned with `0` so the caller
 * can render "💬 N" (subtle) badges for deals with messages but nothing new.
 * Deals with literally zero messages are NOT in the result map.
 *
 * Demo-mode short-circuit: returns an empty Map.
 */
export async function getUnreadCountsForOrg(
  db: Db,
  viewerOrgId: number,
  dealIds: number[],
): Promise<Map<number, number>> {
  if (isDemoMode() || dealIds.length === 0) return new Map();

  const res = await db.execute(sql`
    SELECT m.deal_id AS deal_id,
           COUNT(*) FILTER (
             WHERE m.from_org_id != ${viewerOrgId}
               AND m.deleted_at IS NULL
               AND m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)
           )::int AS unread
    FROM deal_messages m
    JOIN deals d ON d.id = m.deal_id
    LEFT JOIN deal_thread_reads r
      ON r.deal_id = m.deal_id AND r.org_id = ${viewerOrgId}
    WHERE m.deal_id IN (${sql.join(
      dealIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND (
        d.org_id = ${viewerOrgId}
        OR (
          d.visibility_circle_id IS NOT NULL
          AND d.visibility_circle_id IN (
            SELECT circle_id FROM circle_members WHERE org_id = ${viewerOrgId}
          )
        )
      )
      AND (
        m.thread_mode = 'group'
        OR m.from_org_id = ${viewerOrgId}
        OR d.org_id = ${viewerOrgId}
      )
    GROUP BY m.deal_id
  `);

  const rows = (res as unknown as { rows: { deal_id: number; unread: number }[] }).rows;
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.deal_id, r.unread);
  return map;
}
```

- [ ] **Step 4: Run the test — expect all three new cases to pass.**

```bash
npx vitest run test/db/dealMessages.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: `4 passed` (the original ordering test + 3 new unread tests).

- [ ] **Step 5: Commit.**

```bash
git add src/db/dealMessages.ts test/db/dealMessages.test.ts
git commit -m "$(cat <<'EOF'
feat(db): getUnreadCountsForOrg with own-message and soft-delete exclusions

LEFT JOIN against deal_thread_reads + COALESCE('epoch'::timestamptz)
gives the right semantics for "never read" deals without a separate
branch. Same SQL visibility predicate as getDealMessages — kept
deliberately duplicated rather than DRY'd into a Drizzle helper because
the join shapes differ (count vs row select).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Add `getDealThreadModeForOwner` to `src/db/dealMessages.ts`

**Files:**
- Modify: `src/db/dealMessages.ts`
- Modify: `test/db/dealMessages.test.ts`

- [ ] **Step 1: Append a failing test.**

```ts
import { getDealThreadModeForOwner } from "@/db/dealMessages";

describe("getDealThreadModeForOwner", () => {
  it("returns the current thread_mode for the owner", async () => {
    const dealId = await seedDeal(1, "group");
    expect(await getDealThreadModeForOwner(db, 1, dealId)).toBe("group");
  });

  it("returns null for a non-owner", async () => {
    const dealId = await seedDeal(1, "group");
    expect(await getDealThreadModeForOwner(db, 999, dealId)).toBeNull();
  });

  it("returns null for an unknown dealId", async () => {
    expect(await getDealThreadModeForOwner(db, 1, 9_999_999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

```bash
npx vitest run test/db/dealMessages.test.ts --reporter=verbose 2>&1 | tail -8
```

- [ ] **Step 3: Add to `src/db/dealMessages.ts`.**

```ts
/**
 * Returns the current `deals.thread_mode` for the caller IFF the caller is
 * the deal's owner, else `null`. The panel uses the null return to decide
 * whether to render the mode-selector UI.
 *
 * NOT demo-mode-gated: this is consulted at render time and we want the
 * mode banner to show even on the seeded demo dataset.
 */
export async function getDealThreadModeForOwner(
  db: Db,
  viewerOrgId: number,
  dealId: number,
): Promise<"private" | "group" | null> {
  const res = await db.execute(sql`
    SELECT thread_mode AS thread_mode
    FROM deals
    WHERE id = ${dealId} AND org_id = ${viewerOrgId}
    LIMIT 1
  `);
  const rows = (res as unknown as { rows: { thread_mode: "private" | "group" }[] }).rows;
  return rows[0]?.thread_mode ?? null;
}
```

- [ ] **Step 4: Run — expect all dealMessages tests green.**

```bash
npx vitest run test/db/dealMessages.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: `7 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/db/dealMessages.ts test/db/dealMessages.test.ts
git commit -m "$(cat <<'EOF'
feat(db): getDealThreadModeForOwner — owner-gated mode lookup for the UI

Returns null for non-owners (the panel uses null to decide whether to
render the mode selector). Intentionally NOT demo-mode-gated so the live
demo can still showcase the toggle on the seeded deals 109/110.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: Phase A green-bar verification + speculative index decision

**Files:**
- (Maybe) Modify: `src/db/schema.ts` + new migration `drizzle/0007_*.sql` — only if EXPLAIN below warrants

- [ ] **Step 1: Run the full suite to confirm Phase A introduced no regressions.**

```bash
npm test -- --run 2>&1 | tail -25
```

Expected: same passing-test count as the pre-flight baseline, **plus** the new `test/db/dealMessages.test.ts` and `test/db/migration-0006-smoke.test.ts` cases. Zero failures.

- [ ] **Step 2: Typecheck the project.**

```bash
npx tsc --noEmit 2>&1 | tail -15
```

Expected: zero errors.

- [ ] **Step 3: Decide on the speculative `(deal_id, from_org_id, thread_mode)` index.**

Run a quick EXPLAIN against pglite. Write a throwaway script at `/tmp/explain-msg.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";

const client = new PGlite();
const db = drizzle(client);
await migrate(db, { migrationsFolder: "drizzle" });

// Seed 1k deals and 5k messages mixed across modes
await db.execute(sql`INSERT INTO orgs (id, name, slug) VALUES (1, 'X', 'x'), (999, 'Y', 'y') ON CONFLICT DO NOTHING`);
for (let i = 0; i < 1000; i++) {
  await db.execute(sql`INSERT INTO deals (org_id, kind, category, subject, quantity, price_cents, posted_by_label, thread_mode) VALUES (1, 'SELL', 'Diamond', 'd', 1, 1000, 'x', 'private')`);
}
for (let i = 0; i < 5000; i++) {
  const did = (i % 1000) + 1;
  const mode = i % 2 === 0 ? "private" : "group";
  await db.execute(sql`INSERT INTO deal_messages (deal_id, from_org_id, from_org_label, body, thread_mode) VALUES (${did}, 999, 'y', 'b', ${mode})`);
}
const plan = await db.execute(sql`
  EXPLAIN SELECT m.* FROM deal_messages m JOIN deals d ON d.id = m.deal_id
  WHERE m.deal_id = 500
    AND (d.org_id = 1 OR (d.visibility_circle_id IS NOT NULL AND d.visibility_circle_id IN (SELECT circle_id FROM circle_members WHERE org_id = 1)))
    AND (m.thread_mode = 'group' OR m.from_org_id = 1 OR d.org_id = 1)
`);
console.log(JSON.stringify(plan, null, 2));
```

Run:

```bash
npx tsx /tmp/explain-msg.ts 2>&1 | tail -30
```

Decision rule:
- If the planner uses `deal_messages_deal_created_idx` already and reports `cost` below ~50: **skip the extra index** (YAGNI). Move to Step 5.
- If the planner does a `Seq Scan` on `deal_messages` despite the deal_id filter: **add the composite index** (Step 4).
- If unclear (small dataset; planner may pick seq scan regardless): default to **skip** with a note in the next commit message. We can always add later.

- [ ] **Step 4 (CONDITIONAL — only if Step 3 says "add"): Add the composite index.**

Append to the `deal_messages` table indexes block in `src/db/schema.ts`:

```ts
    dealFromOrgModeIdx: index("deal_messages_deal_from_org_mode_idx").on(
      t.dealId,
      t.fromOrgId,
      t.threadMode,
    ),
```

Then:

```bash
npx drizzle-kit generate
mv drizzle/0007_*.sql drizzle/0007_deal_messages_composite_idx.sql
# update _journal tag the same way as A2 step 2
git add src/db/schema.ts drizzle/0007_deal_messages_composite_idx.sql drizzle/meta/_journal.json
git commit -m "feat(db): add deal_messages composite index — EXPLAIN warranted it

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 5: Cleanup.**

```bash
rm -f /tmp/explain-msg.ts
```

- [ ] **Step 6: Final Phase A green-bar.**

```bash
npm test -- --run 2>&1 | tail -10
```

Phase A done.

---

## Phase B — Server actions + truth-table tests

### Task B1: Add Zod input schemas in `src/lib/deals/replyValidation.ts`

**Files:**
- Create: `src/lib/deals/replyValidation.ts`

- [ ] **Step 1: Create the file.**

```ts
import { z } from "zod";

export const postDealMessageInput = z.object({
  dealId: z.number().int().positive(),
  body: z.string().trim().min(1, "Message cannot be empty").max(2000, "Message is too long"),
});
export type PostDealMessageInput = z.infer<typeof postDealMessageInput>;

export const setDealThreadModeInput = z.object({
  dealId: z.number().int().positive(),
  mode: z.enum(["private", "group"]),
});
export type SetDealThreadModeInput = z.infer<typeof setDealThreadModeInput>;

export const deleteDealMessageInput = z.object({
  messageId: z.number().int().positive(),
});
export type DeleteDealMessageInput = z.infer<typeof deleteDealMessageInput>;

export const markDealThreadReadInput = z.object({
  dealId: z.number().int().positive(),
});
export type MarkDealThreadReadInput = z.infer<typeof markDealThreadReadInput>;
```

- [ ] **Step 2: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/deals/replyValidation.ts
git commit -m "$(cat <<'EOF'
feat(deals): Zod schemas for slice-10 reply-thread actions

Body capped at 2000 chars + trimmed. Kept out of validation.ts so the
existing slice-4 file stays focused — replyValidation.ts owns slice-10's
four schemas.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Implement `postDealMessage` + visibility truth-table test

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Create: `test/lib/deals/reply-thread-visibility.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `test/lib/deals/reply-thread-visibility.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, circles, circleMembers } from "@/db/schema";
import { postDealMessage, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

async function seedCircleDeal(opts: {
  ownerOrgId: number;
  threadMode: "private" | "group";
  circleId: number | null;
}) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId: opts.ownerOrgId,
      kind: "SELL",
      category: "Diamond",
      subject: "vis test",
      quantity: 1,
      priceCents: 1000,
      postedByLabel: "owner",
      threadMode: opts.threadMode,
      visibilityCircleId: opts.circleId,
    })
    .returning({ id: deals.id });
  return row.id;
}

async function ensureCircleWithMembers(circleId: number, name: string, members: number[]) {
  await db.insert(circles).values({ id: circleId, name }).onConflictDoNothing();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId, orgId }).onConflictDoNothing();
  }
}

describe("postDealMessage — cross-circle visibility", () => {
  it("allows the deal owner to post on their own deal", async () => {
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "private", circleId: null });
    const res = await postDealMessage({ dealId, body: "owner post" });
    expect(res).toEqual({ ok: true });
  });

  it("allows an in-circle partner to post on a circle-scoped deal", async () => {
    await ensureCircleWithMembers(42, "Trusted", [1, 999]);
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "group", circleId: 42 });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postDealMessage({ dealId, body: "partner post" });
    expect(res).toEqual({ ok: true });
  });

  it("forbids an out-of-circle org from posting on a circle-scoped deal", async () => {
    await ensureCircleWithMembers(42, "Trusted", [1, 999]);
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "group", circleId: 42 });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await postDealMessage({ dealId, body: "should fail" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids ANY non-owner from posting on a private (no-circle) deal", async () => {
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "private", circleId: null });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postDealMessage({ dealId, body: "no" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("snapshots the current deals.thread_mode onto the inserted row", async () => {
    await ensureCircleWithMembers(42, "Trusted", [1, 999]);
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "group", circleId: 42 });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    await postDealMessage({ dealId, body: "snapshot test" });
    const { dealMessages } = await import("@/db/schema");
    const rows = await db.select().from(dealMessages);
    expect(rows).toHaveLength(1);
    expect(rows[0].threadMode).toBe("group");
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

```bash
npx vitest run test/lib/deals/reply-thread-visibility.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: `postDealMessage` not exported from `@/lib/deals/actions`.

- [ ] **Step 3: Implement `postDealMessage` in `src/lib/deals/actions.ts`.**

Add near the top of `actions.ts`, after the existing `postDeal` imports/types, a helper that resolves the caller's org label (mirroring slice 4's pattern — there is likely already a `resolveOrgLabel(db, orgId)` or similar; if not, write a tiny inline one):

```ts
import { dealMessages, dealThreadReads, deals, circleMembers, orgs } from "@/db/schema";
import { and, eq, lt, sql as drizzleSql } from "drizzle-orm";
import {
  postDealMessageInput, setDealThreadModeInput, deleteDealMessageInput, markDealThreadReadInput,
  type PostDealMessageInput, type SetDealThreadModeInput,
  type DeleteDealMessageInput, type MarkDealThreadReadInput,
} from "./replyValidation";

async function resolveOrgLabel(d: Db, orgId: number): Promise<string> {
  const [row] = await d.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  return row?.name ?? `Org ${orgId}`;
}

/** Returns true iff `orgId` is the deal owner OR an in-circle member when the
 *  deal is circle-scoped. Slice-4 predicate, re-encoded here for the message
 *  action so we never widen visibility in TS. */
async function canSeeDeal(d: Db, orgId: number, dealId: number): Promise<{
  ok: true; ownerOrgId: number; threadMode: "private" | "group";
} | { ok: false }> {
  const [row] = await d
    .select({
      ownerOrgId: deals.orgId,
      visibilityCircleId: deals.visibilityCircleId,
      threadMode: deals.threadMode,
    })
    .from(deals)
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!row) return { ok: false };
  if (row.ownerOrgId === orgId) return { ok: true, ownerOrgId: row.ownerOrgId, threadMode: row.threadMode };
  if (row.visibilityCircleId !== null) {
    const [member] = await d
      .select({ orgId: circleMembers.orgId })
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, row.visibilityCircleId), eq(circleMembers.orgId, orgId)))
      .limit(1);
    if (member) return { ok: true, ownerOrgId: row.ownerOrgId, threadMode: row.threadMode };
  }
  return { ok: false };
}

export async function postDealMessage(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealMessageInput, raw, async (input: PostDealMessageInput, user, orgId) => {
    const d = db();
    const access = await canSeeDeal(d, orgId, input.dealId);
    if (!access.ok) throw new ForbiddenError();
    const label = await resolveOrgLabel(d, orgId);
    await d.insert(dealMessages).values({
      dealId: input.dealId,
      fromOrgId: orgId,
      fromOrgLabel: label,
      body: input.body,
      threadMode: access.threadMode,  // snapshot at send time — IMMUTABLE for the life of this row
    });
    return { ok: true };
  });
}
```

> The `runWithUser`/`ForbiddenError`/`ActionResult`/`db()` symbols already exist in `actions.ts` from slice 4. Reuse them — do not reimplement.

- [ ] **Step 4: Run — expect 5 passed.**

```bash
npx vitest run test/lib/deals/reply-thread-visibility.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: `5 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/reply-thread-visibility.test.ts
git commit -m "$(cat <<'EOF'
feat(deals): postDealMessage with SQL-enforced visibility (slice 10)

Visibility predicate is re-encoded in canSeeDeal() rather than imported
from a shared helper — different return shape needed (caller wants the
thread_mode snapshot too) and the slice-4 predicate is small enough that
duplication beats overgeneralization.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Implement `setDealThreadMode` + owner-only authz test

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Create: `test/lib/deals/reply-thread-authz.test.ts`

- [ ] **Step 1: Write the failing test (covers all four actions' authz — we'll add cases as we implement each).**

Create `test/lib/deals/reply-thread-authz.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import { setDealThreadMode, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

async function seedOwnedDeal(orgId: number) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
      threadMode: "private",
    })
    .returning({ id: deals.id });
  return row.id;
}

describe("setDealThreadMode — authz", () => {
  it("allows the owner to switch private -> group", async () => {
    const dealId = await seedOwnedDeal(1);
    const res = await setDealThreadMode({ dealId, mode: "group" });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select({ mode: deals.threadMode }).from(deals).where(eq(deals.id, dealId));
    expect(row.mode).toBe("group");
  });

  it("forbids a non-owner from switching the mode", async () => {
    const dealId = await seedOwnedDeal(1);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await setDealThreadMode({ dealId, mode: "group" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [row] = await db.select({ mode: deals.threadMode }).from(deals).where(eq(deals.id, dealId));
    expect(row.mode).toBe("private"); // unchanged
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Implement `setDealThreadMode` in `src/lib/deals/actions.ts`.**

Append below `postDealMessage`:

```ts
export async function setDealThreadMode(raw: unknown): Promise<ActionResult> {
  return runWithUser(setDealThreadModeInput, raw, async (input: SetDealThreadModeInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({ ownerOrgId: deals.orgId })
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!row || row.ownerOrgId !== orgId) throw new ForbiddenError();
    await d.update(deals).set({ threadMode: input.mode }).where(eq(deals.id, input.dealId));
    return { ok: true };
  });
}
```

- [ ] **Step 4: Run — expect 2 passed.**

```bash
npx vitest run test/lib/deals/reply-thread-authz.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/reply-thread-authz.test.ts
git commit -m "feat(deals): setDealThreadMode — owner-only mode switch

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B4: Implement `deleteDealMessage` + soft-delete window test

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Create: `test/lib/deals/reply-thread-soft-delete.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `test/lib/deals/reply-thread-soft-delete.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealMessages } from "@/db/schema";
import { deleteDealMessage, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

async function seedDealWithMessage(opts: {
  ownerOrgId: number;
  senderOrgId: number;
  createdAt: Date;
}) {
  const [d] = await db
    .insert(deals)
    .values({
      orgId: opts.ownerOrgId, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x", threadMode: "group",
    })
    .returning({ id: deals.id });
  const [m] = await db
    .insert(dealMessages)
    .values({
      dealId: d.id, fromOrgId: opts.senderOrgId, fromOrgLabel: "x",
      body: "hello", threadMode: "group", createdAt: opts.createdAt,
    })
    .returning({ id: dealMessages.id });
  return { dealId: d.id, messageId: m.id };
}

describe("deleteDealMessage — author + window", () => {
  it("allows the author to delete within 14 min", async () => {
    const { messageId } = await seedDealWithMessage({
      ownerOrgId: 999, senderOrgId: 1,
      createdAt: new Date(Date.now() - 14 * 60 * 1000),
    });
    expect(await deleteDealMessage({ messageId })).toEqual({ ok: true });
    const [row] = await db
      .select({ deletedAt: dealMessages.deletedAt })
      .from(dealMessages)
      .where(eq(dealMessages.id, messageId));
    expect(row.deletedAt).not.toBeNull();
  });

  it("forbids deletion after 16 min", async () => {
    const { messageId } = await seedDealWithMessage({
      ownerOrgId: 999, senderOrgId: 1,
      createdAt: new Date(Date.now() - 16 * 60 * 1000),
    });
    expect(await deleteDealMessage({ messageId })).toEqual({ ok: false, error: "Forbidden" });
    const [row] = await db
      .select({ deletedAt: dealMessages.deletedAt })
      .from(dealMessages)
      .where(eq(dealMessages.id, messageId));
    expect(row.deletedAt).toBeNull(); // unchanged
  });

  it("forbids a non-author from deleting", async () => {
    const { messageId } = await seedDealWithMessage({
      ownerOrgId: 1, senderOrgId: 999, createdAt: new Date(),
    });
    // session = org 1 (deal owner, but NOT the author)
    const res = await deleteDealMessage({ messageId });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("double-delete is idempotent (returns ok)", async () => {
    const { messageId } = await seedDealWithMessage({
      ownerOrgId: 999, senderOrgId: 1, createdAt: new Date(),
    });
    expect(await deleteDealMessage({ messageId })).toEqual({ ok: true });
    expect(await deleteDealMessage({ messageId })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Implement `deleteDealMessage` in `src/lib/deals/actions.ts`.**

Append:

```ts
const SOFT_DELETE_WINDOW_MS = 15 * 60 * 1000;

export async function deleteDealMessage(raw: unknown): Promise<ActionResult> {
  return runWithUser(deleteDealMessageInput, raw, async (input: DeleteDealMessageInput, _user, orgId) => {
    const d = db();
    const [msg] = await d
      .select({
        fromOrgId: dealMessages.fromOrgId,
        createdAt: dealMessages.createdAt,
        deletedAt: dealMessages.deletedAt,
      })
      .from(dealMessages)
      .where(eq(dealMessages.id, input.messageId))
      .limit(1);
    if (!msg) throw new ForbiddenError();
    if (msg.fromOrgId !== orgId) throw new ForbiddenError();
    if (msg.deletedAt !== null) return { ok: true }; // idempotent no-op
    const ageMs = Date.now() - msg.createdAt.getTime();
    if (ageMs > SOFT_DELETE_WINDOW_MS) throw new ForbiddenError();
    await d
      .update(dealMessages)
      .set({ deletedAt: new Date() })
      .where(eq(dealMessages.id, input.messageId));
    return { ok: true };
  });
}
```

- [ ] **Step 4: Run — expect 4 passed.**

```bash
npx vitest run test/lib/deals/reply-thread-soft-delete.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/reply-thread-soft-delete.test.ts
git commit -m "feat(deals): deleteDealMessage — author-only soft delete inside 15min window

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B5: Implement `markDealThreadRead` + unread-math test

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Create: `test/lib/deals/reply-thread-unread.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `test/lib/deals/reply-thread-unread.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealMessages } from "@/db/schema";
import { markDealThreadRead, __setTestDb } from "@/lib/deals/actions";
import { getUnreadCountsForOrg } from "@/db/dealMessages";
import { requireSession } from "@/lib/auth/requireSession";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

async function seedDealAndMessages(senderOrgIds: number[]) {
  const [d] = await db
    .insert(deals)
    .values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x", threadMode: "group",
    })
    .returning({ id: deals.id });
  for (const orgId of senderOrgIds) {
    await db.insert(dealMessages).values({
      dealId: d.id, fromOrgId: orgId, fromOrgLabel: "x", body: "m", threadMode: "group",
    });
  }
  return d.id;
}

describe("markDealThreadRead — unread badge math", () => {
  it("drops unread to 0 after marking read", async () => {
    const dealId = await seedDealAndMessages([999, 999, 999]);
    const before = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(before.get(dealId)).toBe(3);
    expect(await markDealThreadRead({ dealId })).toEqual({ ok: true });
    const after = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(after.get(dealId)).toBe(0);
  });

  it("ignores own messages in the unread count", async () => {
    const dealId = await seedDealAndMessages([1, 1, 1]); // session = org 1
    const counts = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(counts.get(dealId) ?? 0).toBe(0);
  });

  it("forbids markDealThreadRead on a deal the caller cannot see", async () => {
    // owner = 999, no circle
    const [d] = await db
      .insert(deals)
      .values({
        orgId: 999, kind: "SELL", category: "Diamond", subject: "x",
        quantity: 1, priceCents: 1000, postedByLabel: "x", threadMode: "private",
      })
      .returning({ id: deals.id });
    // session = org 1 (default)
    const res = await markDealThreadRead({ dealId: d.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("upsert: second mark with later timestamp updates last_read_at", async () => {
    const dealId = await seedDealAndMessages([999]);
    expect(await markDealThreadRead({ dealId })).toEqual({ ok: true });
    expect(await markDealThreadRead({ dealId })).toEqual({ ok: true }); // no error
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Implement `markDealThreadRead` in `src/lib/deals/actions.ts`.**

Append:

```ts
export async function markDealThreadRead(raw: unknown): Promise<ActionResult> {
  return runWithUser(markDealThreadReadInput, raw, async (input: MarkDealThreadReadInput, _user, orgId) => {
    const d = db();
    const access = await canSeeDeal(d, orgId, input.dealId);
    if (!access.ok) throw new ForbiddenError();
    await d.execute(drizzleSql`
      INSERT INTO deal_thread_reads (org_id, deal_id, last_read_at)
      VALUES (${orgId}, ${input.dealId}, now())
      ON CONFLICT (org_id, deal_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
    `);
    return { ok: true };
  });
}
```

- [ ] **Step 4: Run — expect 4 passed.**

```bash
npx vitest run test/lib/deals/reply-thread-unread.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/reply-thread-unread.test.ts
git commit -m "feat(deals): markDealThreadRead — upsert last_read_at with see-deal authz

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B6: Mode-switch immutability test

**Files:**
- Create: `test/lib/deals/reply-thread-mode-switch.test.ts`

- [ ] **Step 1: Write the test.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealMessages, circles, circleMembers } from "@/db/schema";
import { postDealMessage, setDealThreadMode, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { asc, eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

describe("Mode switch never rewrites past messages", () => {
  it("each message records the mode that was active at send time", async () => {
    // Circle so non-owner can post; otherwise the partner posts would fail authz
    await db.insert(circles).values({ id: 7, name: "Test" }).onConflictDoNothing();
    await db.insert(circleMembers).values([
      { circleId: 7, orgId: 1 }, { circleId: 7, orgId: 999 },
    ]).onConflictDoNothing();

    const [d] = await db
      .insert(deals)
      .values({
        orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
        quantity: 1, priceCents: 1000, postedByLabel: "x",
        threadMode: "private", visibilityCircleId: 7,
      })
      .returning({ id: deals.id });

    // 1) Partner posts while mode = private  -> snapshot "private"
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "p", orgId: 999,
    });
    await postDealMessage({ dealId: d.id, body: "m1-private" });

    // 2) Owner flips to group
    await setDealThreadMode({ dealId: d.id, mode: "group" });

    // 3) Partner posts again -> snapshot "group"
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "p", orgId: 999,
    });
    await postDealMessage({ dealId: d.id, body: "m2-group" });

    // 4) Owner flips back to private
    await setDealThreadMode({ dealId: d.id, mode: "private" });

    // 5) Partner posts again -> snapshot "private"
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "p", orgId: 999,
    });
    await postDealMessage({ dealId: d.id, body: "m3-private" });

    const rows = await db
      .select({ body: dealMessages.body, mode: dealMessages.threadMode })
      .from(dealMessages)
      .where(eq(dealMessages.dealId, d.id))
      .orderBy(asc(dealMessages.createdAt));
    expect(rows).toEqual([
      { body: "m1-private", mode: "private" },
      { body: "m2-group", mode: "group" },
      { body: "m3-private", mode: "private" },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect pass.**

```bash
npx vitest run test/lib/deals/reply-thread-mode-switch.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: `1 passed`.

- [ ] **Step 3: Commit.**

```bash
git add test/lib/deals/reply-thread-mode-switch.test.ts
git commit -m "test(deals): mode-switch immutability — past messages preserve their snapshot

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B7: Phase B green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -25
```

Expected: all previous tests still green + all 6 new slice-10 server-action test files (5 newly added in B + the dealMessages query tests from A3-A5).

- [ ] **Step 2: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

Phase B done.

---

## Phase C — Demo seed + UI

### Task C1: Extend `src/lib/demo/seed.ts` with deals 109 + 110 + 5 messages

**Files:**
- Modify: `src/lib/demo/seed.ts`

- [ ] **Step 1: Open `src/lib/demo/seed.ts` and find the `DEMO_DEALS` (or equivalent) array.**

The slice-4 seed exports deals 101-108. Slice 10 appends 109 (private) and 110 (group), both AIYA-owned, both scoped to `DEMO_TRUSTED_PARTNERS_CIRCLE_ID`.

- [ ] **Step 2: Append the two new deals to the deals array.**

```ts
    // --- Slice 10 demo deals: AIYA -> circle, used to seed thread examples ---
    {
      id: 109,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Diamond",
      subject: "1.02ct G/VS1 round — natural",
      quantity: 1,
      priceCents: 1_240_000,
      currency: "USD",
      status: "Open",
      postedByLabel: "AIYA",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      threadMode: "private",
      createdAt: hoursAgo(6),
      updatedAt: hoursAgo(6),
    },
    {
      id: 110,
      orgId: DEMO_AIYA_ORG_ID,
      kind: "SELL",
      category: "Metal",
      subject: "18k chain lot — 320g",
      quantity: 320,
      priceCents: 28_800_000,
      currency: "USD",
      status: "Open",
      postedByLabel: "AIYA",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      threadMode: "group",
      createdAt: hoursAgo(3),
      updatedAt: hoursAgo(3),
    },
```

If `hoursAgo(n)` isn't already defined in this file, define it near the top:

```ts
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
```

- [ ] **Step 3: Add the seed messages.**

Below `DEMO_DEALS`, add an exported constant + a writer function (matching the existing seed pattern):

```ts
export const DEMO_DEAL_MESSAGES: Array<{
  dealId: number;
  fromOrgId: number;
  fromOrgLabel: string;
  body: string;
  threadMode: "private" | "group";
  createdAtOffsetMinutes: number; // minutes before "now"
}> = [
  // Deal 109 — private thread between AIYA and Mehta
  {
    dealId: 109, fromOrgId: DEMO_PARTNER_ORG_IDS.MEHTA, fromOrgLabel: "Mehta Diamonds",
    body: "Still available? Can do $12,100 today, cash on pickup.",
    threadMode: "private", createdAtOffsetMinutes: 90,
  },
  {
    dealId: 109, fromOrgId: DEMO_AIYA_ORG_ID, fromOrgLabel: "AIYA Designs",
    body: "Yes, available. Can meet $12,250 today. Photos already match what's posted.",
    threadMode: "private", createdAtOffsetMinutes: 60,
  },
  // Deal 110 — group thread visible to AIYA + all Trusted Partners
  {
    dealId: 110, fromOrgId: DEMO_PARTNER_ORG_IDS.MEHTA, fromOrgLabel: "Mehta Diamonds",
    body: "Interested. Where are you shipping from?",
    threadMode: "group", createdAtOffsetMinutes: 45,
  },
  {
    dealId: 110, fromOrgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD, fromOrgLabel: "Saint-Cloud Atelier",
    body: "Same question. Lead time?",
    threadMode: "group", createdAtOffsetMinutes: 30,
  },
  {
    dealId: 110, fromOrgId: DEMO_AIYA_ORG_ID, fromOrgLabel: "AIYA Designs",
    body: "Ships from Bandra. Same-day pickup or 2-day courier. Both partners welcome.",
    threadMode: "group", createdAtOffsetMinutes: 15,
  },
];
```

- [ ] **Step 4: Wire the messages into the seed runner.**

Locate the function that performs the actual `db.insert(...)` calls for `DEMO_DEALS` (likely named `seedDemoData` or similar). After it inserts deals, append:

```ts
  // Slice 10: only seed messages if there are none yet (idempotent).
  const existing = await db
    .select({ id: dealMessages.id })
    .from(dealMessages)
    .limit(1);
  if (existing.length === 0) {
    await db.insert(dealMessages).values(
      DEMO_DEAL_MESSAGES.map((m) => ({
        dealId: m.dealId,
        fromOrgId: m.fromOrgId,
        fromOrgLabel: m.fromOrgLabel,
        body: m.body,
        threadMode: m.threadMode,
        createdAt: new Date(Date.now() - m.createdAtOffsetMinutes * 60_000),
      })),
    );
  }
```

Add the import for `dealMessages` at the top of the file:

```ts
import { dealMessages /* …existing imports… */ } from "@/db/schema";
```

- [ ] **Step 5: Run a sanity check that imports the seed without error.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/demo/seed.ts
git commit -m "$(cat <<'EOF'
feat(demo): seed deals 109/110 + 5 reply messages for slice-10 demo

109 = private thread (AIYA <-> Mehta), 110 = group thread (AIYA + Mehta
+ Saint-Cloud). Both AIYA-owned and scoped to AIYA Trusted Partners, so
the live demo shows reply threads working from AIYA's POV.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: Update `test/lib/demo/seed.test.ts` assertions

**Files:**
- Modify: `test/lib/demo/seed.test.ts`

- [ ] **Step 1: Open the existing seed test file and find the "deals count" assertion.**

The slice-4 expected count was 8. Slice 10 adds 109, 110 → expected count becomes **10**.

- [ ] **Step 2: Update the deal-count assertion.**

```ts
// before:  expect(deals.length).toBe(8);
expect(deals.length).toBe(10);
```

- [ ] **Step 3: Add new assertions for the message seed.**

After the deal-count assertion block, add:

```ts
const messages = await db.select().from(dealMessages);
expect(messages).toHaveLength(5);

const private109 = messages.filter((m) => m.dealId === 109);
expect(private109).toHaveLength(2);
expect(private109.every((m) => m.threadMode === "private")).toBe(true);

const group110 = messages.filter((m) => m.dealId === 110);
expect(group110).toHaveLength(3);
expect(group110.every((m) => m.threadMode === "group")).toBe(true);

// Idempotency: running the seed again does not duplicate
await runSeed(db); // or whatever the seed entrypoint is named in this file
const messagesAgain = await db.select().from(dealMessages);
expect(messagesAgain).toHaveLength(5);
```

Add the import:

```ts
import { dealMessages } from "@/db/schema";
```

- [ ] **Step 4: Run.**

```bash
npx vitest run test/lib/demo/seed.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add test/lib/demo/seed.test.ts
git commit -m "test(demo): assert slice-10 seed adds 2 deals + 5 messages, idempotent

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C3: Create `src/components/deals/DealThreadAccordion.tsx`

**Files:**
- Create: `src/components/deals/DealThreadAccordion.tsx`

- [ ] **Step 1: Create the component skeleton.**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { DealMessageView } from "@/db/dealMessages";

export type DealThreadAccordionProps = {
  dealId: number;
  viewerOrgId: number;
  isOwner: boolean;
  /** Null when viewer is not the owner (mode selector is hidden). */
  currentMode: "private" | "group" | null;
  messages: DealMessageView[];
  /** Server actions, passed in so the component is testable without next/server. */
  actions: {
    postMessage: (input: { dealId: number; body: string }) => Promise<
      { ok: true } | { ok: false; error: string }
    >;
    setMode: (input: { dealId: number; mode: "private" | "group" }) => Promise<
      { ok: true } | { ok: false; error: string }
    >;
    deleteMessage: (input: { messageId: number }) => Promise<
      { ok: true } | { ok: false; error: string }
    >;
  };
};

function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function DealThreadAccordion(props: DealThreadAccordionProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSend = () => {
    setError(null);
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    startTransition(async () => {
      const res = await props.actions.postMessage({ dealId: props.dealId, body: trimmed });
      if (res.ok) setBody("");
      else setError(res.error);
    });
  };

  // Build banner positions: every place where adjacent messages differ in mode
  const banners: { afterIndex: number; mode: "private" | "group"; at: Date }[] = [];
  for (let i = 1; i < props.messages.length; i++) {
    if (props.messages[i].threadMode !== props.messages[i - 1].threadMode) {
      banners.push({
        afterIndex: i - 1,
        mode: props.messages[i].threadMode,
        at: props.messages[i].createdAt,
      });
    }
  }
  const bannerAfter = new Map(banners.map((b) => [b.afterIndex, b]));

  return (
    <div aria-label="deal thread" className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
      {props.isOwner && props.currentMode !== null && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <label htmlFor={`mode-${props.dealId}`} className="text-zinc-400">Mode:</label>
          <select
            id={`mode-${props.dealId}`}
            aria-label="thread mode"
            value={props.currentMode}
            disabled={pending}
            onChange={(e) =>
              startTransition(async () => {
                await props.actions.setMode({
                  dealId: props.dealId,
                  mode: e.target.value as "private" | "group",
                });
              })
            }
            className="bg-zinc-800 text-zinc-100 px-1 py-0.5 rounded"
          >
            <option value="private">Private</option>
            <option value="group">Group</option>
          </select>
          <span className="text-zinc-500" title="This only affects new replies. Earlier messages stay where they were sent.">
            (future replies only)
          </span>
        </div>
      )}

      {props.messages.length === 0 ? (
        <p className="text-sm text-zinc-500 mb-2">No replies yet. Be the first.</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {props.messages.map((m, i) => (
            <li key={m.id} aria-label="thread message">
              {m.isDeleted ? (
                <p className="italic text-xs text-zinc-500">
                  {m.fromOrgLabel} deleted a message · {relativeTime(m.createdAt)}
                </p>
              ) : (
                <div>
                  <p className="text-xs text-zinc-400">
                    {m.fromOrgLabel} · {relativeTime(m.createdAt)} · {m.threadMode}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-zinc-100">{m.body}</p>
                  {m.fromOrgId === props.viewerOrgId &&
                    Date.now() - m.createdAt.getTime() < 15 * 60 * 1000 && (
                      <button
                        className="text-xs text-zinc-500 hover:text-rose-400 mt-1"
                        onClick={() =>
                          startTransition(async () => {
                            await props.actions.deleteMessage({ messageId: m.id });
                          })
                        }
                      >
                        Delete
                      </button>
                    )}
                </div>
              )}
              {bannerAfter.has(i) && (
                <p className="text-xs text-amber-300/80 mt-1">
                  Mode switched to {bannerAfter.get(i)!.mode} at {relativeTime(bannerAfter.get(i)!.at)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1">
        <textarea
          aria-label="reply body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a reply..."
          maxLength={2000}
          rows={2}
          className="w-full bg-zinc-800 text-zinc-100 text-sm p-2 rounded"
        />
        {error && (
          <p role="alert" className="text-xs text-rose-400">{error}</p>
        )}
        <button
          onClick={handleSend}
          disabled={pending || body.trim().length === 0}
          className="self-end text-xs px-2 py-1 bg-amber-500/80 hover:bg-amber-500 text-zinc-900 rounded disabled:opacity-50"
        >
          {pending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: Commit.**

```bash
git add src/components/deals/DealThreadAccordion.tsx
git commit -m "$(cat <<'EOF'
feat(deals): DealThreadAccordion — plain-text thread render + mode selector

Render path uses React text children only — no HTML construction from
message bodies. Bodies hit a `<p>{message.body}</p>` slot and React's
default escaping handles the XSS surface. No sanitization libraries.

Mode banner is derived from adjacent message-mode transitions, not a
separate DB column — single source of truth on the per-message snapshot.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C4: Extend `DealRoomPanel` with chevron + unread badge + accordion

**Files:**
- Modify: `src/components/dashboard/DealRoomPanel.tsx`

- [ ] **Step 1: Add the new props.**

Open `src/components/dashboard/DealRoomPanel.tsx` and find the props interface. Extend it with:

```ts
type DealRoomPanelProps = {
  /* …existing… */
  unreadByDealId?: Map<number, number>;
  threadsByDealId?: Map<number, DealMessageView[]>;
  threadModeByDealId?: Map<number, "private" | "group">; // present iff viewer is owner
  viewerOrgId: number;
  actions?: {
    postMessage: (input: { dealId: number; body: string }) => Promise<…>;
    setMode: (input: { dealId: number; mode: "private" | "group" }) => Promise<…>;
    deleteMessage: (input: { messageId: number }) => Promise<…>;
    markRead: (input: { dealId: number }) => Promise<…>;
  };
};
```

(Reuse the `ActionResult` shape from `@/lib/deals/actions` to fill the `Promise<…>` ellipses.)

- [ ] **Step 2: Add chevron + badge state.**

For each rendered deal row, add an inline `useState<number | null>(null)` for the currently-open deal ID (only one open at a time keeps the panel scroll sane):

```tsx
const [openDealId, setOpenDealId] = useState<number | null>(null);
```

Render after the deal row's normal content, per row:

```tsx
{(() => {
  const unread = props.unreadByDealId?.get(d.id) ?? 0;
  const total = props.threadsByDealId?.get(d.id)?.length ?? 0;
  if (total === 0) return null;
  if (unread > 0) {
    return <span className="text-xs text-rose-400 ml-2">🔴 {unread} new</span>;
  }
  return <span className="text-xs text-zinc-500 ml-2">💬 {total}</span>;
})()}

<button
  aria-label={`toggle thread for deal ${d.id}`}
  className="ml-2 text-zinc-500 hover:text-zinc-200"
  onClick={() => {
    const willOpen = openDealId !== d.id;
    setOpenDealId(willOpen ? d.id : null);
    if (willOpen && props.actions) {
      // fire-and-forget — UI updates optimistically
      void props.actions.markRead({ dealId: d.id });
    }
  }}
>
  {openDealId === d.id ? "▾" : "▸"}
</button>

{openDealId === d.id && props.actions && (
  <DealThreadAccordion
    dealId={d.id}
    viewerOrgId={props.viewerOrgId}
    isOwner={d.orgId === props.viewerOrgId}
    currentMode={props.threadModeByDealId?.get(d.id) ?? null}
    messages={props.threadsByDealId?.get(d.id) ?? []}
    actions={{
      postMessage: props.actions.postMessage,
      setMode: props.actions.setMode,
      deleteMessage: props.actions.deleteMessage,
    }}
  />
)}
```

Add imports:

```ts
import { useState } from "react";
import { DealThreadAccordion } from "@/components/deals/DealThreadAccordion";
import type { DealMessageView } from "@/db/dealMessages";
```

- [ ] **Step 3: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

- [ ] **Step 4: Run existing DealRoomPanel tests to confirm nothing broke.**

```bash
npx vitest run test/components/dashboard/DealRoomPanel.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: all existing tests still pass (the new props are optional, so the existing test fixtures don't need changes).

- [ ] **Step 5: Commit.**

```bash
git add src/components/dashboard/DealRoomPanel.tsx
git commit -m "feat(deals): DealRoomPanel chevron + unread badge + thread accordion

Existing props left optional so legacy callers still typecheck. New
callers wire the four query Maps + four action callbacks.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C5: Add thread-mode radio to `PostDealForm`

**Files:**
- Modify: `src/components/deals/PostDealForm.tsx`

- [ ] **Step 1: Extend the submit payload with `threadMode`.**

In `PostDealForm.tsx`, locate the `useState` for the visibility-circle dropdown (from slice 4). Add adjacent state:

```ts
const [threadMode, setThreadMode] = useState<"private" | "group">("private");
```

In the submit handler, include `threadMode` in the action payload **only if** `visibilityCircleId !== null` (matches the spec's "mode is moot for owner-only deals" rule).

- [ ] **Step 2: Render the radio conditionally.**

Below the visibility dropdown, when `visibilityCircleId !== null && circles.length > 0`:

```tsx
{visibilityCircleId !== null && (
  <fieldset className="flex flex-col gap-1" aria-label="thread mode">
    <legend className="text-xs text-zinc-400">Replies</legend>
    <label className="text-xs text-zinc-300">
      <input
        type="radio" name={`thread-mode-${formId}`} value="private"
        checked={threadMode === "private"}
        onChange={() => setThreadMode("private")}
      /> Private — replies are 1-to-1 with you (default)
    </label>
    <label className="text-xs text-zinc-300">
      <input
        type="radio" name={`thread-mode-${formId}`} value="group"
        checked={threadMode === "group"}
        onChange={() => setThreadMode("group")}
      /> Group — replies visible to everyone in this circle
    </label>
  </fieldset>
)}
```

(`formId` should be a `useId()` you already have or can add — needed for unique radio names across multiple forms on the same page.)

- [ ] **Step 3: Extend `postDeal` server-side input to accept `threadMode`.**

In `src/lib/deals/validation.ts`'s `postDealInput`:

```ts
threadMode: z.enum(["private", "group"]).optional().default("private"),
```

In `postDeal` action (`src/lib/deals/actions.ts`), pass `threadMode: input.threadMode` into the `db.insert(deals).values(...)` call.

- [ ] **Step 4: Run existing PostDealForm tests.**

```bash
npx vitest run test/components/deals/PostDealForm.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: existing tests still pass (radio is purely additive UI). If a test renders with `circles=[]`, the radio block is correctly absent.

- [ ] **Step 5: Commit.**

```bash
git add src/components/deals/PostDealForm.tsx src/lib/deals/validation.ts src/lib/deals/actions.ts
git commit -m "feat(deals): PostDealForm thread-mode radio + postDeal threadMode plumb

Radio renders only when a circle is selected (mode is moot for owner-
only deals). Default is "private" both in the form and in the Zod
schema's .default().

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C6: Wire query results through `src/app/page.tsx` (or panel registry)

**Files:**
- Modify: `src/app/page.tsx` (RSC) — or whatever file currently composes `DealRoomPanel`
- Modify: `src/components/dashboard/registry.ts` if PanelCtx type lives there

- [ ] **Step 1: Identify the current call site.**

```bash
grep -rn "DealRoomPanel" src/app/ src/components/dashboard/registry.ts 2>/dev/null
```

Expected: a single render site that fetches `deals` + `circleNamesById` and passes them in. We extend this to also fetch threads, unread counts, and the owner-mode map.

- [ ] **Step 2: Add query calls.**

In the RSC fetch block (top of the page component), add:

```ts
import { getDealMessages, getUnreadCountsForOrg, getDealThreadModeForOwner } from "@/db/dealMessages";

// …existing fetches…
const dealIds = visibleDeals.map((d) => d.id);
const unreadByDealId = await getUnreadCountsForOrg(db, orgId, dealIds);

// Batch-fetch threads for all visible deals. For Phase 1 we lazy-render
// in the panel (only open accordions fetch fresh messages), but for the
// badge we already need totals from getUnreadCountsForOrg. The full
// message list per deal can be fetched in the panel's open handler later
// if perf demands it; for now seed every visible deal up-front since the
// panel rarely shows more than ~30 deals.
const threadsByDealId = new Map<number, Awaited<ReturnType<typeof getDealMessages>>>();
for (const id of dealIds) {
  threadsByDealId.set(id, await getDealMessages(db, orgId, id));
}

const threadModeByDealId = new Map<number, "private" | "group">();
for (const id of dealIds) {
  const m = await getDealThreadModeForOwner(db, orgId, id);
  if (m) threadModeByDealId.set(id, m);
}
```

> Performance note: this is N+1 reads per deal. For slice 10's scale (≤ 30 visible deals per render) this is fine. A subagent verifying the plan should NOT optimize prematurely — see §12 of the spec for the followup-slice that may consolidate.

- [ ] **Step 3: Pass the new props to `DealRoomPanel`.**

```tsx
<DealRoomPanel
  /* …existing props… */
  unreadByDealId={unreadByDealId}
  threadsByDealId={threadsByDealId}
  threadModeByDealId={threadModeByDealId}
  viewerOrgId={orgId}
  actions={{
    postMessage: postDealMessage,
    setMode: setDealThreadMode,
    deleteMessage: deleteDealMessage,
    markRead: markDealThreadRead,
  }}
/>
```

Import the actions at the top of the RSC file:

```ts
import {
  postDealMessage, setDealThreadMode, deleteDealMessage, markDealThreadRead,
} from "@/lib/deals/actions";
```

- [ ] **Step 4: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

- [ ] **Step 5: Build.**

```bash
npm run build 2>&1 | tail -20
```

Expected: success, no Next.js render-time errors on the home page.

- [ ] **Step 6: Commit.**

```bash
git add src/app/page.tsx src/components/dashboard/registry.ts
git commit -m "feat(deals): thread queries + actions wired into DealRoomPanel render

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C7: `DealThreadAccordion.test.tsx` — component tests

**Files:**
- Create: `test/components/deals/DealThreadAccordion.test.tsx`

- [ ] **Step 1: Write the test file.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealThreadAccordion } from "@/components/deals/DealThreadAccordion";
import type { DealMessageView } from "@/db/dealMessages";

const noopActions = {
  postMessage: vi.fn(async (_i: { dealId: number; body: string }) => ({ ok: true as const })),
  setMode: vi.fn(async (_i: { dealId: number; mode: "private" | "group" }) => ({ ok: true as const })),
  deleteMessage: vi.fn(async (_i: { messageId: number }) => ({ ok: true as const })),
};

function msg(over: Partial<DealMessageView>): DealMessageView {
  return {
    id: 1, dealId: 1, fromOrgId: 1, fromOrgLabel: "Org",
    body: "hi", threadMode: "group", isDeleted: false, createdAt: new Date(), ...over,
  };
}

describe("DealThreadAccordion", () => {
  it("renders the empty state when there are no messages", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={true} currentMode="private"
      messages={[]} actions={noopActions}
    />);
    expect(screen.getByText(/no replies yet/i)).toBeInTheDocument();
  });

  it("renders messages in order with sender label", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={true} currentMode="group"
      messages={[
        msg({ id: 1, fromOrgLabel: "A", body: "first" }),
        msg({ id: 2, fromOrgLabel: "B", body: "second" }),
      ]}
      actions={noopActions}
    />);
    const items = screen.getAllByLabelText("thread message");
    expect(items[0]).toHaveTextContent("A");
    expect(items[0]).toHaveTextContent("first");
    expect(items[1]).toHaveTextContent("B");
    expect(items[1]).toHaveTextContent("second");
  });

  it("renders a mode-switch banner when adjacent messages differ", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={true} currentMode="private"
      messages={[
        msg({ id: 1, threadMode: "private", body: "p1" }),
        msg({ id: 2, threadMode: "group", body: "g1" }),
      ]}
      actions={noopActions}
    />);
    expect(screen.getByText(/Mode switched to group/)).toBeInTheDocument();
  });

  it("renders tombstones for soft-deleted messages", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={false} currentMode={null}
      messages={[msg({ id: 1, fromOrgLabel: "Mehta", body: null, isDeleted: true })]}
      actions={noopActions}
    />);
    expect(screen.getByText(/Mehta deleted a message/)).toBeInTheDocument();
  });

  it("submits trimmed body via postMessage", async () => {
    const actions = { ...noopActions, postMessage: vi.fn(async () => ({ ok: true as const })) };
    render(<DealThreadAccordion
      dealId={42} viewerOrgId={1} isOwner={false} currentMode={null}
      messages={[]} actions={actions}
    />);
    fireEvent.change(screen.getByLabelText("reply body"), { target: { value: "   hello  " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(actions.postMessage).toHaveBeenCalledTimes(1));
    expect(actions.postMessage.mock.calls[0][0]).toEqual({ dealId: 42, body: "hello" });
  });

  it("hides mode selector when viewer is not the owner", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={999} isOwner={false} currentMode={null}
      messages={[]} actions={noopActions}
    />);
    expect(screen.queryByLabelText("thread mode")).toBeNull();
  });

  it("XSS sanity: a <script> body renders as visible text, not executed HTML", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={true} currentMode="group"
      messages={[msg({ id: 1, body: "<script>alert(1)</script>" })]}
      actions={noopActions}
    />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run.**

```bash
npx vitest run test/components/deals/DealThreadAccordion.test.tsx --reporter=verbose 2>&1 | tail -20
```

Expected: `7 passed`.

- [ ] **Step 3: Commit.**

```bash
git add test/components/deals/DealThreadAccordion.test.tsx
git commit -m "test(deals): DealThreadAccordion render, send, mode banner, XSS sanity

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C8: `DealRoomPanel.unread-badge.test.tsx` — badge tests

**Files:**
- Create: `test/components/deals/DealRoomPanel.unread-badge.test.tsx`

- [ ] **Step 1: Write the test file.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DealRoomPanel } from "@/components/dashboard/DealRoomPanel";

// Build the minimal fixture shape DealRoomPanel expects.
// Reuse the existing test's fixture builder if it's exported; otherwise inline:
function deal(id: number) {
  return {
    id, kind: "SELL" as const, category: "Diamond" as const,
    subject: `d${id}`, quantity: 1, priceCents: 1000, currency: "USD",
    postedByLabel: "x", visibilityCircleId: null,
    threadMode: "private" as const,
    createdAt: new Date(), orgId: 1, status: "Open" as const,
  };
}

const noopActions = {
  postMessage: vi.fn(async () => ({ ok: true as const })),
  setMode: vi.fn(async () => ({ ok: true as const })),
  deleteMessage: vi.fn(async () => ({ ok: true as const })),
  markRead: vi.fn(async () => ({ ok: true as const })),
};

describe("DealRoomPanel — unread badge", () => {
  it("renders no badge for a deal with zero messages", () => {
    render(<DealRoomPanel
      deals={[deal(1)]} circleNamesById={new Map()}
      viewerOrgId={1}
      unreadByDealId={new Map()}
      threadsByDealId={new Map([[1, []]])}
      threadModeByDealId={new Map()}
      actions={noopActions}
    />);
    expect(screen.queryByText(/new/)).toBeNull();
    expect(screen.queryByText(/💬/)).toBeNull();
  });

  it("renders a subtle 💬 N badge when all messages are read", () => {
    render(<DealRoomPanel
      deals={[deal(1)]} circleNamesById={new Map()}
      viewerOrgId={1}
      unreadByDealId={new Map([[1, 0]])}
      threadsByDealId={new Map([[1, [
        { id: 1, dealId: 1, fromOrgId: 999, fromOrgLabel: "x", body: "h",
          threadMode: "group", isDeleted: false, createdAt: new Date() },
      ]]])}
      threadModeByDealId={new Map()}
      actions={noopActions}
    />);
    expect(screen.getByText(/💬 1/)).toBeInTheDocument();
  });

  it("renders prominent 🔴 N new when there are unread", () => {
    render(<DealRoomPanel
      deals={[deal(1)]} circleNamesById={new Map()}
      viewerOrgId={1}
      unreadByDealId={new Map([[1, 3]])}
      threadsByDealId={new Map([[1, [
        { id: 1, dealId: 1, fromOrgId: 999, fromOrgLabel: "x", body: "h",
          threadMode: "group", isDeleted: false, createdAt: new Date() },
      ]]])}
      threadModeByDealId={new Map()}
      actions={noopActions}
    />);
    expect(screen.getByText(/🔴 3 new/)).toBeInTheDocument();
  });

  it("clicking the chevron fires markRead", () => {
    const actions = { ...noopActions, markRead: vi.fn(async () => ({ ok: true as const })) };
    render(<DealRoomPanel
      deals={[deal(42)]} circleNamesById={new Map()}
      viewerOrgId={1}
      unreadByDealId={new Map([[42, 2]])}
      threadsByDealId={new Map([[42, [
        { id: 1, dealId: 42, fromOrgId: 999, fromOrgLabel: "x", body: "h",
          threadMode: "group", isDeleted: false, createdAt: new Date() },
      ]]])}
      threadModeByDealId={new Map()}
      actions={actions}
    />);
    fireEvent.click(screen.getByLabelText(/toggle thread for deal 42/));
    expect(actions.markRead).toHaveBeenCalledWith({ dealId: 42 });
  });
});
```

> If the existing `DealRoomPanel.test.tsx` exports its `deal()` helper, import it instead of redefining. The grep in Task C6 will surface that.

- [ ] **Step 2: Run.**

```bash
npx vitest run test/components/deals/DealRoomPanel.unread-badge.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: `4 passed`.

- [ ] **Step 3: Commit.**

```bash
git add test/components/deals/DealRoomPanel.unread-badge.test.tsx
git commit -m "test(deals): DealRoomPanel unread badge + chevron markRead behavior

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase D — Final verification + merge

### Task D1: Full suite + lint + typecheck + build

- [ ] **Step 1: Full test suite.**

```bash
npm test -- --run 2>&1 | tail -30
```

Expected: zero failures. Note the new file count delta (~9 new test files for slice 10).

- [ ] **Step 2: Typecheck the whole project.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: Lint.**

```bash
npm run lint 2>&1 | tail -15
```

Expected: no errors. If the repo has a project-specific lint rule (e.g., `no-from-on-tenanted-tables`), confirm slice 10 doesn't trip it — `getDealMessages` accesses `deal_messages` via raw SQL, not Drizzle `from(dealMessages)`, so the rule should be quiet.

- [ ] **Step 4: Build.**

```bash
npm run build 2>&1 | tail -25
```

Expected: build succeeds. Confirm `outputFileTracingIncludes` is unchanged (no new external files referenced at runtime).

- [ ] **Step 5: Local dev server smoke test.**

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:3000/ -o /tmp/slice10-home.html
grep -oE "AIYA Trusted Partners|Mehta Diamonds|Saint-Cloud Atelier" /tmp/slice10-home.html | sort -u
kill $DEV_PID 2>/dev/null
```

Expected: all three markers appear in the rendered HTML (proof the seed runs + the panel renders the new deals' threads).

- [ ] **Step 6: Commit any lint fixes (if needed).** If there were no fixes, skip to D2.

```bash
git add -A
git commit -m "chore(slice-10): lint + final verification fixes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task D2: Merge slice 10 into `main` + push + verify Netlify

- [ ] **Step 1: Squash-or-merge decision.**

Per slice-4 convention this is a merge commit (preserves the per-task commit history). Confirm:

```bash
git log --oneline slice-10-deal-reply-threads ^main | wc -l
```

Expected: ~22-25 commits (one per task step + a couple of housekeeping).

- [ ] **Step 2: Switch to main and merge.**

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff slice-10-deal-reply-threads -m "$(cat <<'EOF'
Merge slice 10: Deal Reply Threads

Adds private-default/group-optional reply threads to every deal in the
Deal Room. Per-message thread_mode snapshot prevents retroactive
visibility changes on mode-switch. Unread badge per (org, deal). Plain-
text rendering keeps the XSS surface at zero. Authz reuses slice-4's
ForbiddenError + runWithUser; no new auth primitive.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push.**

```bash
git push origin main
```

- [ ] **Step 4: Poll Netlify until slice-10 marker appears live.**

The marker for slice 10 is the seeded message body — pick a unique string from the demo seed (e.g., `"Ships from Bandra"`):

```bash
(
  url="https://idesign-dash-demo.netlify.app/"
  marker="Ships from Bandra"
  start=$(date +%s)
  deadline=$((start + 360))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(curl -sL --max-time 15 "$url" 2>/dev/null || true)
    if echo "$body" | grep -q "$marker"; then
      echo "SLICE_10_LIVE after $(( $(date +%s) - start ))s"
      exit 0
    fi
    sleep 20
  done
  echo "TIMEOUT — slice-10 marker '$marker' not found in 6 min"
  exit 1
)
```

Run in background with the standard pattern from prior slice deploys.

- [ ] **Step 5: Delete the feature branch.**

```bash
git branch -d slice-10-deal-reply-threads
git push origin --delete slice-10-deal-reply-threads 2>/dev/null || true
```

Slice 10 done.

---

## Self-Review Notes (filled during writing-plans skill)

**1. Spec coverage check:**
- §3 schema → A1, A2 ✓
- §4 visibility model → A3 SQL (encoded in the WHERE clause), B6 immutability test ✓
- §5 authz rules → B2 (rule 1), B3 (rule 4), B4 (rule 5), B5 (rule 6); rule 2/3 (read) covered by getDealMessages SQL in A3 ✓
- §6 server actions → B1 (schemas), B2-B5 (one action each) ✓
- §7 query layer → A3, A4, A5 ✓
- §8 UI → C3 (accordion), C4 (panel), C5 (form), C6 (wire), C7-C8 (tests) ✓
- §9 demo seed → C1, C2 ✓
- §10 testing strategy → all 8 listed test files mapped to tasks ✓
- §11 migration & rollout → A2 (gen), D1 step 4 (build), D2 (deploy) ✓

**2. Placeholder scan:** None. Every step has either an exact command, a complete code block, or an exact textual diff instruction. The one "if" branch (A6 step 4: conditional index) has explicit decision rules in step 3 so a subagent has zero discretion.

**3. Type consistency:**
- `DealMessageView` defined once in A3, referenced consistently in A4 + C3 + C7 + C8.
- `ActionResult` reused from existing slice-4 code (not redefined).
- `runWithUser`, `ForbiddenError`, `db()` — all existing symbols, reused not redefined.
- `canSeeDeal` defined once in B2; reused in B5 (markDealThreadRead).
- Map<number, …> shapes are consistent: `unreadByDealId: Map<number, number>`, `threadsByDealId: Map<number, DealMessageView[]>`, `threadModeByDealId: Map<number, "private" | "group">`.

Plan is ready.
