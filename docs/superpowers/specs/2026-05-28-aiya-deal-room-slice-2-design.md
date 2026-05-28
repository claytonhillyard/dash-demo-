# AIYA Dashboard — Slice 2: Deal Room (Browse + Post) — Design

**Date:** 2026-05-28
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market), #1a (AIYA dashboard + reskin), #2 (company data), #1b-1 (inventory), #1b-3 (diamond price lists), #1c (customizable layout), demo (Netlify simulation mode) — all shipped on `main`.

---

## 1. Overview & Goals

Replace the "TradeNet Exchange" `BusinessPlaceholder` on the main dashboard with a live **Deal Room** — a private circle where AIYA's team can post and browse buy/sell offers on diamonds, gems, metals, and finished pieces, and mark their own deals as filled or withdrawn. This slice ships the minimum viable cut: one implicit circle per org (AIYA = `org_id 1`), no real bidding, no invitations, no multi-org membership. The result is a usable, honest, org-scoped deal board with a dashboard summary panel, a full `/deals` admin page, and honest demo-mode seeded data — all wired into the existing `run()` wrapper, `AIYA_ORG_ID` tenancy seam, `PanelCtx` / registry layout system, and pglite test infrastructure without touching any prior subsystem.

**Goals:**

- Persistent `deals` table (Drizzle, org-scoped, integer cents, text enums — consistent with every prior business table).
- Post a deal: kind (BUY/SELL), category (Diamond/Gem/Metal/Finished/Other), subject text (max 280 chars), quantity, ask/bid price in cents.
- List active deals in the org's circle; filter by status, kind, and category on the admin page.
- Mark deals as Withdrawn or Filled (terminal states).
- "Deal Room" dashboard panel: latest 5 Open deals with kind badge, price, relative age, and a "View all" link. Replaces the existing `tradenet-exchange` `BusinessPlaceholder` entry in the registry — the panel `id` is preserved so existing persisted user layouts upgrade transparently.
- `/deals` admin page: full list with filter chips, "Post new deal" inline form.
- Demo mode: 5 seeded deals across categories, read-only, subjects include "— demo · simulated" suffix for honest inline provenance.
- TDD: Zod unit tests, action round-trips against pglite via the `shared-db` helper, tenancy isolation test, demo-mode short-circuit test.

**Non-Goals for Slice 2** (each has a named future slice home — see §10):

Multi-org circle membership, real bidding, invitation tokens, real-time updates, KYC, escrow, deal expiry, file attachments, AI pricing suggestions, push notifications, audit log table, rate limiting, full `orgs` table, per-user row ownership enforcement.

---

## 2. Data Model

### 2.1 New table: `deals`

One table, `deals` (Drizzle `pgTable`; integers for money; text columns with Zod enum enforcement — no pg-level `ENUM` type):

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `org_id` | integer NOT NULL default 1 | Tenancy seam — `AIYA_ORG_ID`. `currentOrgId()` seam applies when multi-tenant slice lands. |
| `kind` | text NOT NULL | `BUY` \| `SELL` |
| `category` | text NOT NULL | `Diamond` \| `Gem` \| `Metal` \| `Finished` \| `Other` |
| `subject` | text NOT NULL | Free-text lot description; max 280 chars; trimmed at Zod boundary. |
| `quantity` | integer NOT NULL default 1 | Positive integer (pieces, carats, grams — unit is implicit in the subject). |
| `price_cents` | integer NOT NULL | Ask (SELL) or bid (BUY) in USD cents; non-negative; integer ceiling ~$21.4M per row. |
| `currency` | text NOT NULL default `'USD'` | ISO 4217; only USD wired this slice; column present for future multi-currency. |
| `status` | text NOT NULL default `'Open'` | `Open` \| `Filled` \| `Withdrawn` |
| `posted_by_label` | text NOT NULL | JWT `session.user` string at posting time; display label only — no `users` table yet. |
| `created_at` | timestamptz default now NOT NULL | |
| `updated_at` | timestamptz default now NOT NULL | |

**`integer` for `price_cents` rationale:** Every prior business table uses `integer` for cents values (`unit_cost_cents`, `retail_price_cents`, `price_per_carat_cents`, `amount_cents`). The ceiling (~$21.4M per lot) covers individual deal entries. Diverging to `bigint` for this table alone would fracture the schema convention for a marginal gain; a future migration can widen the column if bulk-parcel pricing demands it. This is a documented trade-off.

**Text enums rationale:** Matches `inventory_items.category`, `inventory_items.status`, `inventory_items.metal`, `diamondMatrixPrices.sheet`, and all other prior enum-style columns. Avoids `ALTER TYPE` DDL when the enum expands; Zod enforces the constraint at the action boundary.

### 2.2 Indexes

```sql
-- Panel + list: open deals for an org, newest first
CREATE INDEX deals_org_status_created_idx ON deals (org_id, status, created_at DESC);

-- Admin filter: by kind
CREATE INDEX deals_org_kind_idx ON deals (org_id, kind);

-- Admin filter: by category
CREATE INDEX deals_org_category_idx ON deals (org_id, category);
```

### 2.3 Tenancy seam

Every query/mutation uses `and(eq(deals.orgId, AIYA_ORG_ID), ...)`. When the multi-tenant slice lands, `AIYA_ORG_ID` is replaced by `currentOrgId()` from `src/db/org.ts` — a single-seam substitution with no schema change. This is the identical convention used by every prior business table.

### 2.4 Migration

Generated by `npm run db:generate` after adding `deals` to `src/db/schema.ts`. Lands in `drizzle/0003_*.sql` with `CREATE TABLE deals ...` and the three `CREATE INDEX` statements. The pglite migrator in `getSharedDb()` and `ensureDbReady()` applies it automatically on next boot.

---

## 3. Server Layer

### 3.1 Constants — `src/lib/deals/constants.ts`

```typescript
export const DEAL_KINDS      = ["BUY", "SELL"] as const;
export const DEAL_CATEGORIES = ["Diamond", "Gem", "Metal", "Finished", "Other"] as const;
export const DEAL_STATUSES   = ["Open", "Filled", "Withdrawn"] as const;
export type DealKind     = (typeof DEAL_KINDS)[number];
export type DealCategory = (typeof DEAL_CATEGORIES)[number];
export type DealStatus   = (typeof DEAL_STATUSES)[number];
```

### 3.2 Validation — `src/lib/deals/validation.ts`

```typescript
export const postDealInput = z.object({
  kind:       z.enum(DEAL_KINDS),
  category:   z.enum(DEAL_CATEGORIES),
  subject:    z.string().min(1, "subject is required").max(280).trim(),
  quantity:   z.number().int().min(1),
  priceCents: z.number().int().min(0),
  currency:   z.string().length(3).optional().default("USD"),
});
export type PostDealInput = z.infer<typeof postDealInput>;

export const updateDealStatusInput = z.object({
  id:     z.number().int(),
  status: z.enum(["Filled", "Withdrawn"]),  // narrowed — Open is only the initial state
});
export type UpdateDealStatusInput = z.infer<typeof updateDealStatusInput>;

export { firstZodError } from "@/lib/company/validation";
```

`status` on update is narrowed to terminal states only. You cannot re-open a Filled or Withdrawn deal in this slice — that would require an audit trail (slice 2g). The restriction is documented and enforced at the Zod boundary so the DB never needs to enforce it.

### 3.3 Actions — `src/lib/deals/actions.ts`

`"use server"`. Follows the `run()` wrapper pattern from `src/lib/inventory/actions.ts` exactly.

**Test seam:**
```typescript
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> { testDb = db; }
function db(): Db { return testDb ?? getDb(); }
```

**`run<T>()` wrapper (standard):**
1. `if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" }`
2. `await requireSession()` — throws "Unauthorized" if absent/invalid; caught and returned.
3. `schema.safeParse(raw)` — returns Zod error on failure.
4. `fn(parsed.data)` — the mutation.
5. `revalidatePath("/")` + `revalidatePath("/deals")`.
6. Catch DB errors: `console.error("[deals action] database error:", e)` → `{ ok: false, error: "Database error" }`.

**`runWithUser<T>()` (local, for `postDeal`):** a variant that resolves the session first, validates, then calls `fn(input, session.user)` — so the `postedByLabel` is available inside the insert without a second `requireSession()` call. Not exported.

**`postDeal(raw: unknown): Promise<ActionResult>`** — uses `runWithUser`. Inserts a row with `orgId: AIYA_ORG_ID`, `postedByLabel: session.user`. Console-logs: `[deals] posted deal id=${id} kind=${kind} category=${category} by=${postedByLabel}`.

**`updateDealStatus(raw: unknown): Promise<ActionResult>`** — uses `run`. Updates `status` and `updatedAt` where `id = input.id AND orgId = AIYA_ORG_ID`. Console-logs: `[deals] deal id=${id} status changed to ${status}`.

**`withdrawDeal(id: number): Promise<ActionResult>`** — uses `run(z.number().int(), id, ...)`. Convenience wrapper that calls `updateDealStatus` logic directly. Console-logs: `[deals] deal id=${id} withdrawn`.

**Note on per-user ownership:** `updateDealStatus` and `withdrawDeal` do not check `postedByLabel` because there is currently one shared auth credential per org and no `users` table. When per-user auth lands, add `AND posted_by_user_id = currentUser.id` here. This gap is documented and is the expected state for this slice.

### 3.4 Queries — `src/lib/deals/queries.ts`

Not server actions — called from RSC pages.

```typescript
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
  status?:   DealStatus;
  kind?:     DealKind;
  category?: DealCategory;
}
```

**`getActiveDeals(db: Db, orgId: number, limit = 5): Promise<DealRow[]>`** — selects `status = 'Open'`, ordered `created_at DESC`, limited to `limit`. Demo guard: `if (isDemoMode()) return getSeedDeals().slice(0, limit)`.

**`getAllDeals(db: Db, orgId: number, filters?: DealFilters): Promise<DealRow[]>`** — selects all statuses, ordered `created_at DESC`, with optional Drizzle `and()` filter composition. Demo guard: `if (isDemoMode()) return getSeedDeals()` (full list; caller applies its own filter UI).

### 3.5 Demo seed — extend `src/lib/demo/seed.ts`

Add `getSeedDeals(): DealRow[]` with 5 fixed entries:

| id | kind | category | subject | qty | priceCents | status |
|---|---|---|---|---|---|---|
| 101 | SELL | Diamond | Round 1.02ct G/VS1 natural — demo · simulated | 1 | 1240000 | Open |
| 102 | BUY | Metal | 18K gold chain lot, 10g per link — demo · simulated | 5 | 875000 | Open |
| 103 | SELL | Gem | Colombian emerald 3.4ct, Gübelin cert — demo · simulated | 1 | 3400000 | Open |
| 104 | SELL | Finished | Platinum diamond tennis bracelet — demo · simulated | 1 | 2250000 | Filled |
| 105 | BUY | Diamond | Lab 2ct F/VVS2 any shape — demo · simulated | 3 | 620000 | Open |

`createdAt` values are fixed offsets (e.g. `new Date(REFERENCE - 2 * 3600 * 1000)`) so relative age labels render plausibly. `id` values start at 101 to avoid collision with real rows in any test context. `postedByLabel` = `"demo-user"`.

---

## 4. UI Layer

### 4.1 Dashboard panel — `src/components/dashboard/DealRoomPanel.tsx`

Server-compatible (no `"use client"`). Receives pre-fetched `deals: DealRow[]` from `PanelCtx`.

Uses the existing `Panel` primitive:
- `state="empty"` + honest message when `deals.length === 0`.
- `state="ready"` + a list of rows when deals are present.
- Header `action` slot: `<Link href="/deals">View all</Link>` (small muted text, `text-[10px]`).

Each row renders: kind badge (BUY in ok/teal, SELL in gold, fixed CSS class lookup — no user input in `className`), category muted label, subject truncated to one line as plain text (`{deal.subject}` — no `dangerouslySetInnerHTML`), `formatCents(deal.priceCents)`, `timeAgo(deal.createdAt)`.

### 4.2 Admin page — `src/app/(admin)/deals/page.tsx`

RSC, `export const dynamic = "force-dynamic"`. Mirrors `src/app/(admin)/inventory/page.tsx` structure. Reads `searchParams` to extract filter values, calls `getAllDeals(db, AIYA_ORG_ID, filters)`, renders `DealsAdmin` client component. Inline `DemoNotice` component when `isDemoMode()`.

URL filter params: `?status=Open`, `?kind=BUY`, `?category=Diamond` — composable, linkable, stateless.

### 4.3 Post Deal form — `src/components/deals/PostDealForm.tsx`

`"use client"`. Controlled state fields for all inputs. `async function submit(e: React.FormEvent)` calls `postDeal(raw)`. Dollar input converted to cents via `Math.round(Number(dollars) * 100)`. Surfaces `FormStatus` for errors and success. Calls `router.refresh()` on success and clears form fields.

### 4.4 Deal list — `src/components/deals/DealList.tsx`

`"use client"`. Accessible table with `role="table"`, `role="columnheader"`, `role="row"`, `role="cell"`. Columns: Kind | Category | Subject | Qty | Price | Status | Posted by | Age | Actions.

Actions: "Withdraw" and "Mark Filled" buttons for `Open` deals (calls `withdrawDeal(id)` / `updateDealStatus({ id, status: "Filled" })`). Simple `window.confirm` guard before mutation. After success: `router.refresh()`. Errors surface via inline `FormStatus`.

XSS: `deal.subject` rendered as `{deal.subject}` inside `<td>`. Kind badges and status pills use a lookup object (`const kindClass: Record<DealKind, string> = { BUY: "text-ok", SELL: "text-gold" }`) — no user string interpolated into `className`.

### 4.5 New helper — `timeAgo` in `src/lib/company/format.ts`

```typescript
export function timeAgo(date: Date, now: number = Date.now()): string {
  const diffMs = now - date.getTime();
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}
```

Accepts an optional `now` parameter for deterministic testing.

### 4.6 `DemoNotice` — `src/components/deals/DemoNotice.tsx`

```typescript
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

Styled to match the shell `DemoBanner` aesthetic.

### 4.7 Registry + `PanelCtx` + page wiring

**`src/lib/layout/types.ts`** — add `DealView` and extend `PanelCtx`:
```typescript
export interface DealView { deals: DealRow[]; }
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;   // added this slice
}
```

**`src/lib/layout/registry.tsx`** — the `tradenet-exchange` entry's `render` function is replaced; `title` is updated to "Deal Room"; the `id` string is preserved so user-persisted localStorage layouts transparently activate:
```typescript
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

**`src/app/page.tsx`** — add `getActiveDeals(db, AIYA_ORG_ID, 5)` to the `Promise.all`, pass result as `deals={{ deals: activeDeals }}` into `DashboardGrid`.

**`src/app/DashboardGrid.tsx`** — accept `deals?: DealView` prop; include in the `useMemo(() => ({ inventory, diamond, deals }), ...)` ctx.

**`src/components/dashboard/Nav.tsx`** — add `"Orders & Deals": "/deals"` to the `ROUTES` record.

**`src/middleware.ts`** — add `"/deals"` to the `matcher` array.

---

## 5. Demo Mode

| Area | Demo behavior |
|---|---|
| `getActiveDeals` | Returns `getSeedDeals().slice(0, limit)` — no DB call. |
| `getAllDeals` | Returns `getSeedDeals()` — no DB call. |
| `postDeal` | `run()` short-circuits before `requireSession` or DB: `{ ok: false, error: "Demo mode — changes are disabled" }`. |
| `updateDealStatus` | Same short-circuit. |
| `withdrawDeal` | Same short-circuit. |
| Dashboard panel | Renders first 5 seeded deals via `PanelCtx.deals`. |
| `/deals` page | Renders full seeded list; `DemoNotice` visible; form submissions surface the disabled error via `FormStatus`. |
| Provenance | Seeded subjects include "— demo · simulated" suffix; shell `DemoBanner` + page `DemoNotice` frame the page context. |

---

## 6. Security & Threat Model

### 6.1 Authentication

Every server action goes through `requireSession()` inside `run()` as defense in depth (re-assertion even though the middleware also guards the route). The `/deals` page is behind the middleware matcher — unauthenticated requests are redirected to `/login` before the RSC runs. In demo mode, middleware bypasses auth (existing behavior); the seeded page is publicly accessible as intended.

### 6.2 Authorization

Every query and mutation applies `and(eq(deals.orgId, AIYA_ORG_ID), ...)`. There is currently no per-user row ownership check — the single shared credential means all org members see and can update all org deals. This is the known state; per-user enforcement (adding `WHERE posted_by_user_id = currentUser.id` on update/withdraw) requires a `users` table and is explicitly deferred. The `postedByLabel` column is a display-only breadcrumb for now and becomes a foreign key lookup when the users table lands.

### 6.3 Input Validation

Zod enforces all constraints at the action boundary before any DB call:
- `subject`: `.min(1).max(280).trim()` — required, capped at 280 chars, whitespace-stripped.
- `priceCents`: `.int().min(0)` — non-negative integer; no floats, no negatives.
- `quantity`: `.int().min(1)` — at least 1.
- `kind`, `category`, `status`: `.enum(...)` — exact enum values only; any unknown value produces a typed `firstZodError` string returned to the UI.
- `currency`: `.length(3)` — three-character ISO code; only "USD" appears in the UI this slice.

### 6.4 XSS

Deal subjects are rendered as `{deal.subject}` inside JSX at every call site. React escapes the value as text content. No `dangerouslySetInnerHTML` is used anywhere in the deals UI. Tailwind class injection from user input is impossible: the kind badge and status pill CSS classes are selected from a finite local lookup object keyed on Zod enum values — no user string is ever interpolated into a `className` expression.

### 6.5 CSRF

Next.js 15 server actions verify the `Origin` header against the application host on all `POST` requests to the action endpoint. No additional CSRF token mechanism is required. If the deployment ever sits behind a CDN or reverse proxy that rewrites `Origin`, this must be re-evaluated.

### 6.6 Audit Logging (console only)

Every successful mutation emits `console.log` with `[deals]` prefix:
- `postDeal`: `[deals] posted deal id=N kind=X category=Y by=Z`
- `updateDealStatus`: `[deals] deal id=N status changed to X`
- `withdrawDeal`: `[deals] deal id=N withdrawn`

This is not a real audit trail — it is discoverable in server logs only. A proper `deal_audit_log` table is planned for slice 2g and must not be deferred past the point where multi-org circles or real bidding ship.

### 6.7 Rate Limiting

Not implemented. Flagged for slice 2g. The `postDeal` action is the primary surface to protect — a misbehaving user could flood the org's deal board. Recommended future approach: sliding-window rate limiter keyed on `session.user` enforced at the middleware or action boundary.

### 6.8 Data Integrity

No foreign key from `deals.org_id` to an `orgs` table — consistent with `inventory_items`, `diamond_matrix_prices`, and all other business tables. The constraint is application-enforced via `AIYA_ORG_ID`. A proper FK constraint arrives with the multi-tenant slice.

---

## 7. Testing (TDD)

All new test files use `// @vitest-environment node`, `vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))`, `vi.mock("@/lib/auth/requireSession", () => ({ requireSession: vi.fn(async () => ({ user: "boss" })) }))`, and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` / `__setTestDb` pattern from `test/helpers/shared-db.ts`.

### 7.1 `test/lib/deals/validation.test.ts`

- `postDealInput` accepts valid BUY/SELL across all categories.
- Rejects empty `subject`, `subject` over 280 chars, negative `priceCents`, non-integer `priceCents`, zero `quantity`, unknown `kind`, unknown `category`.
- Trims leading/trailing whitespace from `subject`.
- `updateDealStatusInput` accepts `Filled` and `Withdrawn`.
- `updateDealStatusInput` rejects `Open` (not a valid update target — only the insert sets `Open`).
- `firstZodError` returns a human-readable string for each rejection path.

### 7.2 `test/lib/deals/actions.test.ts`

- `postDeal` inserts a row; `getActiveDeals` returns it.
- `postDeal` rejects invalid input with `{ ok: false, error: "subject: ..." }`.
- `postDeal` returns `{ ok: false, error: "Demo mode — changes are disabled" }` when `NEXT_PUBLIC_DEMO_MODE=true` (set in `beforeEach` via `process.env`).
- `postDeal` returns `{ ok: false, error: "Unauthorized" }` when `requireSession` rejects.
- `updateDealStatus` to `Filled` on an Open deal: row shows `status = 'Filled'`.
- `updateDealStatus` to `Withdrawn` on an Open deal: row shows `status = 'Withdrawn'`.
- `withdrawDeal` on an Open deal: row shows `status = 'Withdrawn'`.
- Demo guard on `updateDealStatus` and `withdrawDeal`: same short-circuit.
- `revalidatePath` called after each successful mutation (assert via `vi.mocked`).

### 7.3 `test/lib/deals/queries.test.ts`

- `getActiveDeals` returns only `Open` deals, ordered newest-first.
- `getActiveDeals` respects the `limit` parameter.
- `getActiveDeals` returns `[]` on an empty table — no throws, no fake rows.
- `getAllDeals` returns all statuses when no filter supplied.
- `getAllDeals` filtered by `{ status: "Filled" }` returns only Filled rows.
- `getAllDeals` filtered by `{ kind: "BUY" }` returns only BUY rows.
- `getAllDeals` filtered by `{ category: "Diamond" }` returns only Diamond rows.
- Demo mode: `getActiveDeals` returns seed slice without DB access (`process.env.NEXT_PUBLIC_DEMO_MODE=true` in the test; assert that the returned subjects contain "demo · simulated").
- Demo mode: `getAllDeals` returns full seed without DB access.
- **Tenancy isolation:** insert one deal via `db.insert` with `orgId = 1`, one with `orgId = 2`. `getActiveDeals(db, 1)` returns only the `orgId = 1` row; `getActiveDeals(db, 2)` returns only the `orgId = 2` row.

### 7.4 `test/components/dashboard/DealRoomPanel.test.tsx`

- Renders BUY and SELL kind badges.
- Renders `deal.subject` as plain text (assert `textContent`, not raw HTML).
- XSS assertion: subject `"<script>alert(1)</script>"` renders as the literal string in `textContent`, not as an executable tag in `innerHTML`.
- Renders `formatCents` price.
- Renders empty state when `deals = []`.
- "View all" link has `href="/deals"`.

### 7.5 `test/lib/company/format.test.ts` (extend)

- `timeAgo` with `diffMs < 60s` → `"just now"`.
- `timeAgo` with 15 minutes → `"15m ago"`.
- `timeAgo` with 3 hours → `"3h ago"`.
- `timeAgo` with 2 days → `"2d ago"`.
- `timeAgo` with 8 days → formatted short date string.
- Determinism: pass explicit `now` parameter so tests never depend on `Date.now()`.

### 7.6 `test/lib/demo/seed.test.ts` (extend)

- `getSeedDeals()` returns exactly 5 rows.
- All rows have valid `kind`, `category`, `status` (matching the const arrays).
- All `subject` strings contain the substring `"demo · simulated"`.
- All `priceCents >= 0`, `quantity >= 1`.
- `createdAt` is a `Date` instance.

---

## 8. File Plan

### New files

| Path | Purpose |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/constants.ts` | `DEAL_KINDS`, `DEAL_CATEGORIES`, `DEAL_STATUSES`, derived types |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/validation.ts` | `postDealInput`, `updateDealStatusInput`, `firstZodError` re-export |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/actions.ts` | `"use server"`: `postDeal`, `updateDealStatus`, `withdrawDeal`, `__setTestDb` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/queries.ts` | `getActiveDeals`, `getAllDeals`, `DealRow`, `DealFilters` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/DealRoomPanel.tsx` | Dashboard summary panel (server-compatible) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/deals/PostDealForm.tsx` | `"use client"` create-deal form |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/deals/DealList.tsx` | `"use client"` table with withdraw/fill actions |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/deals/DemoNotice.tsx` | Slim demo-mode banner for admin pages |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/deals/page.tsx` | RSC admin page at `/deals` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/drizzle/0003_*.sql` | Generated migration: `deals` table + 3 indexes |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/deals/validation.test.ts` | Zod schema tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/deals/actions.test.ts` | Action round-trip + demo + auth tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/deals/queries.test.ts` | Read function tests + tenancy isolation |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/dashboard/DealRoomPanel.test.tsx` | Panel render tests incl. XSS assertion |

### Modified files

| Path | Change |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/schema.ts` | Add `deals` `pgTable` definition |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/demo/seed.ts` | Add `getSeedDeals(): DealRow[]` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/types.ts` | Add `DealView`; extend `PanelCtx` with `deals?: DealView` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/registry.tsx` | Update `tradenet-exchange` entry: new `title` + `render` fn; import `DealRoomPanel` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/page.tsx` | Fetch `getActiveDeals`; pass `deals` into `DashboardGrid` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/DashboardGrid.tsx` | Accept + include `deals?: DealView` in `ctx` memo and props |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/Nav.tsx` | Add `"Orders & Deals": "/deals"` to `ROUTES` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/middleware.ts` | Add `"/deals"` to `matcher` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/company/format.ts` | Add `timeAgo(date, now?)` helper |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/demo/seed.test.ts` | Add `getSeedDeals()` assertions |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/company/format.test.ts` | Add `timeAgo` tests |

---

## 9. Migration Plan

1. Add the `deals` `pgTable` definition to `src/db/schema.ts`.
2. Run `npm run db:generate` — Drizzle Kit diffs the schema and emits `drizzle/0003_*.sql`.
3. Inspect the generated SQL: verify table name `deals`, all columns present, integer type for `price_cents`, three `CREATE INDEX` statements present.
4. Local pglite (`getSharedDb`, `ensureDbReady`) applies the migration automatically on next boot — no manual step.
5. Neon (prod): run `npm run db:migrate` before deploying the new code.
6. Rollback: the migration is additive only — `DROP TABLE deals CASCADE` is a safe rollback with no effect on any prior table.

---

## 10. Out of Scope (Explicit)

| Feature | Assigned to |
|---|---|
| Multi-org circle membership | Slice 2c — Circles |
| Real bidding / counter-offers | Slice 2d — Bids |
| Invitation tokens / public share links | Slice 2e — Invitations |
| Real-time deal updates (WebSocket / SSE) | Slice 2f — Live |
| KYC / identity verification | TBD |
| Escrow / payment integration | TBD |
| Deal expiry / time-to-live | Slice 2c+ |
| File or image attachments | Enrichment slice |
| AI-assisted pricing suggestions | AI slice |
| Push notifications | Notifications slice |
| Audit log table (`deal_audit_log`) | Slice 2g |
| Rate limiting on `postDeal` | Slice 2g |
| Full `orgs` table and per-user org resolution | Multi-tenant slice |
| Per-user row ownership enforcement on update/withdraw | Requires `users` table (multi-tenant slice) |
| Orders & Pipeline wiring | Slice 1b-2 |
| TradeNet Exchange full multi-org network | Slice 2c+ |

