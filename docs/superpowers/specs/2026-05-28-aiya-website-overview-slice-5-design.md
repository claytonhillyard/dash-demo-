# AIYA Dashboard — Slice 5: Website Overview — Design

**Date:** 2026-05-28
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market), #1a (AIYA dashboard + reskin), #2 (company data), #1b-1 (inventory), #1b-3 (diamond price lists), #1c (customizable layout), demo (Netlify simulation mode), slice 2 (Deal Room), slice 2 hardening passes (keyboard reorder test, build-time fetch resilience, HTTP security headers), slice 3 (Multi-Tenant Foundation: real `orgs` table, `getCurrentOrgId()` async seam, JWT `{user, orgId}`, cross-org isolation tests), and slice 4 (Circles: `circles` + `circle_members` + `deals.visibility_circle_id`, widened deals reads, partial index, demo seed with AIYA Trusted Partners + 3 partner orgs) — all shipped on `main`.

---

## 1. Overview & Goals

Light up mockup 3 — "Website Overview" — as an honest, owner-entered weekly snapshot of marketing-site KPIs. The current dashboard places marketing-site visibility on the same footing as Plausible / PostHog / GA4 dashboards would, but **slice 5 ships no analytics integration**. Instead, an owner manually records a weekly row (visitors, unique visitors, page views, average session, bounce rate) through a `/website` admin route — exactly the same shape as `/inventory` and `/diamonds` — and the dashboard panel renders those rows with week-over-week deltas and a sparkline. Every snapshot is `org_id`-scoped from day one (slice-3 invariant carried verbatim), with no cross-org visibility ever (snapshots are strictly private to each org).

This is the lighter sibling to slice 4's TradeNet Exchange: where slice 4 widened read visibility across organizations through Circles, slice 5 deliberately does **not** widen anything. Website KPIs are per-org by nature — there is no "shared analytics circle" — and the spec calls that boundary out explicitly so a future hardening review doesn't get tempted to retrofit visibility semantics here.

**Goals:**

- New `website_snapshots` table (id, orgId → `orgs.id`, weekStart DATE, visitors, uniqueVisitors, pageViews, avgSessionDurationSeconds, bounceRatePercent, createdAt, updatedAt). Unique constraint on `(orgId, weekStart)` so an owner can only have one row per week per org. Index on `(orgId, weekStart DESC)` for the latest-week query hot path.
- Server actions `createWebsiteSnapshot`, `updateWebsiteSnapshot`, `deleteWebsiteSnapshot` — all through the existing `run()` wrapper that resolves session, validates with Zod, threads `orgId` from session (never wire), and revalidates. Same shape as `src/lib/inventory/actions.ts`.
- Read functions `getWebsiteSnapshots(db, orgId)`, `getLatestWebsiteSnapshot(db, orgId)`, `getWebsiteSnapshotTrend(db, orgId, n=8)` — each takes an explicit `orgId` with **no default value** (slice-3 invariant).
- New dashboard panel `website-overview` in the layout registry. Renders three states: no data, single-snapshot, multi-snapshot. KPI tiles + sparkline + provenance label.
- `/website` admin route with the standard form + table shape from `/inventory`. Sidebar nav extended with a "Website" link in the same admin group.
- Demo seed: 8 weekly snapshots for AIYA with realistic week-over-week growth, plus 2-3 for one partner org (Mehta Diamonds — id 501) so the multi-tenant story is visible end-to-end. Demo writes blocked by the existing `run()` demo guard; demo reads short-circuit in the three read functions, same pattern slice 4 added to circle queries.
- Cross-org isolation tests for `website_snapshots` (insert under org 999, query from org 1, assert zero rows). Action tenancy tests that prove `updateWebsiteSnapshot(id_in_org_999)` from an `orgId=1` session affects zero rows.

**Non-Goals for Slice 5** (each has a named home — see §11):

Real analytics provider integration (Plausible / PostHog / GA4 / Vercel Analytics), funnel / conversion / per-page analytics, A/B testing infrastructure, per-day or per-hour granularity, cross-org snapshot visibility (Circles-style sharing — explicitly **not planned** for this domain), anomaly alerts / notifications, newsletter/email KPIs, custom per-org KPI definitions, e-commerce conversion tracking, cross-org benchmarking, DB-level CHECK constraints for numeric ranges (future hardening — Zod enforces today), audit log of admin edits, mobile-specific layouts beyond slice 1c's responsive shell, and a charting library bigger than the existing `Sparkline` reuse.

---

## 2. Data Model

### 2.1 New table: `website_snapshots`

```typescript
// src/db/schema.ts (append below `deals`)
export const websiteSnapshots = pgTable(
  "website_snapshots",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull().default(1).references(() => orgs.id),
    weekStart: date("week_start").notNull(),
    visitors: integer("visitors").notNull(),
    uniqueVisitors: integer("unique_visitors").notNull(),
    pageViews: integer("page_views").notNull(),
    avgSessionDurationSeconds: integer("avg_session_duration_seconds").notNull(),
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

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `org_id` | integer NOT NULL default 1 → `orgs.id` | Tenancy. Same pattern slice 3 established on every business table. The `default(1)` matches inventory/deals — AIYA's seeded id. |
| `week_start` | date NOT NULL | First day of the calendar week the snapshot represents. Stored as a `DATE` (no time component) to keep "what week was this?" semantically clean. See §2.3 on the Monday-vs-any-day discussion. |
| `visitors` | integer NOT NULL | Total visits during the week. Range guard: `≥ 0` (Zod). |
| `unique_visitors` | integer NOT NULL | Distinct visitors during the week. Range guard: `≥ 0` (Zod). Should be `≤ visitors` in practice but **not enforced at the schema or Zod level** — see §6 for rationale. |
| `page_views` | integer NOT NULL | Total page views during the week. Range guard: `≥ 0` (Zod). |
| `avg_session_duration_seconds` | integer NOT NULL | Average session length in **seconds**. UI formats to `m:ss` or `h:mm:ss`. Range guard: `≥ 0` (Zod). |
| `bounce_rate_percent` | integer NOT NULL | Bounce rate as a whole percent. Range guard: `0..100` inclusive (Zod). |
| `created_at` | timestamptz default now NOT NULL | |
| `updated_at` | timestamptz default now NOT NULL | The admin action stamps `new Date()` on update, same pattern as inventory. |

**Unique constraint `(org_id, week_start)`** — one row per org per week is the entire content of the domain invariant. The unique constraint is the single source of truth for "no duplicate weeks"; the action layer does NOT pre-check existence and then insert (which would race). Instead, `createWebsiteSnapshot` uses `ON CONFLICT (org_id, week_start) DO NOTHING` and inspects the returned row count — see §3.

**Index `(org_id, week_start DESC)`** — the dashboard panel reads `getLatestWebsiteSnapshot` and `getWebsiteSnapshotTrend(8)` on every page render. Both queries look like `WHERE org_id = $1 ORDER BY week_start DESC LIMIT N`. The composite index is the exact match for that access pattern. Postgres can serve the LIMIT-1 latest-snapshot query directly from the index without a heap scan.

**Why integer cents weren't used for any KPI** — none of the columns represent money. Counters are integers. Bounce rate is a whole percent 0-100 (matches what every analytics provider surfaces in UI without forcing decimal-percent precision the owner can't realistically measure). Average session is integer seconds (see §2.4).

### 2.2 No FK from a snapshot to anything else

The table is a pure tenant-scoped time series — no `inventory_item_id`, no `deal_id`, no `circle_id`. Slice-4's `visibility_circle_id` is **explicitly absent**; see §11 "Out of Scope". A future slice that adds cross-org benchmarking will need to design its own visibility semantics (likely opt-in aggregate sharing, not row-level visibility).

### 2.3 `week_start` — Monday or any date?

**Design pick: any date the owner enters, validated as a valid `Date`.** Reasoning:

- The owner is the source of truth. If they record snapshots Sunday-to-Saturday (US conventions) vs Monday-to-Sunday (ISO), forcing Monday in code introduces a constant friction the owner has to mentally convert from whatever their analytics dashboard shows.
- Validating "must be a Monday" at the Zod layer would force locale-specific date math on the wire format (the Zod schema doesn't know the owner's tz, especially in demo). Less code, fewer surprises, ship it.
- The unique constraint `(org_id, week_start)` enforces "one per week" by treating *whatever date the owner picks* as the canonical week marker. As long as the owner is internally consistent (always pick Mondays, or always pick Sundays), the constraint does its job.
- The admin form's date picker defaults to "last Monday" as a UX hint (`new Date().getDay() === 1 ? today : last_monday`), but the server doesn't validate the choice.

Tracked as a known minor risk: if the owner records the same calendar week under two different dates (e.g. Monday this week and Friday last week, where "Friday last week" was technically Q1 of the current week per their mental model), the constraint won't catch the duplicate. Acceptable for an owner-entered ledger; the deduplication problem is the owner's, not the system's.

### 2.4 `avgSessionDurationSeconds` — integer seconds, not a time/interval type

| Choice | Why |
|---|---|
| `integer` seconds | Trivial sort + delta arithmetic; reuses the project's "integer-only for measurable quantities" convention from inventory (`weight_mg`) and diamonds (`carat_x100`). UI formats client-side to `m:ss` / `h:mm:ss`. Tests are simple integer assertions. |
| `interval` PG type | More semantically correct but harder to compare and serialize JSON-safely through Drizzle's type layer. Owner KPIs don't need sub-second precision; the format helper covers the display gap. |
| `text` "m:ss" | The wire format becomes a parse hazard the moment the owner types `3:5` (3 minutes 5 seconds? 3:50?). Pre-formatted strings are not a data store. Rejected. |

The display helper lives at `src/lib/website/format.ts` (new file — §3.5).

### 2.5 Migration (`drizzle/0006_*.sql`)

Generated via `npm run db:generate` after the schema edit. Expected contents in order:

1. `CREATE TABLE website_snapshots ( … )` with the eight columns described above.
2. `ALTER TABLE website_snapshots ADD CONSTRAINT website_snapshots_org_id_fk FOREIGN KEY (org_id) REFERENCES orgs(id);` — emitted by Drizzle from the `.references()` call.
3. `CREATE UNIQUE INDEX website_snapshots_org_week_uniq ON website_snapshots (org_id, week_start);`
4. `CREATE INDEX website_snapshots_org_week_idx ON website_snapshots (org_id, week_start DESC);`

**No hand-appended seed.** Unlike slice 3 (`orgs` table needed an inline AIYA seed for FK validity) and unlike slice 4 (schema-only with the demo seed living in `src/lib/demo/seed.ts`), slice 5's migration is purely schema. AIYA already exists at `orgs.id=1` from slice 3; the new table starts empty in prod. The demo seed lives in `src/lib/demo/seed.ts` (see §9) and never touches the prod migration.

The implementation plan should add a top-of-file SQL comment reading `-- schema-only; no seed data in this migration` so a future executor doesn't accidentally infer "missing seed step" — same defensive comment slice 4 used.

**Rollback:** `DROP TABLE website_snapshots;` — safe; the table has no inbound FKs from anywhere else, so it drops cleanly without `CASCADE`.

### 2.6 Range guards: Zod today, DB CHECK later

The Zod input schemas enforce `visitors ≥ 0`, `uniqueVisitors ≥ 0`, `pageViews ≥ 0`, `avgSessionDurationSeconds ≥ 0`, `bounceRatePercent ∈ [0, 100]`. DB-level `CHECK` constraints could enforce the same invariants at the storage layer (defense in depth), but they're explicitly deferred to a future hardening pass (§11) for two reasons:

- The actions layer is the only insert/update path. There's no `INSERT INTO website_snapshots` from raw SQL anywhere in the codebase, today or planned.
- PGlite (the test/dev driver) has historically had edge cases with `CHECK` constraints around boolean expressions; documenting the deferral lets the future executor confirm support cleanly before adding the constraint to a migration.

A code comment in the schema next to each numeric column reads: `// range enforced at the Zod layer; DB-level CHECK is deferred (see slice 5 spec §2.6)`. The implementation plan's PR review checklist (§8.8) includes a grep to confirm no DB writes bypass the action layer.

---

## 3. Server Layer — Actions

### 3.1 Zod input schemas — `src/lib/website/validation.ts` (new)

```typescript
import { z } from "zod";

const nonNegInt = z.number().int().min(0);

export const websiteSnapshotInput = z.object({
  // YYYY-MM-DD wire format from the date picker. Parsed by the DB layer.
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

export { firstZodError } from "@/lib/company/validation";
```

**Critical invariant (slice-3 / slice-4 carry-over):** the schemas accept **no `orgId` field**. The action wrapper stamps `orgId` from the session. The PR review grep `grep -rn "orgId" src/lib/website/validation.ts` must return zero matches.

The update schema is the same shape plus a positive integer `id`. The shared `firstZodError` flattener re-exports from the company slice to keep error messages consistent across admin forms.

### 3.2 `createWebsiteSnapshot` — `src/lib/website/actions.ts` (new)

```typescript
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
  type WebsiteSnapshotUpdateInput,
} from "./validation";

export type ActionResult =
  | { ok: true }
  | { ok: true; duplicate: true }   // (orgId, weekStart) already exists
  | { ok: false; error: string };

// Test seam — mirrors src/lib/inventory/actions.ts
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

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
      .onConflictDoNothing({ target: [websiteSnapshots.orgId, websiteSnapshots.weekStart] })
      .returning({ id: websiteSnapshots.id });
    if (inserted.length === 0) {
      // Row already exists for (orgId, weekStart). Not an error from the
      // caller's perspective — they get a clear signal so the UI can suggest
      // "edit the existing row" instead of silently no-op'ing.
      return { ok: true, duplicate: true };
    }
    return { ok: true };
  });
}
```

**Why the slightly-wider `ActionResult`?** Slice 5 introduces a single new shape (`{ ok: true; duplicate: true }`) so the UI can distinguish "your row landed" from "we silently no-op'd because a row already exists for that week". The alternative — throwing or returning `{ ok: false, error: "duplicate" }` — would conflate a data conflict with a system failure. The discriminant is cheap; the call site uses `'duplicate' in res` to branch.

Existing action callers (inventory, diamonds, deals) keep their narrower `{ ok: true } | { ok: false, error }` shape unchanged; this is a per-domain widening only.

**`onConflictDoNothing` over a pre-check + insert** — race-free. Two clicks on the form in rapid succession can't end up with two rows because the unique constraint is the gate, not a `SELECT count(*) FROM …` ahead of time.

### 3.3 `updateWebsiteSnapshot` — same file

```typescript
export async function updateWebsiteSnapshot(raw: unknown): Promise<ActionResult> {
  return run(websiteSnapshotUpdateInput, raw, async (input, orgId) => {
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
```

**Critical:** the WHERE clause is `id AND orgId`. Never id alone. Slice-3 invariant. The test in §7.3 proves an update from session-org-1 against a row in org-999 affects zero rows.

A subtle race: if the owner edits a row's `weekStart` to a date that collides with another row for the same org, the unique constraint will throw. The `run()` catch maps it to `{ ok: false, error: "Database error" }`. Acceptable — the form should hint "this week already has a snapshot" via the duplicate detection on create. A future enhancement could pre-check on edit too; deferred.

### 3.4 `deleteWebsiteSnapshot` — same file

```typescript
export async function deleteWebsiteSnapshot(id: number): Promise<ActionResult> {
  return run(z.number().int().positive(), id, async (rid, orgId) => {
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

Identical shape to `deleteInventoryItem`. Tenancy enforced via `id AND orgId` in the WHERE clause.

### 3.5 Format helper — `src/lib/website/format.ts` (new)

```typescript
/** Integer seconds to "m:ss" (or "h:mm:ss" for ≥ 1h). */
export function formatSessionDuration(totalSeconds: number): string {
  if (totalSeconds < 0 || !Number.isFinite(totalSeconds)) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Week-over-week percentage delta with consistent rounding and sign. */
export function weekOverWeekDelta(
  current: number,
  previous: number | null | undefined,
): { sign: "up" | "down" | "flat"; percent: number } | null {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) {
    if (current === 0) return { sign: "flat", percent: 0 };
    return { sign: "up", percent: 100 }; // honest stand-in; UI also shows "n/a" optionally
  }
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change * 10) / 10; // one decimal
  if (rounded === 0) return { sign: "flat", percent: 0 };
  return { sign: rounded > 0 ? "up" : "down", percent: Math.abs(rounded) };
}
```

**`previous === 0` handling** — explicit branch returning a "100%" up signal (or flat if both are zero). The UI may choose to render this as "—" if the panel author considers "infinite growth from zero" misleading. Documented as a design choice the panel can override.

---

## 4. Server Layer — Reads

All three reads live in `src/db/website.ts` (new), mirroring `src/db/inventory.ts` (data access lives under `src/db/`, validation + actions live under `src/lib/website/`). Each takes an explicit `orgId` parameter with no default value (slice-3 invariant), and each demo-mode short-circuits to seed data the same way `getInventorySummary` and `getDiamondSummary` do.

```typescript
// src/db/website.ts
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
  weekStart: string;        // YYYY-MM-DD wire format
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

/** All snapshots for an org, most-recent week first. */
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

/** Single most-recent snapshot; null if no rows. */
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

/** Last N snapshots, most-recent week first. */
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

**Why three separate reads (not one big bundle)** — each call site wants something slightly different. The dashboard panel needs the latest + the trend; the admin route needs the full list. Forcing every caller to take the full list and slice client-side would over-fetch on the dashboard (the trend cap is 8, the admin list could grow indefinitely). Three thin reads, each indexed-driven, is the right shape.

**Deltas computed by the caller, not the DB.** The panel uses `getWebsiteSnapshotTrend(db, orgId, 8)` and computes week-over-week deltas in JS via `weekOverWeekDelta(curr, prev)`. A `getWebsiteSnapshotDelta` server helper was considered but rejected: it would duplicate the math that the format helper already owns, force two queries (latest + previous) when one trend-of-8 fetch already covers it, and adds an extra demo seam. The panel's render is one pass over the array; deltas fall out for free.

**Demo seam.** Same pattern as `getInventorySummary` and `getDiamondSummary`: `if (isDemoMode()) return seed(orgId)` at the top of each function. The seed helpers (§9) handle the per-org filtering so the demo accurately mirrors the per-org isolation of the real query.

---

## 5. UI — Dashboard Panel

### 5.1 `<WebsiteOverviewPanel>` — `src/components/dashboard/WebsiteOverviewPanel.tsx` (new)

Receives serializable props from the RSC page:

```typescript
export interface WebsiteOverviewView {
  latest: WebsiteSnapshotRow | null;
  previous: WebsiteSnapshotRow | null;        // for delta arrows; null when only 1 row
  trend: { weekStart: string; visitors: number }[];  // newest-first; max 8
  updatedLabel: string | null;                 // "updated 2d ago" — from latest.updatedAt
}
```

Three render states:

1. **No data** (`latest === null`)

   ```tsx
   <Panel title="Website Overview" state="ready">
     <div className="py-6 text-center text-sm text-text/40">
       No website snapshots yet — record your first week in the{" "}
       <Link href="/website" className="text-gold underline">Website</Link>{" "}section.
     </div>
   </Panel>
   ```

   Matches the inventory "No inventory yet" empty state shape.

2. **Single-snapshot** (`latest !== null && previous === null`)

   Renders the 4-up KPI grid with delta cells showing `—` (no comparison possible). Sparkline renders a single-point line (lightweight-charts handles single-point data; if it doesn't, fall back to a horizontal rule). A small "Add another week" link below the sparkline points to `/website`.

3. **Multi-snapshot** (`latest !== null && previous !== null`)

   Full KPI grid with delta arrows; sparkline of last 8 (or however many `trend` has).

KPI tile shape:

```tsx
<div
  data-testid="website-kpi-visitors"
  className="rounded-lg border border-border bg-surface-2/40 px-3 py-2"
>
  <div className="text-[10px] uppercase tracking-wider text-text/50">Visitors</div>
  <div className="font-mono text-base text-gold">{NUM.format(latest.visitors)}</div>
  {delta && (
    <div className={`text-[10px] ${delta.sign === "up" ? "text-ok" : delta.sign === "down" ? "text-bad" : "text-text/40"}`}>
      {delta.sign === "up" ? "▲" : delta.sign === "down" ? "▼" : "—"} {delta.percent.toFixed(1)}%
    </div>
  )}
</div>
```

Four tiles total: Visitors, Page Views, Avg Session (formatted via `formatSessionDuration`), Bounce Rate (`{n}%`). `uniqueVisitors` is **deliberately not in the dashboard panel** — the dashboard's job is the headline 4-up; `uniqueVisitors` is captured in the admin route for the owner to track but isn't surfaced on the dashboard. Reduces visual clutter; the spec asks for 4 KPIs (Visitors, Page Views, Avg Session, Bounce Rate) and the panel honors that exactly.

Sparkline reuses the existing `<Sparkline points={number[]} />` at `src/components/market/Sparkline.tsx` — already lightweight-charts-backed, already in deps, already 96×28 px. The panel passes `trend.map(t => t.visitors).reverse()` (oldest-first for natural left-to-right time progression).

Provenance footer:

```tsx
{updatedLabel && (
  <div className="mt-2 text-right text-[10px] text-text/40">
    {updatedLabel} · owner-entered
  </div>
)}
```

**Honesty contract carry-over (§3 of slice 1a):** the panel never shows a "live" FreshnessDot. Owner-entered data renders the same `updated Xd ago` label inventory and diamonds use. The "· owner-entered" suffix is the explicit anti-confusion signal — a future reviewer skimming the dashboard cannot mistake this for a Plausible-style live integration.

### 5.2 Layout registry — `src/lib/layout/registry.tsx` (modified)

Add a new entry below `tradenet-exchange`:

```typescript
{
  id: "website-overview",
  title: "Website Overview",
  defaultSize: 1,
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

The `PanelCtx` interface in `src/lib/layout/types.ts` gains `website?: WebsiteOverviewView`. RSC `src/app/page.tsx` is extended to fetch + pass it:

```typescript
const [invSummary, dia, activeDeals, circleNamesById, websiteTrend] = await Promise.all([
  getInventorySummary(db, orgId),
  getDiamondSummary(db, orgId),
  getActiveDeals(db, orgId, 5),
  getCircleNamesForOrg(db, orgId),
  getWebsiteSnapshotTrend(db, orgId, 8),
]);
const website = {
  latest: websiteTrend[0] ?? null,
  previous: websiteTrend[1] ?? null,
  trend: websiteTrend.map(r => ({ weekStart: r.weekStart, visitors: r.visitors })),
  updatedLabel: updatedAgo(websiteTrend[0]?.updatedAt ?? null),
};
```

A single `getWebsiteSnapshotTrend(8)` fetch covers latest + previous + the sparkline series — one query, three derived props.

### 5.3 Default layout slot

`PANEL_REGISTRY` order determines the default layout. The new `website-overview` entry sits **after `tradenet-exchange`** in the registry array, so on a first load it appears in the same neighborhood as the Deal Room — both are mockup-2/mockup-3 panels. Users who previously customized their layout (slice 1c persisted `layoutItems`) will see the new panel appended at the end via `getEffectiveLayout()`'s "panels in registry but not in persisted layout are appended" rule (existing slice-1c behavior — verified at `src/lib/layout/registry.tsx`).

No layout migration needed. Existing users see the new panel at the bottom of their grid on first reload after the slice ships; they can drag it where they want via the existing customize button.

---

## 6. UI — Admin Route

### 6.1 `/website` route — `src/app/(admin)/website/page.tsx` (new)

```typescript
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

Mirrors `src/app/(admin)/inventory/page.tsx`. Note that this RSC **does not** select directly from `websiteSnapshots` like the inventory page does — instead it routes through `getWebsiteSnapshots(db, orgId)`. That's the right pattern (the inventory page's direct select is called out in its own source comment as a follow-up lint candidate); slice 5 starts correct by going through the helper from day one.

### 6.2 `<WebsiteAdmin>` — `src/components/website/WebsiteAdmin.tsx` (new)

A standard form + table client component. Two design choices to call out:

**Edit-inline vs row-click-into-modal — design pick: inline edit row.** Each table row, on Edit click, swaps to a form-row inline with the existing inputs. Submit calls `updateAction`; Cancel reverts. Rationale:

- The data is shallow (5 numeric fields + 1 date). A modal would be over-engineered.
- The inline pattern matches the slice 1b-3 diamond grid's per-cell edit shape — same mental model for owners.
- No new routing or modal-stack state to manage.

**Default weekStart in the form** — `new Date().toISOString().slice(0, 10)` (today). The owner adjusts as needed. The form does not force "must be a Monday" (see §2.3).

Form shape (sketch):

```tsx
<form onSubmit={submit} className="mb-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
  <label className="flex flex-col">
    Week start
    <input aria-label="week start" type="date" className="bg-bg p-2"
      value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
  </label>
  <label className="flex flex-col">
    Visitors
    <input aria-label="visitors" type="number" min="0" className="bg-bg p-2"
      value={visitors} onChange={(e) => setVisitors(e.target.value)} />
  </label>
  {/* … unique visitors, page views, avg session, bounce rate … */}
  <div className="col-span-2 flex items-center justify-between md:col-span-3">
    <button className="rounded bg-gold p-2 text-black" type="submit" disabled={pending}>
      Add snapshot
    </button>
    <FormStatus error={error} ok={ok} duplicate={duplicate} />
  </div>
</form>
```

**`FormStatus duplicate` extension** — the existing `FormStatus` component at `src/components/company/FormStatus.tsx` receives a new optional `duplicate?: boolean` prop. When the action returns `{ ok: true, duplicate: true }`, the form sets `duplicate=true` instead of `ok=true`, and the status renders "Snapshot for this week already exists — use the table below to edit it." This is the user-facing surface for the slice 3.2 `onConflictDoNothing` branch.

**Avg session input UX** — the form accepts seconds as an integer. A subtle helper text below the field reads "e.g. 180 = 3:00, 240 = 4:00". Adding a separate "minutes:seconds" composite input was considered and rejected — the form is already 6 fields; adding a composite would balloon validation surface and confuse the wire format. Owner-entered ledger; raw seconds is the cleanest path.

### 6.3 Sidebar nav entry — `src/components/dashboard/Nav.tsx` (modified)

Extend `ROUTES`:

```typescript
const ROUTES: Record<string, string> = {
  Inventory: "/inventory",
  Diamonds: "/diamonds",
  "Orders & Deals": "/deals",
  // NEW slice 5:
  "Marketing Suite": "/website",
};
```

The existing `SECTIONS` array already includes `"Marketing Suite"` (verified at `src/components/dashboard/Nav.tsx:8`); slice 5 simply makes it a real link. Adding a literal "Website" string to `SECTIONS` would change the nav order and is unnecessary — "Marketing Suite" is the section that already conceptually covers website analytics, and the title in the panel + admin page (`<h1>Website</h1>`) makes the in-page identity clear. The implementation plan should document this mapping decision in the PR description so a future onboarding doc isn't confused.

**Alternative considered:** add a new `"Website"` entry to `SECTIONS` between `"Marketing Suite"` and `"Social & Inbox"`. Rejected because it crowds an already-long nav and the existing `"Marketing Suite"` label is the natural parent of marketing-site analytics. If the user later prefers a dedicated `"Website"` entry, the change is one line.

### 6.4 Middleware matcher — `src/middleware.ts` (modified)

Add `"/website"` to the matcher array (currently has `/inventory`, `/diamonds`, `/deals`). Without this addition, `/website` would be reachable without auth in prod. The middleware test (slice 3's `test/middleware.test.ts`) gains an assertion for `/website`.

---

## 7. Tests (TDD)

All test files follow the existing pattern: `// @vitest-environment node`, `vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))`, `vi.mock("@/lib/auth/requireSession", () => ({ requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })) }))`, and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` / `__setTestDb` pattern from `test/helpers/shared-db.ts`.

**No shared-db extension needed.** Slice 3 already seeds orgs at id=1 + id=999; slice 4 added id=888 for cross-circle tests. Slice 5's cross-org isolation tests use id=1 vs id=999 — the existing two-org seed is sufficient.

### 7.1 `test/db/website-snapshots.test.ts` (new)

- **Insert + read.** Insert one row with `orgId=1, weekStart='2026-05-25'`; `getWebsiteSnapshots(db, 1)` returns 1 row with matching fields.
- **Order by weekStart DESC.** Insert three rows with weeks `'2026-05-04', '2026-05-11', '2026-05-18'`; result order is `'2026-05-18', '2026-05-11', '2026-05-04'`.
- **Unique constraint.** Insert `(orgId=1, weekStart='2026-05-25')`; a second insert with the same pair raises a DB error. The action layer is the only path that should see this; the test asserts the raw DB enforces it.
- **Cross-org isolation.** Insert 3 rows for `orgId=1` and 2 for `orgId=999`; `getWebsiteSnapshots(db, 1).length === 3`; `getWebsiteSnapshots(db, 999).length === 2`; no `orgId=999` row leaks through the org=1 query.
- **`getLatestWebsiteSnapshot` returns null for empty org.** `getLatestWebsiteSnapshot(db, 1)` returns `null` when no rows exist for org 1.
- **`getLatestWebsiteSnapshot` picks the most recent weekStart.** Insert 3 rows; helper returns the one with the latest `weekStart`.
- **`getWebsiteSnapshotTrend` caps at N.** Insert 12 rows; `getWebsiteSnapshotTrend(db, 1, 8).length === 8`; the 8 rows are the 8 most recent.
- **`getWebsiteSnapshotTrend` default N=8.** Calling with no third argument caps at 8.

### 7.2 `test/lib/website/queries.test.ts` (new)

Same shape as `test/db/website-snapshots.test.ts` but explicitly exercising the **demo-mode short-circuit**:

- With `NEXT_PUBLIC_DEMO_MODE=true`, `getWebsiteSnapshots(db, DEMO_ORG_ID)` returns the seeded 8 rows without touching the DB (the db argument is unused in demo).
- `getLatestWebsiteSnapshot(db, DEMO_ORG_ID)` returns the most recent seeded row.
- `getWebsiteSnapshotTrend(db, DEMO_ORG_ID, 4)` returns 4 rows.
- `getWebsiteSnapshots(db, 999)` in demo returns `[]` (the demo seed is single-org-AIYA-centric; fixture org 999 has no demo data).

### 7.3 `test/lib/website/actions.test.ts` (new)

- **Validation pass.** `createWebsiteSnapshot({ weekStart: '2026-05-25', visitors: 5000, uniqueVisitors: 3500, pageViews: 18000, avgSessionDurationSeconds: 210, bounceRatePercent: 42 })` returns `{ ok: true }`.
- **Validation fail — negative visitors.** Returns `{ ok: false, error: <message> }` and writes zero rows.
- **Validation fail — bounceRate > 100.** Returns `{ ok: false, error }` and writes zero rows.
- **Validation fail — bounceRate < 0.** Same.
- **Validation fail — invalid weekStart format.** `weekStart: '2026/05/25'` (slash) returns `{ ok: false, error }`.
- **Duplicate week** — insert once, then insert again with same `(orgId, weekStart)`; second call returns `{ ok: true, duplicate: true }` and the DB has exactly 1 row.
- **Tenancy enforcement — update.** Insert a row under `orgId=999`. Mock `requireSession` to return `{user: "boss", orgId: 1}`. Call `updateWebsiteSnapshot({ id: <999_row_id>, ...valid })`. After the call, assert the org-999 row's fields are unchanged (the WHERE includes `eq(orgId, 1)`, so the update affects zero rows).
- **Tenancy enforcement — delete.** Same shape: `deleteWebsiteSnapshot(<999_row_id>)` from a session-org-1 session must leave the org-999 row intact.
- **`postDeal`-style insert org stamping.** Mock session as `{orgId: 999}`. `createWebsiteSnapshot(...)` lands a row with `orgId=999`. Confirms `orgId` is from session, never wire (the input has no `orgId` field; this is the slice-3 invariant repeat-test).
- **Demo guard.** With `NEXT_PUBLIC_DEMO_MODE=true`, `createWebsiteSnapshot(...)` returns `{ ok: false, error: "Demo mode — changes are disabled" }`; no DB writes; `getCurrentOrgId` / `requireSession` are never called.
- **Unauthorized.** With `requireSession` mocked to throw, `createWebsiteSnapshot(...)` returns `{ ok: false, error: "Unauthorized" }`.

### 7.4 `test/lib/website/validation.test.ts` (new)

- **Visitors / pageViews / uniqueVisitors must be ≥ 0.** Each rejects -1 and accepts 0.
- **avgSessionDurationSeconds must be ≥ 0.** Rejects -1, accepts 0.
- **bounceRatePercent must be in [0, 100].** Accepts 0, 50, 100; rejects -1 and 101.
- **All numeric fields must be integers.** Rejects `visitors: 5000.5` (Zod's `.int()`).
- **weekStart format.** Accepts `'2026-05-25'`; rejects `'2026-5-25'` (single-digit month), `'2026/05/25'`, `'May 25, 2026'`.
- **No orgId in the schema.** `websiteSnapshotInput.shape.orgId === undefined` (Zod object shape inspection); confirms the slice-3 invariant by grep equivalent.
- **Update schema requires positive integer id.** Rejects `id: 0`, `id: -1`, `id: 1.5`; accepts `id: 1`.

### 7.5 `test/components/dashboard/WebsiteOverviewPanel.test.tsx` (new)

- **No-data state.** `<WebsiteOverviewPanel latest={null} previous={null} trend={[]} updatedLabel={null} />` renders the "No website snapshots yet" copy with a link to `/website`. Assert no KPI tile is rendered.
- **Single-snapshot state.** `latest=row, previous=null, trend=[row]` renders the 4 KPI tiles; each delta cell renders `—`; an "Add another week" link is visible.
- **Multi-snapshot state.** `latest=curr, previous=prev, trend=[...8 rows]` renders all 4 KPI tiles with delta arrows (up/down). The sparkline renders with `data-testid="sparkline"`.
- **Delta direction.** Given `latest.visitors=6000, previous.visitors=5000`, the Visitors tile shows `▲ 20.0%` with the ok-color class.
- **Delta down.** Given `latest.visitors=4500, previous.visitors=5000`, shows `▼ 10.0%` with the bad-color class.
- **Avg session formatting.** `latest.avgSessionDurationSeconds=210` renders `3:30` in the Avg Session tile.
- **Bounce rate formatting.** `latest.bounceRatePercent=42` renders `42%`.
- **Provenance label.** `updatedLabel="updated 2d ago"` renders with the `· owner-entered` suffix; assert no "live" indicator anywhere in the DOM.

### 7.6 `test/components/website/WebsiteAdmin.test.tsx` (new)

- **Form submission wires to action.** Mock `createAction`; fill the 6 fields; submit; assert `createAction` called once with the exact raw payload.
- **Server-rejected submission surfaces error.** `createAction` returns `{ ok: false, error: "boom" }`; the form shows "boom" via `FormStatus`.
- **Duplicate response surfaces hint.** `createAction` returns `{ ok: true, duplicate: true }`; `FormStatus` shows the "already exists — use the table below to edit" copy.
- **Successful submission resets the form.** After `{ ok: true }`, all 6 input values reset to their defaults (weekStart back to today, numbers blank).
- **Table renders rows.** Pass `rows={[r1, r2, r3]}`; assert 3 rows visible with the right weekStart strings.
- **Edit toggles inline form.** Click `Edit` on a row; the row swaps to an inline form with the row's values pre-filled.
- **Delete triggers deleteAction.** Click `Delete` on a row; `deleteAction` called once with the row id.
- **Empty state.** Pass `rows={[]}`; assert "No snapshots yet — add your first week above" copy is shown.

### 7.7 `test/lib/website/format.test.ts` (new)

- `formatSessionDuration(0)` → `"0:00"`.
- `formatSessionDuration(59)` → `"0:59"`.
- `formatSessionDuration(60)` → `"1:00"`.
- `formatSessionDuration(210)` → `"3:30"`.
- `formatSessionDuration(3600)` → `"1:00:00"`.
- `formatSessionDuration(3661)` → `"1:01:01"`.
- `formatSessionDuration(-5)` → `"—"`.
- `weekOverWeekDelta(5500, 5000)` → `{ sign: "up", percent: 10 }`.
- `weekOverWeekDelta(4500, 5000)` → `{ sign: "down", percent: 10 }`.
- `weekOverWeekDelta(5000, 5000)` → `{ sign: "flat", percent: 0 }`.
- `weekOverWeekDelta(100, 0)` → `{ sign: "up", percent: 100 }` (explicit zero-baseline branch).
- `weekOverWeekDelta(0, 0)` → `{ sign: "flat", percent: 0 }`.
- `weekOverWeekDelta(5000, null)` → `null`.
- `weekOverWeekDelta(5000, undefined)` → `null`.

### 7.8 Demo seed tests — `test/lib/demo/seed.test.ts` (extended)

- `getSeedWebsiteSnapshots(DEMO_AIYA_ORG_ID)` returns 8 rows; weeks are in descending order; bounceRate values are in `[0, 100]`.
- `getSeedWebsiteSnapshots(DEMO_PARTNER_ORG_IDS.MEHTA)` returns 2-3 rows (multi-tenant story).
- `getSeedWebsiteSnapshots(999)` returns `[]` — fixture orgs don't get demo data.
- `getSeedLatestWebsiteSnapshot(DEMO_AIYA_ORG_ID)` returns the highest-`weekStart` row.
- `getSeedLatestWebsiteSnapshot(<unknown_org>)` returns `null`.
- `getSeedWebsiteSnapshotTrend(DEMO_AIYA_ORG_ID, 4).length === 4`.
- AIYA's 8 rows show a realistic upward growth curve — `visitors[i] >= visitors[i-1]` for at least 5 of the 7 transitions (no strict monotonicity required; some week-over-week dips are realistic).

### 7.9 Middleware test (extended)

`test/middleware.test.ts` — verify that an unauthenticated request to `/website` redirects to `/login` (mirrors the existing `/inventory` test case).

### 7.10 Existing tests stay green

All slice-3 / slice-4 cross-org isolation tests (inventory, diamonds, deals, circles) must continue passing without modification. Slice 5 is **strictly additive** to the multi-tenant story; it never widens visibility, never modifies an existing query, never changes an existing schema column.

---

## 8. Security & Threat Model

This is the load-bearing section of the slice. The risk surface is narrower than slice 4 (no read-widening) but the same slice-3 invariants apply byte-for-byte.

### 8.1 Tenancy enforcement — the critical invariant

Every read scoped to `eq(websiteSnapshots.orgId, orgId)` where `orgId` is resolved from the session (`getCurrentOrgId()`), not the request body. Every write stamps `orgId` from session and uses `WHERE id = $1 AND orgId = $2` for updates and deletes. **No cross-org visibility exists in this domain.** Website snapshots are private to each org always — there is no Circles-style widening, no public marketplace, no aggregate sharing.

### 8.2 No new wire field beyond the 5 KPIs + week + optional id

The Zod input schemas (`websiteSnapshotInput`, `websiteSnapshotUpdateInput`) accept exactly these fields:

- `weekStart: string` (validated as YYYY-MM-DD)
- `visitors: number` (≥0)
- `uniqueVisitors: number` (≥0)
- `pageViews: number` (≥0)
- `avgSessionDurationSeconds: number` (≥0)
- `bounceRatePercent: number` (0..100)
- `id: number` (positive int, **update/delete only**)

No `orgId`. No `circleId`. No `visibility_circle_id`. No `created_at` override. **The PR review checklist (§8.7) includes the grep `grep -rn "orgId" src/lib/website/validation.ts` → must return zero matches.**

### 8.3 Numeric range validation

Zod enforces:
- `visitors`, `uniqueVisitors`, `pageViews`, `avgSessionDurationSeconds` must be non-negative integers.
- `bounceRatePercent` must be an integer in `[0, 100]`.

Violations return `{ ok: false, error: <Zod message> }` from the action wrapper — no DB write occurs. The unit tests in §7.4 prove each boundary.

**Cross-field invariant `uniqueVisitors ≤ visitors` is NOT enforced.** Rationale: while it's true in well-formed data, owner-entered ledgers commonly have edge cases (e.g. the analytics provider was unreachable for part of a week, so unique visitors was estimated higher than total page sessions). Enforcing this at validation would force the owner to fudge inputs to fit the constraint, which corrupts the ledger. The form will display a soft warning below the field when `uniqueVisitors > visitors`, but the save proceeds. This is a documented intentional gap; tracked under §11 as "cross-field warnings".

### 8.4 No PII in the schema

Every column captures aggregate counts only — no email addresses, no IP addresses, no user agents, no per-session identifiers, no referrer URLs. This is the entire point of using owner-entered weekly aggregates rather than a real analytics provider: the schema is GDPR-trivial because there's no personal data at any layer. Documented explicitly so a future executor adding "let's also store top referrers" understands the boundary they'd be crossing.

If a future slice integrates a real analytics provider (Plausible's no-cookie model, PostHog's session-replay opt-in), the provider's own data residency + retention story applies; this slice does not entangle with it.

### 8.5 Auth bypass for writes — never trust the body

Same slice-3 invariant as inventory / diamonds / deals:
- No Zod input schema includes an `orgId` field.
- Every `INSERT` builds its `orgId` value from the session-resolved local — never `input.orgId` (which doesn't exist) and never a header or query param.
- Every `UPDATE` / `DELETE` WHERE clause is `eq(id, input.id) AND eq(orgId, sessionOrgId)`. ID + orgId together; never id alone.

The §7.3 action tenancy tests prove this by attempting to update / delete a row whose id is from org 999 while the session is org 1, and asserting zero affected rows.

### 8.6 Demo mode

- `getWebsiteSnapshots`, `getLatestWebsiteSnapshot`, `getWebsiteSnapshotTrend` short-circuit on `isDemoMode()` and return seed data filtered to the calling orgId. No DB access in demo.
- `createWebsiteSnapshot`, `updateWebsiteSnapshot`, `deleteWebsiteSnapshot` short-circuit at the top of `run()` with `{ ok: false, error: "Demo mode — changes are disabled" }`. No DB writes.
- The Netlify demo deploy never boots pglite, so even if a bug skipped the `isDemoMode()` check there's no DB to corrupt.
- Cross-org isolation tests run under the test harness with `getSharedDb()`, not under the demo flag — same boundary slice 4 documented.

### 8.7 PR review checklist (slice 5 exit gate)

Before merge:

- `grep -rn "orgId" src/lib/website/validation.ts` → 0 matches (slice-3 invariant).
- `grep -rn "from(websiteSnapshots)" src/` → only matches are inside `src/db/website.ts` (the three read helpers) and `src/lib/website/actions.ts` (insert/update/delete) — no stray direct `select` from an RSC page or component.
- Every `INSERT INTO website_snapshots` builds `orgId` from a session-resolved local, never from the request body.
- Every `UPDATE` / `DELETE` on `website_snapshots` includes `eq(websiteSnapshots.orgId, orgId)` in its WHERE clause.
- The slice-3 cross-org isolation tests (`test/db/inventory.test.ts`, `test/db/diamonds.test.ts`, the slice-2/3/4 deals tests) pass without modification.
- The new `test/db/website-snapshots.test.ts` cross-org isolation case passes.
- The new `test/lib/website/actions.test.ts` tenancy enforcement cases pass.
- `npm run build` and `npm test` green.

### 8.8 Audit logging — explicit gap

Slice 5 adds **no** audit logging for snapshot mutations. The existing slice-3 / slice-4 deferred "tenancy audit logs" track covers this. A future hardening pass should log:
- Successful creates/updates/deletes with `org_id`, `actor`, and `weekStart`.
- Failed tenancy enforcement (UPDATE / DELETE affecting zero rows in a session context — possible attack signal).

Out of scope for slice 5; same explicit gap slice 3 documented.

### 8.9 Rate limiting / abuse

Single-credential per-org dashboard. There's no rate limit on `createWebsiteSnapshot` at the slice-5 layer. A malicious authenticated user could submit thousands of `(orgId, weekStart)` combinations to fill storage; the unique constraint caps each org at one row per week and there's no programmatic week-generation. Practical worst case: ~52 rows per year per org × small `text`/`int` columns = trivial storage even at hundreds of orgs.

A future slice that adds rate limiting (the slice-2g rate-limit slot) should extend to admin mutation routes; tracked as a non-issue for slice 5.

---

## 9. Demo Mode

### 9.1 Seeded weekly snapshots in `src/lib/demo/seed.ts`

Extend the existing demo seed with three new exports + a constant for AIYA's deterministic snapshot fixture:

```typescript
import type { WebsiteSnapshotRow } from "@/db/website";

// Deterministic reference week for the demo: 2026-05-25 = Monday.
// AIYA's 8 weeks span 2026-04-06 (Mon) through 2026-05-25 (Mon).
const DEMO_WEBSITE_REF_WEEK = "2026-05-25";

function makeWeekStart(weeksAgo: number): string {
  // 2026-05-25 minus `weeksAgo` weeks, formatted YYYY-MM-DD.
  const ref = new Date("2026-05-25T00:00:00Z");
  ref.setUTCDate(ref.getUTCDate() - weeksAgo * 7);
  return ref.toISOString().slice(0, 10);
}

/** AIYA's seeded weekly snapshots: 8 weeks, gentle growth, realistic for a
 *  small luxury-jewelry e-commerce site. */
function seedAiyaSnapshots(): WebsiteSnapshotRow[] {
  // newest-first, matching the DESC ordering of the real query
  const weeks: Omit<WebsiteSnapshotRow, "id" | "orgId" | "createdAt" | "updatedAt">[] = [
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
    id: 5000 + i,    // demo-only ids in the 5000-range; never collide with real serials
    orgId: DEMO_AIYA_ORG_ID,
    ...w,
    createdAt: new Date(DEMO_REF),
    updatedAt: new Date(DEMO_REF - i * 86_400_000),  // older rows have older updatedAt
  }));
}

/** Mehta Diamonds — 2 weeks of demo data to show the multi-tenant story. */
function seedMehtaSnapshots(): WebsiteSnapshotRow[] {
  const base = [
    { weekStart: makeWeekStart(0), visitors: 2840, uniqueVisitors: 2010, pageViews: 8120, avgSessionDurationSeconds: 145, bounceRatePercent: 52 },
    { weekStart: makeWeekStart(1), visitors: 2690, uniqueVisitors: 1950, pageViews: 7720, avgSessionDurationSeconds: 138, bounceRatePercent: 54 },
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
  n: number,
): WebsiteSnapshotRow[] {
  return getSeedWebsiteSnapshots(orgId).slice(0, n);
}
```

**Why these numbers?** Targeting a small luxury-jewelry e-commerce site: ~3-8k weekly visitors, ~12-25k page views (AIYA), ~2:30-4:00 avg session (150-240 seconds), ~35-55% bounce rate. AIYA's curve shows ~5% week-over-week growth, which reads as a healthy site without looking implausibly polished. Mehta is a smaller wholesale partner — half the traffic, longer pages per session, slightly higher bounce. The contrast makes the multi-tenant story visible in the demo.

**Deterministic ids in the 5000-range** — high enough to never collide with serials in shared-db tests (which start fresh at 1), low enough to be recognizable as seed data. Same convention slice 4 used for circle id 201 and partner org ids 501/502/503.

### 9.2 Demo mode boundaries

| Area | Demo behavior |
|---|---|
| Read seam | All three reads (`getWebsiteSnapshots`, `getLatestWebsiteSnapshot`, `getWebsiteSnapshotTrend`) short-circuit on `isDemoMode()` at the top, returning seed data. Same pattern as `getInventorySummary`. |
| Write seam | All three actions (`create`, `update`, `delete`) short-circuit at the top of `run()` with the existing demo guard message. No DB writes ever. |
| Admin form in demo | Renders fully (form + table populated with AIYA's 8 demo rows), but the submit button's `{ ok: false, error: "Demo mode …" }` response surfaces in `FormStatus`. Owner sees the form, owner sees the data, owner cannot mutate. Honest. |
| Dashboard panel in demo | Renders with AIYA's 8 weeks of demo data, including deltas and sparkline. The "owner-updated Xd ago" label renders with `DEMO_REF` as the reference, deterministically. |
| Cross-tenant demo data | Mehta has 2 weeks; the demo seed never surfaces Mehta's data to AIYA's view (the read helpers filter on the orgId argument). The multi-tenant story exists in the seed data but isn't visible in the AIYA-only Netlify view — which is correct, since website snapshots have no cross-org visibility. Documented as expected. |

### 9.3 Demo widening is impossible by construction

There's nothing to widen. Website snapshots are strictly per-org. The demo seed mirrors this exactly: even though Mehta's rows exist in `ALL_DEMO_WEBSITE_ROWS`, no `getSeedWebsiteSnapshotsVisibleTo` helper exists — there's nothing for an "AIYA also sees Mehta's snapshots" path to compute, because the domain forbids that path.

The implementation plan should not invent such a helper. The PR review must reject any version of it.

---

## 10. File Plan

### New files

| Path | Purpose |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/drizzle/0006_*.sql` | Generated migration: `CREATE TABLE website_snapshots` + FK + unique + index. No hand-appended seed. |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/website.ts` | `getWebsiteSnapshots`, `getLatestWebsiteSnapshot`, `getWebsiteSnapshotTrend` + `WebsiteSnapshotRow` interface |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/website/validation.ts` | `websiteSnapshotInput`, `websiteSnapshotUpdateInput`, type re-exports |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/website/actions.ts` | `createWebsiteSnapshot`, `updateWebsiteSnapshot`, `deleteWebsiteSnapshot` with `run()` wrapper |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/website/format.ts` | `formatSessionDuration`, `weekOverWeekDelta` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/WebsiteOverviewPanel.tsx` | Dashboard panel — no-data / single / multi states |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/website/WebsiteAdmin.tsx` | Admin form + table client component with inline edit |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/website/page.tsx` | `/website` RSC route — fetches via `getWebsiteSnapshots(db, orgId)` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/db/website-snapshots.test.ts` | DB-level table tests: insert/read/order/unique/cross-org isolation |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/website/queries.test.ts` | Demo-mode short-circuit tests for the three reads |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/website/actions.test.ts` | Validation + tenancy enforcement + duplicate week + demo guard |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/website/validation.test.ts` | Zod schema edge cases |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/website/format.test.ts` | `formatSessionDuration` + `weekOverWeekDelta` edge cases |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/dashboard/WebsiteOverviewPanel.test.tsx` | Panel render tests across the three states |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/website/WebsiteAdmin.test.tsx` | Form + table + inline-edit + duplicate-week UX tests |

### Modified files

| Path | Change |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/schema.ts` | Add `websiteSnapshots` `pgTable` definition |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/types.ts` | Extend `PanelCtx` with `website?: WebsiteOverviewView`; export `WebsiteOverviewView` interface |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/registry.tsx` | Add `website-overview` registry entry below `tradenet-exchange` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/page.tsx` | Parallel-fetch `getWebsiteSnapshotTrend(db, orgId, 8)`; build `website` view object; pass into `DashboardGrid` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/DashboardGrid.tsx` | Accept new `website?: WebsiteOverviewView` prop; thread into `PanelCtx` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/Nav.tsx` | Add `"Marketing Suite": "/website"` to `ROUTES` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/middleware.ts` | Add `"/website"` to the matcher array |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/company/FormStatus.tsx` | Add optional `duplicate?: boolean` prop + message branch |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/demo/seed.ts` | Add `getSeedWebsiteSnapshots`, `getSeedLatestWebsiteSnapshot`, `getSeedWebsiteSnapshotTrend`, `seedAiyaSnapshots`, `seedMehtaSnapshots` + AIYA/Mehta fixtures |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/demo/seed.test.ts` | Extend with website snapshot seed assertions |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/middleware.test.ts` | Add `/website` redirect assertion |

### Removed files

None.

---

## 11. Out of Scope (Explicit)

| Feature | Assigned to |
|---|---|
| Real analytics provider integration (Plausible / PostHog / GA4 / Vercel Analytics) | Slice 5b — Website Live Feed |
| Funnel / conversion / per-page analytics | Future "Website Deep Analytics" |
| A/B testing infrastructure | Future "Experiments" slice |
| Per-day or per-hour granularity | Future "Higher-resolution Web Analytics" — would extend the same table with a finer granularity column |
| Cross-org snapshot visibility (Circles-style sharing) | **Not planned — private by design.** Cross-org benchmarking is a separate aggregation problem; see below. |
| Anomaly alerts / notifications | Future observability slice |
| Newsletter / email KPIs | Future "Email Analytics" slice |
| Custom per-org KPI definitions | **Not planned** — fixed schema is the contract |
| E-commerce conversion tracking | Future "Commerce Analytics" |
| Cross-org benchmarking ("AIYA vs partners average") | Future "Benchmarks" slice — requires aggregate-only sharing semantics, separate from Circles |
| DB-level CHECK constraints for numeric ranges | Future hardening (Zod enforces today) |
| Audit log of admin edits to snapshots | Future tenancy audit slice (descended from slice 3 §10) |
| Cross-field validation (`uniqueVisitors ≤ visitors` etc) | Future "Soft validation warnings" — surface as a hint in the form, not a hard-stop |
| Charting beyond the visitor sparkline (bar charts, heatmaps) | Future "Website Deep Analytics" |
| Mobile-specific layouts | Existing slice-1c responsive shell covers this; no slice-5-specific work |
| Per-org snapshot retention / archival | Future ops slice |
| Bulk CSV import / paste-and-go | Future "Bulk import" slice (mirrors slice 1b-3's pattern, optional add-on) |
| Charts for `uniqueVisitors`, `pageViews`, `avgSession`, `bounceRate` (only `visitors` is sparkline'd) | Future "Website Deep Analytics" — KPI tiles show the latest week's value + WoW delta; trends beyond visitors are out of scope |
| Demo data for a third partner org (Saint-Cloud Gems) | Mehta only — two-org seed is sufficient to demonstrate multi-tenancy; Saint-Cloud's website data is left empty so the demo also shows the empty-state branch indirectly |
| API endpoint for read-only public sharing of snapshots | **Not planned** — would change the security boundary |
| Webhook ingestion of provider data | Slice 5b (the live-feed swap) |
| Pre-check on update that catches `(orgId, weekStart)` collisions before the DB throws | Future UX polish |
