# iDesign Command Center — Slice 24c: Activity Feed UI — Design

**Date:** 2026-06-21
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 24 (readers `getOrgActivity` / `getEntityActivity`, `DEMO_ACTIVITY` demo seed), slice 24b (all mutation surfaces now emit events — the feed is genuinely populated), slice 11+1c layout system (`PanelEntry` / `PanelCtx` / `DashboardGrid`).

---

## 1. Overview & Goals

Slice 24/24b built the audit primitive; 24c makes it visible. Three surfaces, all consuming the existing readers:

1. **`<ActivityPanel>`** — dashboard right-rail panel showing the 10 most recent org events with a "View all →" link.
2. **`/activity`** — full paginated org-wide feed with entity-type filter chips and link-based cursor pagination.
3. **Per-customer Activity section** — on `/customers/[id]/edit`, the customer's own event trail via `getEntityActivity`.

All three render through one shared presentational component, `<ActivityList>`.

Demo mode works for free: the readers short-circuit to `DEMO_ACTIVITY` (slice 24 A7).

## 2. Non-goals (named homes)

- **Live updates / polling / websocket push** — slice 52 (streaming layer).
- **Payload/diff rendering** — `summary` is the display line; expanding payload diffs is later polish.
- **Infinite scroll** — link-based cursor pagination is sufficient until volume demands more.
- **Actor avatars / user profiles** — no users table yet; `actor` renders as plain text.
- **Search over events** — out of scope per slice-24 spec §2.

## 3. Components

### 3.1 `<ActivityList>` — `src/components/activity/ActivityList.tsx`

Hook-free presentational component:

```ts
type ActivityListProps = {
  events: ActivityEvent[];
  compact?: boolean;   // panel + customer-section mode: hide actor, tighter spacing
};
```

- Row: colored verb dot + `summary` + (non-compact) `actor` + `relativeTime(createdAt)` (reuse `src/lib/format/bids.ts`).
- Verb→dot color: `created`→emerald, `updated`→gold/amber, `deleted`/`bid_rejected`→rose, `bid_*`/`invited`/`joined`/`left`→sky, rest→zinc.
- Empty state: `text-xs text-zinc-500` — "No activity yet."
- No `"use client"` of its own (no hooks); it inherits client-bundle status when imported by `DashboardGrid`'s registry, and renders server-side on the RSC pages.

### 3.2 `<ActivityPanel>` — `src/components/dashboard/ActivityPanel.tsx`

Card following the `TodaysBidsPanel` visual conventions (`rounded border border-zinc-700 bg-zinc-900/40 p-3`, `h3` header). Renders `<ActivityList compact>` + footer link "View all →" to `/activity`.

Registry entry in `src/lib/layout/registry.tsx`: `id: "activity"`, `title: "Recent Activity"`, `defaultSize: 1`, `BusinessPlaceholder` fallback when `ctx.activity` is absent — same shape as `todays-bids`.

`PanelCtx` (`src/lib/layout/types.ts`) gains `activity?: { events: ActivityEvent[] }`.

Dashboard page server-fetches `getOrgActivity(db, orgId, { limit: 10 })` and threads through `DashboardGrid` exactly like `todaysBids`.

**Persisted-layout merge:** existing users have saved layouts that predate the `"activity"` id. The implementer MUST verify how the layout store handles registry ids missing from a saved layout (merge-in vs. invisible) and fix within scope if new panels don't appear.

## 4. `/activity` route — `src/app/(admin)/activity/page.tsx`

RSC page mirroring `/customers` (`force-dynamic`, `ensureDbReady`, `getCurrentOrgId`):

- `searchParams`: `type` (entity-type filter) and `before` (cursor, numeric id).
- Fetch: `getOrgActivity(db, orgId, { limit: 50, beforeId, entityTypes: type ? [type] : undefined })`.
- Filter chips as plain links: All / Customers / Deals / Inventory / Bids / Circles → `/activity?type=<entityType>` (chips preserve nothing else; changing filter resets the cursor).
- Pagination: when 50 rows returned, render "Older →" link to `/activity?type=<t>&before=<lastRowId>`. Zero client JS; URL is the state. First pagination UI in the codebase — sets the precedent.
- Invalid `type` (not in `ACTIVITY_ENTITY_TYPES`) is ignored (treated as All), invalid `before` ignored.
- Sidebar: "Activity" `NavItem` → `/activity` added to `Nav.tsx`.

## 5. Per-customer Activity section

In `/customers/[id]/edit/page.tsx`, after `<CustomerForm>`:

```tsx
<section className="mt-8">
  <h2 className="mb-2 text-sm font-semibold text-zinc-200">Activity</h2>
  <ActivityList compact events={events} />
</section>
```

with `events = await getEntityActivity(db, orgId, "customer", id, { limit: 20 })`. A section, not a tab system — the page is single-column `max-w-3xl` and one extra section doesn't justify tabs (YAGNI).

## 6. Test plan

- `test/components/activity/ActivityList.test.tsx` — rows render summary + actor + relative time; verb-dot class mapping (spot-check 3 verbs); empty state; compact hides actor.
- `test/components/dashboard/ActivityPanel.test.tsx` — renders events + "View all" link href.
- `test/app/activity-page.test.tsx` — mirror `circles-page.test.tsx` pattern: demo-mode render shows DEMO_ACTIVITY summaries; `type` filter narrows; `before` cursor excludes newer rows.
- Extend the customer edit page test (if one exists; otherwise add a focused one) asserting the Activity section renders demo events for customer 2201.
- Nav test: extend `test/components/dashboard/Nav.test.tsx` with an Activity-link assertion (same shape as the Customers-link test).

## 7. Decisions

- One shared `<ActivityList>` across all three surfaces — divergence later splits it, not before (DRY until proven otherwise).
- Link-based cursor pagination over client-side "load more" — zero JS, URL-state, mirrors the house RSC-first style.
- `relativeTime` reused from bids rather than a new i18n-grade formatter — consistency beats sophistication here.
- Verb-dot color mapping lives in `ActivityList` as a module-local function, not in `types.ts` — presentation concern, not domain.
