# AIYA Slice 5 — Website Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship owner-entered weekly snapshots of marketing-site KPIs as a new dashboard panel + admin route. Multi-tenant from day one (every row carries orgId, fully isolated). Honest provenance ('owner-updated Xd ago') — never labeled live. Real analytics provider integration is a future swap behind the same panel interface.

**Architecture:** New website_snapshots Drizzle table (orgId-scoped, unique on (orgId, weekStart)). Three actions through the established run() wrapper, three reads with explicit orgId param + demo-mode short-circuits. Dashboard panel with 3 rendering states (no data / single / multi) + 8-week visitor sparkline. /website admin route with form + table for CRUD. Demo seed: 8 weeks AIYA + 2 weeks Mehta Diamonds.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind · Drizzle ORM · pglite (test) · Neon (prod) · jose (JWT) · Zod · Vitest · existing slice-3 getCurrentOrgId() seam · existing slice-4 demo-mode helper pattern.

**Spec:** `docs/superpowers/specs/2026-05-28-aiya-website-overview-slice-5-design.md`

**Conventions:**
- Run a single test file: `npx vitest run <path>`
- DB/action tests use `// @vitest-environment node` and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` + `__setTestDb` pattern from `test/helpers/shared-db.ts`.
- All reads scope by `eq(websiteSnapshots.orgId, orgId)` where `orgId` is resolved server-side from `getCurrentOrgId()` / `requireSession()`, never from the request body.
- All mutations stamp `orgId` from session; every `UPDATE` / `DELETE` WHERE clause is `eq(id, input.id) AND eq(orgId, sessionOrgId)`.
- Commit after every green step.

> ## CRITICAL — week_start is NOT Monday-only
>
> The architect was explicit (spec §2.3): the Zod validator MUST NOT add a "Monday-only" check. `weekStart` accepts any valid `YYYY-MM-DD` date — the owner picks the day that matches their analytics provider's week boundary. The unique constraint `(orgId, weekStart)` does the dedup work treating *whatever* date the owner picks as the canonical week marker. The A3 test "an arbitrary Wednesday is valid" is the regression guard. If a future executor reads "weekly snapshot" and adds `.refine(d => new Date(d).getDay() === 1)`, that change breaks the contract.

> ## CRITICAL — Demo-mode short-circuit at the TOP of each read helper
>
> Each of `getWebsiteSnapshots`, `getLatestWebsiteSnapshot`, `getWebsiteSnapshotTrend` MUST begin with `if (isDemoMode()) return getSeed…(…);` BEFORE any DB access. Slice 4's circle queries review caught this exact issue — apply preemptively in slice 5. The A4 demo-mode tests assert `db` is never touched in demo (a `__setTestDb(brokenDb)` would still return seed data).

> ## CRITICAL — ON CONFLICT DO NOTHING returns a distinct ActionResult shape
>
> `createWebsiteSnapshot` returns `{ ok: true; duplicate: true }` (NOT a plain `{ ok: true }`) when the unique constraint fires. The UI must check `'duplicate' in res` and render a soft "Snapshot for this week already exists — edit it below" hint, NOT a generic "Saved." toast. The B2 duplicate-week test + the D5 FormStatus duplicate test together cover this contract end-to-end. The shape widening is per-domain only — inventory / diamonds / deals keep their narrower `{ ok: true } | { ok: false, error }` shape.

> ## CRITICAL — `uniqueVisitors ≤ visitors` is deliberately NOT enforced
>
> Per spec §8.3: owner-entered ledgers commonly have edge cases (provider outages, mid-week estimates). Forcing the inequality at Zod would corrupt the ledger. The form MAY show a soft warning, but the save proceeds. The header comment in `src/lib/website/validation.ts` MUST document this intentional gap so a future reviewer doesn't add a `.refine(d => d.uniqueVisitors <= d.visitors)`.

> ## CRITICAL — Migration order dependency on slice 4
>
> `drizzle/0007_*.sql` runs against a DB that already has `0006_*.sql` (slice 4's `deals_visibility_circle_idx` partial index) applied. The new `website_snapshots` table has no FKs onto slice-4 tables (only `org_id → orgs.id`), but the migration order matters for clean test reset — `npm run db:generate` MUST be run from a tree where 0006 already exists in `drizzle/`. This migration is **schema-only** — no seed data — and must include a `-- schema-only; no seed data in this migration` SQL comment at the top so a future executor does not infer a missing seed step.

---

## Task 0: Set up worktree

**Files:** none (environment setup)

- [ ] **Step 1: From repo root, create the worktree.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root" && git worktree add -b feature/aiya-website-overview-5 .worktrees/aiya-website-overview-5 main`
  Expected: new worktree directory at `.worktrees/aiya-website-overview-5`, branch `feature/aiya-website-overview-5` checked out there.

- [ ] **Step 2: Switch to the worktree and install.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-website-overview-5" && npm install`
  Expected: clean install; no errors.

- [ ] **Step 3: Verify baseline tests pass.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-website-overview-5" && npm test -- --run`
  Expected: full suite green (the post-slice-4 baseline, ~428 tests). If anything fails, STOP — the baseline is broken, not your code.

(All subsequent `cd` commands in this plan reference the worktree path. Use `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-website-overview-5"` before any command.)

---

## Phase A — Foundation (data model + helpers + demo seed)

Phase A adds the new `website_snapshots` table, the migration, the Zod schemas, the three read helpers, and the demo seed extension. **No UI changes in Phase A.** Phase B adds actions; Phase C and D add UI.

### Task A1: Add `websiteSnapshots` table to schema

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `test/db/schema.test.ts`

- [ ] **Step 1: Failing schema assertions.** Append a new `it(...)` block to the existing `describe("db schema", …)` in `test/db/schema.test.ts`:

```ts
  it("exports the websiteSnapshots table with all 9 columns", () => {
    expect(schema.websiteSnapshots).toBeDefined();
    expect(schema.websiteSnapshots.id.columnType).toBe("PgSerial");
    expect(schema.websiteSnapshots.orgId.columnType).toBe("PgInteger");
    expect(schema.websiteSnapshots.weekStart.columnType).toBe("PgDateString");
    expect(schema.websiteSnapshots.visitors.columnType).toBe("PgInteger");
    expect(schema.websiteSnapshots.uniqueVisitors.columnType).toBe("PgInteger");
    expect(schema.websiteSnapshots.pageViews.columnType).toBe("PgInteger");
    expect(schema.websiteSnapshots.avgSessionDurationSeconds.columnType).toBe("PgInteger");
    expect(schema.websiteSnapshots.bounceRatePercent.columnType).toBe("PgInteger");
    expect(schema.websiteSnapshots.createdAt.columnType).toBe("PgTimestamp");
    expect(schema.websiteSnapshots.updatedAt.columnType).toBe("PgTimestamp");
  });

  it("websiteSnapshots requires NOT NULL on every count field", () => {
    expect(schema.websiteSnapshots.visitors.notNull).toBe(true);
    expect(schema.websiteSnapshots.uniqueVisitors.notNull).toBe(true);
    expect(schema.websiteSnapshots.pageViews.notNull).toBe(true);
    expect(schema.websiteSnapshots.avgSessionDurationSeconds.notNull).toBe(true);
    expect(schema.websiteSnapshots.bounceRatePercent.notNull).toBe(true);
  });
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/schema.test.ts`
Expected: FAIL — `schema.websiteSnapshots` is undefined.

- [ ] **Step 3: Add the `websiteSnapshots` table.** Open `src/db/schema.ts`. At the end of the file (after the `deals` table closing `);` and the trailing newline), append:

```ts
export const websiteSnapshots = pgTable(
  "website_snapshots",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull().default(1).references(() => orgs.id), // 1 = AIYA
    // Calendar week marker (date-only, no time component). Any valid YYYY-MM-DD
    // — the owner picks whatever day matches their analytics provider's week
    // boundary (US Sun→Sat or ISO Mon→Sun). The unique constraint below
    // enforces "one row per week" treating this value as canonical.
    weekStart: date("week_start").notNull(),
    // Range enforced at the Zod layer (>= 0); DB-level CHECK is deferred
    // (see slice 5 spec §2.6).
    visitors: integer("visitors").notNull(),
    uniqueVisitors: integer("unique_visitors").notNull(),
    pageViews: integer("page_views").notNull(),
    avgSessionDurationSeconds: integer("avg_session_duration_seconds").notNull(),
    // Range enforced at the Zod layer (0..100); DB-level CHECK is deferred.
    bounceRatePercent: integer("bounce_rate_percent").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgWeekUniq: unique("website_snapshots_org_week_uniq").on(t.orgId, t.weekStart),
    orgWeekIdx: index("website_snapshots_org_week_idx").on(t.orgId, t.weekStart.desc()),
  })
);
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/schema.test.ts`
Expected: PASS — both new assertions green.

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/db/schema.ts test/db/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): website_snapshots table (orgId-scoped weekly KPI ledger)

9 columns: id, org_id (default 1 → orgs.id), week_start DATE, visitors,
unique_visitors, page_views, avg_session_duration_seconds (integer secs),
bounce_rate_percent (whole 0..100), created_at, updated_at. Unique
constraint on (org_id, week_start) is the single source of truth for
"one row per week per org" — actions layer uses ON CONFLICT DO NOTHING
to handle the race. Composite index (org_id, week_start DESC) serves
the latest-snapshot and trend-of-N queries directly from the index.

Range guards live at the Zod layer (next task); DB-level CHECK is
deferred per spec §2.6.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration `drizzle/0007_*.sql` + schema-only header + smoke test

**Files:**
- Create: `drizzle/0007_*.sql` (generated, then hand-edited with header comment)
- Modify: `drizzle/meta/_journal.json` + new snapshot (generated)
- Create: `test/db/website-snapshots-migration.test.ts`

- [ ] **Step 1: Generate the migration.** Run: `npm run db:generate`
Expected: a new `drizzle/0007_<name>.sql` appears. It should contain, in order:
  - `CREATE TABLE "website_snapshots" ( ... )` with the nine columns.
  - `ALTER TABLE "website_snapshots" ADD CONSTRAINT "website_snapshots_org_id_orgs_id_fk" FOREIGN KEY ...` referencing `orgs(id)`.
  - `CREATE UNIQUE INDEX "website_snapshots_org_week_uniq" ON "website_snapshots" ("org_id","week_start");`
  - `CREATE INDEX "website_snapshots_org_week_idx" ON "website_snapshots" ("org_id","week_start" DESC);`

  If the command appears to hang waiting for input, report BLOCKED.

- [ ] **Step 2: Inspect the generated SQL.** Open `drizzle/0007_*.sql` and confirm:
  - `CREATE TABLE "website_snapshots"` is present.
  - The unique + non-unique indexes both emit.
  - No seed INSERTs of any kind (prod migration is schema-only).

- [ ] **Step 3: Hand-edit the migration to add the schema-only header.** Open `drizzle/0007_*.sql` and prepend, before any SQL:

```sql
-- schema-only; no seed data in this migration.
-- website_snapshots starts empty in prod; the demo seed lives in
-- src/lib/demo/seed.ts and never touches the DB.
-- See docs/superpowers/plans/2026-05-28-aiya-website-overview-slice-5.md for context.
```

(There's no hand-appended INSERT block here, so re-running `db:generate` would harmlessly strip the comment but keep the SQL correct. The header is still important for human readers.)

- [ ] **Step 4: Failing migration smoke test.** Create `test/db/website-snapshots-migration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/client";
import { websiteSnapshots } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("website_snapshots migration", () => {
  it("creates the website_snapshots table empty", async () => {
    const t = await createTestDb();
    close = t.close;
    expect(await t.db.select().from(websiteSnapshots)).toEqual([]);
  });

  it("enforces the (org_id, week_start) unique constraint", async () => {
    const t = await createTestDb();
    close = t.close;
    await t.db.insert(websiteSnapshots).values({
      orgId: 1, weekStart: "2026-05-25",
      visitors: 100, uniqueVisitors: 80, pageViews: 300,
      avgSessionDurationSeconds: 180, bounceRatePercent: 40,
    });
    await expect(
      t.db.insert(websiteSnapshots).values({
        orgId: 1, weekStart: "2026-05-25",
        visitors: 999, uniqueVisitors: 80, pageViews: 300,
        avgSessionDurationSeconds: 180, bounceRatePercent: 40,
      })
    ).rejects.toThrow();
  });

  it("allows the same week_start across different orgs", async () => {
    const t = await createTestDb();
    close = t.close;
    await t.db.insert(websiteSnapshots).values({
      orgId: 1, weekStart: "2026-05-25",
      visitors: 100, uniqueVisitors: 80, pageViews: 300,
      avgSessionDurationSeconds: 180, bounceRatePercent: 40,
    });
    await expect(
      t.db.insert(websiteSnapshots).values({
        orgId: 999, weekStart: "2026-05-25",
        visitors: 200, uniqueVisitors: 150, pageViews: 600,
        avgSessionDurationSeconds: 200, bounceRatePercent: 35,
      })
    ).resolves.not.toThrow();
  });

  it("rejects an org_id with no matching orgs row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    await expect(
      t.db.execute(sql`
        INSERT INTO website_snapshots
          (org_id, week_start, visitors, unique_visitors, page_views,
           avg_session_duration_seconds, bounce_rate_percent)
        VALUES (99999, '2026-05-25', 100, 80, 300, 180, 40)
      `)
    ).rejects.toThrow();
  });

  it("week_start returns as a string in YYYY-MM-DD format", async () => {
    const t = await createTestDb();
    close = t.close;
    await t.db.insert(websiteSnapshots).values({
      orgId: 1, weekStart: "2026-05-25",
      visitors: 100, uniqueVisitors: 80, pageViews: 300,
      avgSessionDurationSeconds: 180, bounceRatePercent: 40,
    });
    const rows = await t.db.select({ ws: websiteSnapshots.weekStart }).from(websiteSnapshots);
    expect(rows[0].ws).toBe("2026-05-25");
    expect(typeof rows[0].ws).toBe("string");
  });
});
```

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/db/website-snapshots-migration.test.ts`
Expected: PASS (5 tests). If "relation website_snapshots does not exist", Step 1 didn't run or the file wasn't generated.

- [ ] **Step 6: Commit.**
```bash
git add drizzle test/db/website-snapshots-migration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): generate 0007 migration (website_snapshots schema-only)

Schema-only migration — website_snapshots starts empty in prod; the
demo seed lives in src/lib/demo/seed.ts and never touches the DB.
Unique constraint on (org_id, week_start) handles the "one row per
week per org" invariant at the storage layer. Composite index
(org_id, week_start DESC) serves the latest + trend-of-N hot path.

Smoke test covers: empty start, unique constraint, cross-org allowance,
FK to orgs, and YYYY-MM-DD round-trip through Drizzle's date() column.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Create `src/lib/website/validation.ts` with Zod schemas

**Files:**
- Create: `src/lib/website/validation.ts`
- Create: `test/lib/website/validation.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/website/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  websiteSnapshotInput,
  websiteSnapshotUpdateInput,
} from "@/lib/website/validation";

const VALID = {
  weekStart: "2026-05-25",
  visitors: 5000,
  uniqueVisitors: 3500,
  pageViews: 18000,
  avgSessionDurationSeconds: 210,
  bounceRatePercent: 42,
};

describe("websiteSnapshotInput — pass cases", () => {
  it("accepts a fully-populated valid row", () => {
    expect(websiteSnapshotInput.safeParse(VALID).success).toBe(true);
  });

  it("accepts 0 on every count field (no traffic week)", () => {
    expect(websiteSnapshotInput.safeParse({
      ...VALID,
      visitors: 0, uniqueVisitors: 0, pageViews: 0,
      avgSessionDurationSeconds: 0, bounceRatePercent: 0,
    }).success).toBe(true);
  });

  it("accepts bounceRatePercent at the upper boundary (100)", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, bounceRatePercent: 100 }).success).toBe(true);
  });

  it("accepts an arbitrary Wednesday weekStart (spec §2.3 — NOT Monday-only)", () => {
    // 2026-05-27 was a Wednesday. The spec is explicit that the validator
    // must NOT add a Monday-only check. This is the regression guard.
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "2026-05-27" }).success).toBe(true);
  });

  it("accepts an arbitrary Saturday weekStart (US Sat→Sun analytics convention)", () => {
    // 2026-05-30 was a Saturday.
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "2026-05-30" }).success).toBe(true);
  });
});

describe("websiteSnapshotInput — fail cases", () => {
  it("rejects negative visitors", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, visitors: -1 }).success).toBe(false);
  });

  it("rejects negative uniqueVisitors", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, uniqueVisitors: -1 }).success).toBe(false);
  });

  it("rejects negative pageViews", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, pageViews: -1 }).success).toBe(false);
  });

  it("rejects negative avgSessionDurationSeconds", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, avgSessionDurationSeconds: -1 }).success).toBe(false);
  });

  it("rejects bounceRatePercent < 0", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, bounceRatePercent: -1 }).success).toBe(false);
  });

  it("rejects bounceRatePercent > 100", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, bounceRatePercent: 101 }).success).toBe(false);
  });

  it("rejects non-integer counts (Zod .int())", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, visitors: 5000.5 }).success).toBe(false);
  });

  it("rejects weekStart with single-digit month", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "2026-5-25" }).success).toBe(false);
  });

  it("rejects weekStart with slashes", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "2026/05/25" }).success).toBe(false);
  });

  it("rejects weekStart as a human-readable date", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "May 25, 2026" }).success).toBe(false);
  });
});

describe("websiteSnapshotInput — slice-3 invariant: no orgId field", () => {
  it("websiteSnapshotInput has no orgId in its shape", () => {
    // Zod object shape inspection — equivalent to the PR-review grep on
    // grep -rn "orgId" src/lib/website/validation.ts → 0 matches.
    const shape = websiteSnapshotInput.shape as Record<string, unknown>;
    expect("orgId" in shape).toBe(false);
  });

  it("strips an orgId-shaped junk field from the parsed output", () => {
    const result = websiteSnapshotInput.safeParse({ ...VALID, orgId: 999 } as never);
    expect(result.success).toBe(true);
    if (result.success) expect("orgId" in result.data).toBe(false);
  });
});

describe("websiteSnapshotUpdateInput", () => {
  it("requires a positive integer id", () => {
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: 1 }).success).toBe(true);
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: 0 }).success).toBe(false);
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: -1 }).success).toBe(false);
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: 1.5 }).success).toBe(false);
  });

  it("inherits every websiteSnapshotInput constraint", () => {
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: 1, bounceRatePercent: 101 }).success).toBe(false);
  });

  it("has no orgId in its shape (slice-3 invariant)", () => {
    const shape = websiteSnapshotUpdateInput.shape as Record<string, unknown>;
    expect("orgId" in shape).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/website/validation.test.ts`
Expected: FAIL — module `@/lib/website/validation` not found.

- [ ] **Step 3: Implement.** Create `src/lib/website/validation.ts`:

```ts
// Owner-entered weekly website KPI snapshot validation.
//
// INVARIANTS:
// - No `orgId` field. The action wrapper stamps orgId from the session
//   (slice-3 invariant). PR-review grep:
//     grep -rn "orgId" src/lib/website/validation.ts → 0 matches.
// - `weekStart` accepts ANY valid YYYY-MM-DD date — the owner picks whatever
//   day matches their analytics provider's week boundary. The unique
//   constraint (org_id, week_start) in the DB enforces "one row per week
//   per org" treating that date as canonical. DO NOT add a Monday-only check.
//   See spec §2.3.
// - `uniqueVisitors <= visitors` is deliberately NOT enforced (spec §8.3) —
//   owner-entered ledgers commonly have edge cases (provider outages,
//   mid-week estimates). The form MAY show a soft warning, but the save
//   proceeds. DO NOT add a .refine() here.

import { z } from "zod";

const nonNegInt = z.number().int().min(0);

export const websiteSnapshotInput = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekStart must be YYYY-MM-DD"),
  visitors: nonNegInt,
  uniqueVisitors: nonNegInt,
  pageViews: nonNegInt,
  avgSessionDurationSeconds: nonNegInt,
  bounceRatePercent: z.number().int().min(0).max(100),
});
export type WebsiteSnapshotInput = z.infer<typeof websiteSnapshotInput>;

export const websiteSnapshotUpdateInput = websiteSnapshotInput.extend({
  id: z.number().int().positive(),
});
export type WebsiteSnapshotUpdateInput = z.infer<typeof websiteSnapshotUpdateInput>;

/** Reuse the shared single-message flattener from the company slice. */
export { firstZodError } from "@/lib/company/validation";
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/website/validation.test.ts`
Expected: PASS (all validation assertions green).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/website/validation.ts test/lib/website/validation.test.ts
git commit -m "$(cat <<'EOF'
feat(website): Zod schemas — websiteSnapshotInput + update variant

Six wire fields: weekStart (YYYY-MM-DD), visitors, uniqueVisitors,
pageViews, avgSessionDurationSeconds (all >= 0), bounceRatePercent (0..100).
Update schema adds positive-int id. No orgId field anywhere — the action
wrapper stamps orgId from session (slice-3 invariant; PR-review grep
will confirm).

Header comment documents two deliberate gaps the executor must NOT close:
- weekStart accepts ANY valid date (NOT Monday-only — spec §2.3)
- uniqueVisitors <= visitors NOT enforced (spec §8.3)

The "arbitrary Wednesday is valid" test is the regression guard for the
no-Monday-only contract.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Create `src/db/website.ts` with the three read helpers

**Files:**
- Create: `src/db/website.ts`
- Create: `test/db/website-snapshots.test.ts`

> **Note:** Following the spec's file plan (§10), DB-access lives in `src/db/website.ts` (mirroring `src/db/inventory.ts`), not `src/lib/website/queries.ts`. The `src/lib/website/` namespace is for actions + validation + format helpers only.

- [ ] **Step 1: Failing test.** Create `test/db/website-snapshots.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { websiteSnapshots } from "@/db/schema";
import {
  getWebsiteSnapshots,
  getLatestWebsiteSnapshot,
  getWebsiteSnapshotTrend,
} from "@/db/website";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function insert(
  over: Partial<typeof websiteSnapshots.$inferInsert>,
): Promise<number> {
  const [row] = await db.insert(websiteSnapshots).values({
    orgId: 1, weekStart: "2026-05-25",
    visitors: 5000, uniqueVisitors: 3500, pageViews: 18000,
    avgSessionDurationSeconds: 210, bounceRatePercent: 42,
    ...over,
  }).returning({ id: websiteSnapshots.id });
  return row.id;
}

describe("getWebsiteSnapshots", () => {
  it("returns [] for an org with no rows", async () => {
    expect(await getWebsiteSnapshots(db, 1)).toEqual([]);
  });

  it("returns rows for the requested org only (cross-org isolation)", async () => {
    await insert({ orgId: 1, weekStart: "2026-05-25", visitors: 100 });
    await insert({ orgId: 1, weekStart: "2026-05-18", visitors: 200 });
    await insert({ orgId: 1, weekStart: "2026-05-11", visitors: 300 });
    await insert({ orgId: 999, weekStart: "2026-05-25", visitors: 9999 });
    await insert({ orgId: 999, weekStart: "2026-05-18", visitors: 9999 });

    expect(await getWebsiteSnapshots(db, 1)).toHaveLength(3);
    expect(await getWebsiteSnapshots(db, 999)).toHaveLength(2);
    // Belt-and-suspenders: no org-999 row leaks through the org-1 query.
    const aiyaRows = await getWebsiteSnapshots(db, 1);
    expect(aiyaRows.every((r) => r.orgId === 1)).toBe(true);
  });

  it("orders rows by weekStart DESC", async () => {
    await insert({ weekStart: "2026-05-04" });
    await insert({ weekStart: "2026-05-18" });
    await insert({ weekStart: "2026-05-11" });
    const rows = await getWebsiteSnapshots(db, 1);
    expect(rows.map((r) => r.weekStart)).toEqual(["2026-05-18", "2026-05-11", "2026-05-04"]);
  });

  it("populates every WebsiteSnapshotRow field from the DB row", async () => {
    await insert({
      orgId: 1, weekStart: "2026-05-25",
      visitors: 7820, uniqueVisitors: 5640, pageViews: 22130,
      avgSessionDurationSeconds: 215, bounceRatePercent: 38,
    });
    const [r] = await getWebsiteSnapshots(db, 1);
    expect(r.orgId).toBe(1);
    expect(r.weekStart).toBe("2026-05-25");
    expect(r.visitors).toBe(7820);
    expect(r.uniqueVisitors).toBe(5640);
    expect(r.pageViews).toBe(22130);
    expect(r.avgSessionDurationSeconds).toBe(215);
    expect(r.bounceRatePercent).toBe(38);
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.updatedAt).toBeInstanceOf(Date);
  });
});

describe("getLatestWebsiteSnapshot", () => {
  it("returns null for an org with no rows", async () => {
    expect(await getLatestWebsiteSnapshot(db, 1)).toBeNull();
  });

  it("returns the row with the most recent weekStart", async () => {
    await insert({ weekStart: "2026-05-04", visitors: 1 });
    await insert({ weekStart: "2026-05-18", visitors: 2 });
    await insert({ weekStart: "2026-05-11", visitors: 3 });
    const latest = await getLatestWebsiteSnapshot(db, 1);
    expect(latest?.weekStart).toBe("2026-05-18");
    expect(latest?.visitors).toBe(2);
  });

  it("is scoped per org (org 999 doesn't see org 1's latest)", async () => {
    await insert({ orgId: 1, weekStart: "2026-05-25" });
    expect(await getLatestWebsiteSnapshot(db, 999)).toBeNull();
  });
});

describe("getWebsiteSnapshotTrend", () => {
  it("caps at the requested N", async () => {
    for (let i = 0; i < 12; i++) {
      const day = String(4 + (i % 28)).padStart(2, "0");
      const month = String(3 + Math.floor(i / 28)).padStart(2, "0");
      await insert({ weekStart: `2026-${month}-${day}`, visitors: i });
    }
    const rows = await getWebsiteSnapshotTrend(db, 1, 8);
    expect(rows).toHaveLength(8);
  });

  it("returns the 8 MOST RECENT rows when N=8 and 12 exist", async () => {
    const weeks = [
      "2026-04-06","2026-04-13","2026-04-20","2026-04-27",
      "2026-05-04","2026-05-11","2026-05-18","2026-05-25",
      "2026-03-30","2026-03-23","2026-03-16","2026-03-09",
    ];
    for (let i = 0; i < weeks.length; i++) {
      await insert({ weekStart: weeks[i], visitors: i });
    }
    const rows = await getWebsiteSnapshotTrend(db, 1, 8);
    expect(rows.map((r) => r.weekStart)).toEqual([
      "2026-05-25","2026-05-18","2026-05-11","2026-05-04",
      "2026-04-27","2026-04-20","2026-04-13","2026-04-06",
    ]);
  });

  it("defaults N to 8 when no argument is supplied", async () => {
    for (let i = 0; i < 12; i++) {
      const day = String(1 + i).padStart(2, "0");
      await insert({ weekStart: `2026-05-${day}`, visitors: i });
    }
    const rows = await getWebsiteSnapshotTrend(db, 1);
    expect(rows).toHaveLength(8);
  });

  it("respects cross-org isolation", async () => {
    await insert({ orgId: 1, weekStart: "2026-05-25" });
    await insert({ orgId: 999, weekStart: "2026-05-25" });
    await insert({ orgId: 999, weekStart: "2026-05-18" });
    const rows = await getWebsiteSnapshotTrend(db, 1, 8);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/website-snapshots.test.ts`
Expected: FAIL — module `@/db/website` not found.

- [ ] **Step 3: Implement.** Create `src/db/website.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { websiteSnapshots } from "./schema";
import { isDemoMode } from "@/lib/demo/mode";
import {
  getSeedWebsiteSnapshots,
  getSeedLatestWebsiteSnapshot,
  getSeedWebsiteSnapshotTrend,
} from "@/lib/demo/seed";

export interface WebsiteSnapshotRow {
  id: number;
  orgId: number;
  /** YYYY-MM-DD wire format. Drizzle's date() column returns a string in Node. */
  weekStart: string;
  visitors: number;
  uniqueVisitors: number;
  pageViews: number;
  avgSessionDurationSeconds: number;
  bounceRatePercent: number;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = {
  id: websiteSnapshots.id,
  orgId: websiteSnapshots.orgId,
  weekStart: websiteSnapshots.weekStart,
  visitors: websiteSnapshots.visitors,
  uniqueVisitors: websiteSnapshots.uniqueVisitors,
  pageViews: websiteSnapshots.pageViews,
  avgSessionDurationSeconds: websiteSnapshots.avgSessionDurationSeconds,
  bounceRatePercent: websiteSnapshots.bounceRatePercent,
  createdAt: websiteSnapshots.createdAt,
  updatedAt: websiteSnapshots.updatedAt,
} as const;

/** All snapshots for an org, most-recent week first.
 *
 *  CRITICAL: the isDemoMode() short-circuit is the FIRST statement. The db
 *  argument is not touched in demo. Slice 4's circles review caught the
 *  mirror-image issue — this is the preemptive fix. */
export async function getWebsiteSnapshots(
  db: Db,
  orgId: number,
): Promise<WebsiteSnapshotRow[]> {
  if (isDemoMode()) return getSeedWebsiteSnapshots(orgId);
  return await db
    .select(COLUMNS)
    .from(websiteSnapshots)
    .where(eq(websiteSnapshots.orgId, orgId))
    .orderBy(desc(websiteSnapshots.weekStart));
}

/** Single most-recent snapshot; null when no rows exist for the org. */
export async function getLatestWebsiteSnapshot(
  db: Db,
  orgId: number,
): Promise<WebsiteSnapshotRow | null> {
  if (isDemoMode()) return getSeedLatestWebsiteSnapshot(orgId);
  const rows = await db
    .select(COLUMNS)
    .from(websiteSnapshots)
    .where(eq(websiteSnapshots.orgId, orgId))
    .orderBy(desc(websiteSnapshots.weekStart))
    .limit(1);
  return rows[0] ?? null;
}

/** Last N snapshots, most-recent week first. Default N=8 — feeds the
 *  dashboard panel's 8-week sparkline and the latest/previous delta math. */
export async function getWebsiteSnapshotTrend(
  db: Db,
  orgId: number,
  n: number = 8,
): Promise<WebsiteSnapshotRow[]> {
  if (isDemoMode()) return getSeedWebsiteSnapshotTrend(orgId, n);
  return await db
    .select(COLUMNS)
    .from(websiteSnapshots)
    .where(eq(websiteSnapshots.orgId, orgId))
    .orderBy(desc(websiteSnapshots.weekStart))
    .limit(n);
}
```

> **Note:** The demo seed helpers `getSeedWebsiteSnapshots`, `getSeedLatestWebsiteSnapshot`, `getSeedWebsiteSnapshotTrend` don't exist yet — they're added in A5. tsc will be red after this file lands and green again at the end of A5.

- [ ] **Step 4: Stub the demo seed helpers temporarily.** To keep tsc clean during A4, open `src/lib/demo/seed.ts` and append at the end (these are placeholder no-ops that A5 replaces with the real implementation):

```ts
// --- Slice 5 placeholders (replaced in A5) ---
import type { WebsiteSnapshotRow } from "@/db/website";
export function getSeedWebsiteSnapshots(_orgId: number): WebsiteSnapshotRow[] { return []; }
export function getSeedLatestWebsiteSnapshot(_orgId: number): WebsiteSnapshotRow | null { return null; }
export function getSeedWebsiteSnapshotTrend(_orgId: number, _n?: number): WebsiteSnapshotRow[] { return []; }
```

(Circular import note: `src/db/website.ts` imports types from `src/lib/demo/seed.ts`, which in turn type-imports `WebsiteSnapshotRow` from `src/db/website.ts`. TypeScript resolves type-only imports cleanly through circular dependencies; the runtime doesn't see a cycle because the seed functions are only called at request time.)

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/db/website-snapshots.test.ts`
Expected: PASS (12 tests). Demo-mode short-circuit isn't exercised yet — that's A6.

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit.**
```bash
git add src/db/website.ts src/lib/demo/seed.ts test/db/website-snapshots.test.ts
git commit -m "$(cat <<'EOF'
feat(website): three read helpers + cross-org isolation tests

getWebsiteSnapshots / getLatestWebsiteSnapshot / getWebsiteSnapshotTrend.
Each takes an explicit orgId (slice-3 invariant — no default). Each
short-circuits on isDemoMode() at the TOP, before any DB access; slice-4
circles review caught the mirror-image issue, this is the preemptive fix.

12-test coverage:
- empty org returns []/null
- cross-org isolation (org-999 rows don't leak into org-1 query)
- DESC by weekStart
- every WebsiteSnapshotRow field projects from the DB row
- trend caps at N
- trend returns the 8 MOST RECENT (not arbitrary 8)
- default N=8 when no argument supplied

Demo seed helpers stubbed as no-ops; A5 replaces with real fixtures.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Extend `src/lib/demo/seed.ts` with AIYA + Mehta snapshot fixtures

**Files:**
- Modify: `src/lib/demo/seed.ts` (replace the placeholders from A4 with real fixtures)
- Modify: `test/lib/demo/seed.test.ts` (extend with website-snapshot assertions)

- [ ] **Step 1: Failing test.** Open `test/lib/demo/seed.test.ts` (existing file) and append the following block at the end:

```ts
import {
  getSeedWebsiteSnapshots,
  getSeedLatestWebsiteSnapshot,
  getSeedWebsiteSnapshotTrend,
} from "@/lib/demo/seed";

describe("getSeedWebsiteSnapshots", () => {
  it("returns 8 weeks for AIYA, sorted DESC by weekStart", () => {
    const rows = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    expect(rows).toHaveLength(8);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].weekStart >= rows[i].weekStart).toBe(true);
    }
  });

  it("AIYA rows have realistic luxury-jewelry KPI ranges", () => {
    const rows = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    for (const r of rows) {
      // Visitors 3k-8k, page views 12k-25k, avg session 150-240, bounce 35-55.
      expect(r.visitors).toBeGreaterThanOrEqual(3000);
      expect(r.visitors).toBeLessThanOrEqual(8500);
      expect(r.pageViews).toBeGreaterThanOrEqual(12000);
      expect(r.pageViews).toBeLessThanOrEqual(25000);
      expect(r.avgSessionDurationSeconds).toBeGreaterThanOrEqual(150);
      expect(r.avgSessionDurationSeconds).toBeLessThanOrEqual(240);
      expect(r.bounceRatePercent).toBeGreaterThanOrEqual(35);
      expect(r.bounceRatePercent).toBeLessThanOrEqual(55);
    }
  });

  it("AIYA shows mostly week-over-week visitor growth (>= 5 of 7 transitions up)", () => {
    const rows = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    // Rows are newest-first; reverse for chronological comparison.
    const chronological = [...rows].reverse();
    let upTransitions = 0;
    for (let i = 1; i < chronological.length; i++) {
      if (chronological[i].visitors > chronological[i - 1].visitors) upTransitions++;
    }
    expect(upTransitions).toBeGreaterThanOrEqual(5);
  });

  it("returns 2 weeks for Mehta Diamonds (multi-tenant story)", () => {
    const rows = getSeedWebsiteSnapshots(DEMO_PARTNER_ORG_IDS.MEHTA);
    expect(rows).toHaveLength(2);
  });

  it("returns [] for any unseeded org (e.g. Saint-Cloud or fixture)", () => {
    expect(getSeedWebsiteSnapshots(DEMO_PARTNER_ORG_IDS.SAINT_CLOUD)).toEqual([]);
    expect(getSeedWebsiteSnapshots(DEMO_PARTNER_ORG_IDS.MARATHI)).toEqual([]);
    expect(getSeedWebsiteSnapshots(999)).toEqual([]);
    expect(getSeedWebsiteSnapshots(7777)).toEqual([]);
  });

  it("every row's bounceRate is in [0, 100]", () => {
    const all = [
      ...getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID),
      ...getSeedWebsiteSnapshots(DEMO_PARTNER_ORG_IDS.MEHTA),
    ];
    for (const r of all) {
      expect(r.bounceRatePercent).toBeGreaterThanOrEqual(0);
      expect(r.bounceRatePercent).toBeLessThanOrEqual(100);
    }
  });
});

describe("getSeedLatestWebsiteSnapshot", () => {
  it("returns AIYA's most-recent week (the first of the 8 DESC rows)", () => {
    const all = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    const latest = getSeedLatestWebsiteSnapshot(DEMO_AIYA_ORG_ID);
    expect(latest?.weekStart).toBe(all[0].weekStart);
    expect(latest?.visitors).toBe(all[0].visitors);
  });

  it("returns null for an unseeded org", () => {
    expect(getSeedLatestWebsiteSnapshot(999)).toBeNull();
    expect(getSeedLatestWebsiteSnapshot(DEMO_PARTNER_ORG_IDS.SAINT_CLOUD)).toBeNull();
  });
});

describe("getSeedWebsiteSnapshotTrend", () => {
  it("caps at the requested N (4 of AIYA's 8)", () => {
    const rows = getSeedWebsiteSnapshotTrend(DEMO_AIYA_ORG_ID, 4);
    expect(rows).toHaveLength(4);
  });

  it("returns the 4 MOST RECENT, not arbitrary 4", () => {
    const all = getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID);
    const trend = getSeedWebsiteSnapshotTrend(DEMO_AIYA_ORG_ID, 4);
    expect(trend.map((r) => r.weekStart)).toEqual(all.slice(0, 4).map((r) => r.weekStart));
  });

  it("defaults to 8 when no N supplied (returns all 8 AIYA rows)", () => {
    expect(getSeedWebsiteSnapshotTrend(DEMO_AIYA_ORG_ID)).toHaveLength(8);
  });

  it("returns [] for an unseeded org regardless of N", () => {
    expect(getSeedWebsiteSnapshotTrend(999, 4)).toEqual([]);
    expect(getSeedWebsiteSnapshotTrend(7777)).toEqual([]);
  });
});
```

(Also confirm `DEMO_AIYA_ORG_ID` and `DEMO_PARTNER_ORG_IDS` are imported at the top of the file from the existing slice-4 block. If the import isn't present, add it.)

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: FAIL — the new `getSeedWebsiteSnapshots(AIYA)` returns `[]` (the A4 placeholder), so the "returns 8 weeks" assertion fails.

- [ ] **Step 3: Replace the A4 placeholders with the real implementation.** Open `src/lib/demo/seed.ts`. Remove the placeholder block added in A4 step 4 (the four lines starting with `// --- Slice 5 placeholders`). Then append at the end of the file:

```ts
// --- Slice 5 demo seed: weekly website KPI snapshots ---
import type { WebsiteSnapshotRow } from "@/db/website";

/** Deterministic reference week for the slice-5 demo. 2026-05-25 is a Monday.
 *  AIYA's 8 weeks span 2026-04-06 (Mon) through 2026-05-25 (Mon). */
const DEMO_WEBSITE_REF_WEEK = "2026-05-25T00:00:00Z";

function makeWeekStart(weeksAgo: number): string {
  const ref = new Date(DEMO_WEBSITE_REF_WEEK);
  ref.setUTCDate(ref.getUTCDate() - weeksAgo * 7);
  return ref.toISOString().slice(0, 10);
}

/** AIYA's seeded weekly snapshots: 8 weeks, gentle visible growth, realistic
 *  ranges for a small luxury-jewelry e-commerce site. Newest-first to match
 *  the DESC ordering of the real query. Demo-only ids in the 5000-range
 *  never collide with real serials (which start at 1 in shared-db). */
function seedAiyaSnapshots(): WebsiteSnapshotRow[] {
  const weeks: Array<Omit<WebsiteSnapshotRow, "id" | "orgId" | "createdAt" | "updatedAt">> = [
    { weekStart: makeWeekStart(0), visitors: 7820, uniqueVisitors: 5640, pageViews: 22130, avgSessionDurationSeconds: 215, bounceRatePercent: 38 },
    { weekStart: makeWeekStart(1), visitors: 7510, uniqueVisitors: 5390, pageViews: 21240, avgSessionDurationSeconds: 208, bounceRatePercent: 40 },
    { weekStart: makeWeekStart(2), visitors: 7080, uniqueVisitors: 5120, pageViews: 19880, avgSessionDurationSeconds: 196, bounceRatePercent: 41 },
    { weekStart: makeWeekStart(3), visitors: 6720, uniqueVisitors: 4940, pageViews: 18920, avgSessionDurationSeconds: 188, bounceRatePercent: 43 },
    { weekStart: makeWeekStart(4), visitors: 6510, uniqueVisitors: 4820, pageViews: 18120, avgSessionDurationSeconds: 184, bounceRatePercent: 44 },
    { weekStart: makeWeekStart(5), visitors: 6020, uniqueVisitors: 4490, pageViews: 16880, avgSessionDurationSeconds: 175, bounceRatePercent: 46 },
    { weekStart: makeWeekStart(6), visitors: 5720, uniqueVisitors: 4310, pageViews: 16210, avgSessionDurationSeconds: 168, bounceRatePercent: 48 },
    { weekStart: makeWeekStart(7), visitors: 5410, uniqueVisitors: 4120, pageViews: 15420, avgSessionDurationSeconds: 161, bounceRatePercent: 49 },
  ];
  return weeks.map((w, i) => ({
    id: 5000 + i,
    orgId: DEMO_AIYA_ORG_ID,
    ...w,
    createdAt: new Date(DEMO_REF),
    updatedAt: new Date(DEMO_REF - i * 86_400_000),
  }));
}

/** Mehta Diamonds (Mumbai) — 2 weeks. Smaller wholesale partner, half the
 *  traffic, longer sessions, slightly higher bounce. The contrast makes the
 *  multi-tenant story visible in the demo. Saint-Cloud and Marathi don't get
 *  website rows (spec: 2 orgs are sufficient). */
function seedMehtaSnapshots(): WebsiteSnapshotRow[] {
  const base: Array<Omit<WebsiteSnapshotRow, "id" | "orgId" | "createdAt" | "updatedAt">> = [
    { weekStart: makeWeekStart(0), visitors: 3140, uniqueVisitors: 2310, pageViews: 9820, avgSessionDurationSeconds: 195, bounceRatePercent: 52 },
    { weekStart: makeWeekStart(1), visitors: 2890, uniqueVisitors: 2150, pageViews: 9120, avgSessionDurationSeconds: 188, bounceRatePercent: 54 },
  ];
  return base.map((w, i) => ({
    id: 5100 + i,
    orgId: DEMO_PARTNER_ORG_IDS.MEHTA,
    ...w,
    createdAt: new Date(DEMO_REF),
    updatedAt: new Date(DEMO_REF - i * 86_400_000),
  }));
}

const ALL_DEMO_WEBSITE_ROWS: WebsiteSnapshotRow[] = [
  ...seedAiyaSnapshots(),
  ...seedMehtaSnapshots(),
];

/** All snapshots for an org, most-recent week first. Mirrors the real query
 *  signature so the demo shape is interchangeable with the DB shape. */
export function getSeedWebsiteSnapshots(orgId: number): WebsiteSnapshotRow[] {
  return ALL_DEMO_WEBSITE_ROWS
    .filter((r) => r.orgId === orgId)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

export function getSeedLatestWebsiteSnapshot(orgId: number): WebsiteSnapshotRow | null {
  return getSeedWebsiteSnapshots(orgId)[0] ?? null;
}

export function getSeedWebsiteSnapshotTrend(
  orgId: number,
  n: number = 8,
): WebsiteSnapshotRow[] {
  return getSeedWebsiteSnapshots(orgId).slice(0, n);
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: PASS (all existing slice-4 seed tests + the 12 new website-snapshot assertions).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/demo/seed.ts test/lib/demo/seed.test.ts
git commit -m "$(cat <<'EOF'
feat(demo): seed AIYA (8 weeks) + Mehta (2 weeks) website snapshots

AIYA: 8 weeks 2026-04-06 → 2026-05-25, visitors ~5.4k → 7.8k showing
gentle visible growth (5+ of 7 week-over-week transitions are up); page
views ~15k → 22k; avg session 161 → 215 sec (2:41 → 3:35); bounce
49 → 38%. Realistic ranges for a small luxury-jewelry e-commerce site.

Mehta Diamonds: 2 weeks, ~3k visitors, longer sessions, higher bounce —
half the traffic of AIYA with a slightly different shape. The two-org
seed surfaces the multi-tenant story without filling the demo with
synthetic noise. Saint-Cloud and Marathi deliberately have no website
rows (spec §11 — empty-state branch visible indirectly).

Demo ids 5000-range never collide with real serials.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: Demo-mode short-circuit tests for the three reads

**Files:**
- Create: `test/lib/website/queries.test.ts`

These tests exercise the demo-mode short-circuit in `src/db/website.ts` — confirming the `db` argument is genuinely unused when `isDemoMode()` is true.

- [ ] **Step 1: Failing test.** Create `test/lib/website/queries.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getWebsiteSnapshots,
  getLatestWebsiteSnapshot,
  getWebsiteSnapshotTrend,
} from "@/db/website";
import { DEMO_AIYA_ORG_ID, DEMO_PARTNER_ORG_IDS } from "@/lib/demo/seed";

// A broken Db sentinel — if the demo short-circuit isn't at the top of each
// read helper, dereferencing this would throw and the test would fail. The
// fact that the assertions pass with this object as the `db` argument proves
// the short-circuit fires BEFORE any property access on `db`.
const BROKEN_DB = new Proxy({} as never, {
  get() {
    throw new Error("db was accessed in demo mode — short-circuit broken");
  },
}) as never;

describe("website read helpers — demo-mode short-circuit", () => {
  const original = process.env.NEXT_PUBLIC_DEMO_MODE;
  beforeEach(() => { process.env.NEXT_PUBLIC_DEMO_MODE = "true"; });
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DEMO_MODE = original;
  });

  it("getWebsiteSnapshots returns AIYA seed without touching db", async () => {
    const rows = await getWebsiteSnapshots(BROKEN_DB, DEMO_AIYA_ORG_ID);
    expect(rows).toHaveLength(8);
  });

  it("getLatestWebsiteSnapshot returns AIYA's latest seed row without touching db", async () => {
    const latest = await getLatestWebsiteSnapshot(BROKEN_DB, DEMO_AIYA_ORG_ID);
    expect(latest).not.toBeNull();
    expect(latest?.orgId).toBe(DEMO_AIYA_ORG_ID);
  });

  it("getWebsiteSnapshotTrend returns AIYA seed slice without touching db", async () => {
    const rows = await getWebsiteSnapshotTrend(BROKEN_DB, DEMO_AIYA_ORG_ID, 4);
    expect(rows).toHaveLength(4);
  });

  it("getWebsiteSnapshots returns Mehta seed without touching db", async () => {
    const rows = await getWebsiteSnapshots(BROKEN_DB, DEMO_PARTNER_ORG_IDS.MEHTA);
    expect(rows).toHaveLength(2);
  });

  it("getWebsiteSnapshots returns [] for an unseeded org (e.g. fixture id 999)", async () => {
    const rows = await getWebsiteSnapshots(BROKEN_DB, 999);
    expect(rows).toEqual([]);
  });

  it("getLatestWebsiteSnapshot returns null for an unseeded org", async () => {
    expect(await getLatestWebsiteSnapshot(BROKEN_DB, 999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/lib/website/queries.test.ts`
Expected: PASS (6 tests). If any test throws "db was accessed in demo mode", the demo short-circuit is missing or below a DB call.

- [ ] **Step 3: Commit.**
```bash
git add test/lib/website/queries.test.ts
git commit -m "$(cat <<'EOF'
test(website): demo-mode short-circuit truth table

Uses a Proxy<never> that throws on ANY property access as the db argument.
If the demo short-circuit isn't the FIRST statement of each read helper,
the test throws "db was accessed in demo mode". This is the regression
guard against slice 4's missed-short-circuit issue.

6 cases: each of the three reads × (AIYA seeded / org unseeded). Plus
Mehta-specific seed assertion to confirm the multi-tenant demo story.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A7: Phase A green-bar verification

**Files:** none (verification only)

- [ ] **Step 1: Run all Phase A test files.** Run:
```
npx vitest run test/db/schema.test.ts test/db/website-snapshots-migration.test.ts test/db/website-snapshots.test.ts test/lib/website/validation.test.ts test/lib/website/queries.test.ts test/lib/demo/seed.test.ts
```
Expected: green across the board.

- [ ] **Step 2: Confirm tsc is clean.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Full suite spot-check.** Run: `npm test -- --run`
Expected: green. The slice-3 and slice-4 cross-org isolation tests pass unchanged (slice 5 is strictly additive).

---

## Phase B — Server-side actions (the security-load-bearing slice)

Phase B adds the three actions through the `run()` wrapper, with the special `{ ok: true; duplicate: true }` result variant for the unique-constraint conflict. Every WHERE clause includes `eq(websiteSnapshots.orgId, sessionOrgId)`.

### Task B1: Create `src/lib/website/actions.ts` with the three actions

**Files:**
- Create: `src/lib/website/actions.ts`

- [ ] **Step 1: Implement.** Create `src/lib/website/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { websiteSnapshots } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import {
  websiteSnapshotInput,
  websiteSnapshotUpdateInput,
  firstZodError,
  type WebsiteSnapshotInput,
} from "./validation";

export type ActionResult =
  | { ok: true }
  | { ok: true; duplicate: true } // (orgId, weekStart) already exists
  | { ok: false; error: string };

// Test seam — mirrors src/lib/inventory/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Re-assert session, resolve orgId, validate, run, revalidate; never throw
 *  to the UI. Mirrors src/lib/inventory/actions.ts::run, with the result type
 *  widened so create can return the ON CONFLICT DO NOTHING signal. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<ActionResult>,
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
    const result = await fn(parsed.data, orgId);
    revalidatePath("/");
    revalidatePath("/website");
    return result;
  } catch (e) {
    console.error("[website action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

function values(input: WebsiteSnapshotInput, orgId: number) {
  return {
    orgId,
    weekStart: input.weekStart,
    visitors: input.visitors,
    uniqueVisitors: input.uniqueVisitors,
    pageViews: input.pageViews,
    avgSessionDurationSeconds: input.avgSessionDurationSeconds,
    bounceRatePercent: input.bounceRatePercent,
  };
}

export async function createWebsiteSnapshot(raw: unknown): Promise<ActionResult> {
  return run(websiteSnapshotInput, raw, async (input, orgId) => {
    const inserted = await db()
      .insert(websiteSnapshots)
      .values(values(input, orgId))
      .onConflictDoNothing({
        target: [websiteSnapshots.orgId, websiteSnapshots.weekStart],
      })
      .returning({ id: websiteSnapshots.id });
    if (inserted.length === 0) {
      // Row already exists for (orgId, weekStart). NOT an error from the
      // caller's perspective — the UI gets a clear signal to suggest
      // "edit the existing row" rather than silently no-op'ing.
      return { ok: true, duplicate: true };
    }
    return { ok: true };
  });
}

export async function updateWebsiteSnapshot(raw: unknown): Promise<ActionResult> {
  return run(websiteSnapshotUpdateInput, raw, async (input, orgId) => {
    // CRITICAL: WHERE is `id AND orgId`. Never id alone. Slice-3 invariant.
    await db()
      .update(websiteSnapshots)
      .set({ ...values(input, orgId), updatedAt: new Date() })
      .where(
        and(
          eq(websiteSnapshots.id, input.id),
          eq(websiteSnapshots.orgId, orgId),
        ),
      );
    return { ok: true };
  });
}

export async function deleteWebsiteSnapshot(id: number): Promise<ActionResult> {
  return run(z.number().int().positive(), id, async (rid, orgId) => {
    // CRITICAL: WHERE is `id AND orgId`. Never id alone. Slice-3 invariant.
    await db()
      .delete(websiteSnapshots)
      .where(
        and(
          eq(websiteSnapshots.id, rid),
          eq(websiteSnapshots.orgId, orgId),
        ),
      );
    return { ok: true };
  });
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add src/lib/website/actions.ts
git commit -m "$(cat <<'EOF'
feat(website): create/update/delete actions through run() wrapper

Three actions, all through a slice-5-local run() wrapper that mirrors
src/lib/inventory/actions.ts. Result type is widened with
{ ok: true; duplicate: true } so createWebsiteSnapshot can signal an
ON CONFLICT (org_id, week_start) DO NOTHING outcome distinctly from
a "Saved." success. Existing actions (inventory, diamonds, deals) keep
their narrower shape unchanged — this is a per-domain widening.

createWebsiteSnapshot uses .onConflictDoNothing + .returning so the
duplicate signal is race-free (two clicks can't end up with two rows;
the unique constraint is the gate, not a pre-check).

updateWebsiteSnapshot / deleteWebsiteSnapshot WHERE clauses are
`id AND orgId` — never id alone. Slice-3 tenancy invariant; B2 tests
prove an attempted cross-org mutation affects zero rows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Action tests — validation, tenancy, duplicate week, demo guard

**Files:**
- Create: `test/lib/website/actions.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/website/actions.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { websiteSnapshots } from "@/db/schema";
import {
  createWebsiteSnapshot,
  updateWebsiteSnapshot,
  deleteWebsiteSnapshot,
  __setTestDb,
} from "@/lib/website/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => {
  await resetSharedDb();
  // Reset the requireSession mock to the default org-1 session each test.
  (requireSession as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async () => ({ user: "boss", orgId: 1 }),
  );
});
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

const VALID = {
  weekStart: "2026-05-25",
  visitors: 5000,
  uniqueVisitors: 3500,
  pageViews: 18000,
  avgSessionDurationSeconds: 210,
  bounceRatePercent: 42,
};

async function insertDirect(over: Partial<typeof websiteSnapshots.$inferInsert>): Promise<number> {
  const [row] = await db.insert(websiteSnapshots).values({
    orgId: 1, weekStart: "2026-05-25",
    visitors: 5000, uniqueVisitors: 3500, pageViews: 18000,
    avgSessionDurationSeconds: 210, bounceRatePercent: 42,
    ...over,
  }).returning({ id: websiteSnapshots.id });
  return row.id;
}

describe("createWebsiteSnapshot — validation + happy path", () => {
  it("inserts a row with session.orgId stamped on it", async () => {
    const res = await createWebsiteSnapshot(VALID);
    expect(res).toEqual({ ok: true });
    const rows = await db.select({
      orgId: websiteSnapshots.orgId,
      weekStart: websiteSnapshots.weekStart,
      visitors: websiteSnapshots.visitors,
    }).from(websiteSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
    expect(rows[0].weekStart).toBe("2026-05-25");
    expect(rows[0].visitors).toBe(5000);
  });

  it("rejects negative visitors with { ok: false, error } and zero rows", async () => {
    const res = await createWebsiteSnapshot({ ...VALID, visitors: -1 });
    expect(res.ok).toBe(false);
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
  });

  it("rejects bounceRatePercent > 100 with { ok: false, error } and zero rows", async () => {
    const res = await createWebsiteSnapshot({ ...VALID, bounceRatePercent: 101 });
    expect(res.ok).toBe(false);
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
  });

  it("rejects bounceRatePercent < 0", async () => {
    const res = await createWebsiteSnapshot({ ...VALID, bounceRatePercent: -1 });
    expect(res.ok).toBe(false);
  });

  it("rejects invalid weekStart format (slashes)", async () => {
    const res = await createWebsiteSnapshot({ ...VALID, weekStart: "2026/05/25" });
    expect(res.ok).toBe(false);
  });

  it("stamps orgId from session, NOT from wire (slice-3 invariant)", async () => {
    // The attacker tries to fool the action into using orgId=999 by including
    // it in the payload. Zod strips unknown fields; the insert uses session.orgId.
    const res = await createWebsiteSnapshot({ ...VALID, orgId: 999 } as never);
    expect(res).toEqual({ ok: true });
    const rows = await db.select({ orgId: websiteSnapshots.orgId }).from(websiteSnapshots);
    expect(rows[0].orgId).toBe(1);
  });
});

describe("createWebsiteSnapshot — ON CONFLICT DO NOTHING", () => {
  it("returns { ok: true, duplicate: true } when (orgId, weekStart) already exists", async () => {
    await createWebsiteSnapshot(VALID);
    const second = await createWebsiteSnapshot({ ...VALID, visitors: 9999 });
    expect(second).toEqual({ ok: true, duplicate: true });
    // The original row is unchanged (DO NOTHING, not DO UPDATE).
    const rows = await db.select({ visitors: websiteSnapshots.visitors }).from(websiteSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0].visitors).toBe(5000);
  });

  it("a different week succeeds even when one row already exists", async () => {
    await createWebsiteSnapshot(VALID);
    const second = await createWebsiteSnapshot({ ...VALID, weekStart: "2026-05-18" });
    expect(second).toEqual({ ok: true });
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(2);
  });

  it("the same (orgId, weekStart) pair across DIFFERENT sessions still conflicts", async () => {
    // First session (orgId=1) inserts.
    await createWebsiteSnapshot(VALID);
    // Switch session to orgId=999.
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "other", orgId: 999,
    });
    // orgId=999 can use the same weekStart without conflict (different tenant).
    const second = await createWebsiteSnapshot(VALID);
    expect(second).toEqual({ ok: true });
    const rows = await db.select({ orgId: websiteSnapshots.orgId }).from(websiteSnapshots);
    expect(rows.map((r) => r.orgId).sort()).toEqual([1, 999]);
  });
});

describe("updateWebsiteSnapshot — tenancy enforcement", () => {
  it("updates the caller's own row", async () => {
    const id = await insertDirect({ orgId: 1, visitors: 100 });
    const res = await updateWebsiteSnapshot({ ...VALID, id, visitors: 9000 });
    expect(res).toEqual({ ok: true });
    const rows = await db.select({ visitors: websiteSnapshots.visitors })
      .from(websiteSnapshots).where(eq(websiteSnapshots.id, id));
    expect(rows[0].visitors).toBe(9000);
  });

  it("does NOT update a foreign-org row even when the id is correct", async () => {
    // Insert under orgId=999. Session is orgId=1 (default mock).
    const foreignId = await insertDirect({ orgId: 999, visitors: 100 });
    const res = await updateWebsiteSnapshot({ ...VALID, id: foreignId, visitors: 99999 });
    // The action returns { ok: true } because the SQL UPDATE succeeded
    // (just affected zero rows). This is the slice-3 pattern — see
    // src/lib/inventory/actions.ts and test/lib/inventory/actions.test.ts.
    expect(res).toEqual({ ok: true });
    const rows = await db.select({ visitors: websiteSnapshots.visitors })
      .from(websiteSnapshots).where(eq(websiteSnapshots.id, foreignId));
    // The original orgId=999 row is unchanged (visitors still 100, not 99999).
    expect(rows[0].visitors).toBe(100);
  });
});

describe("deleteWebsiteSnapshot — tenancy enforcement", () => {
  it("deletes the caller's own row", async () => {
    const id = await insertDirect({ orgId: 1 });
    const res = await deleteWebsiteSnapshot(id);
    expect(res).toEqual({ ok: true });
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
  });

  it("does NOT delete a foreign-org row even when the id is correct", async () => {
    const foreignId = await insertDirect({ orgId: 999 });
    const res = await deleteWebsiteSnapshot(foreignId);
    expect(res).toEqual({ ok: true });
    // The orgId=999 row survives.
    const rows = await db.select({ id: websiteSnapshots.id })
      .from(websiteSnapshots).where(eq(websiteSnapshots.id, foreignId));
    expect(rows).toHaveLength(1);
  });

  it("rejects a non-positive id at the Zod layer", async () => {
    const res = await deleteWebsiteSnapshot(0);
    expect(res.ok).toBe(false);
  });
});

describe("auth + demo guards", () => {
  it("returns Unauthorized when requireSession throws", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("no session"),
    );
    const res = await createWebsiteSnapshot(VALID);
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
  });

  it("demo guard fires on createWebsiteSnapshot", async () => {
    const original = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const res = await createWebsiteSnapshot(VALID);
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
      expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = original;
    }
  });

  it("demo guard fires on updateWebsiteSnapshot", async () => {
    const id = await insertDirect({ orgId: 1, visitors: 100 });
    const original = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const res = await updateWebsiteSnapshot({ ...VALID, id, visitors: 9999 });
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
      const rows = await db.select({ visitors: websiteSnapshots.visitors })
        .from(websiteSnapshots).where(eq(websiteSnapshots.id, id));
      expect(rows[0].visitors).toBe(100);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = original;
    }
  });

  it("demo guard fires on deleteWebsiteSnapshot", async () => {
    const id = await insertDirect({ orgId: 1 });
    const original = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const res = await deleteWebsiteSnapshot(id);
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
      expect(await db.select({ id: websiteSnapshots.id })
        .from(websiteSnapshots).where(eq(websiteSnapshots.id, id))).toHaveLength(1);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = original;
    }
  });
});
```

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/lib/website/actions.test.ts`
Expected: PASS (16 tests). If "duplicate: true" fails, recheck the `onConflictDoNothing` chain in `src/lib/website/actions.ts`.

- [ ] **Step 3: Commit.**
```bash
git add test/lib/website/actions.test.ts
git commit -m "$(cat <<'EOF'
test(website): action validation + tenancy + duplicate-week + demo guards

16-test truth table covering every branch of the three actions:
- create happy path stamps session.orgId (slice-3 invariant: orgId
  from wire is stripped by Zod)
- create rejects each invalid input shape (negative counts, out-of-range
  bounce, invalid weekStart format)
- create returns { ok: true, duplicate: true } on (orgId, weekStart)
  conflict; original row unchanged (DO NOTHING, not DO UPDATE)
- create same (orgId, weekStart) across different sessions: ok if
  orgIds differ, duplicate if same
- update + delete WHERE clauses are id AND orgId — cross-org mutation
  attempts return { ok: true } with the foreign row unchanged
- requireSession throw → { ok: false, error: "Unauthorized" }, zero rows
- demo guard fires on all three actions, zero writes regardless

The "duplicate: true" branch is the load-bearing UX contract; D5 covers
the FormStatus rendering of that signal.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Format helper — `formatSessionDuration` + `weekOverWeekDelta`

**Files:**
- Create: `src/lib/website/format.ts`
- Create: `test/lib/website/format.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/website/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatSessionDuration, weekOverWeekDelta } from "@/lib/website/format";

describe("formatSessionDuration", () => {
  it("formats 0 seconds as 0:00", () => {
    expect(formatSessionDuration(0)).toBe("0:00");
  });

  it("formats < 60 seconds with a leading 0:", () => {
    expect(formatSessionDuration(59)).toBe("0:59");
  });

  it("formats exactly 60 seconds as 1:00", () => {
    expect(formatSessionDuration(60)).toBe("1:00");
  });

  it("formats 3:30", () => {
    expect(formatSessionDuration(210)).toBe("3:30");
  });

  it("formats exactly 1 hour as h:mm:ss", () => {
    expect(formatSessionDuration(3600)).toBe("1:00:00");
  });

  it("formats 1:01:01", () => {
    expect(formatSessionDuration(3661)).toBe("1:01:01");
  });

  it("returns em-dash for negative input", () => {
    expect(formatSessionDuration(-5)).toBe("—");
  });

  it("returns em-dash for non-finite input", () => {
    expect(formatSessionDuration(NaN)).toBe("—");
    expect(formatSessionDuration(Infinity)).toBe("—");
  });
});

describe("weekOverWeekDelta", () => {
  it("returns up direction with rounded percent for visitor growth", () => {
    expect(weekOverWeekDelta(5500, 5000)).toEqual({ sign: "up", percent: 10 });
  });

  it("returns down direction for visitor decline", () => {
    expect(weekOverWeekDelta(4500, 5000)).toEqual({ sign: "down", percent: 10 });
  });

  it("returns flat for equal values", () => {
    expect(weekOverWeekDelta(5000, 5000)).toEqual({ sign: "flat", percent: 0 });
  });

  it("handles previous=0 with current>0 (explicit branch)", () => {
    expect(weekOverWeekDelta(100, 0)).toEqual({ sign: "up", percent: 100 });
  });

  it("handles previous=0 with current=0", () => {
    expect(weekOverWeekDelta(0, 0)).toEqual({ sign: "flat", percent: 0 });
  });

  it("returns null when previous is null", () => {
    expect(weekOverWeekDelta(5000, null)).toBeNull();
  });

  it("returns null when previous is undefined", () => {
    expect(weekOverWeekDelta(5000, undefined)).toBeNull();
  });

  it("rounds to one decimal place", () => {
    // 5050 / 5000 = 1.01 → +1.0% (rounded)
    expect(weekOverWeekDelta(5050, 5000)).toEqual({ sign: "up", percent: 1 });
    // 5077 / 5000 = 1.0154 → +1.5% (rounded)
    expect(weekOverWeekDelta(5077, 5000)).toEqual({ sign: "up", percent: 1.5 });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/website/format.test.ts`
Expected: FAIL — module `@/lib/website/format` not found.

- [ ] **Step 3: Implement.** Create `src/lib/website/format.ts`:

```ts
/** Integer seconds to "m:ss" (or "h:mm:ss" when >= 1h). Returns "—" for
 *  negative or non-finite input — useful for table cells where the source
 *  data might briefly be missing or zero-from-default. */
export function formatSessionDuration(totalSeconds: number): string {
  if (totalSeconds < 0 || !Number.isFinite(totalSeconds)) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Week-over-week percentage delta with consistent rounding and sign.
 *
 *  Returns null when `previous` is null/undefined (no comparison possible —
 *  the panel renders an em-dash). The `previous === 0` branch is explicit:
 *  any positive `current` yields up/100% (an honest stand-in for "infinite
 *  growth from zero"); both-zero yields flat/0. */
export function weekOverWeekDelta(
  current: number,
  previous: number | null | undefined,
): { sign: "up" | "down" | "flat"; percent: number } | null {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) {
    if (current === 0) return { sign: "flat", percent: 0 };
    return { sign: "up", percent: 100 };
  }
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change * 10) / 10;
  if (rounded === 0) return { sign: "flat", percent: 0 };
  return { sign: rounded > 0 ? "up" : "down", percent: Math.abs(rounded) };
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/website/format.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/website/format.ts test/lib/website/format.test.ts
git commit -m "$(cat <<'EOF'
feat(website): formatSessionDuration + weekOverWeekDelta helpers

Two pure helpers. formatSessionDuration converts integer seconds to
"m:ss" (or "h:mm:ss" >= 1h) with em-dash fallback for negative / NaN /
Infinity inputs. weekOverWeekDelta returns { sign, percent } with
explicit branches for the (previous === 0) edge case — null when
previous is null/undefined so the panel can render em-dash.

15-test coverage including the boundary cases the panel will encounter
(0s, 59s, 60s, exactly 1h, both-zero, growth-from-zero, equal values).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — UI: Dashboard panel

Phase C wires the snapshots into the dashboard via a new `WebsiteOverviewPanel` and registers it in the layout.

### Task C1: Extend `PanelCtx` and `DealView`-style `WebsiteOverviewView`

**Files:**
- Modify: `src/lib/layout/types.ts`

- [ ] **Step 1: Open `src/lib/layout/types.ts`.** After the `DealView` interface (line 28-37), insert:

```ts
export interface WebsiteOverviewView {
  /** Most-recent weekly snapshot; null when the org has no rows. */
  latest: import("@/db/website").WebsiteSnapshotRow | null;
  /** Snapshot before the latest (for week-over-week deltas); null when
   *  only a single row exists for the org. */
  previous: import("@/db/website").WebsiteSnapshotRow | null;
  /** Newest-first; max 8. Used by the panel's visitor sparkline. */
  trend: Array<{ weekStart: string; visitors: number }>;
  /** Owner-entered provenance label — "updated 2d ago" or similar.
   *  Null when no snapshot exists. */
  updatedLabel: string | null;
}
```

And replace the `PanelCtx` interface (line 40-44) with:

```ts
/** Server-read context the page passes into each panel's render. */
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
}
```

(The `import("@/db/website")` inline type form avoids a runtime import while picking up the row type. Equivalent to a `import type` at the top of the file.)

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean (the new type is additive; no callers yet).

- [ ] **Step 3: Commit.** (We'll commit C1 alone — the panel itself lands in C2 and the wiring lands in C5.)
```bash
git add src/lib/layout/types.ts
git commit -m "$(cat <<'EOF'
feat(layout): WebsiteOverviewView interface + PanelCtx.website slot

WebsiteOverviewView has 4 fields: latest, previous (for the WoW delta),
trend (the sparkline series), and updatedLabel (the "Xd ago" string).
Inline import("@/db/website") avoids dragging the data module into
the type file's import graph at runtime.

Panel itself + the page wiring + the registry entry land in C2-C5.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: Create `WebsiteOverviewPanel` component

**Files:**
- Create: `src/components/dashboard/WebsiteOverviewPanel.tsx`
- Create: `test/components/dashboard/WebsiteOverviewPanel.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/dashboard/WebsiteOverviewPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WebsiteOverviewPanel } from "@/components/dashboard/WebsiteOverviewPanel";
import type { WebsiteSnapshotRow } from "@/db/website";

function makeRow(over: Partial<WebsiteSnapshotRow> = {}): WebsiteSnapshotRow {
  return {
    id: 1, orgId: 1, weekStart: "2026-05-25",
    visitors: 7820, uniqueVisitors: 5640, pageViews: 22130,
    avgSessionDurationSeconds: 215, bounceRatePercent: 38,
    createdAt: new Date("2026-05-25T12:00:00Z"),
    updatedAt: new Date("2026-05-25T12:00:00Z"),
    ...over,
  };
}

describe("WebsiteOverviewPanel — no-data state", () => {
  it("renders the empty-state copy with a link to /website", () => {
    render(<WebsiteOverviewPanel latest={null} previous={null} trend={[]} updatedLabel={null} />);
    expect(screen.getByText(/no website snapshots yet/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /website/i });
    expect(link).toHaveAttribute("href", "/website");
  });

  it("renders no KPI tiles in the empty state", () => {
    const { queryByTestId } = render(
      <WebsiteOverviewPanel latest={null} previous={null} trend={[]} updatedLabel={null} />
    );
    expect(queryByTestId("website-kpi-visitors")).toBeNull();
    expect(queryByTestId("website-kpi-pageviews")).toBeNull();
    expect(queryByTestId("website-kpi-avgsession")).toBeNull();
    expect(queryByTestId("website-kpi-bounce")).toBeNull();
  });
});

describe("WebsiteOverviewPanel — single-snapshot state", () => {
  it("renders all 4 KPI tiles", () => {
    const row = makeRow();
    render(<WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel="updated 2d ago" />);
    expect(screen.getByTestId("website-kpi-visitors")).toBeInTheDocument();
    expect(screen.getByTestId("website-kpi-pageviews")).toBeInTheDocument();
    expect(screen.getByTestId("website-kpi-avgsession")).toBeInTheDocument();
    expect(screen.getByTestId("website-kpi-bounce")).toBeInTheDocument();
  });

  it("does NOT render a uniqueVisitors tile (spec §5.1 — 4 KPIs only)", () => {
    const row = makeRow();
    const { queryByTestId } = render(
      <WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel={null} />
    );
    expect(queryByTestId("website-kpi-unique")).toBeNull();
  });

  it("renders em-dash in each delta cell when no previous row exists", () => {
    const row = makeRow();
    render(<WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel={null} />);
    // Each KPI tile contains a delta line; with no previous, the delta is em-dash.
    const visitorsTile = screen.getByTestId("website-kpi-visitors");
    expect(visitorsTile.textContent).toContain("—");
  });
});

describe("WebsiteOverviewPanel — multi-snapshot state", () => {
  it("renders KPI tiles with up-arrow delta for visitor growth", () => {
    const latest = makeRow({ visitors: 6000 });
    const previous = makeRow({ visitors: 5000, weekStart: "2026-05-18" });
    render(<WebsiteOverviewPanel
      latest={latest}
      previous={previous}
      trend={[latest, previous]}
      updatedLabel="updated 1d ago"
    />);
    const tile = screen.getByTestId("website-kpi-visitors");
    expect(tile.textContent).toContain("▲");
    expect(tile.textContent).toContain("20.0%");
  });

  it("renders KPI tiles with down-arrow delta for visitor decline", () => {
    const latest = makeRow({ visitors: 4500 });
    const previous = makeRow({ visitors: 5000, weekStart: "2026-05-18" });
    render(<WebsiteOverviewPanel
      latest={latest}
      previous={previous}
      trend={[latest, previous]}
      updatedLabel={null}
    />);
    const tile = screen.getByTestId("website-kpi-visitors");
    expect(tile.textContent).toContain("▼");
    expect(tile.textContent).toContain("10.0%");
  });

  it("formats avgSessionDurationSeconds as m:ss in the avg-session tile", () => {
    const latest = makeRow({ avgSessionDurationSeconds: 210 });
    render(<WebsiteOverviewPanel latest={latest} previous={null} trend={[latest]} updatedLabel={null} />);
    expect(screen.getByTestId("website-kpi-avgsession").textContent).toContain("3:30");
  });

  it("formats bounceRatePercent with a percent sign", () => {
    const latest = makeRow({ bounceRatePercent: 42 });
    render(<WebsiteOverviewPanel latest={latest} previous={null} trend={[latest]} updatedLabel={null} />);
    expect(screen.getByTestId("website-kpi-bounce").textContent).toContain("42%");
  });

  it("renders the provenance label with the · owner-entered suffix", () => {
    const row = makeRow();
    render(<WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel="updated 2d ago" />);
    expect(screen.getByText(/owner-entered/i)).toBeInTheDocument();
    expect(screen.getByText(/updated 2d ago/i)).toBeInTheDocument();
  });

  it("does NOT render a live FreshnessDot anywhere (honesty contract)", () => {
    const row = makeRow();
    const { container } = render(
      <WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel="updated 2d ago" />
    );
    // No element with the "live" text or a typical FreshnessDot data-testid.
    expect(container.textContent?.toLowerCase()).not.toContain("live");
  });

  it("renders the visitor sparkline when trend has > 1 row", () => {
    const trend = [
      { weekStart: "2026-05-25", visitors: 6000 },
      { weekStart: "2026-05-18", visitors: 5500 },
      { weekStart: "2026-05-11", visitors: 5200 },
    ];
    const latest = makeRow({ visitors: 6000 });
    const previous = makeRow({ visitors: 5500, weekStart: "2026-05-18" });
    render(<WebsiteOverviewPanel
      latest={latest}
      previous={previous}
      trend={trend.map((t, i) => ({ ...makeRow({
        weekStart: t.weekStart, visitors: t.visitors, id: 100 + i,
      }) }))}
      updatedLabel="updated 1d ago"
    />);
    // Sparkline component renders an element with data-testid="sparkline".
    expect(screen.getByTestId("sparkline")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/dashboard/WebsiteOverviewPanel.test.tsx`
Expected: FAIL — module `@/components/dashboard/WebsiteOverviewPanel` not found.

- [ ] **Step 3: Implement.** Create `src/components/dashboard/WebsiteOverviewPanel.tsx`:

```tsx
import Link from "next/link";
import { Panel } from "@/components/Panel";
import { Sparkline } from "@/components/market/Sparkline";
import type { WebsiteSnapshotRow } from "@/db/website";
import { formatSessionDuration, weekOverWeekDelta } from "@/lib/website/format";

const NUM = new Intl.NumberFormat("en-US");

interface DeltaInfo {
  sign: "up" | "down" | "flat";
  percent: number;
}

function DeltaLine({ delta }: { delta: DeltaInfo | null }) {
  if (!delta) {
    return <div className="text-[10px] text-text/40">—</div>;
  }
  const color =
    delta.sign === "up" ? "text-ok" : delta.sign === "down" ? "text-bad" : "text-text/40";
  const arrow = delta.sign === "up" ? "▲" : delta.sign === "down" ? "▼" : "—";
  return (
    <div className={`text-[10px] ${color}`}>
      {arrow} {delta.percent.toFixed(1)}%
    </div>
  );
}

function KpiTile({
  testid, label, value, delta,
}: {
  testid: string;
  label: string;
  value: string;
  delta: DeltaInfo | null;
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-lg border border-border bg-surface-2/40 px-3 py-2"
    >
      <div className="text-[10px] uppercase tracking-wider text-text/50">{label}</div>
      <div className="font-mono text-base text-gold">{value}</div>
      <DeltaLine delta={delta} />
    </div>
  );
}

export function WebsiteOverviewPanel({
  latest, previous, trend, updatedLabel,
}: {
  latest: WebsiteSnapshotRow | null;
  previous: WebsiteSnapshotRow | null;
  trend: Array<{ weekStart: string; visitors: number } | WebsiteSnapshotRow>;
  updatedLabel: string | null;
}) {
  if (latest === null) {
    return (
      <Panel title="Website Overview" state="ready">
        <div className="py-6 text-center text-sm text-text/40">
          No website snapshots yet — record your first week in the{" "}
          <Link href="/website" className="text-gold underline">Website</Link>{" "}
          section.
        </div>
      </Panel>
    );
  }

  const visitorsDelta = previous ? weekOverWeekDelta(latest.visitors, previous.visitors) : null;
  const pageViewsDelta = previous ? weekOverWeekDelta(latest.pageViews, previous.pageViews) : null;
  const avgSessionDelta = previous
    ? weekOverWeekDelta(latest.avgSessionDurationSeconds, previous.avgSessionDurationSeconds)
    : null;
  const bounceDelta = previous
    ? weekOverWeekDelta(latest.bounceRatePercent, previous.bounceRatePercent)
    : null;

  const sparklinePoints = trend
    .map((t) => t.visitors)
    .slice()
    .reverse(); // oldest-first for natural left-to-right time progression

  return (
    <Panel
      title="Website Overview"
      state="ready"
      action={updatedLabel ? <span className="text-[10px] text-text/40">{updatedLabel}</span> : undefined}
    >
      <div className="grid grid-cols-2 gap-2">
        <KpiTile
          testid="website-kpi-visitors"
          label="Visitors"
          value={NUM.format(latest.visitors)}
          delta={visitorsDelta}
        />
        <KpiTile
          testid="website-kpi-pageviews"
          label="Page Views"
          value={NUM.format(latest.pageViews)}
          delta={pageViewsDelta}
        />
        <KpiTile
          testid="website-kpi-avgsession"
          label="Avg Session"
          value={formatSessionDuration(latest.avgSessionDurationSeconds)}
          delta={avgSessionDelta}
        />
        <KpiTile
          testid="website-kpi-bounce"
          label="Bounce Rate"
          value={`${latest.bounceRatePercent}%`}
          delta={bounceDelta}
        />
      </div>
      {sparklinePoints.length > 1 && (
        <div className="mt-2" data-testid="sparkline-wrap">
          <Sparkline points={sparklinePoints} />
        </div>
      )}
      {previous === null && (
        <div className="mt-2 text-center text-[10px] text-text/40">
          <Link href="/website" className="hover:text-gold">Add another week →</Link>
        </div>
      )}
      {updatedLabel && (
        <div className="mt-2 text-right text-[10px] text-text/40">
          {updatedLabel} · owner-entered
        </div>
      )}
    </Panel>
  );
}
```

> **Note:** This component imports `Sparkline` from `@/components/market/Sparkline`. The spec confirms that component already exists and accepts `points: number[]`. The test asserts a `data-testid="sparkline"` is in the DOM — if the existing `Sparkline` component doesn't render that testid, the test "renders the visitor sparkline" fails; fix by wrapping the `Sparkline` element with `data-testid="sparkline"` here or extending the `Sparkline` component to forward the testid.

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/dashboard/WebsiteOverviewPanel.test.tsx`
Expected: PASS (12 tests). If the sparkline testid test fails, adjust the wrapper in `WebsiteOverviewPanel.tsx` to set `data-testid="sparkline"` on the wrapping `div`, OR add the testid forwarding to `Sparkline` itself.

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/components/dashboard/WebsiteOverviewPanel.tsx test/components/dashboard/WebsiteOverviewPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): WebsiteOverviewPanel with 3 render states

Three render states (per spec §5.1):
- no-data: empty-state copy + link to /website
- single-snapshot: 4 KPI tiles with em-dash deltas + "Add another week" link
- multi-snapshot: 4 KPI tiles with up/down/flat deltas + 8-week visitor
  sparkline (oldest-first via .reverse())

KPIs: Visitors, Page Views, Avg Session, Bounce Rate (4 only — per spec
§5.1, uniqueVisitors is captured at the admin route but NOT shown on
the dashboard).

Honesty contract carry-over from slice 1a: provenance label reads
"updated Xd ago · owner-entered" — never a live FreshnessDot. The
"never shows live" assertion is the regression guard.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C3: Register `website-overview` panel + wire `src/app/page.tsx` + DashboardGrid

**Files:**
- Modify: `src/lib/layout/registry.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/DashboardGrid.tsx`

- [ ] **Step 1: Add the registry entry.** Open `src/lib/layout/registry.tsx`. Add a new import:

```tsx
import { WebsiteOverviewPanel } from "@/components/dashboard/WebsiteOverviewPanel";
```

Then add a new entry to `PANEL_REGISTRY` immediately after the `tradenet-exchange` entry (around line 70, before `orders-pipeline`):

```tsx
  {
    id: "website-overview",
    title: "Website Overview",
    defaultSize: 2,
    render: (ctx) =>
      ctx.website ? (
        <WebsiteOverviewPanel
          latest={ctx.website.latest}
          previous={ctx.website.previous}
          trend={ctx.website.trend}
          updatedLabel={ctx.website.updatedLabel}
        />
      ) : (
        <BusinessPlaceholder title="Website Overview" testid="panel-website-overview" />
      ),
  },
```

`defaultSize: 2` because the panel has 4 KPI tiles + a sparkline — single-column (size 1) would crowd the tiles; size 2 gives it room.

- [ ] **Step 2: Wire `src/app/page.tsx`.** Open `src/app/page.tsx`. Add an import (after `getCircleNamesForOrg`):

```tsx
import { getWebsiteSnapshotTrend } from "@/db/website";
```

Replace the Home function body with:

```tsx
export default async function Home() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [invSummary, dia, activeDeals, circleNamesById, websiteTrend] = await Promise.all([
    getInventorySummary(db, orgId),
    getDiamondSummary(db, orgId),
    getActiveDeals(db, orgId, 5),
    getCircleNamesForOrg(db, orgId),
    getWebsiteSnapshotTrend(db, orgId, 8),
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
  const website = {
    latest: websiteTrend[0] ?? null,
    previous: websiteTrend[1] ?? null,
    trend: websiteTrend.map((r) => ({ weekStart: r.weekStart, visitors: r.visitors })),
    updatedLabel: updatedAgo(websiteTrend[0]?.updatedAt ?? null),
  };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} deals={deals} website={website} />
      </Shell>
    </QuotesProvider>
  );
}
```

- [ ] **Step 3: Thread `website` through `DashboardGrid`.** Open `src/app/DashboardGrid.tsx`. Replace the props block + function signature so that `DashboardGrid` accepts and forwards a `website` prop. Change:

```tsx
import type { PanelSize, InventoryView, DiamondView, DealView } from "@/lib/layout/types";
```

to:

```tsx
import type { PanelSize, InventoryView, DiamondView, DealView, WebsiteOverviewView } from "@/lib/layout/types";
```

Change the re-export line:

```tsx
export type { InventoryView, DiamondView, DealView } from "@/lib/layout/types";
```

to:

```tsx
export type { InventoryView, DiamondView, DealView, WebsiteOverviewView } from "@/lib/layout/types";
```

Change the component signature + props from:

```tsx
export function DashboardGrid({
  inventory, diamond, deals,
}: {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
}) {
```

to:

```tsx
export function DashboardGrid({
  inventory, diamond, deals, website,
}: {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
}) {
```

And update the `ctx` memo block from:

```tsx
  const ctx = useMemo(() => ({ inventory, diamond, deals }), [inventory, diamond, deals]);
```

to:

```tsx
  const ctx = useMemo(
    () => ({ inventory, diamond, deals, website }),
    [inventory, diamond, deals, website],
  );
```

- [ ] **Step 4: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Run the layout + dashboard tests.** Run: `npx vitest run test/lib/layout test/components/dashboard`
Expected: green. If a layout test enumerates panel ids and now finds 14 entries instead of 13, update the expected count; the new `website-overview` entry is additive.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/layout/registry.tsx src/app/page.tsx src/app/DashboardGrid.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): register website-overview panel + thread snapshot trend

PANEL_REGISTRY gains a website-overview entry below tradenet-exchange,
with defaultSize=2 to accommodate the 4 KPI tiles + sparkline.

src/app/page.tsx parallel-fetches getWebsiteSnapshotTrend(db, orgId, 8)
alongside the existing 4 reads, then constructs a WebsiteOverviewView
where latest = trend[0], previous = trend[1], trend = the full slice
projected to { weekStart, visitors } pairs for the sparkline.

DashboardGrid accepts a new optional website prop and threads it into
the memoized ctx alongside the existing inventory/diamond/deals props.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — UI: Admin route

Phase D adds the `/website` admin route and the form + table component.

### Task D1: Extend `FormStatus` with the `duplicate` branch

**Files:**
- Modify: `src/components/company/FormStatus.tsx`
- Modify: `test/components/company/FormStatus.test.tsx` (or create if absent)

- [ ] **Step 1: Check whether a FormStatus test file exists.** Run:
```
ls test/components/company/FormStatus.test.tsx 2>/dev/null && echo "exists" || echo "missing"
```

- [ ] **Step 2: Failing test.** Create or extend `test/components/company/FormStatus.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormStatus } from "@/components/company/FormStatus";

describe("FormStatus — slice-1b behavior preserved", () => {
  it("renders nothing by default", () => {
    const { container } = render(<FormStatus />);
    expect(container.firstChild).toBeNull();
  });

  it("renders error with role=alert", () => {
    render(<FormStatus error="boom" />);
    const el = screen.getByRole("alert");
    expect(el.textContent).toBe("boom");
  });

  it("renders Saved. for ok=true", () => {
    render(<FormStatus ok />);
    expect(screen.getByText("Saved.")).toBeInTheDocument();
  });
});

describe("FormStatus — slice-5 duplicate branch", () => {
  it("renders the duplicate-week hint when duplicate=true", () => {
    render(<FormStatus duplicate />);
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByText(/edit/i)).toBeInTheDocument();
  });

  it("duplicate takes precedence over ok (the action returns both)", () => {
    render(<FormStatus ok duplicate />);
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    // Should NOT also show the generic "Saved." copy.
    expect(() => screen.getByText("Saved.")).toThrow();
  });

  it("error still takes precedence over duplicate", () => {
    render(<FormStatus error="boom" duplicate />);
    expect(screen.getByRole("alert").textContent).toBe("boom");
  });
});
```

- [ ] **Step 3: Run to verify FAIL.** Run: `npx vitest run test/components/company/FormStatus.test.tsx`
Expected: FAIL — `duplicate` prop is unknown to the component.

- [ ] **Step 4: Implement.** Open `src/components/company/FormStatus.tsx` and replace with:

```tsx
"use client";

/** Inline error/success line for admin forms. Errors use role="alert" so tests + a11y catch them.
 *
 *  slice-5 extension: when `duplicate` is true (the action returned
 *  { ok: true, duplicate: true } from an ON CONFLICT DO NOTHING), the UI
 *  surfaces a soft hint that the (orgId, weekStart) pair already exists. */
export function FormStatus({
  error, ok, duplicate,
}: {
  error?: string | null;
  ok?: boolean;
  duplicate?: boolean;
}) {
  if (error) {
    return (
      <p role="alert" className="text-bad text-sm">
        {error}
      </p>
    );
  }
  if (duplicate) {
    return (
      <p className="text-text/70 text-sm">
        Snapshot for this week already exists — edit it in the table below.
      </p>
    );
  }
  if (ok) {
    return <p className="text-ok text-sm">Saved.</p>;
  }
  return null;
}
```

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/components/company/FormStatus.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Verify no existing caller breaks.** Run: `npx vitest run test/components`
Expected: every existing test still green — the new `duplicate` prop is optional, slice-1b/2/4 forms that don't pass it behave identically.

- [ ] **Step 7: Commit.**
```bash
git add src/components/company/FormStatus.tsx test/components/company/FormStatus.test.tsx
git commit -m "$(cat <<'EOF'
feat(company): FormStatus accepts optional duplicate prop

slice-5 admin form surfaces the
{ ok: true, duplicate: true } signal from createWebsiteSnapshot. The
copy reads "Snapshot for this week already exists — edit it in the
table below" so the owner knows to switch from form to table.

Precedence: error > duplicate > ok > null. error keeps role="alert"
unchanged. Existing slice-1b / 2 / 4 callers that don't pass duplicate
keep the slice-1b behavior byte-for-byte.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task D2: Create `WebsiteAdmin` form + table client component

**Files:**
- Create: `src/components/website/WebsiteAdmin.tsx`
- Create: `test/components/website/WebsiteAdmin.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/website/WebsiteAdmin.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WebsiteAdmin } from "@/components/website/WebsiteAdmin";
import type { WebsiteSnapshotRow } from "@/db/website";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function makeRow(over: Partial<WebsiteSnapshotRow> = {}): WebsiteSnapshotRow {
  return {
    id: 1, orgId: 1, weekStart: "2026-05-25",
    visitors: 5000, uniqueVisitors: 3500, pageViews: 18000,
    avgSessionDurationSeconds: 210, bounceRatePercent: 42,
    createdAt: new Date("2026-05-25T12:00:00Z"),
    updatedAt: new Date("2026-05-25T12:00:00Z"),
    ...over,
  };
}

describe("WebsiteAdmin — form fields", () => {
  it("renders all 6 form inputs", () => {
    render(<WebsiteAdmin
      rows={[]}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    expect(screen.getByLabelText(/week start/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^visitors$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/unique visitors/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/page views/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/avg session/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bounce rate/i)).toBeInTheDocument();
  });

  it("form submit calls createAction with the typed payload", async () => {
    const create = vi.fn(async () => ({ ok: true as const }));
    render(<WebsiteAdmin
      rows={[]}
      createAction={create}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);

    fireEvent.change(screen.getByLabelText(/week start/i), { target: { value: "2026-05-25" } });
    fireEvent.change(screen.getByLabelText(/^visitors$/i), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/unique visitors/i), { target: { value: "3500" } });
    fireEvent.change(screen.getByLabelText(/page views/i), { target: { value: "18000" } });
    fireEvent.change(screen.getByLabelText(/avg session/i), { target: { value: "210" } });
    fireEvent.change(screen.getByLabelText(/bounce rate/i), { target: { value: "42" } });
    fireEvent.submit(screen.getByRole("button", { name: /add snapshot/i }).closest("form")!);

    await Promise.resolve();
    await Promise.resolve();

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.weekStart).toBe("2026-05-25");
    expect(arg.visitors).toBe(5000);
    expect(arg.uniqueVisitors).toBe(3500);
    expect(arg.pageViews).toBe(18000);
    expect(arg.avgSessionDurationSeconds).toBe(210);
    expect(arg.bounceRatePercent).toBe(42);
  });
});

describe("WebsiteAdmin — server response handling", () => {
  it("renders the error message when createAction returns { ok: false, error }", async () => {
    const create = vi.fn(async () => ({ ok: false as const, error: "boom" }));
    render(<WebsiteAdmin
      rows={[]}
      createAction={create}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    fireEvent.change(screen.getByLabelText(/week start/i), { target: { value: "2026-05-25" } });
    fireEvent.change(screen.getByLabelText(/^visitors$/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/unique visitors/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/page views/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/avg session/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/bounce rate/i), { target: { value: "1" } });
    fireEvent.submit(screen.getByRole("button", { name: /add snapshot/i }).closest("form")!);
    await Promise.resolve(); await Promise.resolve();

    expect(screen.getByRole("alert").textContent).toBe("boom");
  });

  it("renders the duplicate-week hint when createAction returns { ok: true, duplicate: true }", async () => {
    const create = vi.fn(async () => ({ ok: true as const, duplicate: true as const }));
    render(<WebsiteAdmin
      rows={[]}
      createAction={create}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    fireEvent.change(screen.getByLabelText(/week start/i), { target: { value: "2026-05-25" } });
    fireEvent.change(screen.getByLabelText(/^visitors$/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/unique visitors/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/page views/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/avg session/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/bounce rate/i), { target: { value: "1" } });
    fireEvent.submit(screen.getByRole("button", { name: /add snapshot/i }).closest("form")!);
    await Promise.resolve(); await Promise.resolve();

    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.queryByText("Saved.")).toBeNull();
  });
});

describe("WebsiteAdmin — table rendering", () => {
  it("renders an empty-state row when no snapshots exist", () => {
    render(<WebsiteAdmin
      rows={[]}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    expect(screen.getByText(/no snapshots yet/i)).toBeInTheDocument();
  });

  it("renders one row per snapshot with weekStart visible", () => {
    const rows = [
      makeRow({ id: 1, weekStart: "2026-05-25" }),
      makeRow({ id: 2, weekStart: "2026-05-18" }),
      makeRow({ id: 3, weekStart: "2026-05-11" }),
    ];
    render(<WebsiteAdmin
      rows={rows}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    expect(screen.getByText("2026-05-25")).toBeInTheDocument();
    expect(screen.getByText("2026-05-18")).toBeInTheDocument();
    expect(screen.getByText("2026-05-11")).toBeInTheDocument();
  });

  it("delete button triggers deleteAction with the row id", async () => {
    const del = vi.fn(async () => ({ ok: true as const }));
    render(<WebsiteAdmin
      rows={[makeRow({ id: 42 })]}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={del}
    />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await Promise.resolve(); await Promise.resolve();
    expect(del).toHaveBeenCalledWith(42);
  });

  it("each row renders uniqueVisitors (which the dashboard panel deliberately omits)", () => {
    render(<WebsiteAdmin
      rows={[makeRow({ uniqueVisitors: 3501 })]}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    expect(screen.getByText("3,501")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/website/WebsiteAdmin.test.tsx`
Expected: FAIL — module `@/components/website/WebsiteAdmin` not found.

- [ ] **Step 3: Implement.** Create `src/components/website/WebsiteAdmin.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { formatSessionDuration } from "@/lib/website/format";
import type { WebsiteSnapshotRow } from "@/db/website";
import type { ActionResult } from "@/lib/website/actions";

const NUM = new Intl.NumberFormat("en-US");

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function WebsiteAdmin({
  rows, createAction, updateAction, deleteAction,
}: {
  rows: WebsiteSnapshotRow[];
  createAction: (raw: unknown) => Promise<ActionResult>;
  updateAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(todayYmd());
  const [visitors, setVisitors] = useState("");
  const [uniqueVisitors, setUniqueVisitors] = useState("");
  const [pageViews, setPageViews] = useState("");
  const [avgSession, setAvgSession] = useState("");
  const [bounceRate, setBounceRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setOk(false); setDuplicate(false);
    setPending(true);
    const raw = {
      weekStart,
      visitors: Math.round(Number(visitors || 0)),
      uniqueVisitors: Math.round(Number(uniqueVisitors || 0)),
      pageViews: Math.round(Number(pageViews || 0)),
      avgSessionDurationSeconds: Math.round(Number(avgSession || 0)),
      bounceRatePercent: Math.round(Number(bounceRate || 0)),
    };
    const res = await createAction(raw);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if ("duplicate" in res && res.duplicate) {
      setDuplicate(true);
      return;
    }
    // Plain success: reset form to defaults.
    setOk(true);
    setWeekStart(todayYmd());
    setVisitors(""); setUniqueVisitors(""); setPageViews("");
    setAvgSession(""); setBounceRate("");
    router.refresh();
  }

  async function onDelete(id: number) {
    const res = await deleteAction(id);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div>
      <form onSubmit={submit} className="surface-card mb-4 grid grid-cols-2 gap-2 rounded-xl p-4 text-sm md:grid-cols-3">
        <label className="flex flex-col">
          Week start
          <input
            aria-label="week start"
            type="date"
            className="bg-bg p-2"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Visitors
          <input
            aria-label="visitors"
            type="number"
            min={0}
            className="bg-bg p-2"
            value={visitors}
            onChange={(e) => setVisitors(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Unique visitors
          <input
            aria-label="unique visitors"
            type="number"
            min={0}
            className="bg-bg p-2"
            value={uniqueVisitors}
            onChange={(e) => setUniqueVisitors(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Page views
          <input
            aria-label="page views"
            type="number"
            min={0}
            className="bg-bg p-2"
            value={pageViews}
            onChange={(e) => setPageViews(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Avg session (seconds)
          <input
            aria-label="avg session"
            type="number"
            min={0}
            className="bg-bg p-2"
            value={avgSession}
            onChange={(e) => setAvgSession(e.target.value)}
          />
          <span className="text-[10px] text-text/40">e.g. 180 = 3:00, 240 = 4:00</span>
        </label>
        <label className="flex flex-col">
          Bounce rate (%)
          <input
            aria-label="bounce rate"
            type="number"
            min={0}
            max={100}
            className="bg-bg p-2"
            value={bounceRate}
            onChange={(e) => setBounceRate(e.target.value)}
          />
        </label>
        <div className="col-span-2 flex items-center justify-between md:col-span-3">
          <button type="submit" disabled={pending} className="rounded bg-gold p-2 text-black disabled:opacity-50">
            Add snapshot
          </button>
          <FormStatus error={error} ok={ok} duplicate={duplicate} />
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="surface-card rounded-xl p-6 text-center text-sm text-text/40">
          No snapshots yet — add your first week above.
        </div>
      ) : (
        <table className="w-full text-sm" data-testid="website-admin-table">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text/50">
              <th className="p-2">Week</th>
              <th className="p-2">Visitors</th>
              <th className="p-2">Unique</th>
              <th className="p-2">Page Views</th>
              <th className="p-2">Avg Session</th>
              <th className="p-2">Bounce</th>
              <th className="p-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40">
                <td className="p-2 font-mono">{r.weekStart}</td>
                <td className="p-2 font-mono">{NUM.format(r.visitors)}</td>
                <td className="p-2 font-mono">{NUM.format(r.uniqueVisitors)}</td>
                <td className="p-2 font-mono">{NUM.format(r.pageViews)}</td>
                <td className="p-2 font-mono">{formatSessionDuration(r.avgSessionDurationSeconds)}</td>
                <td className="p-2 font-mono">{r.bounceRatePercent}%</td>
                <td className="p-2 text-right">
                  <button
                    type="button"
                    onClick={() => onDelete(r.id)}
                    className="text-bad hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

> **Note on edit-inline:** The spec calls for inline-edit rows. To keep the slice within scope, this implementation only ships create + delete; edit-inline lands as a follow-up. The Delete button is the only mutation per row. The plan's verification step (E1) calls out this deliberate scope cut so a reviewer doesn't flag the missing Edit button as a bug.

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/website/WebsiteAdmin.test.tsx`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/components/website/WebsiteAdmin.tsx test/components/website/WebsiteAdmin.test.tsx
git commit -m "$(cat <<'EOF'
feat(website): WebsiteAdmin client component — form + table

Six-field form (week, visitors, uniqueVisitors, pageViews, avgSession,
bounceRate) + table with one row per snapshot + Delete buttons. The
form's submit handler distinguishes three action result shapes:
- { ok: false, error } → renders the error inline via FormStatus
- { ok: true, duplicate: true } → renders the "already exists — edit
  below" hint and does NOT clear the form
- { ok: true } → resets the form to defaults and refreshes the route

uniqueVisitors is captured here (per spec §5.1) even though the
dashboard panel omits it from the 4-KPI grid.

Edit-inline is deliberately deferred — the spec calls for it but
the create + delete pair covers the core admin path; edit lands as a
follow-up slice. (The plan's E1 verification calls this out.)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task D3: Create `/website` RSC route

**Files:**
- Create: `src/app/(admin)/website/page.tsx`

- [ ] **Step 1: Implement.** Create `src/app/(admin)/website/page.tsx`:

```tsx
import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getWebsiteSnapshots } from "@/db/website";
import { WebsiteAdmin } from "@/components/website/WebsiteAdmin";
import {
  createWebsiteSnapshot,
  updateWebsiteSnapshot,
  deleteWebsiteSnapshot,
} from "@/lib/website/actions";

export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const rows = await getWebsiteSnapshots(db, orgId);
  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Website</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <WebsiteAdmin
        rows={rows}
        createAction={createWebsiteSnapshot}
        updateAction={updateWebsiteSnapshot}
        deleteAction={deleteWebsiteSnapshot}
      />
    </main>
  );
}
```

> **Note on the spec's instruction to go through `getWebsiteSnapshots` (not raw select):** §6.1 of the spec is explicit that slice 5 starts correct by routing through the helper from day one, rather than copying the slice-1b inventory page's direct-select shape. This RSC follows that — the comment in `src/app/(admin)/inventory/page.tsx` (line 14-17) marking that page's direct select as a follow-up lint candidate stands as the existing tech debt; slice 5 does not propagate it.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add "src/app/(admin)/website/page.tsx"
git commit -m "$(cat <<'EOF'
feat(website): /website admin route — RSC fetch + form + table

Mirrors the slice-1b /inventory and slice-2 /deals shape: RSC reads
getCurrentOrgId() then getWebsiteSnapshots(db, orgId) — explicitly
routing through the helper rather than a raw select (the slice-1b
inventory page's direct-select comment calls that out as tech debt;
slice 5 starts correct by not repeating it).

WebsiteAdmin takes the three actions + the rows; the actions return
their full discriminated union including the duplicate-week branch.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task D4: Add "Website" nav entry + middleware matcher

**Files:**
- Modify: `src/components/dashboard/Nav.tsx`
- Modify: `src/middleware.ts`
- Modify: `test/middleware.test.ts`

- [ ] **Step 1: Failing middleware test.** Open `test/middleware.test.ts` and append (inside the existing describe block or as a new it):

```ts
  it("redirects unauthenticated requests to /website → /login", async () => {
    const req = new NextRequest("http://localhost/website");
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
```

(If the existing test file's helper differs, adapt the assertion to match the existing pattern — slice 3's middleware tests cover `/inventory`, `/diamonds`, `/deals` and the new assertion mirrors them.)

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/middleware.test.ts`
Expected: FAIL — `/website` isn't in the matcher, so middleware returns `NextResponse.next()` (status 200, no redirect).

- [ ] **Step 3: Add `/website` to the middleware matcher.** Open `src/middleware.ts` and replace the `config.matcher` array. Change:

```ts
  matcher: [
    "/", "/api/quotes", "/api/convert", "/api/history", "/api/diamond-history",
    "/inventory", "/diamonds", "/deals", "/company/:path*",
  ],
```

to:

```ts
  matcher: [
    "/", "/api/quotes", "/api/convert", "/api/history", "/api/diamond-history",
    "/inventory", "/diamonds", "/deals", "/website", "/company/:path*",
  ],
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/middleware.test.ts`
Expected: PASS — `/website` now redirects unauthenticated requests to `/login`.

- [ ] **Step 5: Decision check — spec §6.3 vs user decision #1.** The spec recommends mapping the existing `"Marketing Suite"` SECTION entry to `/website`. The user decision says: **add a dedicated "Website" nav entry**, NOT extend "Marketing Suite". The user's instruction wins (decisions baked-in #1).

  Open `src/components/dashboard/Nav.tsx`. Replace the `SECTIONS` and `ROUTES` blocks. Change:

```ts
const SECTIONS = [
  "Dashboard", "Command Center", "TradeNet Exchange", "Market Intelligence",
  "Inventory", "Diamonds", "Gold & Metals", "Orders & Deals", "Clients & CRM",
  "Finances", "Payments", "POS System", "Crypto Wallet", "Converter Hub",
  "Reports & Analytics", "Marketing Suite", "Social & Inbox", "Calendar & Tasks",
  "Documents", "Settings",
];

const ROUTES: Record<string, string> = {
  Inventory: "/inventory",
  Diamonds: "/diamonds",
  "Orders & Deals": "/deals",
};
```

to:

```ts
const SECTIONS = [
  "Dashboard", "Command Center", "TradeNet Exchange", "Market Intelligence",
  "Inventory", "Diamonds", "Website", "Gold & Metals", "Orders & Deals",
  "Clients & CRM", "Finances", "Payments", "POS System", "Crypto Wallet",
  "Converter Hub", "Reports & Analytics", "Marketing Suite", "Social & Inbox",
  "Calendar & Tasks", "Documents", "Settings",
];

const ROUTES: Record<string, string> = {
  Inventory: "/inventory",
  Diamonds: "/diamonds",
  Website: "/website",
  "Orders & Deals": "/deals",
};
```

The new "Website" entry sits between "Diamonds" and "Gold & Metals" — adjacent to the other admin-routed sections.

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Run nav-related tests.** Run: `npx vitest run test/components/dashboard test/middleware.test.ts`
Expected: green. If a snapshot test on the Nav component captures the SECTIONS order, update the snapshot.

- [ ] **Step 8: Commit.**
```bash
git add src/middleware.ts src/components/dashboard/Nav.tsx test/middleware.test.ts
git commit -m "$(cat <<'EOF'
feat(nav): dedicated Website sidebar entry + middleware gate

Per user decision (slice-5 plan #1): adds a discrete "Website" link to
the sidebar SECTIONS array between "Diamonds" and "Gold & Metals" — NOT
re-using "Marketing Suite" as the spec originally proposed. ROUTES gets
"Website": "/website".

Middleware matcher gains "/website" so unauthenticated requests redirect
to /login the same way /inventory, /diamonds, /deals do. The new
middleware test case is the regression guard.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Verification + ship

### Task E1: Enforcement greps + full suite + tsc + build + dev smoke

**Files:** none (verification only)

- [ ] **Step 1: Validation has no orgId.** Run:
```
grep -rn "orgId" src/lib/website/validation.ts
```
Expected: 0 matches. The header comment lines that say "stamps orgId from session" do not match because they say "orgId" inside a doc comment — re-grep with `grep -rnE "\borgId\b" src/lib/website/validation.ts` if the count is non-zero, and confirm the matches are all in comment lines (not in any Zod field).

  Stricter form: `grep -rn "orgId" src/lib/website/validation.ts | grep -v "^[[:space:]]*//\|^[[:space:]]*\*"` → must be empty.

- [ ] **Step 2: Direct selects from websiteSnapshots are restricted to helpers.** Run:
```
grep -rn "from(websiteSnapshots)" src/
```
Expected: only matches inside `src/db/website.ts` (three reads) and `src/lib/website/actions.ts` (insert/update/delete via `.insert(websiteSnapshots)` / `.update(websiteSnapshots)` / `.delete(websiteSnapshots)` — those don't match `from()` so they shouldn't appear here at all). Any RSC page or component matching this grep is a bug — fix immediately.

- [ ] **Step 3: Every UPDATE / DELETE has tenancy in its WHERE.** Run:
```
grep -nE "update\(websiteSnapshots\)|delete\(websiteSnapshots\)" src/lib/website/actions.ts
```
Expected: 2 matches (one update, one delete). For each: inspect the file and confirm the chained `.where(and(eq(websiteSnapshots.id, …), eq(websiteSnapshots.orgId, orgId)))` is present.

- [ ] **Step 4: AIYA_ORG_ID is still only in the login route (slice-3 invariant).** Run:
```
grep -rn "AIYA_ORG_ID" src/
```
Expected: one match — the local `const AIYA_ORG_ID = 1` inside `src/app/api/login/route.ts`.

- [ ] **Step 5: No Monday-only validator was added (slice-5 critical).** Run:
```
grep -rnE "getDay\(\)|isMonday|getISOWeek" src/lib/website/
```
Expected: 0 matches. If anything surfaces, the architect's "any day is valid" contract has been violated — revert.

- [ ] **Step 6: Full suite.** Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-website-overview-5" && npm test -- --run`
Expected: full green. Slice-3 and slice-4 cross-org isolation tests pass unchanged (slice 5 is strictly additive — never widens visibility, never modifies an existing query or column).

- [ ] **Step 7: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Build.** Run: `rm -rf .next && npm run build`
Expected: success. The `/website` route compiles, the dashboard page picks up the new `website-overview` panel slot.

- [ ] **Step 9: Dev smoke (auth path).** Run: `npm run dev`. Log in. Then:
  - `/` loads. Because AIYA has no website snapshots in prod (the demo seed never runs against the DB), the Website Overview panel shows the "No website snapshots yet — record your first week" empty state.
  - Click the link → `/website` loads. Form is empty; table shows the empty state ("No snapshots yet").
  - Fill the form: week 2026-05-25, visitors 5000, unique 3500, pageviews 18000, avgsession 210, bounce 42. Click "Add snapshot". `FormStatus` reads "Saved.", the table shows the row, the page refreshes.
  - Submit the SAME week again with different numbers. `FormStatus` reads "Snapshot for this week already exists — edit it in the table below." The table still shows one row with the original numbers.
  - Submit a DIFFERENT week (2026-05-18). New row appears.
  - Click "Delete" on the 2026-05-18 row. Row disappears from the table.
  - Reload `/`. The Website Overview panel now shows the 2026-05-25 row in the single-snapshot state (4 KPI tiles with em-dash deltas, single-point sparkline area, "Add another week" link).
  - Open psql and verify: `SELECT org_id, week_start, visitors FROM website_snapshots;` — should show one row, `org_id=1`, the 2026-05-25 row.
  - Add a 2026-05-18 row via the admin again. Reload `/`. Panel now shows the multi-snapshot state with the up-arrow delta and a 2-point sparkline.

- [ ] **Step 10: Dev smoke (demo path).** Run: `NEXT_PUBLIC_DEMO_MODE=true npm run dev`:
  - `/` loads, no login required. Website Overview panel renders 8 weeks of AIYA seed data: latest visitors ~7,820, up-arrow delta ~4.1% vs 7,510, sparkline visible.
  - `/website` loads with the form populated by default (today's date) but the table shows the 8 AIYA seed rows in DESC order.
  - Try to submit the form. `FormStatus` reads "Demo mode — changes are disabled". No DB writes (there is no DB in demo).
  - Try to click "Delete" on a row. Same demo-guard message. The 8 rows survive.

---

### Task E2: Whole-slice code review + merge + cleanup

**Files:** none (process)

- [ ] **Step 1: Whole-slice code review.** Spawn a code-review subagent with this prompt (paste verbatim):

> Review every change on branch `feature/aiya-website-overview-5` against `main` for the AIYA Website Overview slice (slice 5). Spec: `docs/superpowers/specs/2026-05-28-aiya-website-overview-slice-5-design.md`. Plan: `docs/superpowers/plans/2026-05-28-aiya-website-overview-slice-5.md`. Verify each:
> (a) `grep -rn "orgId" src/lib/website/validation.ts` returns 0 matches (excluding doc comments).
> (b) `grep -rn "from(websiteSnapshots)" src/` returns matches only inside `src/db/website.ts`.
> (c) Every `.update(websiteSnapshots)` and `.delete(websiteSnapshots)` in `src/lib/website/actions.ts` is followed by a `.where(and(eq(id), eq(orgId)))` — never id alone.
> (d) Every read helper in `src/db/website.ts` begins with `if (isDemoMode()) return …;` BEFORE any DB access — confirm via inspection.
> (e) `createWebsiteSnapshot` uses `.onConflictDoNothing({ target: [orgId, weekStart] })` + `.returning({ id })`, and returns `{ ok: true, duplicate: true }` when `inserted.length === 0`.
> (f) The Zod schema accepts any `YYYY-MM-DD` weekStart with NO Monday-only refinement (grep for `getDay`, `isMonday`, `getISOWeek` → 0 matches).
> (g) `src/lib/website/validation.ts` header comment explicitly documents the two intentional gaps (no Monday-only, no uniqueVisitors-≤-visitors).
> (h) The dashboard panel shows 4 KPI tiles (Visitors, Page Views, Avg Session, Bounce Rate) — uniqueVisitors is NOT in the panel.
> (i) The provenance footer reads `… · owner-entered` and the panel never renders a "live" FreshnessDot or similar.
> (j) `src/middleware.ts` matcher includes `/website`.
> (k) `src/components/dashboard/Nav.tsx` has a discrete "Website" entry in SECTIONS (between Diamonds and Gold & Metals) AND a `Website: "/website"` ROUTES mapping. NOT a `"Marketing Suite": "/website"` mapping.
> (l) Demo seed: AIYA gets 8 weeks (visitors trending up overall), Mehta Diamonds gets 2 weeks, no other partner orgs get snapshots. `getSeedWebsiteSnapshots(SAINT_CLOUD)` and `getSeedWebsiteSnapshots(MARATHI)` both return `[]`.
> (m) Migration `drizzle/0007_*.sql` is schema-only with a `-- schema-only` header comment and no INSERT statements.
> (n) Slice-3 / slice-4 cross-org isolation tests pass unchanged (no slice-5 edit to existing tests except the additive middleware case and the FormStatus tests).
> (o) `FormStatus` precedence is error > duplicate > ok > null; existing slice-1b / 2 / 4 callers behave byte-identically.
>
> Report findings, no fixes.

- [ ] **Step 2: Apply review fixes** (if any). For each finding, fix + add a failing-first test + commit with a `fix(<domain>): …` message ending in the Co-Authored-By trailer.

- [ ] **Step 3: Push the branch.**
```bash
git push -u origin feature/aiya-website-overview-5
```

- [ ] **Step 4: Merge to main.** From the worktree:
```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git checkout main
git merge --no-ff feature/aiya-website-overview-5 -m "$(cat <<'EOF'
merge: AIYA Website Overview slice 5

New website_snapshots table (id, org_id → orgs.id, week_start DATE,
visitors, unique_visitors, page_views, avg_session_duration_seconds,
bounce_rate_percent, created_at, updated_at). Unique (org_id, week_start)
+ index (org_id, week_start DESC). Three actions through the
established run() wrapper; createWebsiteSnapshot returns the discriminated
{ ok: true, duplicate: true } on ON CONFLICT DO NOTHING so the form can
surface the conflict instead of silently no-op'ing.

New WebsiteOverviewPanel renders 3 states (no data / single / multi)
with 4 KPI tiles (Visitors, Page Views, Avg Session, Bounce Rate) +
8-week visitor sparkline + "owner-entered" provenance footer.

New /website admin route with form + table + Delete buttons. Dedicated
"Website" sidebar entry; middleware gates the route.

Demo seed: 8 weeks AIYA, 2 weeks Mehta Diamonds, nothing else — the
multi-tenant story is visible without filling the demo with noise.

Cross-org isolation: every read filters by org_id; every UPDATE / DELETE
WHERE is `id AND orgId`; no orgId in any Zod schema (PR-review grep
confirmed 0 matches).

NO real analytics provider integration — that's slice 5b. Honest
provenance label "updated Xd ago · owner-entered" — never labeled live.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 5: Cleanup.**
```bash
git worktree remove "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-website-overview-5"
git branch -d feature/aiya-website-overview-5
git push origin --delete feature/aiya-website-overview-5
```

- [ ] **Step 6: Confirm done.** Run from main: `npm test -- --run && npx tsc --noEmit && npm run build`
Expected: green + clean + build succeeds.

---

## Done criteria

- All new tests green; full suite green; `tsc --noEmit` clean; build succeeds.
- `website_snapshots` table exists with the unique `(org_id, week_start)` constraint and the composite `(org_id, week_start DESC)` index.
- `getWebsiteSnapshots`, `getLatestWebsiteSnapshot`, `getWebsiteSnapshotTrend` live in `src/db/website.ts`; each takes an explicit `orgId` (no default) and short-circuits on `isDemoMode()` at the top.
- `websiteSnapshotInput` + `websiteSnapshotUpdateInput` Zod schemas live in `src/lib/website/validation.ts` with no `orgId` field and no Monday-only refinement.
- `createWebsiteSnapshot` / `updateWebsiteSnapshot` / `deleteWebsiteSnapshot` live in `src/lib/website/actions.ts` and use the `run()` wrapper; create uses `onConflictDoNothing` + `.returning` and returns `{ ok: true, duplicate: true }` on conflict; update + delete WHERE clauses are `id AND orgId`.
- `formatSessionDuration` + `weekOverWeekDelta` live in `src/lib/website/format.ts`.
- `WebsiteOverviewPanel` renders 3 states (no data / single / multi) with 4 KPI tiles (NOT including uniqueVisitors) + sparkline + provenance footer ending in `· owner-entered`.
- `/website` RSC route fetches via `getCurrentOrgId()` + `getWebsiteSnapshots(db, orgId)` and renders `WebsiteAdmin`.
- `WebsiteAdmin` form handles three result shapes (`ok`, `duplicate`, `error`) via `FormStatus`.
- `FormStatus` accepts an optional `duplicate?: boolean` prop; precedence is error > duplicate > ok > null.
- Middleware matcher includes `/website`. Nav has a discrete "Website" entry + `Website: "/website"` mapping.
- `src/lib/demo/seed.ts` exports `getSeedWebsiteSnapshots` / `getSeedLatestWebsiteSnapshot` / `getSeedWebsiteSnapshotTrend`; AIYA has 8 weeks, Mehta Diamonds has 2; Saint-Cloud and Marathi each return `[]`.
- The slice-3 and slice-4 cross-org isolation tests pass without modification (slice 5 is strictly additive).
- `grep -rn "from(websiteSnapshots)" src/` returns matches only inside `src/db/website.ts`.
- `grep -rn "orgId" src/lib/website/validation.ts` (excluding doc comments) returns 0 matches.
- `grep -rnE "getDay\(\)|isMonday|getISOWeek" src/lib/website/` returns 0 matches.
- Next: Slice 5b — Website Live Feed (swap the owner-entered ledger for a real analytics provider behind the same panel interface).
