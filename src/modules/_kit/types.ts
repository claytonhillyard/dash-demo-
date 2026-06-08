/**
 * Slice C-1 (module-skeleton): typed contract between the shell and a vertical
 * module. Single point of evolution for the shell↔module API. Adding a new
 * field here is a deliberate, version-able act — see docs/MODULES.md §4 + §11.
 *
 * Strict TS: every field is typed except the two intentional escape hatches
 * (`demo`, `integrations`) where each module owns its own shape. AIYA's
 * concrete manifest lands in slice C-2; until then `MODULES = {}` in
 * `src/modules/registry.ts` and `getActiveModule()` always returns null.
 */
import { type ComponentType } from "react";

/**
 * A single sidebar entry a module appends to the shell nav. The shell renders
 * core entries first, then `manifest.navEntries` in declared order — see
 * docs/MODULES.md §7.1.
 */
export interface NavEntry {
  /** Stable identifier — used as React key + analytics tag. Module-scoped, so
   *  collisions across modules are impossible at runtime (only one module is
   *  ever active per tenant). */
  id: string;
  /** Human-readable label shown in the sidebar. */
  label: string;
  /** Route href. Module routes MUST live under /m/<module-id>/... — see §7.3. */
  href: string;
  /** Optional Lucide-style icon component. Left as ComponentType so modules can
   *  pass whatever icon library they prefer; the shell wraps it in a fixed
   *  16px box. */
  icon?: ComponentType<{ className?: string }>;
  /** Optional badge text (e.g. "Beta", "3") rendered next to the label. */
  badge?: string;
}

/**
 * The category overrides a module contributes to shell forms.
 *
 * Both keys are optional — a module that does not customize deal categories
 * MUST omit `deal` rather than send `[]`, otherwise the shell would render an
 * empty picker. Same for `inventory`.
 */
export interface ModuleCategoryOverrides {
  deal?: readonly string[];
  inventory?: readonly string[];
}

/**
 * Lifecycle hook context passed to `onActivate` / `onDeactivate`. Kept minimal
 * for C-1 — the only thing every hook needs is the orgId that's switching.
 * Modules requiring more (Db, request scope, etc.) can wire it in later when
 * the first real hook lands; expanding this is non-breaking.
 */
export interface ModuleLifecycleCtx {
  orgId: number;
}

/**
 * The single contract every vertical module exports.
 *
 * Fields are intentionally narrow: the shell guarantees only what's typed
 * here. New optional fields = non-breaking; new required fields or shape
 * changes = bump `manifestVersion` (see docs/MODULES.md §11).
 */
export interface ModuleManifest {
  /** Registry key — matches `orgs.module_id` and the property name in
   *  `src/modules/registry.ts`. Lower-kebab-case. */
  id: string;
  /** Display name for settings UIs. */
  displayName: string;

  /**
   * Optional category enums that override the shell defaults. The shell merges
   * these into deal/inventory forms when the module is active; falls back to
   * the core enums when the module omits a key or no module is active.
   */
  categories?: ModuleCategoryOverrides;

  /**
   * Optional panels added to the shell `PANEL_REGISTRY` while the module is
   * active. Key = panel id (used in dashboards, links, etc.); value = the
   * React component the shell renders.
   */
  panels?: Record<string, ComponentType<unknown>>;

  /** Optional sidebar entries appended after core nav. */
  navEntries?: readonly NavEntry[];

  /**
   * Optional list of App Router routes this module claims. Convention:
   * `/m/<module-id>/...`. The shell uses this list for sanity-checks and
   * future automated route gating; it is NOT a router — Next.js still reads
   * the filesystem.
   */
  routes?: readonly string[];

  /**
   * Optional demo-seed augmentation. The shell merges this into the base seed
   * when the module is active in demo mode. Shape is module-defined (escape
   * hatch — every module owns its own seed format) so we use `unknown` and let
   * the module's seed merger narrow it. Setting this to `unknown` makes
   * callers explicitly cast; that's the right friction here.
   */
  demo?: unknown;

  /**
   * Optional integration metadata (invoice template ids, PDF footer strings,
   * partner ids, etc.). Shape is module-specific — escape hatch — but typed
   * narrower than `any` so accidental typos still error.
   */
  integrations?: Record<string, unknown>;

  /** Optional lifecycle hook fired once when a tenant adopts this module. */
  onActivate?: (ctx: ModuleLifecycleCtx) => Promise<void>;
  /** Optional lifecycle hook fired once when a tenant abandons this module. */
  onDeactivate?: (ctx: ModuleLifecycleCtx) => Promise<void>;
}
