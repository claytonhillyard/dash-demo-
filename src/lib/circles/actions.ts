"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { circles, circleMembers, circleInvitations, orgs } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  createCircleInput, inviteOrgToCircleInput, tokenInput,
  removeOrgFromCircleInput, leaveCircleInput,
  type CreateCircleInput, type InviteOrgToCircleInput, type TokenInput,
  type RemoveOrgFromCircleInput, type LeaveCircleInput,
} from "./validation";
import { firstZodError } from "@/lib/company/validation";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";

export type ActionResult = { ok: true } | { ok: false; error: string };

let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> { testDb = d; }
function db(): Db { return testDb ?? getDb(); }

async function runWithUser<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, user: string, orgId: number) => Promise<void>,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let user: string;
  let orgId: number;
  try {
    const session = await requireSession();
    user = session.user;
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, user, orgId);
    revalidatePath("/circles");
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "Forbidden" };
    console.error("[circles action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "circles-action" } });
    return { ok: false, error: "Database error" };
  }
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(createCircleInput, raw, async (input: CreateCircleInput, user, orgId) => {
    let circleId!: number;
    await db().transaction(async (tx) => {
      // TODO(slice-4c review): plan used `.returning({ id: circles.id })`, but
      // Drizzle's TS overload only resolves with no-arg .returning() in this
      // chain. Match the slice-5 workaround.
      const [c] = await tx
        .insert(circles)
        .values({ name: input.name, slug: input.slug, ownerOrgId: orgId })
        .returning();
      await tx
        .insert(circleMembers)
        .values({ circleId: c.id, orgId });
      circleId = c.id;
    });
    await recordActivitySafely(
      db(),
      {
        orgId,
        actor: user,
        entityType: "circle",
        entityId: circleId,
        verb: "created",
        summary: `Created circle "${input.name}"`,
        payload: { name: input.name, slug: input.slug },
      },
      { action: "circles.create" },
    );
  });
}

// TODO(slice-4c review): plan listed only top-level `.code` check; in practice
// Drizzle wraps driver errors in DrizzleQueryError and exposes the PG SQLSTATE
// on `.cause.code`. Checking both keeps Neon (pg) compatibility and unblocks
// the pglite test path.
function isUniqueViolation(e: unknown): boolean {
  // PG SQLSTATE 23505 = unique_violation.
  if (typeof e !== "object" || e === null) return false;
  const top = (e as { code?: string }).code;
  if (top === "23505") return true;
  const cause = (e as { cause?: { code?: string } }).cause;
  return cause?.code === "23505";
}

export async function inviteOrgToCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(inviteOrgToCircleInput, raw, async (input: InviteOrgToCircleInput, user, orgId) => {
    const d = db();
    // Owner-only gate.
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId, name: circles.name }).from(circles)
      .where(eq(circles.id, input.circleId)).limit(1);
    if (!c || c.ownerOrgId !== orgId) throw new ForbiddenError();
    // Self-invite: no-op if the target slug is the caller's own.
    const [me] = await d.select({ slug: orgs.slug }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
    if (me && me.slug === input.toOrgSlug) return;
    // Generate token + expiry server-side.
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    try {
      await d.insert(circleInvitations).values({
        circleId: input.circleId,
        fromOrgId: orgId,
        toOrgSlug: input.toOrgSlug,
        token,
        expiresAt,
      });
    } catch (e) {
      // Partial unique index throws on duplicate-pending. Translate to
      // Forbidden — we don't tell the inviter "an invite already exists".
      if (isUniqueViolation(e)) throw new ForbiddenError();
      throw e;
    }
    await recordActivitySafely(
      d,
      {
        orgId,
        actor: user,
        entityType: "circle",
        entityId: input.circleId,
        verb: "invited",
        summary: `Invited ${input.toOrgSlug} to "${c.name}"`,
        payload: { circleId: input.circleId, toSlug: input.toOrgSlug },
      },
      { action: "circles.invite" },
    );
  });
}

export async function acceptInvitation(raw: unknown): Promise<ActionResult> {
  return runWithUser(tokenInput, raw, async (input: TokenInput, user, orgId) => {
    let circleId!: number;
    let circleName = "";
    let fromOrgSlug = "";
    await db().transaction(async (tx) => {
      // 1) Lock the invitation row (FOR UPDATE closes the check-then-write race).
      const rows = await tx.execute(drizzleSql`
        SELECT id, circle_id, from_org_id, to_org_slug, status, expires_at
        FROM circle_invitations
        WHERE token = ${input.token}
        LIMIT 1
        FOR UPDATE
      `);
      // pglite normalizes .execute() to a { rows: [...] } shape; some drivers
      // return the array directly. Defensive cast handles both.
      const inv = ((rows as { rows?: Array<Record<string, unknown>> }).rows
        ?? (rows as unknown as Array<Record<string, unknown>>))[0];
      if (!inv) throw new ForbiddenError();
      if (inv.status !== "pending") throw new ForbiddenError();
      const expiresAt = inv.expires_at instanceof Date
        ? inv.expires_at
        : new Date(inv.expires_at as string);
      if (expiresAt <= new Date()) throw new ForbiddenError();
      // 2) Cross-org integrity: session's org slug must match invite.to_org_slug.
      const [me] = await tx.select({ slug: orgs.slug }).from(orgs)
        .where(eq(orgs.id, orgId)).limit(1);
      if (!me || me.slug !== inv.to_org_slug) throw new ForbiddenError();
      // 3) Idempotent membership insert (ON CONFLICT against slice-4 uniq).
      await tx.execute(drizzleSql`
        INSERT INTO circle_members (circle_id, org_id)
        VALUES (${inv.circle_id as number}, ${orgId})
        ON CONFLICT (circle_id, org_id) DO NOTHING
      `);
      // 4) Mark accepted.
      await tx
        .update(circleInvitations)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(eq(circleInvitations.id, inv.id as number));
      circleId = inv.circle_id as number;
      // Audit-only lookups (display name + inviter slug); not authz-relevant,
      // done last inside the tx so they read the same snapshot.
      const [circleRow] = await tx.select({ name: circles.name }).from(circles)
        .where(eq(circles.id, circleId)).limit(1);
      circleName = circleRow?.name ?? `circle #${circleId}`;
      const [fromOrg] = await tx.select({ slug: orgs.slug }).from(orgs)
        .where(eq(orgs.id, inv.from_org_id as number)).limit(1);
      fromOrgSlug = fromOrg?.slug ?? "unknown";
    });
    await recordActivitySafely(
      db(),
      {
        orgId,
        actor: user,
        entityType: "circle",
        entityId: circleId,
        verb: "joined",
        summary: `Accepted invite to "${circleName}"`,
        payload: { circleId, fromOrgSlug },
      },
      { action: "circles.acceptInvite" },
    );
  });
}

export async function declineInvitation(raw: unknown): Promise<ActionResult> {
  return runWithUser(tokenInput, raw, async (input: TokenInput, user, orgId) => {
    let circleId!: number;
    let circleName = "";
    let fromOrgSlug = "";
    await db().transaction(async (tx) => {
      const rows = await tx.execute(drizzleSql`
        SELECT id, circle_id, from_org_id, to_org_slug, status, expires_at
        FROM circle_invitations
        WHERE token = ${input.token}
        LIMIT 1
        FOR UPDATE
      `);
      const inv = ((rows as { rows?: Array<Record<string, unknown>> }).rows
        ?? (rows as unknown as Array<Record<string, unknown>>))[0];
      if (!inv) throw new ForbiddenError();
      if (inv.status !== "pending") throw new ForbiddenError();
      const expiresAt = inv.expires_at instanceof Date
        ? inv.expires_at
        : new Date(inv.expires_at as string);
      if (expiresAt <= new Date()) throw new ForbiddenError();
      const [me] = await tx.select({ slug: orgs.slug }).from(orgs)
        .where(eq(orgs.id, orgId)).limit(1);
      if (!me || me.slug !== inv.to_org_slug) throw new ForbiddenError();
      await tx
        .update(circleInvitations)
        .set({ status: "declined", respondedAt: new Date() })
        .where(eq(circleInvitations.id, inv.id as number));
      circleId = inv.circle_id as number;
      // Audit-only lookups; see acceptInvitation for rationale.
      const [circleRow] = await tx.select({ name: circles.name }).from(circles)
        .where(eq(circles.id, circleId)).limit(1);
      circleName = circleRow?.name ?? `circle #${circleId}`;
      const [fromOrg] = await tx.select({ slug: orgs.slug }).from(orgs)
        .where(eq(orgs.id, inv.from_org_id as number)).limit(1);
      fromOrgSlug = fromOrg?.slug ?? "unknown";
    });
    // "deleted" is the closest ACTIVITY_VERBS match for a soft-deleted
    // (declined) invite row — see slice-24b-2 spec, whitelist stays stable.
    await recordActivitySafely(
      db(),
      {
        orgId,
        actor: user,
        entityType: "circle",
        entityId: circleId,
        verb: "deleted",
        summary: `Declined invite to "${circleName}"`,
        payload: { circleId, fromOrgSlug },
      },
      { action: "circles.declineInvite" },
    );
  });
}

// Note: removeOrgFromCircle and leaveCircle inline the DELETE rather than
// calling membership-mutations.ts's removeOrgFromCircle helper. Reasons:
// (a) DELETE FROM ... WHERE ... is idempotent + safe without transaction
//     wrapping — no race condition to mitigate
// (b) The session-scoped predicates (ownerOrgId === sessionOrgId for remove,
//     orgId === sessionOrgId for leave) are authz-relevant and live with
//     the action's authz checks; folding them into the helper would push
//     authz across the module boundary
// (c) The helper in membership-mutations.ts remains the canonical writer
//     for tests + future external callers (e.g. an admin CLI). The slice-4c
//     race sentinel asserts the helper EXPORTS exist + the production
//     race-mitigation patterns are present; both invariants still hold.
// (Slice-4c review finding #7.)
export async function removeOrgFromCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(removeOrgFromCircleInput, raw, async (input: RemoveOrgFromCircleInput, user, orgId) => {
    const d = db();
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId, name: circles.name }).from(circles)
      .where(eq(circles.id, input.circleId)).limit(1);
    if (!c || c.ownerOrgId !== orgId) throw new ForbiddenError();
    if (input.orgId === c.ownerOrgId) throw new ForbiddenError(); // cannot remove the owner
    const removed = await d
      .delete(circleMembers)
      .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.orgId, input.orgId)))
      .returning();
    // Idempotent no-op (removing an already-removed / non-member org): zero
    // rows changed, so nothing real happened — skip the audit call.
    if (removed.length === 0) return;
    const [removedOrg] = await d.select({ slug: orgs.slug }).from(orgs)
      .where(eq(orgs.id, input.orgId)).limit(1);
    const removedOrgSlug = removedOrg?.slug ?? "unknown";
    await recordActivitySafely(
      d,
      {
        orgId,
        actor: user,
        entityType: "circle",
        entityId: input.circleId,
        verb: "left",
        summary: `Removed ${removedOrgSlug} from "${c.name}"`,
        payload: { circleId: input.circleId, removedOrgSlug },
      },
      { action: "circles.remove" },
    );
  });
}

export async function leaveCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(leaveCircleInput, raw, async (input: LeaveCircleInput, user, orgId) => {
    const d = db();
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId, name: circles.name }).from(circles)
      .where(eq(circles.id, input.circleId)).limit(1);
    if (!c) throw new ForbiddenError();
    if (c.ownerOrgId === orgId) throw new ForbiddenError(); // owner cannot leave
    const removed = await d
      .delete(circleMembers)
      .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.orgId, orgId)))
      .returning();
    // Idempotent no-op (leaving a circle the caller isn't a member of): zero
    // rows changed, so nothing real happened — skip the audit call.
    if (removed.length === 0) return;
    await recordActivitySafely(
      d,
      {
        orgId,
        actor: user,
        entityType: "circle",
        entityId: input.circleId,
        verb: "left",
        summary: `Left circle "${c.name}"`,
        payload: { circleId: input.circleId },
      },
      { action: "circles.leave" },
    );
  });
}
