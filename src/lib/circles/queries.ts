import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circles, circleMembers } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedCircleIdsForOrg, getSeedCircles } from "@/lib/demo/seed";

export interface CircleRow {
  id: number;
  name: string;
  slug: string;
  ownerOrgId: number;
}

/** Returns the circle ids that an org is currently a member of.
 *  Hot read path — feeds the widened deals query.
 *
 *  Demo-mode short-circuit lives here (not in callers) so every future call
 *  site is automatically demo-safe. */
export async function getCircleIdsForOrg(db: Db, orgId: number): Promise<number[]> {
  if (isDemoMode()) return getSeedCircleIdsForOrg(orgId);
  const rows = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(eq(circleMembers.orgId, orgId));
  return rows.map((r) => r.circleId);
}

/** Returns the full circle rows an org belongs to — used by the PostDealForm
 *  dropdown and the panel's circle-name lookup map.
 *
 *  Demo-mode short-circuit: filters the seed circle list down to the ones
 *  the demo membership graph says this org belongs to. */
export async function getCirclesForOrg(db: Db, orgId: number): Promise<CircleRow[]> {
  if (isDemoMode()) {
    const ids = new Set(getSeedCircleIdsForOrg(orgId));
    return getSeedCircles().filter((c) => ids.has(c.id));
  }
  const rows = await db
    .select({
      id: circles.id,
      name: circles.name,
      slug: circles.slug,
      ownerOrgId: circles.ownerOrgId,
    })
    .from(circles)
    .innerJoin(circleMembers, eq(circleMembers.circleId, circles.id))
    .where(eq(circleMembers.orgId, orgId));
  return rows;
}

/** Convenience helper for the UI: returns a Map<circleId, name>. The map only
 *  ever contains circles the viewer is a member of, so it's safe to surface
 *  any value as a display label.
 *
 *  Built on top of `getCirclesForOrg`, so it inherits the demo-mode guard. */
export async function getCircleNamesForOrg(
  db: Db,
  orgId: number,
): Promise<Map<number, string>> {
  const rows = await getCirclesForOrg(db, orgId);
  return new Map(rows.map((r) => [r.id, r.name] as const));
}
