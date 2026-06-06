// SLICE 4C: canonical writers for circle_members. The slice-4 race sentinel
// guarded this file's existence; slice 4c repurposes the sentinel to LOCK IN
// the chosen race mitigation (FOR UPDATE transaction + ON CONFLICT idempotent
// insert). See spec §5.3 / §11.1 + plan A5/B10.
//
// The full FOR UPDATE transaction lives in src/lib/circles/actions.ts inside
// acceptInvitation / declineInvitation (it has to, to span the invitation
// status read + membership insert + status update in one tx). This module
// exports the standalone idempotent writers used by createCircle (post-insert
// owner-as-member step), removeOrgFromCircle, and leaveCircle, where the
// caller's authz check has already happened in the action layer.

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circleMembers } from "@/db/schema";

/** Idempotent membership insert. ON CONFLICT DO NOTHING against the slice-4
 *  circle_members_circle_org_uniq constraint. Safe under concurrent calls. */
export async function addOrgToCircle(
  db: Db,
  circleId: number,
  orgId: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO circle_members (circle_id, org_id)
    VALUES (${circleId}, ${orgId})
    ON CONFLICT (circle_id, org_id) DO NOTHING
  `);
}

/** Idempotent membership delete. DELETE WHERE is safe to repeat. */
export async function removeOrgFromCircle(
  db: Db,
  circleId: number,
  orgId: number,
): Promise<void> {
  await db
    .delete(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, orgId)));
}
