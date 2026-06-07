import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circles, circleMembers, orgs, circleInvitations } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedCircleIdsForOrg, getSeedCircles } from "@/lib/demo/seed";
import { isOrgMemberOfCircle } from "./membership";

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

export interface InvitationRow {
  id: number;
  circleId: number;
  circleName: string;
  fromOrgId: number;
  fromOrgName: string;
  toOrgSlug: string;
  token: string;
  status: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
}

/** Owner perspective: circles where the caller's org is the owner. */
export async function getOwnedCirclesForOrg(db: Db, orgId: number): Promise<CircleRow[]> {
  if (isDemoMode()) {
    // Demo mode: AIYA owns the demo Trusted Partners circle.
    const { getSeedOwnedCirclesForOrg } = await import("@/lib/demo/seed");
    return getSeedOwnedCirclesForOrg(orgId);
  }
  return await db
    .select({
      id: circles.id, name: circles.name, slug: circles.slug, ownerOrgId: circles.ownerOrgId,
    })
    .from(circles)
    .where(eq(circles.ownerOrgId, orgId));
}

/** Returns the member orgs of a circle, but ONLY if the caller is themselves
 *  a member of that circle. Defense in depth: the page already only iterates
 *  over circles the viewer is in, but this helper double-checks. */
export async function listCircleMemberOrgs(
  db: Db,
  circleId: number,
  viewerOrgId: number,
): Promise<{ orgId: number; name: string; slug: string; createdAt: Date }[]> {
  if (isDemoMode()) {
    // Demo: if viewer is in this circle per the seed graph, return seeded
    // partner-org names. Otherwise [].
    const { getSeedCircleIdsForOrg, DEMO_PARTNER_ORG_IDS, DEMO_AIYA_ORG_ID, DEMO_TRUSTED_PARTNERS_CIRCLE_ID } =
      await import("@/lib/demo/seed");
    if (!getSeedCircleIdsForOrg(viewerOrgId).includes(circleId)) return [];
    if (circleId !== DEMO_TRUSTED_PARTNERS_CIRCLE_ID) return [];
    const t0 = new Date("2026-05-01T00:00:00Z");
    return [
      { orgId: DEMO_AIYA_ORG_ID, name: "AIYA Designs", slug: "aiya", createdAt: t0 },
      { orgId: DEMO_PARTNER_ORG_IDS.MEHTA, name: "Mehta Diamonds — Mumbai", slug: "mehta-mumbai", createdAt: t0 },
      { orgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD, name: "Saint-Cloud Gems — Geneva", slug: "saint-cloud-geneva", createdAt: t0 },
      { orgId: DEMO_PARTNER_ORG_IDS.MARATHI, name: "Marathi Trading — Surat", slug: "marathi-surat", createdAt: t0 },
    ];
  }
  const isMember = await isOrgMemberOfCircle(db, viewerOrgId, circleId);
  if (!isMember) return [];
  return await db
    .select({
      orgId: circleMembers.orgId,
      name: orgs.name,
      slug: orgs.slug,
      createdAt: circleMembers.createdAt,
    })
    .from(circleMembers)
    .innerJoin(orgs, eq(orgs.id, circleMembers.orgId))
    .where(eq(circleMembers.circleId, circleId))
    .orderBy(circleMembers.createdAt);
}

/** Outbox for the owner: pending invites this org has issued. */
export async function getPendingInvitesIssuedByOrg(db: Db, orgId: number): Promise<InvitationRow[]> {
  if (isDemoMode()) {
    const { getSeedPendingInvitesForOrg } = await import("@/lib/demo/seed");
    return getSeedPendingInvitesForOrg(orgId).map((s) => ({
      id: s.id,
      circleId: s.circleId,
      circleName: s.circleName,
      fromOrgId: s.fromOrgId,
      fromOrgName: s.fromOrgName,
      toOrgSlug: s.toOrgSlug,
      token: s.token,
      status: s.status,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      respondedAt: null,
    }));
  }
  return await db
    .select({
      id: circleInvitations.id,
      circleId: circleInvitations.circleId,
      circleName: circles.name,
      fromOrgId: circleInvitations.fromOrgId,
      fromOrgName: orgs.name,
      toOrgSlug: circleInvitations.toOrgSlug,
      token: circleInvitations.token,
      status: circleInvitations.status,
      createdAt: circleInvitations.createdAt,
      expiresAt: circleInvitations.expiresAt,
      respondedAt: circleInvitations.respondedAt,
    })
    .from(circleInvitations)
    .innerJoin(circles, eq(circles.id, circleInvitations.circleId))
    .innerJoin(orgs, eq(orgs.id, circleInvitations.fromOrgId))
    .where(and(eq(circleInvitations.fromOrgId, orgId), eq(circleInvitations.status, "pending")))
    .orderBy(desc(circleInvitations.createdAt));
}

/** Inbox for the recipient: pending invites addressed to this org's slug. */
export async function getPendingInvitesForSlug(db: Db, slug: string): Promise<InvitationRow[]> {
  if (isDemoMode()) {
    // Demo mode: AIYA has no pending received invites in the seed.
    return [];
  }
  if (!slug) return [];
  return await db
    .select({
      id: circleInvitations.id,
      circleId: circleInvitations.circleId,
      circleName: circles.name,
      fromOrgId: circleInvitations.fromOrgId,
      fromOrgName: orgs.name,
      toOrgSlug: circleInvitations.toOrgSlug,
      token: circleInvitations.token,
      status: circleInvitations.status,
      createdAt: circleInvitations.createdAt,
      expiresAt: circleInvitations.expiresAt,
      respondedAt: circleInvitations.respondedAt,
    })
    .from(circleInvitations)
    .innerJoin(circles, eq(circles.id, circleInvitations.circleId))
    .innerJoin(orgs, eq(orgs.id, circleInvitations.fromOrgId))
    .where(and(eq(circleInvitations.toOrgSlug, slug), eq(circleInvitations.status, "pending")))
    .orderBy(desc(circleInvitations.createdAt));
}
