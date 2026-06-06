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
  return runWithUser(createCircleInput, raw, async (input: CreateCircleInput, _user, orgId) => {
    await db().transaction(async (tx) => {
      const [c] = await tx
        .insert(circles)
        .values({ name: input.name, slug: input.slug, ownerOrgId: orgId })
        .returning({ id: circles.id });
      await tx
        .insert(circleMembers)
        .values({ circleId: c.id, orgId });
    });
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
  return runWithUser(inviteOrgToCircleInput, raw, async (input: InviteOrgToCircleInput, _user, orgId) => {
    const d = db();
    // Owner-only gate.
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId }).from(circles)
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
  });
}

// acceptInvitation, declineInvitation, removeOrgFromCircle,
// leaveCircle land in B6..B9.
