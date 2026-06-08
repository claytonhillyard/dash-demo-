/**
 * Slice C-1 (module-skeleton): companion to `getCurrentOrgId()`. Loads the
 * acting tenant's `module_id` so the shell can decide what to render.
 *
 * Why a separate file (vs. adding fields to the JWT payload): the session
 * JWT is intentionally narrow (`user`, `orgId`) and is verified on every
 * request — re-encoding org-level data into the cookie every time a tenant
 * switches modules would be a footgun. We do a single tiny `SELECT module_id`
 * here, which is cheap on Neon (the orgs row is in shared buffers) and
 * naturally invalidates the moment a settings UI flips the column.
 *
 * Demo mode short-circuits to null — same precedent as `getActiveModule()` —
 * because C-1 ships no manifests, and the demo path stays bare-shell until
 * C-2 lands AIYA's manifest with a real demo seed.
 */
import { eq } from "drizzle-orm";
import { ensureDbReady } from "@/db/client";
import { orgs } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { getCurrentOrgId } from "./getCurrentOrgId";

export async function getCurrentOrgModuleId(): Promise<string | null> {
  if (isDemoMode()) return null;
  const orgId = await getCurrentOrgId();
  const db = await ensureDbReady();
  const rows = await db
    .select({ moduleId: orgs.moduleId })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  return rows[0]?.moduleId ?? null;
}
