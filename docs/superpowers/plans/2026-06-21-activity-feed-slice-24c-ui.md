# Slice 24c — Activity Feed UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render the activity log on three surfaces — dashboard right-rail panel, `/activity` full feed, per-customer section — via one shared `<ActivityList>` component.

**Architecture:** Presentational `<ActivityList>` (no hooks) consumed by (1) `<ActivityPanel>` registered in the layout registry and fed via `PanelCtx` from the dashboard page, (2) an RSC `/activity` page with link-based cursor pagination + entity-type filter chips, (3) an Activity section appended to the customer edit page via `getEntityActivity`. No new data layer — readers shipped in slice 24.

**Tech Stack:** Next.js RSC, existing layout registry (`src/lib/layout/`), `relativeTime` from `src/lib/format/bids.ts`, Vitest + jsdom for component tests.

**Spec:** `docs/superpowers/specs/2026-06-21-activity-feed-slice-24c-ui-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-24c-activity-ui`

**Reference patterns (read before implementing):**
- `src/components/dashboard/TodaysBidsPanel.tsx` — card/header/empty-state classes
- `src/lib/layout/registry.tsx` — `PanelEntry` shape, `todays-bids` entry with `BusinessPlaceholder` fallback
- `src/lib/layout/types.ts` — `PanelCtx` (add `activity` there)
- `src/app/DashboardGrid.tsx` — how ctx fields thread from the dashboard page
- `src/app/(admin)/customers/page.tsx` — searchParams handling (`pickQuery`)
- `src/app/(admin)/customers/[id]/edit/page.tsx` — where the Activity section slots
- `test/app/circles-page.test.tsx` — RSC page test pattern
- `test/components/dashboard/Nav.test.tsx` — nav link test pattern

---

## Task 24c-1 — `<ActivityList>` shared component

**Files:**
- Create: `src/components/activity/ActivityList.tsx`
- Create: `test/components/activity/ActivityList.test.tsx`

- [ ] **Step 1: Write the failing tests** (`test/components/activity/ActivityList.test.tsx`)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityList } from "@/components/activity/ActivityList";
import type { ActivityEvent } from "@/lib/activity/types";

function ev(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 1, orgId: 1, actor: "owner@aiya.demo", entityType: "customer",
    entityId: 2201, verb: "created", summary: "Added Priya Mehta",
    payload: null, createdAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

describe("ActivityList", () => {
  it("renders summary, actor, and relative time per row", () => {
    render(<ActivityList events={[ev({})]} />);
    expect(screen.getByText("Added Priya Mehta")).toBeInTheDocument();
    expect(screen.getByText("owner@aiya.demo")).toBeInTheDocument();
    expect(screen.getByText(/ago$/)).toBeInTheDocument();
  });

  it("hides actor in compact mode", () => {
    render(<ActivityList compact events={[ev({})]} />);
    expect(screen.getByText("Added Priya Mehta")).toBeInTheDocument();
    expect(screen.queryByText("owner@aiya.demo")).not.toBeInTheDocument();
  });

  it("maps verb to a dot color class", () => {
    const { container } = render(
      <ActivityList events={[
        ev({ id: 1, verb: "created" }),
        ev({ id: 2, verb: "deleted", summary: "Deleted X" }),
        ev({ id: 3, verb: "bid_placed", summary: "Placed bid on Y" }),
      ]} />,
    );
    const dots = container.querySelectorAll("[data-verb-dot]");
    expect(dots).toHaveLength(3);
    expect(dots[0].className).toContain("bg-emerald");
    expect(dots[1].className).toContain("bg-rose");
    expect(dots[2].className).toContain("bg-sky");
  });

  it("renders the empty state when there are no events", () => {
    render(<ActivityList events={[]} />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });

  it("renders a null actor row without crashing (system event)", () => {
    render(<ActivityList events={[ev({ actor: null })]} />);
    expect(screen.getByText("Added Priya Mehta")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/components/activity/ActivityList.test.tsx; echo "EXIT=$?"` → module not found.

- [ ] **Step 3: Implement** (`src/components/activity/ActivityList.tsx`)

```tsx
import type { ActivityEvent, ActivityVerb } from "@/lib/activity/types";
import { relativeTime } from "@/lib/format/bids";

/** Verb → dot color. Presentation concern — lives here, not in types.ts. */
function verbDotClass(verb: ActivityVerb): string {
  switch (verb) {
    case "created":
    case "restored":
    case "bid_accepted":
      return "bg-emerald-400";
    case "updated":
      return "bg-amber-300";
    case "deleted":
    case "comment_deleted":
    case "bid_rejected":
      return "bg-rose-400";
    case "bid_placed":
    case "bid_withdrawn":
    case "invited":
    case "joined":
    case "left":
      return "bg-sky-400";
    default:
      return "bg-zinc-500";
  }
}

/**
 * Shared audit-feed list. Used by the dashboard ActivityPanel (compact),
 * the /activity page (full), and the per-customer Activity section
 * (compact). Hook-free so it renders server-side on RSC pages and inside
 * the client DashboardGrid alike.
 */
export function ActivityList({
  events,
  compact = false,
}: {
  events: ActivityEvent[];
  compact?: boolean;
}) {
  if (events.length === 0) {
    return <p className="text-xs text-zinc-500">No activity yet.</p>;
  }
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2.5"}>
      {events.map((e) => (
        <li key={e.id} className="flex items-baseline gap-2 text-sm">
          <span
            data-verb-dot
            className={`mt-1 h-1.5 w-1.5 shrink-0 self-center rounded-full ${verbDotClass(e.verb)}`}
          />
          <span className="min-w-0 flex-1 truncate text-zinc-200">{e.summary}</span>
          {!compact && e.actor ? (
            <span className="shrink-0 text-xs text-zinc-500">{e.actor}</span>
          ) : null}
          <span className="shrink-0 text-xs text-zinc-500">
            {relativeTime(e.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

Check `relativeTime`'s actual export location first (`grep -n "export function relativeTime" src/lib/format/bids.ts`) — if it lives elsewhere, adjust the import.

- [ ] **Step 4: Run to verify pass** — same command → 5 tests pass, EXIT=0.
- [ ] **Step 5: tsc** — `npx tsc --noEmit; echo "EXIT=$?"` → 0.
- [ ] **Step 6: Commit** — `git add src/components/activity/ test/components/activity/ && git commit -m "feat(activity): ActivityList shared component (slice 24c-1)"`

---

## Task 24c-2 — ActivityPanel + registry + PanelCtx + dashboard wiring

**Files:**
- Create: `src/components/dashboard/ActivityPanel.tsx`
- Modify: `src/lib/layout/types.ts` (PanelCtx + optional `activity` field)
- Modify: `src/lib/layout/registry.tsx` (new entry)
- Modify: the dashboard page + `src/app/DashboardGrid.tsx` (fetch + thread `activity`)
- Create: `test/components/dashboard/ActivityPanel.test.tsx`

- [ ] **Step 1: Component** (`src/components/dashboard/ActivityPanel.tsx`)

```tsx
import Link from "next/link";
import type { ActivityEvent } from "@/lib/activity/types";
import { ActivityList } from "@/components/activity/ActivityList";

export function ActivityPanel({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
      <h3 className="mb-2 text-sm font-semibold text-zinc-200">Recent Activity</h3>
      <ActivityList compact events={events} />
      <div className="mt-2 text-right">
        <Link href="/activity" className="text-xs text-zinc-400 hover:text-gold">
          View all →
        </Link>
      </div>
    </div>
  );
}
```

Match the exact card classes used by `TodaysBidsPanel` — read it first and mirror.

- [ ] **Step 2: PanelCtx + registry.** In `src/lib/layout/types.ts` add to `PanelCtx`: `activity?: { events: ActivityEvent[] };` (import the type as `import type { ActivityEvent } from "@/lib/activity/types";`). In `src/lib/layout/registry.tsx` add an entry mirroring `todays-bids`:

```tsx
{
  id: "activity",
  title: "Recent Activity",
  defaultSize: 1,
  render: (ctx) =>
    ctx.activity ? (
      <ActivityPanel events={ctx.activity.events} />
    ) : (
      <BusinessPlaceholder title="Recent Activity" testid="panel-activity" />
    ),
},
```

- [ ] **Step 3: Dashboard wiring.** Find where the dashboard page fetches `todaysBids` and threads it into `DashboardGrid` (grep `todaysBids` across `src/app/`). Add alongside: server-fetch `const activityEvents = await getOrgActivity(db, orgId, { limit: 10 });` and pass `activity={{ events: activityEvents }}` through the same prop path (page → DashboardGrid → ctx useMemo). Match naming + memo-dependency conventions exactly.

- [ ] **Step 4: LAYOUT-MERGE VERIFICATION (required).** Existing users have persisted layouts that predate the `"activity"` panel id. Find the layout persistence/merge logic (grep `defaultSize\|layout` under `src/lib/layout/`) and determine what happens to a registry id absent from a saved layout. If new registry panels are automatically appended/visible → note that in your report and move on. If they'd be invisible for existing layouts → fix within scope (merge missing registry ids into the loaded layout at read time) + add a unit test for the merge. Report which case you found.

- [ ] **Step 5: Panel test** (`test/components/dashboard/ActivityPanel.test.tsx`)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityPanel } from "@/components/dashboard/ActivityPanel";
import type { ActivityEvent } from "@/lib/activity/types";

const EV: ActivityEvent = {
  id: 1, orgId: 1, actor: "owner@aiya.demo", entityType: "customer",
  entityId: 2201, verb: "created", summary: "Added Priya Mehta",
  payload: null, createdAt: new Date(),
};

describe("ActivityPanel", () => {
  it("renders events and the View all link", () => {
    render(<ActivityPanel events={[EV]} />);
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();
    expect(screen.getByText("Added Priya Mehta")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link).toHaveAttribute("href", "/activity");
  });

  it("renders the empty state when no events", () => {
    render(<ActivityPanel events={[]} />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run** — `npx vitest run test/components/dashboard/ActivityPanel.test.tsx; echo "EXIT=$?"` → pass. Also run any existing layout/registry/dashboard tests: `npx vitest run test/lib/layout/ test/app/ 2>/dev/null` if those dirs exist (check first) → all pass.
- [ ] **Step 7: tsc** → 0.
- [ ] **Step 8: Commit** — `git add -A src/ test/ && git commit -m "feat(dashboard): ActivityPanel wired into layout registry + PanelCtx (slice 24c-2)"`

---

## Task 24c-3 — `/activity` route + nav entry

**Files:**
- Create: `src/app/(admin)/activity/page.tsx`
- Modify: `src/components/dashboard/Nav.tsx` (+ ROUTES if the codebase centralizes hrefs — check)
- Create: `test/app/activity-page.test.tsx`
- Modify: `test/components/dashboard/Nav.test.tsx`

- [ ] **Step 1: Page** (`src/app/(admin)/activity/page.tsx`)

```tsx
import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getOrgActivity } from "@/db/activityEvents";
import { ActivityList } from "@/components/activity/ActivityList";
import {
  ACTIVITY_ENTITY_TYPES,
  type ActivityEntityType,
} from "@/lib/activity/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const FILTERS: Array<{ label: string; type?: ActivityEntityType }> = [
  { label: "All" },
  { label: "Customers", type: "customer" },
  { label: "Deals", type: "deal" },
  { label: "Inventory", type: "inventory_item" },
  { label: "Bids", type: "bid" },
  { label: "Circles", type: "circle" },
];

function pickType(raw: string | string[] | undefined): ActivityEntityType | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (ACTIVITY_ENTITY_TYPES as readonly string[]).includes(v ?? "")
    ? (v as ActivityEntityType)
    : undefined;
}

function pickBefore(raw: string | string[] | undefined): number | undefined {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(v) && v > 0 ? v : undefined;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const type = pickType(params.type);
  const before = pickBefore(params.before);

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const events = await getOrgActivity(db, orgId, {
    limit: PAGE_SIZE,
    beforeId: before,
    entityTypes: type ? [type] : undefined,
  });

  const olderHref =
    events.length === PAGE_SIZE
      ? `/activity?${new URLSearchParams({
          ...(type ? { type } : {}),
          before: String(events[events.length - 1]!.id),
        }).toString()}`
      : null;

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Activity</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">
          Back to dashboard
        </Link>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filter by type">
        {FILTERS.map((f) => {
          const active = f.type === type;
          return (
            <Link
              key={f.label}
              href={f.type ? `/activity?type=${f.type}` : "/activity"}
              className={`rounded px-2 py-0.5 text-xs ${
                active
                  ? "border border-gold/30 bg-gold/10 text-gold"
                  : "border border-transparent text-text/65 hover:bg-surface-2 hover:text-gold"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <ActivityList events={events} />

      {olderHref ? (
        <div className="mt-4 text-right">
          <Link href={olderHref} className="text-sm text-zinc-400 hover:text-gold">
            Older →
          </Link>
        </div>
      ) : null}
    </main>
  );
}
```

Note the `active` logic: "All" chip is active when `type === undefined` — `f.type === type` handles that (both undefined). Filter chips intentionally drop the cursor (changing filter resets pagination).

- [ ] **Step 2: Nav.** Check how `Nav.tsx` declares entries (and whether hrefs come from a `ROUTES` map — grep `ROUTES`). Add an "Activity" entry pointing at `/activity`, positioned after "Customers". Mirror the existing declaration style exactly.

- [ ] **Step 3: Page test** (`test/app/activity-page.test.tsx`) — mirror the `circles-page.test.tsx` harness (demo-mode env or shared-db setup — read that file and copy its scaffolding). Assert:
  - Default render shows a known DEMO_ACTIVITY summary ("Added Priya Mehta") in demo mode
  - `searchParams: { type: "customer" }` still shows customer rows; `{ type: "deal" }` shows the empty state (DEMO_ACTIVITY is all customer events)
  - `{ before: "9003" }` excludes summaries with id ≥ 9003 (e.g. "Added Anita Sharma" is id 9003 → absent; ids 9001–9002 present)
  - An invalid `type` value ("bogus") renders as All

- [ ] **Step 4: Nav test.** Extend `test/components/dashboard/Nav.test.tsx` with an Activity-link assertion mirroring the Customers one (`getByRole("link", { name: "Activity" })` → href `/activity`).

- [ ] **Step 5: Run** — `npx vitest run test/app/activity-page.test.tsx test/components/dashboard/Nav.test.tsx; echo "EXIT=$?"` → pass.
- [ ] **Step 6: tsc** → 0.
- [ ] **Step 7: Commit** — `git add -A src/ test/ && git commit -m "feat(activity): /activity feed page + sidebar nav entry (slice 24c-3)"`

---

## Task 24c-4 — Per-customer Activity section

**Files:**
- Modify: `src/app/(admin)/customers/[id]/edit/page.tsx`
- Test: extend an existing edit-page test if present (grep `customers.*edit` under `test/`); otherwise create `test/app/customer-edit-activity.test.tsx` following the same RSC-page harness as 24c-3's test.

- [ ] **Step 1:** In the edit page, after the `<CustomerForm ... />` element, add:

```tsx
<section className="mt-8">
  <h2 className="mb-2 text-sm font-semibold text-zinc-200">Activity</h2>
  <ActivityList compact events={activity} />
</section>
```

with the fetch alongside the existing customer fetch:

```tsx
const activity = await getEntityActivity(db, orgId, "customer", id, { limit: 20 });
```

Imports: `getEntityActivity` from `@/db/activityEvents`, `ActivityList` from `@/components/activity/ActivityList`.

- [ ] **Step 2: Test.** In demo mode, customer id 2201 has 2 DEMO_ACTIVITY events ("Added Priya Mehta" + "Updated Priya Mehta"). Render the edit page RSC with `params: { id: "2201" }` (demo-mode harness) and assert both summaries appear and the "Activity" heading renders.

- [ ] **Step 3: Run** the test file + `npx tsc --noEmit` → both green.
- [ ] **Step 4: Commit** — `git add -A src/ test/ && git commit -m "feat(customers): per-customer Activity section on edit page (slice 24c-4)"`

---

## Final verification (controller)

- Full suite detached: `nohup bash -c 'npx vitest run > /tmp/slice24c-final.log 2>&1; echo "VITEST_EXIT=$?" > /tmp/slice24c-final.done' > /dev/null 2>&1 & disown` → expect VITEST_EXIT=0, ~1106 baseline + ~15 new.
- `npx tsc --noEmit` → 0.
- `npm run build` if quick sanity desired (optional; Netlify build is blocked on credits anyway).
- Merge `--no-ff` to main + push + ROADMAP `shipped:` + HANDOFF update.

## Done condition

- 4 commits (one per task) + spec/plan docs commit
- All three surfaces render in demo mode
- Full vitest green, tsc clean
- ROADMAP §9 row 24c → `shipped: <sha>`
