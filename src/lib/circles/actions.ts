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

// inviteOrgToCircle, acceptInvitation, declineInvitation, removeOrgFromCircle,
// leaveCircle land in B5..B9.
