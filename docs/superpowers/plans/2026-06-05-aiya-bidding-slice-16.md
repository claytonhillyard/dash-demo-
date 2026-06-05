# AIYA Slice 16 — Bidding tab + Today's Bids panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured price-offer bidding to every Deal Room deal, with an atomic accept flow (deal → Filled + sibling bids auto-rejected in one transaction), an owner-toggleable single/history display mode, and a right-rail "Today's Bids" aggregate panel.

**Architecture:** One new `bids` table (always append-only — every bid is a new row) plus a `deals.bid_mode` column that's purely a render-time display preference. Five `runWithUser`-wrapped server actions enforce all authz via the slice-10 `canSeeDeal` helper + slice-3 defense-in-depth `AND org_id = $orgId` UPDATE pattern. Visibility is bidder + owner only — independent of `deals.thread_mode`. New `DealBidsTab` component nests inside slice-10's `DealThreadAccordion` via `Messages | Bids` tabs; new `TodaysBidsPanel` lives in the right rail.

**Tech Stack:** Drizzle ORM (pglite dev/test, Neon HTTP prod) · Next.js 15 App Router · React 19 Server Components + Server Actions · Zod · vitest (jsdom + node) · Testing Library · Tailwind (existing tokens).

**Branch:** `feature/slice-16-bidding` worktree at `.worktrees/slice-16-bidding`. See `docs/worktrees.md` for the convention. Implementer subagents work *only* in the worktree path — never in `/root`.

---

## File Structure

**New files:**
- `src/db/bids.ts` — query layer (2 functions: `getBidsForDeal`, `getTodaysBidsForOwner`)
- `src/lib/deals/bidValidation.ts` — Zod schemas for the 5 actions (parallel to `replyValidation.ts`)
- `src/components/deals/DealBidsTab.tsx` — Bids tab UI inside the accordion
- `src/components/deals/PostBidForm.tsx` — bid-submission form (used inside DealBidsTab)
- `src/components/dashboard/TodaysBidsPanel.tsx` — right-rail aggregate panel
- New drizzle migration `drizzle/NNNN_bidding.sql` (NNNN = next sequential, read from `drizzle/meta/_journal.json` at execution time)
- `test/db/bids.test.ts`
- `test/db/migration-bidding-smoke.test.ts`
- `test/lib/deals/bid-authz.test.ts`
- `test/lib/deals/bid-accept-atomicity.test.ts`
- `test/lib/deals/bid-withdraw.test.ts`
- `test/components/deals/DealBidsTab.test.tsx`
- `test/components/deals/PostBidForm.test.tsx`
- `test/components/dashboard/TodaysBidsPanel.test.tsx`

**Modified files:**
- `src/db/schema.ts` — add `bids` table + `deals.bid_mode` column
- `src/lib/deals/actions.ts` — append 5 new actions next to slice-10 actions
- `src/lib/demo/seed.ts` — append `DEMO_BIDS` constant + (authored-only) seed entries
- `src/components/deals/DealThreadAccordion.tsx` — add `Messages | Bids` tab switcher
- `src/components/dashboard/DealRoomPanel.tsx` — thread `bidsByDealId` + bid actions through props
- `src/app/page.tsx` — fetch bids + today's-bids queries; pass to panel
- `src/components/dashboard/registry.ts` (or wherever `PanelCtx` lives) — extend the context type to include `bidsByDealId` + actions
- `test/lib/demo/seed.test.ts` — assert `DEMO_BIDS` shape

---

## Pre-flight

- [ ] **Pre-flight Step 1: Sync main + verify clean working tree**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git fetch origin --quiet
git pull --ff-only origin main
git status -sb
git log --oneline -1
```

Expected: `## main...origin/main`, last commit is the slice-16 spec commit `2fdc186` (or its descendant if the parallel agent merged something). No `M`/`A` lines — only the long-standing untracked personal files (`.md2pdf.py`, `FEMALE_AI_BOT.md`, `FEMALE_AI_BOT.pdf`, `training protocol/`) are acceptable.

- [ ] **Pre-flight Step 2: Cut the slice-16 worktree (per `docs/worktrees.md`)**

```bash
git worktree add .worktrees/slice-16-bidding -b feature/slice-16-bidding
cd .worktrees/slice-16-bidding
ln -sf ../../.env .env
ln -sf ../../node_modules node_modules
git branch --show-current
```

Expected: `feature/slice-16-bidding`. Symlinks present.

**All remaining steps run from `.worktrees/slice-16-bidding`, NOT from `/root`.** This is the failure mode `docs/worktrees.md` exists to prevent.

- [ ] **Pre-flight Step 3: Determine the next migration number**

```bash
ls -1 drizzle/ | grep -E '^[0-9]{4}_' | sort | tail -3
```

Expected: lists the highest-numbered migration on `main`. The slice-16 migration is the next sequential number (e.g. if the last is `0009_*`, slice-16 generates `0010_*`). Call this `NNNN` for the rest of the plan.

- [ ] **Pre-flight Step 4: Confirm baseline test suite is green**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: a "Test Files N passed (N) / Tests M passed (M)" summary with zero failures. The exact M depends on what shipped to main since slice 10 (≥588). If anything is failing on `main` before slice-16 edits, stop and fix that first.

---

## Phase A — DB foundation + query layer

### Task A1: Add `bids` table + `deals.bid_mode` column to `src/db/schema.ts`

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Locate the `deals` definition.**

Open `src/db/schema.ts` and find the `export const deals = pgTable(` block. Slice-10 added `threadMode` as the last enum column before timestamps. Slice-16 adds `bidMode` immediately after it.

- [ ] **Step 2: Add the `bidMode` column to `deals`.**

Inside the `deals` `pgTable(...)` columns object, immediately after `threadMode`:

```ts
    bidMode: text("bid_mode", { enum: ["single", "history"] })
      .notNull()
      .default("single"),
```

- [ ] **Step 3: Add the `bids` table.**

Insert below the existing `deal_thread_reads` definition (file ordering is cosmetic; pglite resolves FK order from references). Confirm `primaryKey` is imported from `drizzle-orm/pg-core` (slice-4 + slice-10 both need it).

```ts
export const bids = pgTable(
  "bids",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    bidderOrgId: integer("bidder_org_id")
      .notNull()
      .references(() => orgs.id),
    bidderOrgLabel: text("bidder_org_label").notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    notes: text("notes"),
    bidMode: text("bid_mode", { enum: ["single", "history"] }).notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "rejected", "withdrawn", "auto_rejected"],
    })
      .notNull()
      .default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    dealCreatedIdx: index("bids_deal_created_idx").on(t.dealId, t.createdAt.desc()),
    bidderStatusIdx: index("bids_bidder_status_idx").on(t.bidderOrgId, t.status),
    pendingByDealIdx: index("bids_pending_by_deal_idx")
      .on(t.dealId, t.status)
      .where(sql`${t.status} = 'pending'`),
  }),
);
```

> The partial index `pendingByDealIdx` mirrors the slice-4 partial-index pattern (`deals_visibility_circle_idx`). It supports the accept-atomicity sweep: `UPDATE bids SET status='auto_rejected' WHERE deal_id = ? AND status = 'pending' AND id != ?`.

- [ ] **Step 4: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 5: Commit.**

```bash
git add src/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): bids table + deals.bid_mode column (slice 16 schema)

deals.bid_mode default "single" makes the column safe to add to
existing rows. bids table indexes: (deal_id, created_at DESC) for the
list path, (bidder_org_id, status) for outgoing-bid/withdraw lookups,
and a partial index on pending bids per deal for the accept-atomicity
sweep (mirrors slice-4's deals_visibility_circle_idx pattern).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration + smoke test

**Files:**
- Create: `drizzle/NNNN_bidding.sql` (NNNN = next sequential)
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/NNNN_snapshot.json`
- Create: `test/db/migration-bidding-smoke.test.ts`

- [ ] **Step 1: Generate the migration.**

```bash
npx drizzle-kit generate
ls -1 drizzle/ | grep -E '^[0-9]{4}_' | tail -2
```

Expected: a new migration `NNNN_<auto_suffix>.sql` appears. Inspect it:

```bash
cat drizzle/NNNN_*.sql
```

Expected SQL includes:
```sql
CREATE TABLE IF NOT EXISTS "bids" ( … );
ALTER TABLE "deals" ADD COLUMN "bid_mode" text DEFAULT 'single' NOT NULL;
CREATE INDEX … "bids_deal_created_idx" …
CREATE INDEX … "bids_bidder_status_idx" …
CREATE INDEX … "bids_pending_by_deal_idx" … WHERE … status = 'pending' …
```

- [ ] **Step 2: Rename the migration to a descriptive name.**

The slice-10 convention was to rename the auto-name (`0008_*` → `0008_deal_reply_threads`). The parallel-agent track keeps the auto names. Match whichever convention the most recent 2-3 migrations use (run `ls drizzle/0006_* drizzle/0007_* drizzle/0008_*` and `cat drizzle/meta/_journal.json | tail -10` to see). If auto names are the standard, leave as-is. If descriptive names are standard, rename:

```bash
mv drizzle/NNNN_*.sql drizzle/NNNN_bidding.sql
# Edit drizzle/meta/_journal.json: find the just-appended entry and update its "tag" to "NNNN_bidding"
```

- [ ] **Step 3: Write the smoke test at `test/db/migration-bidding-smoke.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { sql } from "drizzle-orm";

describe("migration NNNN — bidding (slice 16)", () => {
  it("creates the bids table and deals.bid_mode without error", async () => {
    const { db, close } = await createTestDb();
    try {
      const tables = await db.execute(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'bids'
      `);
      const tableRows = (tables as unknown as { rows: { tablename: string }[] }).rows;
      expect(tableRows.map((r) => r.tablename)).toEqual(["bids"]);

      const cols = await db.execute(sql`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'deals' AND column_name = 'bid_mode'
      `);
      const colRows = (cols as unknown as {
        rows: { column_name: string; data_type: string; column_default: string }[];
      }).rows;
      expect(colRows).toHaveLength(1);
      expect(colRows[0].data_type).toBe("text");
      expect(colRows[0].column_default).toMatch(/^'single'::text$/);

      // Bid columns we depend on downstream
      const bidCols = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'bids'
        ORDER BY ordinal_position
      `);
      const bidColRows = (bidCols as unknown as {
        rows: { column_name: string; is_nullable: "YES" | "NO" }[];
      }).rows;
      const bidColMap = new Map(bidColRows.map((r) => [r.column_name, r.is_nullable]));
      expect(bidColMap.get("id")).toBe("NO");
      expect(bidColMap.get("deal_id")).toBe("NO");
      expect(bidColMap.get("bidder_org_id")).toBe("NO");
      expect(bidColMap.get("price_cents")).toBe("NO");
      expect(bidColMap.get("notes")).toBe("YES"); // notes is nullable
      expect(bidColMap.get("decided_at")).toBe("YES"); // decided_at is nullable
    } finally {
      await close();
    }
  });
});
```

- [ ] **Step 4: Run the smoke test.**

```bash
npx vitest run test/db/migration-bidding-smoke.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: `1 passed`.

- [ ] **Step 5: Commit.**

```bash
git add drizzle/ test/db/migration-bidding-smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(db): generate NNNN migration (bids table + deals.bid_mode)

Migration smoke test asserts the bids table exists with the expected
nullable/non-nullable columns and that deals.bid_mode defaults to
'single'::text so existing rows are safe under the non-null constraint.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Create `src/db/bids.ts` and implement `getBidsForDeal`

**Files:**
- Create: `src/db/bids.ts`
- Create: `test/db/bids.test.ts` (first describe block)

- [ ] **Step 1: Write the failing test at `test/db/bids.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { deals, bids } from "@/db/schema";
import { getBidsForDeal } from "@/db/bids";

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

async function seedDeal(orgId: number) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId,
      kind: "SELL",
      category: "Diamond",
      subject: "bid-test",
      quantity: 1,
      priceCents: 1000,
      postedByLabel: "owner",
    })
    .returning();
  return row.id;
}

describe("getBidsForDeal — visibility filter", () => {
  it("returns the bid to its bidder", async () => {
    const dealId = await seedDeal(1);
    await db.insert(bids).values({
      dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1200, bidMode: "single",
    });
    const rows = await getBidsForDeal(db, 999, dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(1200);
    expect(rows[0].status).toBe("pending");
  });

  it("returns the bid to the deal owner", async () => {
    const dealId = await seedDeal(1);
    await db.insert(bids).values({
      dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1200, bidMode: "single",
    });
    const rows = await getBidsForDeal(db, 1, dealId);
    expect(rows).toHaveLength(1);
  });

  it("hides the bid from a third party", async () => {
    const dealId = await seedDeal(1);
    await db.insert(bids).values({
      dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1200, bidMode: "single",
    });
    const rows = await getBidsForDeal(db, 888, dealId);
    expect(rows).toEqual([]);
  });

  it("orders bids newest-first", async () => {
    const dealId = await seedDeal(1);
    await db.insert(bids).values([
      { dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta", priceCents: 1100, bidMode: "single",
        createdAt: new Date(Date.now() - 60_000) },
      { dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta", priceCents: 1200, bidMode: "single",
        createdAt: new Date() },
    ]);
    const rows = await getBidsForDeal(db, 1, dealId);
    expect(rows.map((r) => r.priceCents)).toEqual([1200, 1100]);
  });
});
```

- [ ] **Step 2: Run — expect compile failure (`getBidsForDeal` not found).**

```bash
npx vitest run test/db/bids.test.ts --reporter=verbose 2>&1 | tail -10
```

- [ ] **Step 3: Create `src/db/bids.ts`.**

```ts
import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

export type BidStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "auto_rejected";

export type BidView = {
  id: number;
  dealId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  bidMode: "single" | "history";
  status: BidStatus;
  decidedAt: Date | null;
  createdAt: Date;
};

/**
 * Returns bids on a single deal visible to `viewerOrgId`, ordered newest-first.
 *
 * Visibility is SQL-enforced (NEVER application-layer filtering):
 *   bidder_org_id = viewer OR deals.org_id = viewer
 *
 * Note: visibility is INTENTIONALLY decoupled from deals.thread_mode. Bids
 * are structured trade negotiations; even in group thread_mode, a bid is
 * for the owner's eyes only. See slice-16 spec §4.
 *
 * ⚠ VISIBILITY PREDICATE — slice-16-local (NOT the slice-4 can-see-deal
 * rule). Do not "unify" this with the slice-10 message visibility predicate;
 * they intentionally differ. If you change this rule, update:
 *   - getTodaysBidsForOwner WHERE clause (below in this file)
 *   - the canBidOn helper in src/lib/deals/actions.ts (slice-16 write side)
 *
 * Demo mode short-circuits to `[]` (matches slice-10 query helper convention).
 */
export async function getBidsForDeal(
  db: Db,
  viewerOrgId: number,
  dealId: number,
): Promise<BidView[]> {
  if (isDemoMode()) return [];

  const res = await db.execute(sql`
    SELECT b.id, b.deal_id, b.bidder_org_id, b.bidder_org_label,
           b.price_cents, b.currency, b.notes, b.bid_mode,
           b.status, b.decided_at, b.created_at
    FROM bids b
    JOIN deals d ON d.id = b.deal_id
    WHERE b.deal_id = ${dealId}
      AND (b.bidder_org_id = ${viewerOrgId} OR d.org_id = ${viewerOrgId})
    ORDER BY b.created_at DESC
  `);

  const rows = rowsOf<{
    id: number;
    deal_id: number;
    bidder_org_id: number;
    bidder_org_label: string;
    price_cents: number;
    currency: string;
    notes: string | null;
    bid_mode: "single" | "history";
    status: BidStatus;
    decided_at: Date | string | null;
    created_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id,
    bidderOrgId: r.bidder_org_id,
    bidderOrgLabel: r.bidder_org_label,
    priceCents: r.price_cents,
    currency: r.currency,
    notes: r.notes,
    bidMode: r.bid_mode,
    status: r.status,
    decidedAt:
      r.decided_at === null
        ? null
        : r.decided_at instanceof Date
        ? r.decided_at
        : new Date(r.decided_at),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}
```

- [ ] **Step 4: Run — expect `4 passed`.**

```bash
npx vitest run test/db/bids.test.ts --reporter=verbose 2>&1 | tail -10
```

- [ ] **Step 5: Commit.**

```bash
git add src/db/bids.ts test/db/bids.test.ts
git commit -m "$(cat <<'EOF'
feat(db): getBidsForDeal with SQL-enforced bidder+owner visibility

Visibility intentionally decoupled from deals.thread_mode — bids are
structured trade negotiations, not conversation. The SQL WHERE clause
admits only the bidder and the deal owner. JSDoc carries the
divergence warning so a future "unify with slice-10 messages" refactor
doesn't accidentally widen visibility.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Add `getTodaysBidsForOwner` + tests

**Files:**
- Modify: `src/db/bids.ts`
- Modify: `test/db/bids.test.ts`

- [ ] **Step 1: Append a failing test.**

```ts
import { getTodaysBidsForOwner } from "@/db/bids";

describe("getTodaysBidsForOwner", () => {
  it("returns today's pending bids on the viewer's deals, joined with deal subject", async () => {
    const myDealId = await seedDeal(1);
    const othersDealId = await seedDeal(999);

    // Today, pending, my deal -> SHOULD appear
    await db.insert(bids).values({
      dealId: myDealId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 12_300_00, bidMode: "single", status: "pending",
      createdAt: new Date(),
    });

    // Today, pending, NOT my deal -> excluded
    await db.insert(bids).values({
      dealId: othersDealId, bidderOrgId: 1, bidderOrgLabel: "Me",
      priceCents: 999, bidMode: "single", status: "pending",
      createdAt: new Date(),
    });

    // Today, accepted, my deal -> excluded (not pending)
    await db.insert(bids).values({
      dealId: myDealId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1, bidMode: "single", status: "accepted",
      decidedAt: new Date(), createdAt: new Date(),
    });

    // Yesterday, pending, my deal -> excluded (not today)
    await db.insert(bids).values({
      dealId: myDealId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 2, bidMode: "single", status: "pending",
      createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000),
    });

    const rows = await getTodaysBidsForOwner(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(12_300_00);
    expect(rows[0].bidderOrgLabel).toBe("Mehta");
  });

  it("returns an empty array when there are no qualifying bids", async () => {
    expect(await getTodaysBidsForOwner(db, 1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

```bash
npx vitest run test/db/bids.test.ts --reporter=verbose 2>&1 | tail -10
```

- [ ] **Step 3: Append the function to `src/db/bids.ts`.**

```ts
export type TodaysBidView = {
  bidId: number;
  dealId: number;
  dealSubject: string;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  createdAt: Date;
};

/**
 * Returns today's PENDING bids on deals owned by `viewerOrgId`.
 * "Today" = `created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`.
 * Limited to 30 most recent.
 *
 * ⚠ VISIBILITY PREDICATE — mirrors the owner-side of getBidsForDeal.
 * If you change "deals.org_id = viewer" here, update getBidsForDeal +
 * canBidOn (src/lib/deals/actions.ts) at the same time.
 *
 * Demo mode short-circuits to `[]`.
 */
export async function getTodaysBidsForOwner(
  db: Db,
  viewerOrgId: number,
): Promise<TodaysBidView[]> {
  if (isDemoMode()) return [];

  const res = await db.execute(sql`
    SELECT b.id AS bid_id, d.id AS deal_id, d.subject AS deal_subject,
           b.bidder_org_label, b.price_cents, b.currency, b.created_at
    FROM bids b
    JOIN deals d ON d.id = b.deal_id
    WHERE d.org_id = ${viewerOrgId}
      AND b.status = 'pending'
      AND b.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
    ORDER BY b.created_at DESC
    LIMIT 30
  `);

  const rows = rowsOf<{
    bid_id: number;
    deal_id: number;
    deal_subject: string;
    bidder_org_label: string;
    price_cents: number;
    currency: string;
    created_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    bidId: r.bid_id,
    dealId: r.deal_id,
    dealSubject: r.deal_subject,
    bidderOrgLabel: r.bidder_org_label,
    priceCents: r.price_cents,
    currency: r.currency,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}
```

- [ ] **Step 4: Run — expect `6 passed` total in this file.**

```bash
npx vitest run test/db/bids.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/db/bids.ts test/db/bids.test.ts
git commit -m "$(cat <<'EOF'
feat(db): getTodaysBidsForOwner — owner-perspective right-rail panel query

UTC start-of-day windowing keeps slice-16 timezone-free. LIMIT 30 caps
the panel render size. JOIN with deals for the subject so the panel
can render rows without a second fetch.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Phase A green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: pre-Phase-A baseline + 7 new test cases (4 + 2 + 1 smoke). Zero failures.

- [ ] **Step 2: tsc.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors.

Phase A done.

---

## Phase B — Server actions + truth-table tests

### Task B1: Add Zod schemas in `src/lib/deals/bidValidation.ts`

**Files:**
- Create: `src/lib/deals/bidValidation.ts`

- [ ] **Step 1: Create the file.**

```ts
import { z } from "zod";

export const postBidInput = z.object({
  dealId: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  currency: z.enum(["USD", "EUR", "INR", "JPY"]).default("USD"),
  notes: z.string().trim().max(500, "Notes too long").optional(),
});
export type PostBidInput = z.infer<typeof postBidInput>;

export const acceptBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type AcceptBidInput = z.infer<typeof acceptBidInput>;

export const rejectBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type RejectBidInput = z.infer<typeof rejectBidInput>;

export const withdrawBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type WithdrawBidInput = z.infer<typeof withdrawBidInput>;

export const setDealBidModeInput = z.object({
  dealId: z.number().int().positive(),
  mode: z.enum(["single", "history"]),
});
export type SetDealBidModeInput = z.infer<typeof setDealBidModeInput>;
```

- [ ] **Step 2: Typecheck + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/lib/deals/bidValidation.ts
git commit -m "$(cat <<'EOF'
feat(deals): Zod schemas for slice-16 bidding actions

priceCents required positive int (cents). currency limited to a short
enum (USD/EUR/INR/JPY) — the deals.currency text column is unconstrained
but slice-16 enforces the short list at the form/Zod layer.
notes optional, ≤500 chars, trimmed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Implement `postBid` + visibility/self-bid truth-table test

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Create: `test/lib/deals/bid-authz.test.ts` (first describe — postBid only)

- [ ] **Step 1: Write the failing test.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, circles, circleMembers, bids } from "@/db/schema";
import { postBid, __setTestDb } from "@/lib/deals/actions";
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

async function seedDeal(ownerOrgId: number, circleId: number | null = null, bidMode: "single" | "history" = "single") {
  const [row] = await db
    .insert(deals)
    .values({
      orgId: ownerOrgId, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
      visibilityCircleId: circleId, bidMode,
    })
    .returning();
  return row.id;
}

async function ensureCircleWithMembers(name: string, slug: string, ownerOrgId: number, members: number[]) {
  const [c] = await db.insert(circles).values({ name, slug, ownerOrgId }).returning();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId: c.id, orgId }).onConflictDoNothing();
  }
  return c.id;
}

describe("postBid — authz", () => {
  it("allows an in-circle partner to bid on a circle-scoped deal", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pb1", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postBid({ dealId, priceCents: 12_300_00 });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(bids);
    expect(rows).toHaveLength(1);
    expect(rows[0].bidderOrgId).toBe(999);
    expect(rows[0].priceCents).toBe(12_300_00);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].bidMode).toBe("single"); // snapshot of deal.bidMode at send
  });

  it("forbids an out-of-circle org from bidding", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pb2", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await postBid({ dealId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const rows = await db.select().from(bids);
    expect(rows).toHaveLength(0);
  });

  it("forbids the deal owner from bidding on their own deal (no self-bidding)", async () => {
    const dealId = await seedDeal(1);
    const res = await postBid({ dealId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const rows = await db.select().from(bids);
    expect(rows).toHaveLength(0);
  });

  it("forbids a non-owner from bidding on a private (no-circle) deal", async () => {
    const dealId = await seedDeal(1);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postBid({ dealId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("snapshots history-mode when deals.bid_mode is set to history at send time", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pb5", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId, "history");
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    await postBid({ dealId, priceCents: 100 });
    const [row] = await db.select().from(bids);
    expect(row.bidMode).toBe("history");
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

```bash
npx vitest run test/lib/deals/bid-authz.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 3: Implement `postBid` in `src/lib/deals/actions.ts`.**

Add imports at the top of `actions.ts` next to the slice-10 imports:

```ts
import { bids } from "@/db/schema";
import {
  postBidInput, acceptBidInput, rejectBidInput, withdrawBidInput, setDealBidModeInput,
  type PostBidInput, type AcceptBidInput, type RejectBidInput,
  type WithdrawBidInput, type SetDealBidModeInput,
} from "./bidValidation";
```

Add a helper that combines `canSeeDeal` with the no-self-bid rule, near the slice-10 `canSeeDeal`:

```ts
/** Slice-16 write-side gate: can the caller bid on this deal?
 *  Returns the deal's owner + bid_mode snapshot for the insert.
 *
 *  ⚠ Mirrors getBidsForDeal's bidder|owner SQL visibility, with the
 *  added "no self-bidding" rule. If you change visibility in either
 *  place, change both. */
async function canBidOn(d: Db, orgId: number, dealId: number): Promise<
  { ok: true; ownerOrgId: number; bidMode: "single" | "history" } | { ok: false }
> {
  const seen = await canSeeDeal(d, orgId, dealId);
  if (!seen.ok) return { ok: false };
  if (seen.ownerOrgId === orgId) return { ok: false }; // no self-bidding
  // Read deals.bid_mode (canSeeDeal returns the thread_mode, not bid_mode)
  const [row] = await d
    .select({ bidMode: deals.bidMode })
    .from(deals)
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!row) return { ok: false };
  return { ok: true, ownerOrgId: seen.ownerOrgId, bidMode: row.bidMode };
}
```

Add the action:

```ts
export async function postBid(raw: unknown): Promise<ActionResult> {
  return runWithUser(postBidInput, raw, async (input: PostBidInput, _user, orgId) => {
    const d = db();
    const access = await canBidOn(d, orgId, input.dealId);
    if (!access.ok) throw new ForbiddenError();
    const label = await resolveOrgLabel(d, orgId);
    await d.insert(bids).values({
      dealId: input.dealId,
      bidderOrgId: orgId,
      bidderOrgLabel: label,
      priceCents: input.priceCents,
      currency: input.currency,
      notes: input.notes ?? null,
      bidMode: access.bidMode, // snapshot at send time — IMMUTABLE
      // status defaults to 'pending'
    });
  });
}
```

- [ ] **Step 4: Run — expect `5 passed`.**

```bash
npx vitest run test/lib/deals/bid-authz.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/bid-authz.test.ts
git commit -m "$(cat <<'EOF'
feat(deals): postBid — visibility-gated bid insert with self-bid block

canBidOn is canSeeDeal + "no self-bidding" rule. Returns the deal's
bid_mode so the inserted row gets a single-read snapshot (same TOCTOU
elimination as slice-10's canSeeDeal returning thread_mode).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Implement `acceptBid` + atomicity test

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Create: `test/lib/deals/bid-accept-atomicity.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, bids, circles, circleMembers } from "@/db/schema";
import { acceptBid, __setTestDb } from "@/lib/deals/actions";
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

describe("acceptBid — atomicity", () => {
  it("fills the deal, accepts the chosen bid, and auto-rejects siblings in one txn", async () => {
    const [d] = await db
      .insert(deals)
      .values({
        orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
        quantity: 1, priceCents: 1000, postedByLabel: "x",
      })
      .returning();

    const [b1, b2, b3] = await db
      .insert(bids)
      .values([
        { dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "M", priceCents: 1200, bidMode: "single" },
        { dealId: d.id, bidderOrgId: 888, bidderOrgLabel: "S", priceCents: 1100, bidMode: "single" },
        { dealId: d.id, bidderOrgId: 501, bidderOrgLabel: "P", priceCents: 1300, bidMode: "single" },
      ])
      .returning();

    const res = await acceptBid({ bidId: b1.id });
    expect(res).toEqual({ ok: true });

    const [dealAfter] = await db.select({ status: deals.status }).from(deals).where(eq(deals.id, d.id));
    expect(dealAfter.status).toBe("Filled");

    const rows = await db.select().from(bids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(b1.id)?.status).toBe("accepted");
    expect(byId.get(b1.id)?.decidedAt).not.toBeNull();
    expect(byId.get(b2.id)?.status).toBe("auto_rejected");
    expect(byId.get(b2.id)?.decidedAt).not.toBeNull();
    expect(byId.get(b3.id)?.status).toBe("auto_rejected");
    expect(byId.get(b3.id)?.decidedAt).not.toBeNull();
  });

  it("forbids a non-owner from accepting a bid", async () => {
    const [d] = await db
      .insert(deals)
      .values({
        orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
        quantity: 1, priceCents: 1000, postedByLabel: "x",
      })
      .returning();
    const [b] = await db
      .insert(bids)
      .values({ dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "M", priceCents: 1, bidMode: "single" })
      .returning();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await acceptBid({ bidId: b.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [dealAfter] = await db.select({ status: deals.status }).from(deals).where(eq(deals.id, d.id));
    expect(dealAfter.status).toBe("Open"); // unchanged
  });

  it("forbids accepting a bid on a deal that is already Filled", async () => {
    const [d] = await db
      .insert(deals)
      .values({
        orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
        quantity: 1, priceCents: 1000, postedByLabel: "x", status: "Filled",
      })
      .returning();
    const [b] = await db
      .insert(bids)
      .values({ dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "M", priceCents: 1, bidMode: "single" })
      .returning();
    const res = await acceptBid({ bidId: b.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});
```

- [ ] **Step 2: Run — expect missing-export.**

- [ ] **Step 3: Implement `acceptBid` in `src/lib/deals/actions.ts`.**

Append:

```ts
export async function acceptBid(raw: unknown): Promise<ActionResult> {
  return runWithUser(acceptBidInput, raw, async (input: AcceptBidInput, _user, orgId) => {
    const d = db();
    // Look up the bid + its parent deal in one read
    const [row] = await d
      .select({
        bidId: bids.id,
        bidStatus: bids.status,
        dealId: bids.dealId,
        dealOwnerOrgId: deals.orgId,
        dealStatus: deals.status,
      })
      .from(bids)
      .innerJoin(deals, eq(deals.id, bids.dealId))
      .where(eq(bids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError();
    if (row.dealOwnerOrgId !== orgId) throw new ForbiddenError();
    if (row.dealStatus !== "Open") throw new ForbiddenError();
    if (row.bidStatus !== "pending") throw new ForbiddenError();

    // Atomic transaction: accept this bid, auto-reject siblings, mark deal Filled.
    // pglite supports drizzle's d.transaction(); Neon HTTP also supports it.
    const now = new Date();
    await d.transaction(async (tx) => {
      await tx
        .update(bids)
        .set({ status: "accepted", decidedAt: now })
        .where(and(eq(bids.id, input.bidId), eq(bids.status, "pending")));
      await tx
        .update(bids)
        .set({ status: "auto_rejected", decidedAt: now })
        .where(
          and(
            eq(bids.dealId, row.dealId),
            eq(bids.status, "pending"),
            ne(bids.id, input.bidId),
          ),
        );
      await tx
        .update(deals)
        .set({ status: "Filled", updatedAt: now })
        .where(and(eq(deals.id, row.dealId), eq(deals.orgId, orgId)));
    });
  });
}
```

> Add `ne` to the `drizzle-orm` import at the top of the file if it isn't already imported.

- [ ] **Step 4: Run — expect `3 passed`.**

```bash
npx vitest run test/lib/deals/bid-accept-atomicity.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/bid-accept-atomicity.test.ts
git commit -m "feat(deals): acceptBid — atomic Filled + auto-reject siblings in one txn

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B4: Implement `rejectBid` + tests in `bid-authz.test.ts`

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Modify: `test/lib/deals/bid-authz.test.ts`

- [ ] **Step 1: Append failing tests to `test/lib/deals/bid-authz.test.ts`.**

```ts
import { rejectBid } from "@/lib/deals/actions";

describe("rejectBid — authz", () => {
  it("allows the deal owner to reject a pending bid", async () => {
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
    }).returning();
    const [b] = await db.insert(bids).values({
      dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "M",
      priceCents: 1, bidMode: "single",
    }).returning();
    expect(await rejectBid({ bidId: b.id })).toEqual({ ok: true });
    const [after] = await db.select({ status: bids.status, decidedAt: bids.decidedAt })
      .from(bids).where(eq(bids.id, b.id));
    expect(after.status).toBe("rejected");
    expect(after.decidedAt).not.toBeNull();
  });

  it("forbids a non-owner (including the bidder themselves) from rejecting", async () => {
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
    }).returning();
    const [b] = await db.insert(bids).values({
      dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "M",
      priceCents: 1, bidMode: "single",
    }).returning();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "bidder-cant-reject-self", orgId: 999,
    });
    expect(await rejectBid({ bidId: b.id })).toEqual({ ok: false, error: "Forbidden" });
  });
});
```

Add the import at the top of the file: `import { eq } from "drizzle-orm";` (if not already present).

- [ ] **Step 2: Run — expect missing-export.**

- [ ] **Step 3: Implement `rejectBid` in `src/lib/deals/actions.ts`.**

Append:

```ts
export async function rejectBid(raw: unknown): Promise<ActionResult> {
  return runWithUser(rejectBidInput, raw, async (input: RejectBidInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidStatus: bids.status,
        dealOwnerOrgId: deals.orgId,
      })
      .from(bids)
      .innerJoin(deals, eq(deals.id, bids.dealId))
      .where(eq(bids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError();
    if (row.dealOwnerOrgId !== orgId) throw new ForbiddenError();
    if (row.bidStatus !== "pending") throw new ForbiddenError();
    await d
      .update(bids)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(and(eq(bids.id, input.bidId), eq(bids.status, "pending")));
  });
}
```

- [ ] **Step 4: Run — expect 7 passed in this file (5 from B2 + 2 new).**

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/bid-authz.test.ts
git commit -m "feat(deals): rejectBid — owner-only single-bid reject

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B5: Implement `withdrawBid` + idempotency test

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Create: `test/lib/deals/bid-withdraw.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, bids } from "@/db/schema";
import { withdrawBid, __setTestDb } from "@/lib/deals/actions";
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

async function seedDealWithBid(bidderOrgId: number, initialStatus: "pending" | "accepted" = "pending") {
  const [d] = await db.insert(deals).values({
    orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
    quantity: 1, priceCents: 1000, postedByLabel: "x",
  }).returning();
  const [b] = await db.insert(bids).values({
    dealId: d.id, bidderOrgId, bidderOrgLabel: "x",
    priceCents: 1, bidMode: "single", status: initialStatus,
    decidedAt: initialStatus === "accepted" ? new Date() : null,
  }).returning();
  return { dealId: d.id, bidId: b.id };
}

describe("withdrawBid", () => {
  it("allows the bidder to withdraw a pending bid", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "bidder", orgId: 999,
    });
    const { bidId } = await seedDealWithBid(999);
    expect(await withdrawBid({ bidId })).toEqual({ ok: true });
    const [row] = await db.select({ status: bids.status, decidedAt: bids.decidedAt })
      .from(bids).where(eq(bids.id, bidId));
    expect(row.status).toBe("withdrawn");
    expect(row.decidedAt).not.toBeNull();
  });

  it("forbids withdrawing a non-pending (accepted) bid", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "bidder", orgId: 999,
    });
    const { bidId } = await seedDealWithBid(999, "accepted");
    expect(await withdrawBid({ bidId })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids withdrawing another org's bid", async () => {
    // session = org 1 (deal owner). Bidder is org 999.
    const { bidId } = await seedDealWithBid(999);
    expect(await withdrawBid({ bidId })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("is idempotent on a row already withdrawn (returns ok no-op)", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: "bidder", orgId: 999,
    });
    const { bidId } = await seedDealWithBid(999);
    expect(await withdrawBid({ bidId })).toEqual({ ok: true });
    expect(await withdrawBid({ bidId })).toEqual({ ok: true }); // no error on second
    const [row] = await db.select({ status: bids.status }).from(bids).where(eq(bids.id, bidId));
    expect(row.status).toBe("withdrawn");
  });
});
```

- [ ] **Step 2: Run — expect missing-export.**

- [ ] **Step 3: Implement `withdrawBid`.**

Append to `src/lib/deals/actions.ts`:

```ts
export async function withdrawBid(raw: unknown): Promise<ActionResult> {
  return runWithUser(withdrawBidInput, raw, async (input: WithdrawBidInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidderOrgId: bids.bidderOrgId,
        status: bids.status,
      })
      .from(bids)
      .where(eq(bids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError();
    if (row.bidderOrgId !== orgId) throw new ForbiddenError();
    if (row.status === "withdrawn") return; // idempotent (slice-10 deleteDealMessage pattern)
    if (row.status !== "pending") throw new ForbiddenError();
    await d
      .update(bids)
      .set({ status: "withdrawn", decidedAt: new Date() })
      .where(and(eq(bids.id, input.bidId), eq(bids.bidderOrgId, orgId)));
  });
}
```

- [ ] **Step 4: Run — expect `4 passed`.**

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/bid-withdraw.test.ts
git commit -m "feat(deals): withdrawBid — bidder-only with idempotent re-call

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B6: Implement `setDealBidMode` + tests

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Modify: `test/lib/deals/bid-authz.test.ts`

- [ ] **Step 1: Append failing tests.**

```ts
import { setDealBidMode } from "@/lib/deals/actions";

describe("setDealBidMode — owner-only display toggle", () => {
  it("allows the owner to switch display modes", async () => {
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x", bidMode: "single",
    }).returning();
    expect(await setDealBidMode({ dealId: d.id, mode: "history" })).toEqual({ ok: true });
    const [after] = await db.select({ mode: deals.bidMode }).from(deals).where(eq(deals.id, d.id));
    expect(after.mode).toBe("history");
  });

  it("does NOT mutate any bid rows when the mode changes", async () => {
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x", bidMode: "single",
    }).returning();
    const [b] = await db.insert(bids).values({
      dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "M",
      priceCents: 1, bidMode: "single", // snapshot at insert
    }).returning();
    await setDealBidMode({ dealId: d.id, mode: "history" });
    const [bidAfter] = await db.select({ mode: bids.bidMode }).from(bids).where(eq(bids.id, b.id));
    expect(bidAfter.mode).toBe("single"); // snapshot UNCHANGED
  });

  it("forbids a non-owner from changing the display mode", async () => {
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
    }).returning();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    expect(await setDealBidMode({ dealId: d.id, mode: "history" })).toEqual({
      ok: false, error: "Forbidden",
    });
    const [after] = await db.select({ mode: deals.bidMode }).from(deals).where(eq(deals.id, d.id));
    expect(after.mode).toBe("single");
  });
});
```

- [ ] **Step 2: Run — expect missing-export.**

- [ ] **Step 3: Implement.**

Append to `src/lib/deals/actions.ts`:

```ts
export async function setDealBidMode(raw: unknown): Promise<ActionResult> {
  return runWithUser(setDealBidModeInput, raw, async (input: SetDealBidModeInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({ ownerOrgId: deals.orgId })
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!row || row.ownerOrgId !== orgId) throw new ForbiddenError();
    await d
      .update(deals)
      .set({ bidMode: input.mode })
      .where(and(eq(deals.id, input.dealId), eq(deals.orgId, orgId)));
  });
}
```

- [ ] **Step 4: Run — expect 10 passed in `bid-authz.test.ts`.**

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/bid-authz.test.ts
git commit -m "feat(deals): setDealBidMode — owner-only display toggle (no row mutations)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B7: Phase B green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: Phase A baseline + 16 new Phase B test cases (5 + 3 + 2 + 4 + 3) green.

- [ ] **Step 2: tsc.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Phase B done.

---

## Phase C — Demo seed + UI

### Task C1: Add `DEMO_BIDS` constant to `src/lib/demo/seed.ts`

**Files:**
- Modify: `src/lib/demo/seed.ts`
- Modify: `test/lib/demo/seed.test.ts`

- [ ] **Step 1: Open `src/lib/demo/seed.ts` and find the `DEMO_DEAL_MESSAGES` constant + the comment block that explains the "authored-only, not inserted" pattern.**

Append a new constant after `DEMO_DEAL_MESSAGES` and before the `getSeedDealsVisibleTo` export. Note the file already has a TODO comment explaining demo seeds aren't inserted into pglite at runtime; the same applies here.

- [ ] **Step 2: Append `DEMO_BIDS` constant.**

```ts
// --- Slice 16 demo seed: authored-only bid examples ---
// See the comment above DEMO_DEAL_MESSAGES — this is also a TS constant,
// not actually inserted at runtime. The query layer short-circuits in demo
// mode. If a real demo runner is ever added, this is the source.
export type SeedBid = {
  dealId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  bidMode: "single" | "history";
  status: "pending";
  createdAtOffsetMinutes: number;
};

export const DEMO_BIDS: SeedBid[] = [
  {
    dealId: 109,
    bidderOrgId: DEMO_PARTNER_ORG_IDS.MEHTA,
    bidderOrgLabel: "Mehta Diamonds",
    priceCents: 12_300_00,
    currency: "USD",
    notes: "Can pick up today, cash.",
    bidMode: "single",
    status: "pending",
    createdAtOffsetMinutes: 25,
  },
  {
    dealId: 110,
    bidderOrgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD,
    bidderOrgLabel: "Saint-Cloud Atelier",
    priceCents: 89_500_00,
    currency: "USD",
    notes: "Spot price + 2%, 2-day courier.",
    bidMode: "single",
    status: "pending",
    createdAtOffsetMinutes: 10,
  },
];
```

- [ ] **Step 3: Append a test to `test/lib/demo/seed.test.ts`.**

```ts
import { DEMO_BIDS } from "@/lib/demo/seed";

describe("DEMO_BIDS — slice-16 authored seed", () => {
  it("exports exactly 2 pending bids on deals 109 + 110", () => {
    expect(DEMO_BIDS).toHaveLength(2);
    const byDeal = new Map(DEMO_BIDS.map((b) => [b.dealId, b]));
    expect(byDeal.get(109)?.bidderOrgLabel).toBe("Mehta Diamonds");
    expect(byDeal.get(109)?.priceCents).toBe(12_300_00);
    expect(byDeal.get(110)?.bidderOrgLabel).toBe("Saint-Cloud Atelier");
    expect(byDeal.get(110)?.priceCents).toBe(89_500_00);
    expect(DEMO_BIDS.every((b) => b.status === "pending")).toBe(true);
  });
});
```

- [ ] **Step 4: Run.**

```bash
npx vitest run test/lib/demo/seed.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/demo/seed.ts test/lib/demo/seed.test.ts
git commit -m "feat(demo): DEMO_BIDS authored constant for slice-16 demo seed

Authored-only (no pglite runtime insert) — matches the slice-10
DEMO_DEAL_MESSAGES pattern. The query layer short-circuits demo mode,
so this constant exists for a future demo-render shim only.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C2: Create `src/components/deals/DealBidsTab.tsx`

**Files:**
- Create: `src/components/deals/DealBidsTab.tsx`

- [ ] **Step 1: Create the component.**

```tsx
"use client";

import { useState, useTransition, useMemo } from "react";
import type { BidView } from "@/db/bids";

export type DealBidsTabProps = {
  dealId: number;
  viewerOrgId: number;
  isOwner: boolean;
  /** Null when viewer is not the owner (mode selector hidden). */
  currentBidMode: "single" | "history" | null;
  bids: BidView[];
  actions: {
    postBid: (input: {
      dealId: number; priceCents: number; currency?: string; notes?: string;
    }) => Promise<{ ok: true } | { ok: false; error: string }>;
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    withdrawBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    setBidMode: (input: { dealId: number; mode: "single" | "history" }) => Promise<
      { ok: true } | { ok: false; error: string }
    >;
  };
};

function formatPrice(cents: number, currency: string): string {
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(dollars);
  } catch {
    return `${currency} ${dollars.toFixed(2)}`;
  }
}

function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

function statusBadgeClass(status: BidView["status"]): string {
  switch (status) {
    case "pending": return "text-amber-300";
    case "accepted": return "text-emerald-400";
    case "rejected":
    case "withdrawn":
    case "auto_rejected": return "text-zinc-500";
  }
}

export function DealBidsTab(props: DealBidsTabProps) {
  const [pending, startTransition] = useTransition();

  // In single mode (owner only), group by bidder and show only the latest pending row.
  // In history mode OR for non-owner viewers, show all bids chronologically (already DESC).
  const visibleBids = useMemo(() => {
    if (!props.isOwner || props.currentBidMode === "history") return props.bids;
    // Single mode: latest pending per bidder. Past rows hidden behind disclosure.
    const seen = new Set<number>();
    return props.bids
      .filter((b) => b.status === "pending")
      .filter((b) => {
        if (seen.has(b.bidderOrgId)) return false;
        seen.add(b.bidderOrgId);
        return true;
      });
  }, [props.bids, props.isOwner, props.currentBidMode]);

  return (
    <div aria-label="deal bids" className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
      {props.isOwner && props.currentBidMode !== null && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <label htmlFor={`bidmode-${props.dealId}`} className="text-zinc-400">Display:</label>
          <select
            id={`bidmode-${props.dealId}`}
            aria-label="bid display mode"
            value={props.currentBidMode}
            disabled={pending}
            onChange={(e) =>
              startTransition(async () => {
                await props.actions.setBidMode({
                  dealId: props.dealId,
                  mode: e.target.value as "single" | "history",
                });
              })
            }
            className="bg-zinc-800 text-zinc-100 px-1 py-0.5 rounded"
          >
            <option value="single">Single (latest per bidder)</option>
            <option value="history">History (all bids)</option>
          </select>
        </div>
      )}

      {visibleBids.length === 0 ? (
        <p className="text-sm text-zinc-500 mb-2">No bids yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {visibleBids.map((b) => (
            <li key={b.id} aria-label="bid row" className="border-b border-zinc-800 pb-2 last:border-b-0">
              <p className="text-xs text-zinc-400">
                {b.bidderOrgId === props.viewerOrgId ? "You" : b.bidderOrgLabel}
                {" · "}{relativeTime(b.createdAt)}
                {" · "}<span className={statusBadgeClass(b.status)}>{b.status}</span>
              </p>
              <p className="text-sm text-zinc-100 font-semibold">
                {formatPrice(b.priceCents, b.currency)}
              </p>
              {b.notes && (
                <p className="whitespace-pre-wrap text-xs text-zinc-300 mt-1">{b.notes}</p>
              )}
              {props.isOwner && b.status === "pending" && (
                <div className="flex gap-2 mt-1">
                  <button
                    aria-label={`accept bid ${b.id}`}
                    className="text-xs px-2 py-0.5 bg-emerald-500/80 hover:bg-emerald-500 text-zinc-900 rounded"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await props.actions.acceptBid({ bidId: b.id });
                      })
                    }
                  >
                    Accept
                  </button>
                  <button
                    aria-label={`reject bid ${b.id}`}
                    className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await props.actions.rejectBid({ bidId: b.id });
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
              {b.bidderOrgId === props.viewerOrgId && b.status === "pending" && (
                <button
                  aria-label={`withdraw bid ${b.id}`}
                  className="text-xs text-zinc-500 hover:text-rose-400 mt-1"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await props.actions.withdrawBid({ bidId: b.id });
                    })
                  }
                >
                  Withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Bid form hidden when viewer IS the deal owner (can't bid on own deal) */}
      {!props.isOwner && (
        <PostBidFormInline
          dealId={props.dealId}
          postBid={props.actions.postBid}
          disabled={pending}
        />
      )}
    </div>
  );
}

// Inline so DealBidsTab.test.tsx covers it without a separate render harness.
function PostBidFormInline(props: {
  dealId: number;
  postBid: DealBidsTabProps["actions"]["postBid"];
  disabled?: boolean;
}) {
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = () => {
    setError(null);
    const parsed = parseFloat(price);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const priceCents = Math.round(parsed * 100);
    startTransition(async () => {
      const res = await props.postBid({
        dealId: props.dealId, priceCents, currency,
        notes: notes.trim() === "" ? undefined : notes.trim(),
      });
      if (res.ok) {
        setPrice("");
        setNotes("");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1 border-t border-zinc-700 pt-2">
      <div className="flex gap-1">
        <input
          aria-label="bid price"
          type="number"
          step="0.01"
          min="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Your bid"
          className="flex-1 bg-zinc-800 text-zinc-100 text-sm p-1 rounded"
        />
        <select
          aria-label="bid currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="bg-zinc-800 text-zinc-100 text-sm p-1 rounded"
        >
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="INR">INR</option>
          <option value="JPY">JPY</option>
        </select>
      </div>
      <textarea
        aria-label="bid notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional note (≤500 chars)"
        maxLength={500}
        rows={1}
        className="bg-zinc-800 text-zinc-100 text-xs p-1 rounded"
      />
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
      <button
        aria-label="submit bid"
        onClick={handleSubmit}
        disabled={pending || props.disabled || price.trim() === ""}
        className="self-end text-xs px-2 py-1 bg-amber-500/80 hover:bg-amber-500 text-zinc-900 rounded disabled:opacity-50"
      >
        {pending ? "Submitting..." : "Submit bid"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/components/deals/DealBidsTab.tsx
git commit -m "$(cat <<'EOF'
feat(deals): DealBidsTab — bid render + accept/reject/withdraw + submit form

Plain-text rendering of notes (whitespace-pre-wrap, no HTML construction).
Single-mode displays latest-pending-per-bidder; history mode shows all
chronologically. Form hidden for the deal owner (no self-bidding).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task C3: Extend `DealThreadAccordion` with `Messages | Bids` tabs

**Files:**
- Modify: `src/components/deals/DealThreadAccordion.tsx`

- [ ] **Step 1: Read the existing DealThreadAccordion props + body to identify the tab insertion point.**

```bash
grep -nE "function DealThreadAccordion|return \(" src/components/deals/DealThreadAccordion.tsx | head -10
```

The existing component returns a single accordion box that renders messages. We're nesting a tab switcher INSIDE the box.

- [ ] **Step 2: Add bid-related props to `DealThreadAccordionProps`.**

Open `src/components/deals/DealThreadAccordion.tsx`. Extend the props type:

```ts
import type { BidView } from "@/db/bids";

export type DealThreadAccordionProps = {
  /* …existing message-related props… */
  bids?: BidView[];
  currentBidMode?: "single" | "history" | null;
  bidActions?: {
    postBid: (input: { dealId: number; priceCents: number; currency?: string; notes?: string }) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    withdrawBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    setBidMode: (input: { dealId: number; mode: "single" | "history" }) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
  };
};
```

- [ ] **Step 3: Add the tab switcher inside the existing accordion body.**

Add `useState<"messages" | "bids">("messages")` at the top of the component. Render the tab strip at the top of the JSX, before the existing message UI:

```tsx
import { DealBidsTab } from "./DealBidsTab";

const [tab, setTab] = useState<"messages" | "bids">("messages");

return (
  <div aria-label="deal thread" className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
    <div role="tablist" className="flex gap-2 mb-2 text-xs border-b border-zinc-700 pb-1">
      <button
        role="tab"
        aria-selected={tab === "messages"}
        onClick={() => setTab("messages")}
        className={`px-2 py-0.5 rounded ${tab === "messages" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
      >
        Messages
      </button>
      <button
        role="tab"
        aria-selected={tab === "bids"}
        onClick={() => setTab("bids")}
        className={`px-2 py-0.5 rounded ${tab === "bids" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
      >
        Bids
      </button>
    </div>

    {tab === "messages" ? (
      <>{/* existing message UI body — keep as-is */}</>
    ) : (
      <DealBidsTab
        dealId={props.dealId}
        viewerOrgId={props.viewerOrgId}
        isOwner={props.isOwner}
        currentBidMode={props.currentBidMode ?? null}
        bids={props.bids ?? []}
        actions={
          props.bidActions ?? {
            postBid: async () => ({ ok: false, error: "Bid actions not configured" }),
            acceptBid: async () => ({ ok: false, error: "Bid actions not configured" }),
            rejectBid: async () => ({ ok: false, error: "Bid actions not configured" }),
            withdrawBid: async () => ({ ok: false, error: "Bid actions not configured" }),
            setBidMode: async () => ({ ok: false, error: "Bid actions not configured" }),
          }
        }
      />
    )}
  </div>
);
```

> The inner `{/* existing message UI body — keep as-is */}` is the existing JSX you found in Step 1 (the mode selector, message list, soft-delete buttons, reply textarea, etc.) — move it inside the `tab === "messages"` branch without modification.

- [ ] **Step 4: Run existing message tests to confirm nothing broke.**

```bash
npx vitest run test/components/deals/DealThreadAccordion.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: existing tests pass — they don't pass bid props, which default to empty/null, so the bids tab silently no-ops.

- [ ] **Step 5: tsc + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/components/deals/DealThreadAccordion.tsx
git commit -m "feat(deals): DealThreadAccordion gains Messages | Bids tab switcher

Existing message UI moves into the messages tab unchanged. Bid props are
all optional so legacy callers (e.g. existing tests) still typecheck and
render correctly (bids tab silently no-ops with empty data).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C4: Wire bid query results through `src/app/page.tsx` + `DealRoomPanel`

**Files:**
- Modify: `src/components/dashboard/DealRoomPanel.tsx`
- Modify: `src/app/page.tsx` (or wherever DealRoomPanel is rendered as a RSC)

- [ ] **Step 1: Identify the existing slice-10 wiring in `DealRoomPanel.tsx`.**

```bash
grep -nE "unreadByDealId|threadsByDealId|threadModeByDealId" src/components/dashboard/DealRoomPanel.tsx | head -10
```

Slice 10 added three Map props + an actions object. Mirror that shape for bids.

- [ ] **Step 2: Add bid props to `DealRoomPanel`.**

In `DealRoomPanel.tsx`:

```ts
import type { BidView } from "@/db/bids";

type DealRoomPanelProps = {
  /* …existing props… */
  bidsByDealId?: Map<number, BidView[]>;
  bidModeByDealId?: Map<number, "single" | "history">;
  bidActions?: {
    postBid: (input: { dealId: number; priceCents: number; currency?: string; notes?: string }) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    withdrawBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    setBidMode: (input: { dealId: number; mode: "single" | "history" }) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
  };
};
```

- [ ] **Step 3: Pass bid props through to `DealThreadAccordion` at the per-row render site.**

Find the existing `<DealThreadAccordion … />` rendering and add:

```tsx
<DealThreadAccordion
  /* …existing message props… */
  bids={props.bidsByDealId?.get(d.id) ?? []}
  currentBidMode={
    d.orgId === props.viewerOrgId ? (props.bidModeByDealId?.get(d.id) ?? null) : null
  }
  bidActions={props.bidActions}
/>
```

- [ ] **Step 4: In `src/app/page.tsx`, add the bid query calls + wire to the panel.**

Find the RSC fetch block (likely above the JSX). Add:

```ts
import { getBidsForDeal, getTodaysBidsForOwner } from "@/db/bids";
import {
  postBid, acceptBid, rejectBid, withdrawBid, setDealBidMode,
} from "@/lib/deals/actions";

// …existing fetches…
const bidsByDealId = new Map<number, Awaited<ReturnType<typeof getBidsForDeal>>>();
const bidModeByDealId = new Map<number, "single" | "history">();
for (const id of dealIds) {
  bidsByDealId.set(id, await getBidsForDeal(db, orgId, id));
  // Bid mode read is owner-perspective only; non-owner viewers see null
  // (handled in DealRoomPanel — we just stuff every deal we own here)
}
for (const d of visibleDeals) {
  if (d.orgId === orgId) bidModeByDealId.set(d.id, d.bidMode);
}

const todaysBids = await getTodaysBidsForOwner(db, orgId);
```

Pass into `DealRoomPanel`:

```tsx
<DealRoomPanel
  /* …existing props… */
  bidsByDealId={bidsByDealId}
  bidModeByDealId={bidModeByDealId}
  bidActions={{
    postBid, acceptBid, rejectBid, withdrawBid, setBidMode: setDealBidMode,
  }}
/>
```

- [ ] **Step 5: Typecheck + build smoke.**

```bash
npx tsc --noEmit 2>&1 | tail -10
npm run build 2>&1 | tail -20
```

Expected: tsc clean, build succeeds.

- [ ] **Step 6: Commit.**

```bash
git add src/components/dashboard/DealRoomPanel.tsx src/app/page.tsx
git commit -m "feat(deals): wire bid queries + actions into DealRoomPanel render

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C5: Create `src/components/dashboard/TodaysBidsPanel.tsx` + wire it

**Files:**
- Create: `src/components/dashboard/TodaysBidsPanel.tsx`
- Modify: `src/app/page.tsx` (or wherever right-rail panels are composed)

- [ ] **Step 1: Create the component.**

```tsx
"use client";

import { useTransition } from "react";
import type { TodaysBidView } from "@/db/bids";

export type TodaysBidsPanelProps = {
  bids: TodaysBidView[];
  actions: {
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

function formatPrice(cents: number, currency: string): string {
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(dollars);
  } catch {
    return `${currency} ${dollars.toFixed(2)}`;
  }
}

function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function TodaysBidsPanel(props: TodaysBidsPanelProps) {
  const [pending, startTransition] = useTransition();

  return (
    <div aria-label="todays bids panel" className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">Today's Bids</h3>
      {props.bids.length === 0 ? (
        <p className="text-xs text-zinc-500">No bids today yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.bids.map((b) => (
            <li key={b.bidId} aria-label="todays bid row" className="text-xs">
              <p className="text-zinc-300">
                <span className="font-semibold">{b.bidderOrgLabel}</span>
                {" bid "}<span className="text-amber-300">{formatPrice(b.priceCents, b.currency)}</span>
                {" on "}<span className="text-zinc-200">"{truncate(b.dealSubject, 40)}"</span>
              </p>
              <p className="text-zinc-500">{relativeTime(b.createdAt)}</p>
              <div className="flex gap-1 mt-1">
                <button
                  aria-label={`accept bid ${b.bidId}`}
                  className="text-xs px-2 py-0.5 bg-emerald-500/80 hover:bg-emerald-500 text-zinc-900 rounded"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await props.actions.acceptBid({ bidId: b.bidId });
                    })
                  }
                >
                  Accept
                </button>
                <button
                  aria-label={`reject bid ${b.bidId}`}
                  className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await props.actions.rejectBid({ bidId: b.bidId });
                    })
                  }
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `src/app/page.tsx` right-rail composition.**

Find where existing right-rail panels are rendered (look for `RightRail`, `TopCirclesPanel`, etc. — slice-2/3 added some). Add:

```tsx
<TodaysBidsPanel
  bids={todaysBids}
  actions={{ acceptBid, rejectBid }}
/>
```

`todaysBids` was already fetched in Task C4 Step 4. `acceptBid` + `rejectBid` are already imported.

- [ ] **Step 3: tsc + build smoke.**

```bash
npx tsc --noEmit 2>&1 | tail -10
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit.**

```bash
git add src/components/dashboard/TodaysBidsPanel.tsx src/app/page.tsx
git commit -m "feat(deals): TodaysBidsPanel right-rail panel + RSC wiring

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C6: Component test `DealBidsTab.test.tsx`

**Files:**
- Create: `test/components/deals/DealBidsTab.test.tsx`

- [ ] **Step 1: Write the test.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealBidsTab } from "@/components/deals/DealBidsTab";
import type { BidView } from "@/db/bids";

const noopActions = {
  postBid: vi.fn(async (_i: { dealId: number; priceCents: number; currency?: string; notes?: string }) => ({ ok: true as const })),
  acceptBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  rejectBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  withdrawBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  setBidMode: vi.fn(async (_i: { dealId: number; mode: "single" | "history" }) => ({ ok: true as const })),
};

function bid(over: Partial<BidView>): BidView {
  return {
    id: 1, dealId: 1, bidderOrgId: 999, bidderOrgLabel: "Mehta",
    priceCents: 1_200_00, currency: "USD", notes: null,
    bidMode: "single", status: "pending", decidedAt: null, createdAt: new Date(),
    ...over,
  };
}

describe("DealBidsTab", () => {
  it("renders empty state with bid form for non-owner viewer", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null}
      bids={[]} actions={noopActions}
    />);
    expect(screen.getByText(/no bids yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText("bid price")).toBeInTheDocument();
  });

  it("HIDES the bid form when viewer is the deal owner", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[]} actions={noopActions}
    />);
    expect(screen.queryByLabelText("bid price")).toBeNull();
  });

  it("renders mode selector only for the owner", () => {
    const { rerender } = render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[]} actions={noopActions}
    />);
    expect(screen.getByLabelText(/bid display mode/i)).toBeInTheDocument();
    rerender(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null}
      bids={[]} actions={noopActions}
    />);
    expect(screen.queryByLabelText(/bid display mode/i)).toBeNull();
  });

  it("single mode shows latest pending per bidder; hides earlier rows from same bidder", () => {
    const now = Date.now();
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[
        bid({ id: 2, priceCents: 1_300_00, createdAt: new Date(now) }),       // latest pending from Mehta
        bid({ id: 1, priceCents: 1_100_00, createdAt: new Date(now - 60000) }), // earlier pending from Mehta — hidden in single
      ]}
      actions={noopActions}
    />);
    const rows = screen.getAllByLabelText("bid row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("$1,300.00");
  });

  it("history mode shows all bids chronologically", () => {
    const now = Date.now();
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="history"
      bids={[
        bid({ id: 2, priceCents: 1_300_00, createdAt: new Date(now) }),
        bid({ id: 1, priceCents: 1_100_00, createdAt: new Date(now - 60000) }),
      ]}
      actions={noopActions}
    />);
    expect(screen.getAllByLabelText("bid row")).toHaveLength(2);
  });

  it("Accept button click fires acceptBid", async () => {
    const actions = { ...noopActions, acceptBid: vi.fn(async () => ({ ok: true as const })) };
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[bid({ id: 42 })]} actions={actions}
    />);
    fireEvent.click(screen.getByLabelText(/accept bid 42/));
    await waitFor(() => expect(actions.acceptBid).toHaveBeenCalledWith({ bidId: 42 }));
  });

  it("Withdraw button only appears on bidder's own pending bid (not owner's)", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null}
      bids={[bid({ id: 1, bidderOrgId: 999 })]} actions={noopActions}
    />);
    expect(screen.getByLabelText(/withdraw bid 1/)).toBeInTheDocument();
  });

  it("PostBidForm submits parsed cents via postBid", async () => {
    const actions = {
      ...noopActions,
      postBid: vi.fn(async (_i: { dealId: number; priceCents: number; currency?: string; notes?: string }) => ({ ok: true as const })),
    };
    render(<DealBidsTab
      dealId={7} viewerOrgId={999} isOwner={false} currentBidMode={null}
      bids={[]} actions={actions}
    />);
    fireEvent.change(screen.getByLabelText("bid price"), { target: { value: "123.45" } });
    fireEvent.click(screen.getByLabelText(/submit bid/));
    await waitFor(() => expect(actions.postBid).toHaveBeenCalledTimes(1));
    expect(actions.postBid.mock.calls[0][0]).toEqual({
      dealId: 7,
      priceCents: 12345,
      currency: "USD",
      notes: undefined,
    });
  });

  it("XSS sanity: notes with HTML render as text, not executed markup", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[bid({ notes: "<script>alert(1)</script>" })]} actions={noopActions}
    />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect 9 passed.**

```bash
npx vitest run test/components/deals/DealBidsTab.test.tsx --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 3: Commit.**

```bash
git add test/components/deals/DealBidsTab.test.tsx
git commit -m "test(deals): DealBidsTab — single/history rendering, accept/withdraw, XSS

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C7: Component test `TodaysBidsPanel.test.tsx`

**Files:**
- Create: `test/components/dashboard/TodaysBidsPanel.test.tsx`

- [ ] **Step 1: Write the test.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TodaysBidsPanel } from "@/components/dashboard/TodaysBidsPanel";
import type { TodaysBidView } from "@/db/bids";

const noopActions = {
  acceptBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  rejectBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
};

function row(over: Partial<TodaysBidView>): TodaysBidView {
  return {
    bidId: 1, dealId: 100, dealSubject: "1.02ct G/VS1 round",
    bidderOrgLabel: "Mehta", priceCents: 12_300_00, currency: "USD",
    createdAt: new Date(), ...over,
  };
}

describe("TodaysBidsPanel", () => {
  it("renders empty state when there are no bids", () => {
    render(<TodaysBidsPanel bids={[]} actions={noopActions} />);
    expect(screen.getByText(/no bids today yet/i)).toBeInTheDocument();
  });

  it("renders one row per incoming bid", () => {
    render(<TodaysBidsPanel
      bids={[row({ bidId: 1 }), row({ bidId: 2, bidderOrgLabel: "Saint-Cloud", priceCents: 89_500_00 })]}
      actions={noopActions}
    />);
    expect(screen.getAllByLabelText("todays bid row")).toHaveLength(2);
    expect(screen.getByText(/Mehta/)).toBeInTheDocument();
    expect(screen.getByText(/Saint-Cloud/)).toBeInTheDocument();
  });

  it("Accept button click fires acceptBid", async () => {
    const actions = { ...noopActions, acceptBid: vi.fn(async () => ({ ok: true as const })) };
    render(<TodaysBidsPanel bids={[row({ bidId: 42 })]} actions={actions} />);
    fireEvent.click(screen.getByLabelText(/accept bid 42/));
    await waitFor(() => expect(actions.acceptBid).toHaveBeenCalledWith({ bidId: 42 }));
  });

  it("Reject button click fires rejectBid", async () => {
    const actions = { ...noopActions, rejectBid: vi.fn(async () => ({ ok: true as const })) };
    render(<TodaysBidsPanel bids={[row({ bidId: 99 })]} actions={actions} />);
    fireEvent.click(screen.getByLabelText(/reject bid 99/));
    await waitFor(() => expect(actions.rejectBid).toHaveBeenCalledWith({ bidId: 99 }));
  });

  it("truncates long deal subjects to 40 chars", () => {
    const longSubject = "A".repeat(60);
    render(<TodaysBidsPanel bids={[row({ dealSubject: longSubject })]} actions={noopActions} />);
    // Truncated string ends with the ellipsis char
    expect(screen.getByText(/A{39}…/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect 5 passed.**

```bash
npx vitest run test/components/dashboard/TodaysBidsPanel.test.tsx --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 3: Commit.**

```bash
git add test/components/dashboard/TodaysBidsPanel.test.tsx
git commit -m "test(deals): TodaysBidsPanel — empty + populated + accept/reject + truncation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C8: Phase C green-bar verification

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: Phase B baseline + 15 new test cases (1 seed + 9 + 5).

- [ ] **Step 2: tsc + build.**

```bash
npx tsc --noEmit 2>&1 | tail -10
npm run build 2>&1 | tail -10
```

Phase C done.

---

## Phase D — Final verify + merge + deploy

### Task D1: Full suite + lint + typecheck + dev smoke

- [ ] **Step 1: Full suite.**

```bash
npm test -- --run 2>&1 | tail -20
```

Expected: all green. The test-count delta vs the pre-slice-16 baseline is the sum of:
- Phase A: 4 + 2 + 1 = 7
- Phase B: 5 + 3 + 2 + 4 + 3 = 17
- Phase C: 1 + 9 + 5 = 15
Total new: **39 cases**. Plus zero regressions.

- [ ] **Step 2: tsc.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

- [ ] **Step 3: Lint.**

```bash
npm run lint 2>&1 | tail -15
```

Expected: zero errors. If a project-specific rule (e.g., "no .from(<tenanted-table>) outside per-table query module") trips on our bids queries, confirm `bids` is exempt by virtue of living in `src/db/bids.ts` (the canonical query module for bids).

- [ ] **Step 4: Build.**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 5: Local demo-mode smoke check.**

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:3000/ -o /tmp/slice16-home.html
grep -oE "Today's Bids|No bids today yet|Messages|Bids" /tmp/slice16-home.html | sort -u
kill $DEV_PID 2>/dev/null
```

Expected: `Today's Bids` panel header + `No bids today yet` empty state should appear (demo-mode short-circuits the query to []). The `Messages` and `Bids` tab labels only appear in expanded accordions, so they may or may not be in the static HTML depending on whether any deal is rendered open by default — either way is fine.

---

### Task D2: Merge feature branch into main + push + verify Netlify

- [ ] **Step 1: From `.worktrees/slice-16-bidding`, confirm commit history.**

```bash
git log --oneline main..HEAD | wc -l
git log --oneline main..HEAD | head -25
```

Expected: ~22-25 commits across the four phases.

- [ ] **Step 2: Switch to `/root` (the main worktree) and pull latest main.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git fetch origin --quiet
git pull --ff-only origin main
```

Expected: clean pull. If main has advanced (parallel agent merged something), the merge below will need to handle it.

- [ ] **Step 3: Merge.**

```bash
git merge --no-ff feature/slice-16-bidding -m "$(cat <<'EOF'
Merge feature/slice-16-bidding: Bidding tab + Today's Bids panel

Structured price offers alongside slice-10 messaging. Append-only
data layer with owner-toggleable single/history display mode (purely
render-time). Accept is atomic: deal → Filled + sibling pending bids
→ auto_rejected in one transaction. Bid visibility is bidder + owner
only — independent of deals.thread_mode. No self-bidding. No partial
fills. Reuses slice-10 canSeeDeal + ForbiddenError + denormalized
org-label pattern. New TodaysBidsPanel in the right rail.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push.**

```bash
git push origin main
```

- [ ] **Step 5: Poll Netlify until the deploy lands.**

The slice-16 deploy is mostly server-side; the visible UI marker is the `Today's Bids` panel header which the right rail will now render. Use it:

```bash
(
  url="https://idesign-dash-demo.netlify.app/"
  marker="Today's Bids"
  start=$(date +%s)
  deadline=$((start + 360))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(curl -sL --max-time 15 "$url" 2>/dev/null || true)
    if echo "$body" | grep -q "$marker"; then
      echo "SLICE_16_LIVE after $(( $(date +%s) - start ))s"
      exit 0
    fi
    sleep 20
  done
  echo "TIMEOUT — slice-16 marker '$marker' not found in 6 min"
  exit 1
)
```

Run in background with the established polling pattern. Expected: marker found within ~2-3 minutes of push.

- [ ] **Step 6: Tear down the worktree + delete the feature branch.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree remove .worktrees/slice-16-bidding
git branch -d feature/slice-16-bidding
git push origin --delete feature/slice-16-bidding 2>/dev/null || true
git worktree list
```

Expected: only the main worktree at `/root` (and the parallel agent's worktree at `.worktrees/aiya-polish-observability-11`, if still active).

Slice 16 done.

---

## Self-Review Notes (filled during writing-plans skill)

**1. Spec coverage check:**
- §3 schema (bids + bid_mode column) → A1, A2 ✓
- §4 visibility model (bidder + owner, decoupled from thread_mode) → A3 SQL (encoded in WHERE clause) + B2 canBidOn ✓
- §5 display mode (data is history; mode is render) → A1 (column exists), B6 (set), C2 (DealBidsTab single/history filtering) ✓
- §6 authz (5 rules) → B2-B6 each implements one + tests one ✓
- §7 server actions → B2 postBid, B3 acceptBid (atomicity), B4 rejectBid, B5 withdrawBid (with idempotency), B6 setDealBidMode ✓
- §8 query layer → A3 getBidsForDeal, A4 getTodaysBidsForOwner ✓
- §9 UI → C2 DealBidsTab + inline PostBidForm, C3 DealThreadAccordion tabs, C4 DealRoomPanel wiring, C5 TodaysBidsPanel, C6 + C7 tests ✓
- §10 testing → 8 listed test files mapped (mig smoke, bids query, bid-authz, accept-atomicity, withdraw, DealBidsTab, TodaysBidsPanel, demo-seed update); the "demo seed test" is C1's append ✓
- §11 migration & rollout → A2 (gen + rename), D1 (build), D2 (deploy + verify) ✓

**2. Placeholder scan:** None. Every step has either an exact command, a complete code block, or an exact textual diff instruction. The migration-number `NNNN` is named with explicit instructions on how to resolve it at execution time (Pre-flight Step 3).

**3. Type consistency:**
- `BidView`, `TodaysBidView`, `BidStatus`, `SeedBid` defined once each (A3, A4, A3, C1) and reused consistently in all downstream tasks.
- `runWithUser`, `ForbiddenError`, `canSeeDeal`, `resolveOrgLabel`, `db()`, `__setTestDb` — all slice-10 symbols, reused not redefined.
- Action signatures: `(raw: unknown) => Promise<ActionResult>` consistent across all 5 new actions.
- Map prop shapes in `DealRoomPanel`: `Map<number, BidView[]>`, `Map<number, "single" | "history">` — match the slice-10 pattern.

Plan is ready.
