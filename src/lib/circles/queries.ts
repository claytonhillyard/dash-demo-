import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circles, circleMembers } from "@/db/schema";

export interface CircleRow {
  id: number;
  name: string;
  slug: string;
  ownerOrgId: number;
}

/** Returns the circle ids that an org is currently a member of.
 *  Hot read path — feeds the widened deals query. */
export async function getCircleIdsForOrg(db: Db, orgId: number): Promise<number[]> {
  const rows = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(eq(circleMembers.orgId, orgId));
  return rows.map((r) => r.circleId);
}

/** Returns the full circle rows an org belongs to — used by the PostDealForm
 *  dropdown and the panel's circle-name lookup map. */
export async function getCirclesForOrg(db: Db, orgId: number): Promise<CircleRow[]> {
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
 *  any value as a display label. */
export async function getCircleNamesForOrg(
  db: Db,
  orgId: number,
): Promise<Map<number, string>> {
  const rows = await getCirclesForOrg(db, orgId);
  return new Map(rows.map((r) => [r.id, r.name] as const));
}
