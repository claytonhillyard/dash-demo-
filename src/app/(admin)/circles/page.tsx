import Link from "next/link";
import { eq } from "drizzle-orm";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { orgs } from "@/db/schema";
import {
  getCirclesForOrg,
  getOwnedCirclesForOrg,
  getPendingInvitesForSlug,
  getPendingInvitesIssuedByOrg,
  listCircleMemberOrgs,
} from "@/lib/circles/queries";
import { DemoNotice } from "@/components/deals/DemoNotice";
import { PendingInvitesInbox } from "@/components/circles/PendingInvitesInbox";
import { OwnedCirclesSection } from "@/components/circles/OwnedCirclesSection";
import { MemberCirclesSection } from "@/components/circles/MemberCirclesSection";
import { CreateCircleForm } from "@/components/circles/CreateCircleForm";
import {
  acceptInvitation, declineInvitation,
  createCircle, inviteOrgToCircle,
  removeOrgFromCircle, leaveCircle,
} from "@/lib/circles/actions";

export const dynamic = "force-dynamic";

export default async function CirclesPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [me] = await db.select({ slug: orgs.slug, name: orgs.name }).from(orgs)
    .where(eq(orgs.id, orgId)).limit(1);

  const [memberOf, owned, pendingInbox, pendingOutbox] = await Promise.all([
    getCirclesForOrg(db, orgId),
    getOwnedCirclesForOrg(db, orgId),
    getPendingInvitesForSlug(db, me?.slug ?? ""),
    getPendingInvitesIssuedByOrg(db, orgId),
  ]);

  const memberRows = await Promise.all(
    memberOf.map(async (c) => ({
      circle: c,
      isOwner: c.ownerOrgId === orgId,
      members: await listCircleMemberOrgs(db, c.id, orgId),
    })),
  );

  const empty = memberOf.length === 0 && owned.length === 0 && pendingInbox.length === 0;

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Circles</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>

      <DemoNotice />

      {pendingInbox.length > 0 && (
        <PendingInvitesInbox
          invitations={pendingInbox}
          acceptAction={acceptInvitation}
          declineAction={declineInvitation}
        />
      )}

      <OwnedCirclesSection
        owned={owned}
        pendingOutbox={pendingOutbox}
        memberRows={memberRows.filter((r) => r.isOwner)}
        inviteAction={inviteOrgToCircle}
        removeAction={removeOrgFromCircle}
      />

      <MemberCirclesSection
        rows={memberRows.filter((r) => !r.isOwner)}
        leaveAction={leaveCircle}
      />

      <CreateCircleForm createAction={createCircle} />

      {empty && (
        <p data-testid="circles-empty-helper" className="mt-6 text-sm text-text/40">
          You're not in any circles yet. When another org invites you, the invite will appear here.
        </p>
      )}
    </main>
  );
}
