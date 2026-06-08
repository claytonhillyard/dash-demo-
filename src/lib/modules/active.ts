/**
 * Slice C-1 (module-skeleton): resolves a tenant's active module manifest.
 *
 * Reads `orgs.module_id` for the given org and looks up the matching manifest
 * in the registry. Returns null if:
 *   - the column is NULL ("core only" tenant)
 *   - the column is a string that has no matching registry entry (unknown
 *     module id — defensive, prevents a bad DB write from crashing the shell)
 *   - the app is in demo mode (C-1 has no registered modules, and the demo
 *     short-circuit keeps the surface area small until C-2 lands a real
 *     manifest)
 *
 * Spec: docs/MODULES.md §5.
 */
import { eq } from "drizzle-orm";
import { type Db } from "@/db/client";
import { orgs } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { MODULES, type ActiveModuleId } from "@/modules/registry";
import { type ModuleManifest } from "@/modules/_kit/types";

export async function getActiveModule(
  orgId: number,
  db: Db,
): Promise<ModuleManifest | null> {
  // Demo-mode short-circuit. C-1 has no registered modules, so this would
  // return null anyway; making the short-circuit explicit means C-2 can layer
  // demo-specific manifest selection on top without revisiting this branch.
  if (isDemoMode()) return null;

  const rows = await db
    .select({ moduleId: orgs.moduleId })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);

  const moduleId = rows[0]?.moduleId;
  if (!moduleId) return null;

  // Cast through `string` because `keyof typeof MODULES` is `never` while the
  // registry is empty (C-1), which would force `MODULES[moduleId]` to be a
  // type error. The runtime lookup is correct either way; once C-2 lands AIYA
  // the cast narrows to a real union and the lookup becomes type-checked.
  const manifest = (MODULES as Record<string, ModuleManifest>)[
    moduleId as ActiveModuleId
  ];
  return manifest ?? null;
}
