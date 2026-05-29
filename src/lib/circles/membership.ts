import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circleMembers } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedCircleIdsForOrg } from "@/lib/demo/seed";

/** Truth check used by post-time write authorization. Hits the
 *  (circle_id, org_id) unique-constraint composite index directly via the
 *  WHERE clause + LIMIT 1 — PG short-circuits on the first match.
 *
 *  Returns false for circle ids that do not exist (defense against id-guessing
 *  — we never let the FK throw a DB error that could leak which ids are valid).
 *
 *  In demo mode, short-circuits to the seed membership graph (the Netlify
 *  demo never boots pglite, so callers must never hit the DB). The guard
 *  lives here — not in callers — so every future caller is automatically
 *  demo-safe. */
export async function isOrgMemberOfCircle(
  db: Db,
  orgId: number,
  circleId: number,
): Promise<boolean> {
  if (isDemoMode()) return getSeedCircleIdsForOrg(orgId).includes(circleId);
  const rows = await db
    .select({ id: circleMembers.id })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, orgId)))
    .limit(1);
  return rows.length > 0;
}
