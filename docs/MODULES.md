# iDesign Command Center — Module Architecture

**Last updated:** 2026-06-07
**Status:** Aspirational target. Codebase is migrating toward this shape; see `docs/CODE_AUDIT.md` for current vs target file layout.

This is the **technical contract** between the shell and any module. Read this before:
- Designing a feature that might be vertical-specific
- Adding a new top-level route
- Adding a new sidebar nav item
- Adding a new database column with an industry-flavored name (e.g. `diamond_grade`)
- Hardcoding a category enum

---

## 1. Mental model

```
┌─────────────────────────────────────────────────────────────┐
│                    iDesign Command Center                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                       SHELL (core)                     │   │
│  │  Auth · Layout · Market data · KPI panels · Mobile   │   │
│  │  Multi-tenant orgs · Demo mode · Observability       │   │
│  │  Generic primitives: Circles, Deal Room, Bidding,     │   │
│  │  Reply threads, Customers, Attachments, Activity feed │   │
│  └──────────────────────────────────────────────────────┘   │
│                            ▲                                  │
│              (registers)   │   (consumes)                     │
│                            │                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    ACTIVE MODULE                       │   │
│  │  Vertical-specific:                                    │   │
│  │  · Category enums (override deals.category)           │   │
│  │  · Demo seed data                                     │   │
│  │  · Custom panels (e.g. Diamond Index)                 │   │
│  │  · Custom routes (e.g. /diamonds, /winjewel-import)   │   │
│  │  · Custom sidebar nav entries                         │   │
│  │  · Invoice + PDF templates                            │   │
│  │  · Integrations (e.g. GIA cert lookup, WinJewel CSV)  │   │
│  │  · Industry-specific brand strings                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**One tenant org = one active module.** The shell loads the module's registry at startup based on the org's `module` field.

A module **extends** the shell. It never edits shell internals. Every shell file is under `src/`; every module file is under `src/modules/<module-name>/`. If a shell file imports from `src/modules/...`, that's an architecture violation.

## 2. The contract — what core guarantees

The shell guarantees these things to every module:

### 2.1 Identity + auth
- A `session` object with `userId`, `orgId`, `role`, `email`
- `requireSession(req)` helper
- `getCurrentOrgId()` for RSC pages
- JWT verified by `jose`, cookie `ccc_session`, 7-day TTL

### 2.2 Database
- A `Db` connection from `@/db/client` (pglite in dev/test, Neon HTTP in prod)
- The `orgs` table — every business is an `org`. Modules MAY add per-module rows joined to orgs (e.g. `aiya_module_settings`) but MUST NOT add columns to `orgs` itself.
- Multi-tenant invariant: every read takes explicit `orgId`. No defaults.
- Migrations: drizzle. Modules generate migrations in `drizzle/` like core does. Slice numbers must coordinate via `docs/ROADMAP.md` §9.

### 2.3 Validation + actions
- `zod` schemas for input
- `runWithUser({ schema, action: async (input, ctx) => {...} })` wrapper for server actions
- `ForbiddenError` from `@/lib/auth/errors` for authz failures
- Auto-Sentry capture with `layer:` tag

### 2.4 Storage
- `BlobStore` injection seam (`src/lib/storage/blobStore.ts`)
- Magic-byte MIME validation (`detectKindFromBytes`)
- Signed-URL placeholder (modules may extend with their preferred URL signer)

### 2.5 UI primitives
- `Shell.tsx` (top-level app shell with mobile drawer + sidebar)
- `PANEL_REGISTRY` (panel components by ID — modules register panels here)
- `PanelCtx` (per-panel customization context)
- Design tokens (colors, spacing, type) — modules SHOULD reuse these, MAY override via a module theme file

### 2.6 Observability
- `Sentry.captureException` with `layer:` tag — modules MUST use this naming pattern
- Web Vitals already wired

### 2.7 Demo mode
- `NEXT_PUBLIC_DEMO_MODE=true` short-circuits the entire app
- Modules MUST provide demo seed for every feature they ship
- Demo helpers in `src/lib/demo/`

### 2.8 Background work + email
- AI Gateway (slice 32, planned) — provider strings via Vercel AI Gateway
- Resend (slice 25, planned) — modules send mail via `core/email/send.ts`
- Pinecone (slice 34, planned) — modules query vector index via `core/embeddings/`

## 3. The contract — what modules promise

A module MUST:

1. **Live entirely under `src/modules/<name>/`.** No edits to shell files. (Exception: the `manifest.ts` file under the module IS registered in a single shell file, `src/modules/registry.ts` — see §5.)
2. **Export a `manifest.ts`** that declares everything the shell needs to know about the module — see §4.
3. **Use the shell's auth, validation, storage, demo-mode, observability primitives.** No re-rolling JWT verification, no custom Sentry tags outside the `layer:` convention.
4. **Be removable.** Deleting `src/modules/<name>/` and the manifest registration MUST leave the shell working. Core tests MUST pass with no modules registered.
5. **Provide demo seed data.** Without it the demo deploy breaks for that tenant.
6. **Document its own migrations.** Each module slice's design spec lists which migration numbers it claims.
7. **Honor tenant isolation.** Same multi-tenant invariant — every read takes explicit `orgId`.

A module SHOULD:
- Reuse core mechanics rather than fork them. (e.g. don't build a parallel deal-room; extend the core one.)
- Provide a single point of integration (a module owner file) so cross-tab work is easy to navigate.
- Stay within the design tokens unless brand requires otherwise.

## 4. The module manifest

Every module exports a `manifest.ts`:

```ts
// src/modules/aiya-jewelry/manifest.ts
import { type ModuleManifest } from "@/modules/_kit/types";
import { categories } from "./categories";
import { sidebarEntries } from "./nav";
import { panels } from "./panels";
import { routes } from "./routes";
import { demoSeed } from "./demo";

export const aiyaJewelryManifest: ModuleManifest = {
  id: "aiya-jewelry",
  displayName: "AIYA Designs (Jewelry Trade)",

  // Categories override
  categories: {
    deal: categories.deal,                  // e.g. ["Diamond", "Gem", "Metal", "Finished", "Other"]
    inventory: categories.inventory,         // e.g. ["Ring", "Necklace", ...]
  },

  // Panels added to PANEL_REGISTRY when this module is active
  panels: {
    "diamond-index": panels.DiamondIndex,
    "spot-metals":    panels.SpotMetals,
    "gia-cert-quick": panels.GiaCertQuick,
  },

  // Sidebar entries appended (in declared order, after core)
  navEntries: sidebarEntries,                // [{ id, label, href, icon, badge? }, ...]

  // Routes added to the App Router (must be under /m/<module-id>/...)
  routes: [
    "/m/aiya-jewelry/diamonds",              // Diamond price matrix
    "/m/aiya-jewelry/winjewel-import",       // WinJewel CSV wizard
    "/m/aiya-jewelry/cert-lookup",           // GIA/IGI lookup
  ],

  // Demo seed augmentations (added to the base demo)
  demo: demoSeed,

  // Optional integrations
  integrations: {
    invoiceTemplates: ["aiya-jewelry-default", "aiya-jewelry-loose-diamond"],
    pdfFooter: "AIYA Designs · ISO 9001 · GIA member",
  },

  // Lifecycle hooks (rarely needed — for now just an activation hook for backfills)
  onActivate: async (ctx) => { /* run once when tenant adopts module */ },
  onDeactivate: async (ctx) => { /* unwind any module-specific cron, etc. */ },
};
```

Manifest fields are **typed**. The `ModuleManifest` type lives in `src/modules/_kit/types.ts` and is the single point of evolution for the module API.

## 5. Wiring — how the shell loads a module

```ts
// src/modules/registry.ts
import { aiyaJewelryManifest } from "./aiya-jewelry/manifest";

// Single point where modules are registered with the shell.
// Adding a new module = adding one import + one entry here.
export const MODULES = {
  "aiya-jewelry": aiyaJewelryManifest,
  // "cpg-spirits":     cpgSpiritsManifest,    // future
  // "restaurant-ops":  restaurantOpsManifest, // future
} as const;

export type ActiveModuleId = keyof typeof MODULES;
```

```ts
// src/lib/modules/active.ts
import { MODULES, type ActiveModuleId } from "@/modules/registry";
import { getCurrentOrg } from "@/lib/auth/session";

export async function getActiveModule() {
  const org = await getCurrentOrg();
  if (!org?.moduleId) return null;          // "core only" tenant
  return MODULES[org.moduleId as ActiveModuleId] ?? null;
}
```

The shell uses `getActiveModule()` to:
- Decide which sidebar entries to render
- Merge category enums into the deal/inventory forms
- Mount module routes
- Add panels to `PANEL_REGISTRY`
- Apply branding strings

If `getActiveModule()` returns `null`, the user sees the **bare core** (generic CEO command center, no jewelry-specific UI). This is what every future demo tenant looks like.

## 6. Database model for modules

### 6.1 New columns on `orgs`

```sql
ALTER TABLE orgs ADD COLUMN module_id text NULL;
-- Examples: 'aiya-jewelry', 'cpg-spirits', 'restaurant-ops', or NULL for core-only.
-- Validated at app boundary (Zod) AND DB boundary (CHECK constraint).
```

### 6.2 Per-module settings tables

Modules MAY add their own tables. Naming convention: `<module_id>_<entity>` with underscores, e.g.:

- `aiya_jewelry_diamond_prices` (the existing diamond price matrix becomes module-scoped)
- `aiya_jewelry_cert_lookups` (cached GIA results)
- `aiya_jewelry_winjewel_imports` (audit of CSV uploads)

Every module table has `org_id` and respects the multi-tenant invariant.

### 6.3 Shared tables, module-flavored data

For tables shared with core (e.g. `inventory_items`, `deals`), the **module-specific data** (category enum) is enforced at the app boundary (Zod), not the DB. The DB stores raw text; Zod validates against `manifest.categories.<entity>`.

This means a tenant can switch modules without DB migration — only their UI changes. (Practical caveat: switching from a module with category "Ring" to a module without it leaves orphan category strings; UI surfaces these as "Other" or prompts a recategorization.)

## 7. UI: how a module plugs in

### 7.1 Sidebar
```ts
// src/components/Sidebar.tsx (shell)
import { coreNav } from "@/nav/core";
import { getActiveModule } from "@/lib/modules/active";

export async function Sidebar() {
  const module = await getActiveModule();
  const entries = [...coreNav, ...(module?.navEntries ?? [])];
  return <nav>{entries.map(...)}</nav>;
}
```

### 7.2 Panels
```ts
// src/components/PanelRenderer.tsx (shell)
import { CORE_PANELS } from "@/panels/registry";
import { getActiveModule } from "@/lib/modules/active";

export function PanelRenderer({ panelId, ctx }: { panelId: string; ctx: PanelCtx }) {
  const module = await getActiveModule();
  const allPanels = { ...CORE_PANELS, ...(module?.panels ?? {}) };
  const Panel = allPanels[panelId];
  if (!Panel) return null;
  return <Panel ctx={ctx} />;
}
```

### 7.3 Routes
Module routes live under `/m/<module-id>/...`. Convention:
- Core routes (auth-gated): `/dashboard`, `/deals/<id>`, `/customers/<id>`, etc.
- Module routes: `/m/aiya-jewelry/diamonds`, `/m/aiya-jewelry/winjewel-import`.

This makes it impossible to accidentally route to a module's page from a tenant that doesn't have the module active.

## 8. Demo mode + modules

The shell's demo seed (`src/lib/demo/seed.ts`) is **module-agnostic**: it seeds `orgs`, `users`, `circles`, generic `customers`, generic `deals`, generic `inventory`. No jewelry.

The active module's manifest contributes `demoSeed`. At startup, the shell merges:
```ts
const baseSeed = await import("@/lib/demo/seed");
const moduleSeed = (await getActiveModule())?.demo;
const fullSeed = mergeSeeds(baseSeed, moduleSeed);
```

For the demo deploy (`idesign-dash-demo.netlify.app`), `org_id = 1` is the AIYA tenant, so it gets the full jewelry experience. A second demo tenant (`org_id = 2`, "Demo CPG Co.") could show off a hypothetical CPG module.

## 9. Migration plan from today's code

The current code mixes shell + jewelry concerns. We need a small refactor to enforce the boundary. **None of this is urgent** — the shell + module distinction works as a *forward* discipline starting today. Refactor existing code opportunistically when we touch it.

### Phase M1 — Add the manifest skeleton (1 small slice, "C-3" in roadmap)
- Add `orgs.module_id text NULL` column + migration
- Create `src/modules/_kit/types.ts` with `ModuleManifest` type
- Create `src/modules/registry.ts` (empty)
- Wire `getActiveModule()` helper

### Phase M2 — Extract AIYA panels (next jewelry slice's prep)
- Move `DiamondIndex`, `SpotMetals`, `GIACertQuick` from `src/panels/` to `src/modules/aiya-jewelry/panels/`
- Register them in the AIYA manifest
- Verify shell renders without them when `module_id = null`

### Phase M3 — Extract AIYA routes (next AIYA slice's prep)
- Move `/diamonds` to `/m/aiya-jewelry/diamonds`
- Add redirect `/diamonds` → `/m/aiya-jewelry/diamonds` for backward compat
- Move all `winjewel-*` slice work to `/m/aiya-jewelry/...` from day one

### Phase M4 — Extract categories (cleanup slice C-1 + C-2)
- New table `tenant_categories` (or just the manifest field — TBD on cost/benefit)
- Migrate `inventory_items.category` + `deals.category` to be free text validated at app boundary
- Manifest provides the canonical list for the active module

### Phase M5 — Extract demo seed (small)
- `src/lib/demo/seed.ts` stays generic
- `src/modules/aiya-jewelry/demo.ts` provides jewelry-flavored data
- Demo mode merges them

No big-bang rewrite. We can ship modules + AIYA migration arc + new core slices in parallel.

## 10. Permissions + access

A module's UI is gated by the active tenant having that module enabled. Two layers:

1. **UI layer** — `getActiveModule()` returns `null` → module routes 404, module sidebar entries hidden.
2. **Server-action layer** — module-specific actions check `getCurrentOrg().moduleId === "aiya-jewelry"` before executing. Defense in depth.

A user with the **owner** role can switch their tenant's module via Settings (later). For the AIYA customer, this happens at onboarding and stays fixed.

## 11. Versioning + breaking changes

The `ModuleManifest` type is the public API between shell and modules. Breaking changes to it require:
1. A new major version field in the manifest (e.g. `manifestVersion: 2`)
2. A compat shim that translates v1 → v2 for older modules
3. A doc update here

Since the only module is internal (AIYA), this is currently theoretical. Becomes real if we open the SDK (slice 60+).

## 12. Open architecture questions

These are decisions deferred to first concrete need:

- **Q-M1.** Should module data tables (e.g. `aiya_jewelry_diamond_prices`) carry the module prefix at the DB level, or live in a per-module schema (`CREATE SCHEMA aiya_jewelry`)?
  - Prefix = simpler, no PG schema mgmt
  - Schema = cleaner isolation, easier to drop a module
  - **Recommendation:** Prefix for now. Schema if we get a 3rd module.

- **Q-M2.** Should panels register as React lazy-loaded chunks per module, or eagerly bundled?
  - Lazy = smaller initial bundle, separate cache key per module
  - Eager = simpler, all panels in one chunk
  - **Recommendation:** Eager until bundle gets noisy (3+ modules).

- **Q-M3.** Module-specific server actions — where do they live in the directory tree?
  - **Recommendation:** `src/modules/aiya-jewelry/actions/`. Same `runWithUser` wrapper.

- **Q-M4.** Cross-module shared logic (e.g. AIYA and CPG both need "case quantity tracking")?
  - **Recommendation:** Promote shared logic to core. Modules should not import each other.

## 13. Checklist — adding a new feature

Use this for every new feature spec:

- [ ] Is it generic enough that any vertical would want it? → **Core**
- [ ] Does only one vertical care? → **Module**
- [ ] Borderline? Default to **Core**, with the vertical-specific bit (templates, integrations, brand strings) in the **Module**
- [ ] Database column with industry-flavored name (`gia_grade`, `vintage_year`)? → **Module table**
- [ ] New route? Core routes top-level; module routes under `/m/<module-id>/`
- [ ] Sidebar entry? Core entries in `coreNav`; module entries in `manifest.navEntries`
- [ ] New panel? Core panels in `CORE_PANELS`; module panels in `manifest.panels`
- [ ] Demo seed contribution? Always required
- [ ] Update `docs/CODE_AUDIT.md` if the file lives in a new module directory

## 14. Worked example — slice 27 (Invoice schema + create/edit form)

This is the kind of slice where the shell-vs-module call needs the framework above. Walk through:

- **Schema** (`invoices` table, `invoice_line_items` table): **core**. Every business invoices.
- **Server actions** (`createInvoice`, `updateInvoice`, `deleteInvoice`): **core**.
- **Form UI** (`InvoiceForm` component with line items, totals, tax): **core**. Generic.
- **Templates** (the PDF layout — colors, logo placement, footer): **module**. Each vertical wants its own look. AIYA gets `aiya-jewelry-default.tsx`; CPG would get its own.
- **Per-line-item metadata** (diamond carat × clarity for jewelry invoices; ABV × case-count for CPG): **module-extension**. Core invoice has a `meta jsonb` field. Each module's invoice template knows how to render its expected `meta` shape. Schema-flexibility at the cost of type-strictness — same precedent as slice-5 `website_snapshots.perYearOverrides`.

This is the pattern. The mechanic is core; the dress is the module.
