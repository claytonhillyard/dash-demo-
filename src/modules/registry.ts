/**
 * Slice C-1 (module-skeleton): the single point where vertical modules are
 * registered with the shell. Adding a new module = one import + one entry
 * here. See docs/MODULES.md §5.
 *
 * C-1 ships the skeleton with an EMPTY registry — `MODULES = {}` — and
 * `getActiveModule()` always returns null. Slice C-2 lands the first concrete
 * manifest (aiya-jewelry).
 */
import { type ModuleManifest } from "./_kit/types";

/**
 * The registry is `as const satisfies Record<string, ModuleManifest>` so that:
 *  - `keyof typeof MODULES` is the literal union of registered module ids
 *    (used as `ActiveModuleId` below — the type-safe key into the registry).
 *  - Every value is still constrained to be a `ModuleManifest` at compile
 *    time. Forgetting a required field on a future manifest is a tsc error,
 *    not a runtime surprise.
 *
 * NOTE: while the registry is empty, `keyof typeof MODULES` is `never`. That
 * is intentional — there is no valid `ActiveModuleId` yet, and any lookup
 * against the registry returns `undefined`. `getActiveModule()` collapses
 * that to `null` as the public API.
 */
export const MODULES = {} as const satisfies Record<string, ModuleManifest>;

/**
 * The literal union of registered module ids. `never` while the registry is
 * empty (C-1); becomes `"aiya-jewelry"` in C-2.
 */
export type ActiveModuleId = keyof typeof MODULES;
