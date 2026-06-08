# iDesign Command Center — Code Audit (Shell vs Module Map)

**Last updated:** 2026-06-07
**Purpose:** File-by-file inventory of the current codebase classifying every file as **core** (shell) or **module** (AIYA jewelry).
**Use:** Before editing any file, check this map. If you're adding to a "core" file with jewelry-specific logic, stop and put it in the module instead.

**Repo file count (`src/**`):** 160 TS/TSX files as of audit.

---

## Legend

- ✅ **core** — generic shell, no industry assumptions, stays in `src/`
- 🔶 **aiya-jewelry** — vertical-specific, target home `src/modules/aiya-jewelry/` (currently still in `src/`)
- 🤔 **borderline** — has jewelry flavor but the primitive is generic; refactor when touched
- 🧹 **needs split** — file mixes core + module concerns; refactor required

---

## Top-level

| File | Classification | Notes |
|---|---|---|
| `src/middleware.ts` | ✅ core | Auth gating + CSP. No vertical assumptions. |
| `src/instrumentation.ts` | ✅ core | Sentry init. |
| `src/app/layout.tsx` | ✅ core | App shell layout. |
| `src/app/page.tsx` | 🤔 borderline | Dashboard root. Currently routes to AIYA-flavored panels by default. Future: routes by tenant's `module_id`. |

## `src/app/(admin)/` — routes

| Route | Classification | Target after refactor |
|---|---|---|
| `(admin)/circles/*` | ✅ core | Cross-org sharing primitive |
| `(admin)/company/*` | ✅ core | KPI admin pages (revenue, profit, clients, employees, projections) |
| `(admin)/deals/*` | ✅ core | Deal Room mechanic |
| `(admin)/diamonds/*` | 🔶 aiya-jewelry | Move to `/m/aiya-jewelry/diamonds` (slice C-2 / Phase M3) |
| `(admin)/exchange/*` | 🤔 borderline | Cross-circle TradeNet inventory — primitive is generic, current naming is jewelry-flavored |
| `(admin)/inventory/*` | ✅ core | Inventory mechanic (categories will be module-driven post C-1) |
| `(admin)/website/*` | ✅ core | Website snapshots (analytics intake) |
| `api/diamond-history` | 🔶 aiya-jewelry | Move under `/m/aiya-jewelry/api/` |
| `api/quotes`, `api/history`, `api/convert`, `api/login`, `api/logout` | ✅ core | Generic |

## `src/db/` — database layer

| File | Classification | Notes |
|---|---|---|
| `client.ts` | ✅ core | Drizzle connection (pglite/Neon). |
| `schema.ts` | 🧹 needs split | Mixed: orgs/users/customers/deals/bids/etc are core. `diamondPrices` is jewelry. After Phase M2: split into `src/db/schema.ts` (core) + `src/modules/aiya-jewelry/db/schema.ts` (jewelry). |
| `dashboard.ts` | ✅ core | KPI projections + metrics queries |
| `metrics.ts` | ✅ core | Metric projections |
| `queries.ts` | ✅ core | Generic dashboard queries |
| `inventory.ts` | ✅ core | Generic inventory CRUD (category enum becomes module-provided) |
| `inventoryBids.ts` | ✅ core | Generic bidding on inventory |
| `bids.ts` | ✅ core | Bids on deals (generic) |
| `dealMessages.ts` | ✅ core | Reply threads (generic) |
| `dealAttachments.ts` | ✅ core | Attachment query layer (generic) |
| `diamonds.ts` | 🔶 aiya-jewelry | Diamond price matrix queries — move to `src/modules/aiya-jewelry/db/diamonds.ts` |
| `website.ts` | ✅ core | Website analytics queries |

## `src/lib/` — business logic

### Core libraries

| File | Classification |
|---|---|
| `lib/auth/*` | ✅ core |
| `lib/circles/*` | ✅ core |
| `lib/deals/*` | ✅ core |
| `lib/demo/*` | 🧹 needs split | The seed file (`seed.ts`) currently mixes core fixtures + AIYA jewelry inventory/deals. After M5: core seed in `lib/demo/seed.ts`, AIYA seed in `modules/aiya-jewelry/demo.ts`. |
| `lib/format/*` | ✅ core |
| `lib/inventory/*` | ✅ core |
| `lib/layout/*` | ✅ core |
| `lib/market/*` | ✅ core |
| `lib/company/*` | ✅ core |
| `lib/observability/*` | ✅ core |
| `lib/storage/*` | ✅ core |
| `lib/website/*` | ✅ core |

### Module-flavored libraries

| File | Classification | Target |
|---|---|---|
| `lib/diamonds/*` | 🔶 aiya-jewelry | `src/modules/aiya-jewelry/lib/diamonds/` |

## `src/components/` — UI components

### ✅ Core components (stay in `src/components/`)

- `Panel.tsx`, `FreshnessDot.tsx` (panel primitives)
- `circles/*` (cross-org sharing UI)
- `company/*` (KPI admin UI: Revenue, Profit, Clients, Employees, Projections)
- `converter/*` (Unit Converter)
- `dashboard/*` — most of these are shell + grid + customization; with two exceptions noted below
- `deals/*` (Deal Room UI: list, attachments, threads, bids, post form)
- `inventory/*` (Inventory UI — categories will become module-provided)
- `market/*` (live market data)
- `observability/*` (Web Vitals reporter)
- `website/*` (website analytics admin)

### 🔶 AIYA jewelry components (move to `src/modules/aiya-jewelry/components/`)

- `diamonds/*` — DiamondAdmin and diamond price matrix UI
- `dashboard/TradeNetInventoryPanel.tsx` — **🤔 borderline.** Cross-circle inventory sharing is a generic primitive but the panel's framing today is jewelry-trade ("TradeNet"). Recommendation: rename to `CrossCircleInventoryPanel`, keep core; if jewelry-specific copy creeps in, split into a module sub-component.

### 🤔 Borderline — pay attention when touching

- `dashboard/DealRoomPanel.tsx` — generic shell of deal-room; category labels are jewelry-flavored via `deals.category`. Becomes pure-core once C-1 lands.
- `dashboard/TodaysBidsPanel.tsx` — generic. No jewelry assumptions.

## `src/app/(admin)/<route>/page.tsx` — RSC pages

All current RSC pages are ✅ core except `(admin)/diamonds/page.tsx` → 🔶 aiya-jewelry.

## `src/hooks/`, `src/store/`

All ✅ core (settings, quotes, layout state).

---

## Database schema audit

### ✅ Core tables (current schema)

- `orgs`, `users`, `org_users`
- `circles`, `circle_members`, `circle_invites`
- `inventory_items`, `inventory_bids`
- `deals`, `deal_messages`, `deal_attachments`, `bids`
- `customers` (slice 22 — Phase A pending)
- `metrics`, `revenue_txns`, `clients`, `employees`, `projection_overrides`
- `website_snapshots`
- `users_layout` (panel preferences)

### 🔶 AIYA jewelry tables (move under module's prefix)

- `diamond_prices` — rename to `aiya_jewelry_diamond_prices` (Phase M4 / cleanup slice C-4)

### Migration impact

Renaming `diamond_prices` requires:
1. Migration (`ALTER TABLE diamond_prices RENAME TO aiya_jewelry_diamond_prices`)
2. Code refactor: update queries + UI imports
3. Demo seed update
4. ~1-2 hours of work + tests, but no breaking changes for active users

Defer until Phase 3 of the WinJewel migration arc — bundle with other module-extraction work.

---

## Categories audit

Two places where the DB encodes a jewelry assumption today:

### `inventory_items.category` (text)

Current accepted values (from app boundary Zod):
- `Ring`, `Necklace`, `Earring`, `Bracelet`, `Pendant`, `Chain`, `Watch Band`, `Diamond`, `Gem`, `Other`

After C-1 (`tenant_categories` table) + manifest-provided list:
- AIYA module manifest provides the same list
- Core schema stores raw text
- App boundary validates against the active module's category list
- Switching modules doesn't need DB migration; only the validation boundary changes

### `deals.category` (text)

Current accepted values (from Zod):
- `Diamond`, `Gem`, `Metal`, `Finished`, `Other`

Same treatment as above.

---

## Worktree state (what's uncommitted)

Run before claiming a slice:
```bash
git worktree list
ls .worktrees/
```

As of this audit:
- `.worktrees/slice-22-customers/` — Phase A committed locally, NOT merged. Schema + 0015 migration + query layer. Layer: **core** (`customers` table).
- All other slices through #20 → main.

---

## Refactor backlog (cleanup slices)

These are in `docs/ROADMAP.md` §9 as the C-series. Listed here with the file-level impact so the implementer can scope quickly.

### C-1 — `orgs.module_id` column + `getActiveModule()` helper

- New: `src/modules/_kit/types.ts` (the `ModuleManifest` type)
- New: `src/modules/registry.ts` (empty)
- New: `src/lib/modules/active.ts` (helper)
- Edit: `src/db/schema.ts` (+ migration)
- Edit: `src/lib/auth/session.ts` (load `moduleId` into session context)
- Tests: validation + auth coverage

**Size:** ~3 files new, ~3 files edited, 1 migration, ~30 lines test. Small.

### C-2 — Extract AIYA jewelry components

Move from `src/components/diamonds/*` → `src/modules/aiya-jewelry/components/diamonds/*`. Update imports. Add `manifest.panels` entries.

**Size:** 5-6 files moved, ~15 import updates. Mechanical.

### C-3 — Move `/diamonds` to `/m/aiya-jewelry/diamonds`

Move `src/app/(admin)/diamonds/*` → `src/app/m/aiya-jewelry/diamonds/*`. Add redirect.

**Size:** 4-5 files moved, 1 redirect rule, 1 sidebar nav update.

### C-4 — Module-provided category enums

Implement `manifest.categories` consumption + app-boundary Zod refactor.

**Size:** Edits to `lib/deals/validation.ts`, `lib/inventory/validation.ts`. Tests covering category-switching. ~2 hours.

### C-5 — Split demo seed

Refactor `src/lib/demo/seed.ts` to expose ONLY generic fixtures (orgs, users, circles, KPI metrics, generic deals). Move AIYA-flavored inventory + diamond prices + jewelry-categorized deals to `src/modules/aiya-jewelry/demo.ts`.

**Size:** 1 file split, ~1 hour. Hold until C-1 lands so the merging mechanism exists.

---

## Acceptance criteria for "the audit is done"

When all 5 cleanup slices ship:
- [ ] `find src -type d -name aiya-jewelry` returns `src/modules/aiya-jewelry`
- [ ] `find src -name diamond*` returns ONLY files under `src/modules/aiya-jewelry/`
- [ ] `grep -r "Diamond\|Ring\|Necklace" src/lib/` returns zero hits in core lib files (other than tests with explicit AIYA test fixtures)
- [ ] `getActiveModule()` returns the AIYA manifest when seeded as AIYA tenant; returns `null` when seeded as a "demo CPG" tenant
- [ ] Core test suite passes with `MODULES = {}` (no modules registered)
- [ ] Demo deploy renders the bare core when `module_id = null`

When those all green, the boundary is real and future verticals are tractable.

---

## Cross-tab coordination during refactors

The C-series slices touch files both tabs frequently edit. Before claiming any of them:

1. Edit `docs/ROADMAP.md` §9 to mark `Owner: this-tab`
2. Push that edit BEFORE starting the refactor
3. Work in a worktree (`.worktrees/slice-C-N`)
4. Keep the worktree branch short-lived — these are mechanical, ship same day if possible
5. The other tab can keep building feature slices in parallel; merge order: feature slices first (they have content), refactors second (they only move files)

If a refactor blocks a feature slice (e.g. the feature wants to add a panel that should live in the module dir but the module dir doesn't exist yet), ship C-1 first, then unblock.
