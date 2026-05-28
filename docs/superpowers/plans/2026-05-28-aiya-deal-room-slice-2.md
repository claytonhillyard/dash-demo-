# AIYA Slice 2 — Deal Room (Browse + Post) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the org-scoped Deal Room MVP — Drizzle table, three server actions, dashboard panel + admin page, demo-mode seeds — replacing the current `tradenet-exchange` placeholder without changing its registry id.

**Architecture:** Drizzle table `deals` (org-scoped, integer cents, text+Zod enums) → query layer with demo short-circuit → `run()`-wrapped server actions → dashboard panel + `/deals` admin page. Registry entry `tradenet-exchange` keeps its id; only `title` and `render` change so persisted user layouts auto-upgrade.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind · Drizzle ORM · pglite (test) · Neon (prod) · Zod · Vitest · existing JWT/middleware/run()/`AIYA_ORG_ID` seams.

**Spec:** `docs/superpowers/specs/2026-05-28-aiya-deal-room-slice-2-design.md`

**Conventions:**
- Run a single test file: `npx vitest run <path>`
- DB/action tests use `// @vitest-environment node` and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` + `__setTestDb` pattern from `test/helpers/shared-db.ts`.
- Money is integer cents; integer `price_cents` per spec §2.1.
- `run()` short-circuits on `isDemoMode()` before any other work (matches inventory + diamonds).
- All queries/mutations scope on `and(eq(deals.orgId, AIYA_ORG_ID), ...)`.
- Commit after every green step.

---

## Task 0: Set up worktree

**Files:** none (environment setup)

- [ ] **Step 1: From repo root, create the worktree.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root" && git worktree add -b feature/aiya-deal-room-slice-2 .worktrees/aiya-deal-room-slice-2 main`
  Expected: new worktree directory at `.worktrees/aiya-deal-room-slice-2`, branch `feature/aiya-deal-room-slice-2` checked out there.

- [ ] **Step 2: Switch to the worktree and install.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-deal-room-slice-2" && npm install`
  Expected: clean install; no errors.

- [ ] **Step 3: Verify baseline tests pass.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-deal-room-slice-2" && npm test -- --run`
  Expected: full suite green (~226+ tests depending on origin/main state). If anything fails, STOP — the baseline is broken, not your code.

(All subsequent `cd` commands in this plan reference the worktree path. Use `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-deal-room-slice-2"` before any command.)

---

## Phase A — Server foundation

### Task A1: Add the `deals` table to the schema

**Files:**
- Modify: `src/db/schema.ts`
- Test: `test/db/schema.test.ts`

- [ ] **Step 1: Add failing schema assertions.** Append a new `it(...)` inside the existing `describe("db schema", …)` in `test/db/schema.test.ts`:

```ts
  it("exports the deals table with integer cents + org scoping", () => {
    expect(schema.deals).toBeDefined();
    expect(schema.deals.orgId.columnType).toBe("PgInteger");
    expect(schema.deals.priceCents.columnType).toBe("PgInteger");
    expect(schema.deals.quantity.columnType).toBe("PgInteger");
  });
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/schema.test.ts`
Expected: FAIL — `schema.deals` is undefined.

- [ ] **Step 3: Add the table.** In `src/db/schema.ts`, append at the bottom (imports `pgTable, serial, integer, text, timestamp` already exist):

```ts
export const deals = pgTable(
  "deals",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull().default(1), // 1 = AIYA; orgs table arrives with multi-tenant slice
    kind: text("kind", { enum: ["BUY", "SELL"] }).notNull(),
    category: text("category", {
      enum: ["Diamond", "Gem", "Metal", "Finished", "Other"],
    }).notNull(),
    subject: text("subject").notNull(),
    quantity: integer("quantity").notNull().default(1),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status", { enum: ["Open", "Filled", "Withdrawn"] })
      .notNull()
      .default("Open"),
    postedByLabel: text("posted_by_label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgStatusCreatedIdx: index("deals_org_status_created_idx").on(
      t.orgId,
      t.status,
      t.createdAt.desc()
    ),
    orgKindIdx: index("deals_org_kind_idx").on(t.orgId, t.kind),
    orgCategoryIdx: index("deals_org_category_idx").on(t.orgId, t.category),
  })
);
```

  Also add `index` to the top-of-file import: change `import { pgTable, serial, integer, text, date, timestamp, jsonb, unique } from "drizzle-orm/pg-core";` to include `index`:

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
} from "drizzle-orm/pg-core";
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/schema.test.ts`
Expected: PASS (all prior + the new deals assertion).

- [ ] **Step 5: Commit.**
```bash
git add src/db/schema.ts test/db/schema.test.ts
git commit -m "feat(db): add deals table (org-scoped, integer cents, text+Zod enums)"
```

---

### Task A2: Generate and verify the migration

**Files:**
- Create: `drizzle/0003_*.sql` (generated) + `drizzle/meta/*` updates
- Test: `test/db/deals-migration.test.ts`

- [ ] **Step 1: Generate the migration.** Run: `npm run db:generate`
Expected: a new `drizzle/0003_<name>.sql` appears containing `CREATE TABLE "deals"` plus three `CREATE INDEX` statements (`deals_org_status_created_idx`, `deals_org_kind_idx`, `deals_org_category_idx`), and `drizzle/meta/_journal.json` + a new snapshot are updated. The command is non-interactive — if it appears to hang waiting for input, report BLOCKED.

- [ ] **Step 2: Inspect the generated SQL.** Open `drizzle/0003_*.sql` and confirm:
  - Table name is `deals`.
  - `price_cents` is `integer NOT NULL`.
  - `org_id` defaults to `1`.
  - `status` defaults to `'Open'`.
  - All three indexes are present.

- [ ] **Step 3: Failing migration smoke test.** Create `test/db/deals-migration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@/db/client";
import { deals } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("deals migration", () => {
  it("creates the deals table in a freshly migrated pglite db", async () => {
    const t = await createTestDb();
    close = t.close;
    const rows = await t.db.select({ id: deals.id }).from(deals);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/deals-migration.test.ts`
Expected: PASS (table exists after migrate). If it fails with "relation deals does not exist", the migration was not generated — re-run Step 1.

- [ ] **Step 5: Commit.**
```bash
git add drizzle test/db/deals-migration.test.ts
git commit -m "feat(db): generate deals migration"
```

---

### Task A3: Deal constants

**Files:**
- Create: `src/lib/deals/constants.ts`
- Test: `test/lib/deals/constants.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/deals/constants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEAL_KINDS, DEAL_CATEGORIES, DEAL_STATUSES } from "@/lib/deals/constants";

describe("deal constants", () => {
  it("exports the BUY/SELL kinds", () => {
    expect(DEAL_KINDS).toEqual(["BUY", "SELL"]);
  });
  it("exports the five categories", () => {
    expect(DEAL_CATEGORIES).toEqual(["Diamond", "Gem", "Metal", "Finished", "Other"]);
  });
  it("exports the three statuses", () => {
    expect(DEAL_STATUSES).toEqual(["Open", "Filled", "Withdrawn"]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/deals/constants.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/lib/deals/constants.ts`:

```ts
export const DEAL_KINDS = ["BUY", "SELL"] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

export const DEAL_CATEGORIES = ["Diamond", "Gem", "Metal", "Finished", "Other"] as const;
export type DealCategory = (typeof DEAL_CATEGORIES)[number];

export const DEAL_STATUSES = ["Open", "Filled", "Withdrawn"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/deals/constants.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/deals/constants.ts test/lib/deals/constants.test.ts
git commit -m "feat(deals): kind/category/status const arrays + derived types"
```

---

### Task A4: Deal validation (Zod)

**Files:**
- Create: `src/lib/deals/validation.ts`
- Test: `test/lib/deals/validation.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/deals/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { postDealInput, updateDealStatusInput, firstZodError } from "@/lib/deals/validation";

describe("postDealInput", () => {
  it("accepts a valid SELL Diamond deal", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Diamond",
      subject: "Round 1.02ct G/VS1",
      quantity: 1, priceCents: 1240000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a valid BUY Metal deal", () => {
    const r = postDealInput.safeParse({
      kind: "BUY", category: "Metal",
      subject: "18K gold chain lot, 10g per link",
      quantity: 5, priceCents: 875000,
    });
    expect(r.success).toBe(true);
  });

  it("trims leading/trailing whitespace from subject", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other",
      subject: "  loose pearls  ",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.subject).toBe("loose pearls");
  });

  it("rejects an empty subject", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstZodError(r.error)).toMatch(/subject/);
  });

  it("rejects a subject over 280 chars", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other",
      subject: "x".repeat(281),
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative price", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "x",
      quantity: 1, priceCents: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-integer price", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "x",
      quantity: 1, priceCents: 100.5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects zero quantity", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "x",
      quantity: 0, priceCents: 100,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const r = postDealInput.safeParse({
      kind: "TRADE", category: "Other", subject: "x",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown category", () => {
    const r = postDealInput.safeParse({
      kind: "BUY", category: "Spaceships", subject: "x",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(false);
  });

  it("defaults currency to USD when omitted", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "x",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("USD");
  });
});

describe("updateDealStatusInput", () => {
  it("accepts Filled", () => {
    expect(updateDealStatusInput.safeParse({ id: 1, status: "Filled" }).success).toBe(true);
  });
  it("accepts Withdrawn", () => {
    expect(updateDealStatusInput.safeParse({ id: 1, status: "Withdrawn" }).success).toBe(true);
  });
  it("rejects Open (terminal-only update target)", () => {
    expect(updateDealStatusInput.safeParse({ id: 1, status: "Open" }).success).toBe(false);
  });
  it("rejects an unknown status", () => {
    expect(updateDealStatusInput.safeParse({ id: 1, status: "Reopened" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/deals/validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/lib/deals/validation.ts`:

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
Expected: PASS (15 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/deals/validation.ts test/lib/deals/validation.test.ts
git commit -m "feat(deals): zod validation (post + update status; terminal-only)"
```

---

### Task A5: Extend demo seed with `getSeedDeals()`

**Files:**
- Modify: `src/lib/demo/seed.ts`
- Test: `test/lib/demo/seed.test.ts`

- [ ] **Step 1: Failing test.** Append the following block to `test/lib/demo/seed.test.ts` (after the existing `describe`):

```ts
import { getSeedDeals } from "@/lib/demo/seed";
import { DEAL_KINDS, DEAL_CATEGORIES, DEAL_STATUSES } from "@/lib/deals/constants";

describe("getSeedDeals", () => {
  it("returns exactly 5 rows", () => {
    expect(getSeedDeals()).toHaveLength(5);
  });
  it("each row has valid kind/category/status", () => {
    for (const d of getSeedDeals()) {
      expect(DEAL_KINDS).toContain(d.kind);
      expect(DEAL_CATEGORIES).toContain(d.category);
      expect(DEAL_STATUSES).toContain(d.status);
    }
  });
  it("every subject carries the 'demo · simulated' provenance suffix", () => {
    for (const d of getSeedDeals()) {
      expect(d.subject).toMatch(/demo · simulated/);
    }
  });
  it("price_cents >= 0 and quantity >= 1 everywhere", () => {
    for (const d of getSeedDeals()) {
      expect(d.priceCents).toBeGreaterThanOrEqual(0);
      expect(d.quantity).toBeGreaterThanOrEqual(1);
    }
  });
  it("createdAt is a Date instance on every row", () => {
    for (const d of getSeedDeals()) {
      expect(d.createdAt).toBeInstanceOf(Date);
    }
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: FAIL — `getSeedDeals` not exported.

- [ ] **Step 3: Implement.** Append to `src/lib/demo/seed.ts`:

```ts
import type { DealRow } from "@/lib/deals/queries";

// Fixed reference instant so relative ages are deterministic across renders.
// (Real `getActiveDeals` runs against the DB; this only fires when isDemoMode().)
const DEMO_REF = new Date("2026-05-28T12:00:00Z").getTime();

export function getSeedDeals(): DealRow[] {
  return [
    {
      id: 101,
      kind: "SELL",
      category: "Diamond",
      subject: "Round 1.02ct G/VS1 natural — demo · simulated",
      quantity: 1,
      priceCents: 1240000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      createdAt: new Date(DEMO_REF - 2 * 3600 * 1000),
    },
    {
      id: 102,
      kind: "BUY",
      category: "Metal",
      subject: "18K gold chain lot, 10g per link — demo · simulated",
      quantity: 5,
      priceCents: 875000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      createdAt: new Date(DEMO_REF - 5 * 3600 * 1000),
    },
    {
      id: 103,
      kind: "SELL",
      category: "Gem",
      subject: "Colombian emerald 3.4ct, Gübelin cert — demo · simulated",
      quantity: 1,
      priceCents: 3400000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      createdAt: new Date(DEMO_REF - 26 * 3600 * 1000),
    },
    {
      id: 104,
      kind: "SELL",
      category: "Finished",
      subject: "Platinum diamond tennis bracelet — demo · simulated",
      quantity: 1,
      priceCents: 2250000,
      currency: "USD",
      status: "Filled",
      postedByLabel: "demo-user",
      createdAt: new Date(DEMO_REF - 72 * 3600 * 1000),
    },
    {
      id: 105,
      kind: "BUY",
      category: "Diamond",
      subject: "Lab 2ct F/VVS2 any shape — demo · simulated",
      quantity: 3,
      priceCents: 620000,
      currency: "USD",
      status: "Open",
      postedByLabel: "demo-user",
      createdAt: new Date(DEMO_REF - 15 * 60 * 1000),
    },
  ];
}
```

(This introduces a type-only import on `@/lib/deals/queries` — that module is created next in Task A6. TypeScript will not complain about a missing module until the queries file is committed, but the seed test imports nothing from it directly; it imports the `getSeedDeals` value. Run the test BEFORE building. If `tsc --noEmit` is run between A5 and A6, expect a "Cannot find module" error — that resolves in A6.)

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/demo/seed.test.ts`
Expected: PASS (existing 2 + new 5 = 7 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/demo/seed.ts test/lib/demo/seed.test.ts
git commit -m "feat(deals): demo seed (5 deals with simulated provenance)"
```

---

### Task A6: Queries (`getActiveDeals` + `getAllDeals`)

**Files:**
- Create: `src/lib/deals/queries.ts`
- Test: `test/lib/deals/queries.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/deals/queries.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import { getActiveDeals, getAllDeals } from "@/lib/deals/queries";
import { AIYA_ORG_ID } from "@/db/org";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function insert(overrides: Partial<typeof deals.$inferInsert> = {}) {
  await db.insert(deals).values({
    orgId: AIYA_ORG_ID,
    kind: "SELL",
    category: "Diamond",
    subject: "test",
    quantity: 1,
    priceCents: 100,
    postedByLabel: "boss",
    ...overrides,
  });
}

describe("getActiveDeals", () => {
  it("returns only Open deals, newest first", async () => {
    await insert({ subject: "older open", createdAt: new Date(Date.now() - 60_000) });
    await insert({ subject: "newer open" });
    await insert({ subject: "filled", status: "Filled" });
    await insert({ subject: "withdrawn", status: "Withdrawn" });
    const rows = await getActiveDeals(db, AIYA_ORG_ID);
    expect(rows.map((r) => r.subject)).toEqual(["newer open", "older open"]);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 8; i++) await insert({ subject: `d${i}` });
    const rows = await getActiveDeals(db, AIYA_ORG_ID, 3);
    expect(rows).toHaveLength(3);
  });

  it("returns [] when the table is empty", async () => {
    const rows = await getActiveDeals(db, AIYA_ORG_ID);
    expect(rows).toEqual([]);
  });
});

describe("getAllDeals", () => {
  it("returns all statuses when no filter is supplied", async () => {
    await insert({ subject: "a" });
    await insert({ subject: "b", status: "Filled" });
    await insert({ subject: "c", status: "Withdrawn" });
    const rows = await getAllDeals(db, AIYA_ORG_ID);
    expect(rows).toHaveLength(3);
  });

  it("filters by status", async () => {
    await insert({ subject: "open" });
    await insert({ subject: "filled", status: "Filled" });
    const rows = await getAllDeals(db, AIYA_ORG_ID, { status: "Filled" });
    expect(rows.map((r) => r.subject)).toEqual(["filled"]);
  });

  it("filters by kind", async () => {
    await insert({ subject: "sell", kind: "SELL" });
    await insert({ subject: "buy", kind: "BUY" });
    const rows = await getAllDeals(db, AIYA_ORG_ID, { kind: "BUY" });
    expect(rows.map((r) => r.subject)).toEqual(["buy"]);
  });

  it("filters by category", async () => {
    await insert({ subject: "diamond", category: "Diamond" });
    await insert({ subject: "gem", category: "Gem" });
    const rows = await getAllDeals(db, AIYA_ORG_ID, { category: "Gem" });
    expect(rows.map((r) => r.subject)).toEqual(["gem"]);
  });

  it("scopes to the supplied org (tenancy isolation)", async () => {
    await insert({ subject: "aiya", orgId: 1 });
    await insert({ subject: "otherOrg", orgId: 2 });
    expect((await getActiveDeals(db, 1)).map((r) => r.subject)).toEqual(["aiya"]);
    expect((await getActiveDeals(db, 2)).map((r) => r.subject)).toEqual(["otherOrg"]);
    expect((await getAllDeals(db, 1)).map((r) => r.subject)).toEqual(["aiya"]);
    expect((await getAllDeals(db, 2)).map((r) => r.subject)).toEqual(["otherOrg"]);
  });
});

describe("demo-mode short-circuit", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("getActiveDeals returns seed slice without DB access", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const rows = await getActiveDeals(db, AIYA_ORG_ID, 5);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.subject).toMatch(/demo · simulated/);
  });

  it("getActiveDeals respects limit in demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const rows = await getActiveDeals(db, AIYA_ORG_ID, 2);
    expect(rows).toHaveLength(2);
  });

  it("getAllDeals returns full seed in demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const rows = await getAllDeals(db, AIYA_ORG_ID);
    expect(rows).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/deals/queries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/lib/deals/queries.ts`:

```ts
import { and, eq, desc, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema";
import { AIYA_ORG_ID } from "@/db/org";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedDeals } from "@/lib/demo/seed";
import type { DealKind, DealCategory, DealStatus } from "./constants";

export interface DealRow {
  id: number;
  kind: DealKind;
  category: DealCategory;
  subject: string;
  quantity: number;
  priceCents: number;
  currency: string;
  status: DealStatus;
  postedByLabel: string;
  createdAt: Date;
}

export interface DealFilters {
  status?: DealStatus;
  kind?: DealKind;
  category?: DealCategory;
}

const COLUMNS = {
  id: deals.id,
  kind: deals.kind,
  category: deals.category,
  subject: deals.subject,
  quantity: deals.quantity,
  priceCents: deals.priceCents,
  currency: deals.currency,
  status: deals.status,
  postedByLabel: deals.postedByLabel,
  createdAt: deals.createdAt,
} as const;

export async function getActiveDeals(
  db: Db,
  orgId: number = AIYA_ORG_ID,
  limit: number = 5
): Promise<DealRow[]> {
  if (isDemoMode()) {
    return getSeedDeals().filter((d) => d.status === "Open").slice(0, limit);
  }
  const rows = await db
    .select(COLUMNS)
    .from(deals)
    .where(and(eq(deals.orgId, orgId), eq(deals.status, "Open")))
    .orderBy(desc(deals.createdAt))
    .limit(limit);
  return rows as DealRow[];
}

export async function getAllDeals(
  db: Db,
  orgId: number = AIYA_ORG_ID,
  filters: DealFilters = {}
): Promise<DealRow[]> {
  if (isDemoMode()) return getSeedDeals();
  const clauses: SQL[] = [eq(deals.orgId, orgId)];
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

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/deals/queries.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean (the A5 forward-reference to `DealRow` from `queries.ts` now resolves).

- [ ] **Step 6: Commit.**
```bash
git add src/lib/deals/queries.ts test/lib/deals/queries.test.ts
git commit -m "feat(deals): query layer (active + all with filters; demo short-circuit; tenancy isolation)"
```

---

### Task A7: Server actions (post / mark filled / withdraw)

**Files:**
- Create: `src/lib/deals/actions.ts`
- Test: `test/lib/deals/actions.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/deals/actions.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss" })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import {
  postDeal, markDealFilled, withdrawDeal, __setTestDb,
} from "@/lib/deals/actions";
import { getActiveDeals, getAllDeals } from "@/lib/deals/queries";
import { requireSession } from "@/lib/auth/requireSession";
import { AIYA_ORG_ID } from "@/db/org";
import { revalidatePath } from "next/cache";

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

describe("postDeal", () => {
  it("inserts a row that getActiveDeals returns", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond",
      subject: "Round 1.02ct G/VS1", quantity: 1, priceCents: 1240000,
    });
    expect(res).toEqual({ ok: true });
    const rows = await getActiveDeals(db, AIYA_ORG_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe("Round 1.02ct G/VS1");
    expect(rows[0].postedByLabel).toBe("boss");
  });

  it("rejects invalid input with a typed error", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond",
      subject: "", quantity: 1, priceCents: 100,
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error).toMatch(/subject/);
    expect(await getAllDeals(db, AIYA_ORG_ID)).toHaveLength(0);
  });

  it("surfaces unauthorized as a typed error (no insert)", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized")
    );
    const res = await postDeal({
      kind: "SELL", category: "Diamond",
      subject: "x", quantity: 1, priceCents: 100,
    });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await getAllDeals(db, AIYA_ORG_ID)).toHaveLength(0);
  });

  it("revalidates / and /deals on success", async () => {
    await postDeal({
      kind: "BUY", category: "Metal", subject: "x", quantity: 1, priceCents: 100,
    });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/");
    expect(calls).toContain("/deals");
  });
});

describe("markDealFilled", () => {
  it("flips an Open deal to Filled", async () => {
    await postDeal({
      kind: "SELL", category: "Diamond", subject: "x", quantity: 1, priceCents: 100,
    });
    const [row] = await db.select({ id: deals.id }).from(deals);
    const res = await markDealFilled(row.id);
    expect(res).toEqual({ ok: true });
    const all = await getAllDeals(db, AIYA_ORG_ID);
    expect(all[0].status).toBe("Filled");
  });
});

describe("withdrawDeal", () => {
  it("flips an Open deal to Withdrawn", async () => {
    await postDeal({
      kind: "BUY", category: "Gem", subject: "x", quantity: 1, priceCents: 100,
    });
    const [row] = await db.select({ id: deals.id }).from(deals);
    const res = await withdrawDeal(row.id);
    expect(res).toEqual({ ok: true });
    const all = await getAllDeals(db, AIYA_ORG_ID);
    expect(all[0].status).toBe("Withdrawn");
  });

  it("rejects non-integer id with a typed error", async () => {
    const res = await withdrawDeal("oops" as unknown as number);
    expect(res.ok).toBe(false);
  });
});

describe("tenancy isolation on mutation", () => {
  it("withdrawDeal does not touch other-org rows", async () => {
    await db.insert(deals).values({
      orgId: 2, kind: "SELL", category: "Diamond", subject: "other",
      quantity: 1, priceCents: 100, postedByLabel: "x",
    });
    const [otherRow] = await db.select({ id: deals.id }).from(deals);
    const res = await withdrawDeal(otherRow.id);
    expect(res).toEqual({ ok: true }); // no error, no match
    const orgTwo = await getAllDeals(db, 2);
    expect(orgTwo[0].status).toBe("Open"); // unchanged
  });
});

describe("demo writes disabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("postDeal returns the disabled error and writes nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "x", quantity: 1, priceCents: 100,
    });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
  });

  it("markDealFilled returns the disabled error", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(await markDealFilled(1)).toEqual({
      ok: false, error: "Demo mode — changes are disabled",
    });
  });

  it("withdrawDeal returns the disabled error", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(await withdrawDeal(1)).toEqual({
      ok: false, error: "Demo mode — changes are disabled",
    });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/deals/actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/lib/deals/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { deals } from "@/db/schema";
import { AIYA_ORG_ID } from "@/db/org";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import {
  postDealInput, updateDealStatusInput, firstZodError,
  type PostDealInput, type UpdateDealStatusInput,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

// test seam — inject an isolated pglite db (mirrors inventory + diamonds pattern)
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> { testDb = db; }
function db(): Db { return testDb ?? getDb(); }

/** Demo-guard, session re-assert, validate, run, revalidate; never throw to UI. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T) => Promise<void>
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  try {
    await requireSession();
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data);
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

/** Same as run() but resolves the session first and threads `session.user`
 *  into the mutation, so postDeal can stamp postedByLabel without a second
 *  requireSession() call. */
async function runWithUser<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, user: string) => Promise<void>
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let user: string;
  try {
    const session = await requireSession();
    user = session.user;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, user);
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

export async function postDeal(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealInput, raw, async (input: PostDealInput, user) => {
    const inserted = await db().insert(deals).values({
      orgId: AIYA_ORG_ID,
      kind: input.kind,
      category: input.category,
      subject: input.subject,
      quantity: input.quantity,
      priceCents: input.priceCents,
      currency: input.currency,
      postedByLabel: user,
    }).returning({ id: deals.id });
    const id = inserted[0]?.id;
    console.log(
      `[deals] posted deal id=${id} kind=${input.kind} category=${input.category} by=${user}`
    );
  });
}

async function updateStatus(input: UpdateDealStatusInput): Promise<void> {
  await db()
    .update(deals)
    .set({ status: input.status, updatedAt: new Date() })
    .where(and(eq(deals.id, input.id), eq(deals.orgId, AIYA_ORG_ID)));
  console.log(`[deals] deal id=${input.id} status changed to ${input.status}`);
}

export async function markDealFilled(id: number): Promise<ActionResult> {
  return run(updateDealStatusInput, { id, status: "Filled" }, updateStatus);
}

export async function withdrawDeal(id: number): Promise<ActionResult> {
  return run(updateDealStatusInput, { id, status: "Withdrawn" }, async (input) => {
    await updateStatus(input);
    console.log(`[deals] deal id=${input.id} withdrawn`);
  });
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/deals/actions.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/deals/actions.ts test/lib/deals/actions.test.ts
git commit -m "feat(deals): server actions (postDeal, markDealFilled, withdrawDeal) with demo + auth guards"
```

---

## Phase B — UI

### Task B1: `timeAgo` helper

**Files:**
- Modify: `src/lib/company/format.ts`
- Test: `test/lib/company/format.test.ts`

- [ ] **Step 1: Failing test.** Append to `test/lib/company/format.test.ts`:

```ts
import { timeAgo } from "@/lib/company/format";

describe("timeAgo", () => {
  const now = new Date("2026-05-28T12:00:00Z").getTime();

  it("'just now' for < 60 seconds", () => {
    expect(timeAgo(new Date(now - 30_000), now)).toBe("just now");
  });
  it("minutes for 1m..59m", () => {
    expect(timeAgo(new Date(now - 15 * 60_000), now)).toBe("15m ago");
  });
  it("hours for 1h..23h", () => {
    expect(timeAgo(new Date(now - 3 * 3_600_000), now)).toBe("3h ago");
  });
  it("days for 1d..6d", () => {
    expect(timeAgo(new Date(now - 2 * 86_400_000), now)).toBe("2d ago");
  });
  it("short date for >= 7 days", () => {
    const result = timeAgo(new Date(now - 8 * 86_400_000), now);
    expect(result).toMatch(/[A-Z][a-z]{2} \d+/); // e.g. "May 20"
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/company/format.test.ts`
Expected: FAIL — `timeAgo` not exported.

- [ ] **Step 3: Implement.** Append to `src/lib/company/format.ts`:

```ts
/** Relative time label: "just now" / "15m ago" / "3h ago" / "2d ago" / short date.
 *  `now` is injectable for deterministic tests. */
export function timeAgo(date: Date, now: number = Date.now()): string {
  const diffMs = now - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/company/format.test.ts`
Expected: PASS (existing + 5 new).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/company/format.ts test/lib/company/format.test.ts
git commit -m "feat(format): timeAgo helper (deterministic via injectable now)"
```

---

### Task B2: `DealRoomPanel` dashboard panel

**Files:**
- Create: `src/components/dashboard/DealRoomPanel.tsx`
- Test: `test/components/dashboard/DealRoomPanel.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/dashboard/DealRoomPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealRoomPanel } from "@/components/dashboard/DealRoomPanel";
import type { DealRow } from "@/lib/deals/queries";

function makeDeal(over: Partial<DealRow> = {}): DealRow {
  return {
    id: 1, kind: "SELL", category: "Diamond",
    subject: "Round 1.02ct G/VS1",
    quantity: 1, priceCents: 1240000, currency: "USD",
    status: "Open", postedByLabel: "boss",
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    ...over,
  };
}

describe("DealRoomPanel", () => {
  it("renders BUY and SELL kind badges", () => {
    render(<DealRoomPanel deals={[
      makeDeal({ id: 1, kind: "BUY", subject: "buy lot" }),
      makeDeal({ id: 2, kind: "SELL", subject: "sell lot" }),
    ]} />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();
  });

  it("renders the subject as plain text", () => {
    render(<DealRoomPanel deals={[makeDeal({ subject: "Emerald 3.4ct" })]} />);
    expect(screen.getByText("Emerald 3.4ct")).toBeInTheDocument();
  });

  it("does NOT execute script in subject (XSS)", () => {
    const subject = "<script>alert(1)</script>";
    const { container } = render(<DealRoomPanel deals={[makeDeal({ subject })]} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(subject);
  });

  it("renders formatted price", () => {
    render(<DealRoomPanel deals={[makeDeal({ priceCents: 1240000 })]} />);
    expect(screen.getByText(/\$12,400/)).toBeInTheDocument();
  });

  it("renders an empty state when no deals", () => {
    render(<DealRoomPanel deals={[]} />);
    expect(screen.getByText(/no open deals/i)).toBeInTheDocument();
  });

  it('"View all" link points to /deals', () => {
    render(<DealRoomPanel deals={[makeDeal()]} />);
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link).toHaveAttribute("href", "/deals");
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/dashboard/DealRoomPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/components/dashboard/DealRoomPanel.tsx`:

```tsx
import Link from "next/link";
import { Panel } from "@/components/Panel";
import { formatCents, timeAgo } from "@/lib/company/format";
import type { DealRow } from "@/lib/deals/queries";
import type { DealKind } from "@/lib/deals/constants";

// Fixed lookup so user input never reaches a className expression.
const KIND_CLASS: Record<DealKind, string> = {
  BUY: "text-ok",
  SELL: "text-gold",
};

export function DealRoomPanel({ deals }: { deals: DealRow[] }) {
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
      <ul className="divide-y divide-text/10 text-sm">
        {deals.map((d) => (
          <li key={d.id} className="flex items-center gap-2 py-2">
            <span className={`font-mono text-[10px] uppercase tracking-wider ${KIND_CLASS[d.kind]}`}>
              {d.kind}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-text/40">{d.category}</span>
            <span className="flex-1 truncate text-text/80" title={d.subject}>{d.subject}</span>
            <span className="font-mono text-text">{formatCents(d.priceCents)}</span>
            <span className="text-[10px] text-text/40">{timeAgo(d.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/dashboard/DealRoomPanel.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/components/dashboard/DealRoomPanel.tsx test/components/dashboard/DealRoomPanel.test.tsx
git commit -m "feat(deals): DealRoomPanel dashboard summary (badge lookup, XSS-safe, empty state)"
```

---

### Task B3: `DealList` admin table

**Files:**
- Create: `src/components/deals/DealList.tsx`
- Test: `test/components/deals/DealList.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/deals/DealList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealList } from "@/components/deals/DealList";
import type { DealRow } from "@/lib/deals/queries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function deal(over: Partial<DealRow> = {}): DealRow {
  return {
    id: 1, kind: "SELL", category: "Diamond", subject: "Round 1.02ct",
    quantity: 1, priceCents: 1240000, currency: "USD",
    status: "Open", postedByLabel: "boss",
    createdAt: new Date(Date.now() - 60_000),
    ...over,
  };
}

beforeEach(() => {
  // skip the window.confirm guard so action tests fire
  vi.stubGlobal("confirm", () => true);
});

describe("DealList", () => {
  it("renders rows with subject as plain text (XSS-safe)", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <DealList deals={[deal({ subject: evil })]}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(evil);
  });

  it("Open deals show Withdraw and Mark Filled buttons", () => {
    render(
      <DealList deals={[deal()]}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    expect(screen.getByRole("button", { name: /withdraw deal 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark deal 1 filled/i })).toBeInTheDocument();
  });

  it("terminal (Filled/Withdrawn) deals do not show action buttons", () => {
    render(
      <DealList deals={[deal({ id: 2, status: "Filled" })]}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark.*filled/i })).not.toBeInTheDocument();
  });

  it("clicking Withdraw calls the action with the deal id", async () => {
    const withdrawAction = vi.fn(async () => ({ ok: true as const }));
    render(
      <DealList deals={[deal({ id: 42 })]}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={withdrawAction} />
    );
    fireEvent.click(screen.getByRole("button", { name: /withdraw deal 42/i }));
    await waitFor(() => expect(withdrawAction).toHaveBeenCalledWith(42));
  });

  it("surfaces an action error", async () => {
    const withdrawAction = vi.fn(async () => ({ ok: false as const, error: "Database error" }));
    render(
      <DealList deals={[deal({ id: 99 })]}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={withdrawAction} />
    );
    fireEvent.click(screen.getByRole("button", { name: /withdraw deal 99/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Database error");
  });

  it("renders an empty state when no deals", () => {
    render(
      <DealList deals={[]}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    expect(screen.getByText(/no deals/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/deals/DealList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/components/deals/DealList.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { formatCents, timeAgo } from "@/lib/company/format";
import type { DealRow } from "@/lib/deals/queries";
import type { DealKind, DealStatus } from "@/lib/deals/constants";
import type { ActionResult } from "@/lib/deals/actions";

const KIND_CLASS: Record<DealKind, string> = {
  BUY: "text-ok",
  SELL: "text-gold",
};

const STATUS_CLASS: Record<DealStatus, string> = {
  Open: "text-ok",
  Filled: "text-text/60",
  Withdrawn: "text-bad",
};

export function DealList({
  deals, markFilledAction, withdrawAction,
}: {
  deals: DealRow[];
  markFilledAction: (id: number) => Promise<ActionResult>;
  withdrawAction: (id: number) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function withdraw(id: number) {
    if (!window.confirm("Withdraw this deal?")) return;
    setError(null);
    setPendingId(id);
    const res = await withdrawAction(id);
    setPendingId(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  async function markFilled(id: number) {
    if (!window.confirm("Mark this deal as filled?")) return;
    setError(null);
    setPendingId(id);
    const res = await markFilledAction(id);
    setPendingId(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  if (deals.length === 0) {
    return (
      <div className="surface-card rounded-xl p-6 text-center text-sm text-text/40">
        No deals match these filters.
      </div>
    );
  }

  return (
    <div className="surface-card rounded-xl p-3">
      <FormStatus error={error} />
      <table role="table" className="w-full text-sm">
        <thead>
          <tr role="row" className="text-left text-[10px] uppercase tracking-wider text-text/40">
            <th role="columnheader" className="py-2">Kind</th>
            <th role="columnheader">Category</th>
            <th role="columnheader">Subject</th>
            <th role="columnheader" className="text-right">Qty</th>
            <th role="columnheader" className="text-right">Price</th>
            <th role="columnheader">Status</th>
            <th role="columnheader">Posted by</th>
            <th role="columnheader">Age</th>
            <th role="columnheader" className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-text/10">
          {deals.map((d) => (
            <tr role="row" key={d.id}>
              <td role="cell" className={`py-2 font-mono text-xs ${KIND_CLASS[d.kind]}`}>{d.kind}</td>
              <td role="cell" className="text-text/60">{d.category}</td>
              <td role="cell" className="text-text/85">{d.subject}</td>
              <td role="cell" className="text-right text-text/70">{d.quantity}</td>
              <td role="cell" className="text-right font-mono text-text">{formatCents(d.priceCents)}</td>
              <td role="cell" className={STATUS_CLASS[d.status]}>{d.status}</td>
              <td role="cell" className="text-text/60">{d.postedByLabel}</td>
              <td role="cell" className="text-text/40">{timeAgo(d.createdAt)}</td>
              <td role="cell" className="text-right">
                {d.status === "Open" && (
                  <span className="inline-flex gap-2">
                    <button
                      type="button"
                      onClick={() => markFilled(d.id)}
                      disabled={pendingId === d.id}
                      aria-label={`Mark deal ${d.id} filled`}
                      className="text-[11px] uppercase tracking-wider text-ok hover:underline disabled:opacity-50"
                    >
                      Mark Filled
                    </button>
                    <button
                      type="button"
                      onClick={() => withdraw(d.id)}
                      disabled={pendingId === d.id}
                      aria-label={`Withdraw deal ${d.id}`}
                      className="text-[11px] uppercase tracking-wider text-bad hover:underline disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/deals/DealList.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/components/deals/DealList.tsx test/components/deals/DealList.test.tsx
git commit -m "feat(deals): DealList admin table with Withdraw / Mark Filled actions"
```

---

### Task B4: `PostDealForm`

**Files:**
- Create: `src/components/deals/PostDealForm.tsx`
- Test: `test/components/deals/PostDealForm.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/deals/PostDealForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PostDealForm } from "@/components/deals/PostDealForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PostDealForm", () => {
  it("submits trimmed + cents-converted payload to the action", async () => {
    const postAction = vi.fn(async () => ({ ok: true as const }));
    render(<PostDealForm postAction={postAction} />);
    fireEvent.change(screen.getByLabelText("kind"), { target: { value: "BUY" } });
    fireEvent.change(screen.getByLabelText("category"), { target: { value: "Metal" } });
    fireEvent.change(screen.getByLabelText("subject"), { target: { value: "  18k chain lot  " } });
    fireEvent.change(screen.getByLabelText("quantity"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "8750" } });
    fireEvent.click(screen.getByRole("button", { name: /post deal/i }));

    await waitFor(() => expect(postAction).toHaveBeenCalledTimes(1));
    expect(postAction.mock.calls[0][0]).toMatchObject({
      kind: "BUY",
      category: "Metal",
      subject: "18k chain lot",
      quantity: 5,
      priceCents: 875000,
    });
  });

  it("surfaces an action error", async () => {
    const postAction = vi.fn(async () => ({
      ok: false as const, error: "Demo mode — changes are disabled",
    }));
    render(<PostDealForm postAction={postAction} />);
    fireEvent.change(screen.getByLabelText("subject"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /post deal/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/demo mode/i);
  });

  it("clears the form on success", async () => {
    const postAction = vi.fn(async () => ({ ok: true as const }));
    render(<PostDealForm postAction={postAction} />);
    const subject = screen.getByLabelText("subject") as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "Emerald" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /post deal/i }));
    await waitFor(() => expect(subject.value).toBe(""));
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/deals/PostDealForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/components/deals/PostDealForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { DEAL_KINDS, DEAL_CATEGORIES, type DealKind, type DealCategory } from "@/lib/deals/constants";
import type { ActionResult } from "@/lib/deals/actions";

export function PostDealForm({
  postAction,
}: {
  postAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<DealKind>("SELL");
  const [category, setCategory] = useState<DealCategory>("Diamond");
  const [subject, setSubject] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priceDollars, setPriceDollars] = useState("");
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
    };
    const res = await postAction(raw);
    setPending(false);
    if (res.ok) {
      setOk(true);
      setSubject("");
      setQuantity("1");
      setPriceDollars("");
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

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/deals/PostDealForm.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/components/deals/PostDealForm.tsx test/components/deals/PostDealForm.test.tsx
git commit -m "feat(deals): PostDealForm (trimmed subject, cents conversion, FormStatus)"
```

---

### Task B5: `DemoNotice`

**Files:**
- Create: `src/components/deals/DemoNotice.tsx`
- Test: `test/components/deals/DemoNotice.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/deals/DemoNotice.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoNotice } from "@/components/deals/DemoNotice";

describe("DemoNotice", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders nothing when not in demo mode", () => {
    const { container } = render(<DemoNotice />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the disabled-changes banner in demo mode", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    render(<DemoNotice />);
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    expect(screen.getByText(/changes are disabled/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/components/deals/DemoNotice.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/components/deals/DemoNotice.tsx`:

```tsx
import { isDemoMode } from "@/lib/demo/mode";

export function DemoNotice() {
  if (!isDemoMode()) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg bg-gold/10 px-3 py-2 text-[11px] uppercase tracking-widest text-gold">
      <span className="h-1.5 w-1.5 rounded-full bg-gold" />
      Demo mode · changes are disabled
    </div>
  );
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/components/deals/DemoNotice.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/components/deals/DemoNotice.tsx test/components/deals/DemoNotice.test.tsx
git commit -m "feat(deals): DemoNotice banner for /deals admin page"
```

---

### Task B6: `/deals` admin page

**Files:**
- Create: `src/app/(admin)/deals/page.tsx`

- [ ] **Step 1: Implement.** Create `src/app/(admin)/deals/page.tsx`:

```tsx
import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { AIYA_ORG_ID } from "@/db/org";
import { getAllDeals, type DealFilters } from "@/lib/deals/queries";
import { DEAL_KINDS, DEAL_CATEGORIES, DEAL_STATUSES, type DealKind, type DealCategory, type DealStatus } from "@/lib/deals/constants";
import { DealList } from "@/components/deals/DealList";
import { PostDealForm } from "@/components/deals/PostDealForm";
import { DemoNotice } from "@/components/deals/DemoNotice";
import { postDeal, markDealFilled, withdrawDeal } from "@/lib/deals/actions";

export const dynamic = "force-dynamic";

function pickFilter<T extends readonly string[]>(
  raw: string | string[] | undefined,
  allowed: T,
): T[number] | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

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
  const rows = await getAllDeals(db, AIYA_ORG_ID, filters);

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

      <PostDealForm postAction={postDeal} />

      <DealList deals={rows} markFilledAction={markDealFilled} withdrawAction={withdrawDeal} />
    </main>
  );
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 transition-colors ${
        active
          ? "border-gold/40 bg-gold/10 text-gold"
          : "border-border text-text/60 hover:border-gold/40 hover:text-gold"
      }`}
    >
      {label}
    </Link>
  );
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add "src/app/(admin)/deals/page.tsx"
git commit -m "feat(deals): /deals admin page (filter chips + post form + list)"
```

---

### Task B7: Registry update (replace `tradenet-exchange` render)

**Files:**
- Modify: `src/lib/layout/types.ts`
- Modify: `src/lib/layout/registry.tsx`
- Test: `test/lib/layout/registry.test.ts`

- [ ] **Step 1: Failing registry test.** Append to `test/lib/layout/registry.test.ts` (after the existing tests, inside the existing `describe`):

```ts
  it("the tradenet-exchange entry is retitled 'Deal Room' (id preserved)", () => {
    const entry = PANEL_REGISTRY.find((p) => p.id === "tradenet-exchange");
    expect(entry).toBeDefined();
    expect(entry!.title).toBe("Deal Room");
  });
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/layout/registry.test.ts`
Expected: FAIL — title still "TradeNet Exchange".

- [ ] **Step 3: Extend `PanelCtx` with `deals`.** In `src/lib/layout/types.ts`, add the import + interface + extend `PanelCtx`. Replace the file with:

```ts
import type { ReactNode } from "react";
import type { DiamondKpis } from "@/components/market/KpiTicker";
import type { DiamondRow } from "@/components/market/MarketIntelligencePanel";
import type { InventoryCategory } from "@/lib/inventory/validation";
import type { DealRow } from "@/lib/deals/queries";

export type PanelSize = 1 | 2 | 4;

export interface LayoutItem {
  id: string;
  size: PanelSize;
  hidden: boolean;
}

/** Server-read views the page passes down — defined here (not in DashboardGrid)
 *  so the layout types don't depend on the grid that consumes them. */
export interface InventoryView {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedLabel: string | null;
}

export interface DiamondView {
  kpis: DiamondKpis;
  rows: DiamondRow[];
}

export interface DealView {
  deals: DealRow[];
}

/** Server-read context the page passes into each panel's render. */
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
}

export interface PanelEntry {
  id: string;
  title: string;
  defaultSize: PanelSize;
  render: (ctx: PanelCtx) => ReactNode;
}
```

- [ ] **Step 4: Update the registry entry.** In `src/lib/layout/registry.tsx`:
  - Add the import line near the top (after the other component imports):

```tsx
import { DealRoomPanel } from "@/components/dashboard/DealRoomPanel";
```

  - Replace the existing `tradenet-exchange` entry (lines `{ id: "tradenet-exchange", title: "TradeNet Exchange", … }`) with:

```tsx
  {
    id: "tradenet-exchange",
    title: "Deal Room",
    defaultSize: 1,
    render: (ctx) =>
      ctx.deals
        ? <DealRoomPanel deals={ctx.deals.deals} />
        : <BusinessPlaceholder title="Deal Room" testid="panel-tradenet-exchange" />,
  },
```

  (Keep the id `"tradenet-exchange"` — that's what makes persisted user layouts transparently upgrade. Keep the `testid="panel-tradenet-exchange"` on the placeholder for the same reason: existing `Dashboard.test.tsx` references it for the unwired fallback path.)

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/lib/layout/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/layout/types.ts src/lib/layout/registry.tsx test/lib/layout/registry.test.ts
git commit -m "feat(layout): retitle tradenet-exchange to 'Deal Room' + render DealRoomPanel when deals ctx present"
```

---

### Task B8: Wire `page.tsx` + `DashboardGrid` + middleware + Nav

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/DashboardGrid.tsx`
- Modify: `src/middleware.ts`
- Modify: `src/components/dashboard/Nav.tsx`
- Test: `test/middleware.test.ts`
- Test: `test/components/dashboard/Nav.test.tsx`
- Test: `test/components/dashboard/Dashboard.test.tsx`

- [ ] **Step 1: Failing middleware test.** In `test/middleware.test.ts`, add inside the existing `describe`:

```ts
  it("guards /deals (slice-2)", () => {
    expect(isMatched("/deals")).toBe(true);
  });
```

- [ ] **Step 2: Failing nav test.** In `test/components/dashboard/Nav.test.tsx`, add inside the existing `describe`:

```ts
  it("links Orders & Deals to /deals", () => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Orders & Deals" });
    expect(link).toHaveAttribute("href", "/deals");
  });
```

- [ ] **Step 3: Failing dashboard test.** In `test/components/dashboard/Dashboard.test.tsx`, modify the existing "renders the live panels and honest business placeholders" test:
  - Remove `"panel-tradenet-exchange"` from the placeholder-id loop (the registry now renders `DealRoomPanel` when `deals` is supplied).
  - Add a `deals` prop to the existing render call:

```tsx
    const deals = {
      deals: [{
        id: 1, kind: "SELL" as const, category: "Diamond" as const,
        subject: "Round 1.02ct G/VS1", quantity: 1, priceCents: 1240000,
        currency: "USD", status: "Open" as const, postedByLabel: "boss",
        createdAt: new Date(Date.now() - 3_600_000),
      }],
    };
    render(<DashboardGrid inventory={inventory} diamond={diamond} deals={deals} />);
```

  - After the existing assertions, add:

```tsx
    // Deal Room panel is now REAL (replaced the tradenet-exchange placeholder)
    expect(screen.getByText("Deal Room")).toBeInTheDocument();
    expect(screen.getByText("Round 1.02ct G/VS1")).toBeInTheDocument();
```

  - In the placeholder-id loop, the array becomes (without `panel-tradenet-exchange`):

```tsx
    for (const id of [
      "panel-orders-pipeline", "panel-portfolio-snapshot", "panel-financial-overview",
      "panel-crypto-wallet", "panel-ai-insights",
      "panel-todays-schedule", "panel-social-inbox",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
```

- [ ] **Step 4: Run to verify FAIL.** Run: `npx vitest run test/middleware.test.ts test/components/dashboard/Nav.test.tsx test/components/dashboard/Dashboard.test.tsx`
Expected: FAIL — `/deals` not in matcher, Nav has no `Orders & Deals` route, `DashboardGrid` doesn't accept `deals`.

- [ ] **Step 5: Update middleware.** In `src/middleware.ts`, change the matcher array to:

```ts
  matcher: [
    "/", "/api/quotes", "/api/convert", "/api/history", "/api/diamond-history",
    "/inventory", "/diamonds", "/deals", "/company/:path*",
  ],
```

- [ ] **Step 6: Update Nav.** In `src/components/dashboard/Nav.tsx`, replace the `ROUTES` constant with:

```ts
const ROUTES: Record<string, string> = {
  Inventory: "/inventory",
  Diamonds: "/diamonds",
  "Orders & Deals": "/deals",
};
```

- [ ] **Step 7: Update `DashboardGrid` to accept and forward `deals`.** In `src/app/DashboardGrid.tsx`:
  - Update the type import line:

```tsx
import type { PanelSize, InventoryView, DiamondView, DealView } from "@/lib/layout/types";
```

  - Update the re-export line:

```tsx
export type { InventoryView, DiamondView, DealView } from "@/lib/layout/types";
```

  - Update the component signature + `ctx` memo:

```tsx
export function DashboardGrid({
  inventory, diamond, deals,
}: {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
}) {
  const editMode = useSettings((s) => s.editMode);
  const persisted = useSettings((s) => s.dashboardLayout);
  const reorderLayout = useSettings((s) => s.reorderLayout);
  const setPanelSize = useSettings((s) => s.setPanelSize);
  const togglePanelHidden = useSettings((s) => s.togglePanelHidden);

  const layout = useMemo(() => getEffectiveLayout(persisted), [persisted]);
  const visible = useMemo(() => layout.filter((i) => !i.hidden), [layout]);
  const ctx = useMemo(() => ({ inventory, diamond, deals }), [inventory, diamond, deals]);
```

  (Everything else in the file stays exactly the same — sensors, onDragEnd, the grid JSX, the conditional DndContext wrap.)

- [ ] **Step 8: Wire `page.tsx`.** Replace the body of `src/app/page.tsx` with:

```tsx
import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { ensureDbReady } from "@/db/client";
import { AIYA_ORG_ID } from "@/db/org";
import { getInventorySummary } from "@/db/inventory";
import { getDiamondSummary } from "@/db/diamonds";
import { getActiveDeals } from "@/lib/deals/queries";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await ensureDbReady();
  const [invSummary, dia, activeDeals] = await Promise.all([
    getInventorySummary(db),
    getDiamondSummary(db),
    getActiveDeals(db, AIYA_ORG_ID, 5),
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
  const deals = { deals: activeDeals };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} deals={deals} />
      </Shell>
    </QuotesProvider>
  );
}
```

- [ ] **Step 9: Run to verify PASS.** Run: `npx vitest run test/middleware.test.ts test/components/dashboard/Nav.test.tsx test/components/dashboard/Dashboard.test.tsx`
Expected: PASS (all three suites green).

- [ ] **Step 10: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 11: Commit.**
```bash
git add src/app/page.tsx src/app/DashboardGrid.tsx src/middleware.ts src/components/dashboard/Nav.tsx \
  test/middleware.test.ts test/components/dashboard/Nav.test.tsx test/components/dashboard/Dashboard.test.tsx
git commit -m "feat(deals): wire activeDeals through page → grid → registry; gate /deals; link Orders & Deals nav"
```

---

## Phase C — Verification + ship

### Task C1: Full suite + tsc + build + dev smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite.** Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-deal-room-slice-2" && npm test -- --run`
Expected: all green (existing + ~50 new tests across deals validation, queries, actions, format, seed, panel, list, form, notice, registry, middleware, nav, dashboard). If a single pglite file flakes under load, re-run that file alone to confirm it isn't a regression.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Build.** Run: `rm -rf .next && npm run build`
Expected: success; the routes manifest lists `/deals` (under the `(admin)` group).

- [ ] **Step 4: Manual dev smoke (auth path).** Run: `npm run dev`, log in, then:
  - Navigate to `/deals` — header reads "Deal Room", post form + filter chips + empty list visible.
  - Post a SELL Diamond: subject "Round 1.02ct G/VS1", qty 1, price 12400 — confirm row appears in the list, status Open, posted_by shows your session user.
  - Click filter chips: `?status=Open` shows the row; `?status=Filled` shows the empty-state.
  - Return to `/` — Deal Room panel (in the slot previously labeled "TradeNet Exchange") shows the row with SELL badge, $12,400, "just now".
  - Back at `/deals`, click "Mark Filled" on the row — confirm prompt, then row flips to Filled, action buttons disappear.
  - Post a second deal and click "Withdraw" — confirm prompt, status flips to Withdrawn.
  - Verify the `Orders & Deals` sidebar entry links to `/deals`.

- [ ] **Step 5: Manual demo smoke.** Run: `NEXT_PUBLIC_DEMO_MODE=true npm run dev` (no login):
  - `/deals` loads, DemoNotice banner visible, 5 seeded deals render (4 Open + 1 Filled), each subject ends with "— demo · simulated".
  - Click "Post deal" with any input — surfaces "Demo mode — changes are disabled" via `FormStatus`.
  - Click "Withdraw" on any Open row — surfaces the same disabled error.
  - `/` Deal Room panel shows the 4 open seeded deals (excluding the Filled one), all carrying the simulated provenance suffix.

- [ ] **Step 6: Commit any smoke fixes** (skip if none).

---

### Task C2: Whole-slice review + merge + cleanup

**Files:** none (process)

- [ ] **Step 1: Whole-slice code review.** Spawn a code-review subagent with this prompt (paste it verbatim):

> Review every change on branch `feature/aiya-deal-room-slice-2` against `main` for the AIYA Deal Room slice (slice 2). Spec: `docs/superpowers/specs/2026-05-28-aiya-deal-room-slice-2-design.md`. Implementation plan: `docs/superpowers/plans/2026-05-28-aiya-deal-room-slice-2.md`. Look specifically for: (a) demo-mode write guards are present on all three actions and run BEFORE `requireSession()`; (b) every query/mutation includes `eq(deals.orgId, AIYA_ORG_ID)`; (c) no raw-HTML insertion APIs are used anywhere in the deals UI (subject must render as JSX text); (d) kind/status CSS classes come from a finite lookup object, never from interpolated user input; (e) `postedByLabel` is sourced from `requireSession().user`, not from form input; (f) `updateDealStatusInput` rejects "Open"; (g) the `tradenet-exchange` registry id is preserved while title/render change; (h) no test uses `createTestDb()` in `beforeEach` (must use the `getSharedDb`/`resetSharedDb` pattern); (i) no `// TODO` or placeholder code; (j) every action calls `revalidatePath("/")` and `revalidatePath("/deals")` on success. Report findings, no fixes.

- [ ] **Step 2: Apply review fixes** (if any). For each finding, fix + add a failing-first test + commit with a `fix(deals): …` message.

- [ ] **Step 3: Push the branch.**
```bash
git push -u origin feature/aiya-deal-room-slice-2
```

- [ ] **Step 4: Merge to main.** From the worktree:
```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git checkout main
git merge --no-ff feature/aiya-deal-room-slice-2 -m "merge: AIYA Deal Room slice 2"
git push origin main
```

- [ ] **Step 5: Cleanup.**
```bash
git worktree remove "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-deal-room-slice-2"
git branch -d feature/aiya-deal-room-slice-2
git push origin --delete feature/aiya-deal-room-slice-2
```

- [ ] **Step 6: Confirm done.** Run from main: `npm test -- --run && npx tsc --noEmit`
Expected: green + clean.

---

## Done criteria

- All new tests green; full suite green; `tsc --noEmit` clean; build succeeds.
- `deals` table is org-scoped; three composite indexes present; integer cents enforced.
- `postDeal` / `markDealFilled` / `withdrawDeal` all gate on demo + session, validate via Zod, scope to `AIYA_ORG_ID`, log `[deals] …` provenance, and revalidate `/` + `/deals`.
- Dashboard panel "Deal Room" replaces the `tradenet-exchange` placeholder while preserving the registry id (persisted user layouts upgrade transparently).
- `/deals` admin page renders with filter chips, post form, list, and `DemoNotice`; demo mode shows 5 seeded deals with "demo · simulated" provenance; writes return the disabled error.
- Sidebar "Orders & Deals" entry links to `/deals`; middleware matcher includes `/deals`.
- Next: Slice 2c — Circles (multi-org membership) or another priority slice per the roadmap.
