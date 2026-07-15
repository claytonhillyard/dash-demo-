"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { watchlists } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import { firstZodError } from "@/lib/company/validation";
import { ACTIVITY_ENTITY_TYPES } from "@/lib/activity/types";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import { safeErrShape, mapDbConstraintError } from "@/lib/actionErrors";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Test seam — see test/lib/watchlists/actions.test.ts. Production paths read
// the live Neon/pglite via getDb(). Identical pattern to
// src/lib/customers/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

const watchEntityInput = z.object({
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: z.number().int().positive(),
  notifyEmail: z.email().max(200),
});
export type WatchEntityInput = z.infer<typeof watchEntityInput>;

const unwatchEntityInput = z.object({
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: z.number().int().positive(),
});
export type UnwatchEntityInput = z.infer<typeof unwatchEntityInput>;

/**
 * Shared wrapper: demo guard, session re-assert + orgId resolve, validate,
 * run the callback, revalidate /watchlists + /customers (the toggle lives on
 * customer edit pages). Never throws to the UI — every failure is mapped to
 * { ok: false, error }. Copied from src/lib/customers/actions.ts `run()`.
 *
 * Layered error mapping:
 *   ForbiddenError      → "Forbidden"   (deliberate authz reject inside fn)
 *   anything else       → "Server error" (Sentry-captured, opaque to UI)
 */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number, actor: string) => Promise<void>,
  opts: { action: string },
): Promise<ActionResult> {
  if (isDemoMode()) {
    return { ok: false, error: "Demo mode — changes are disabled" };
  }
  let orgId: number;
  let actor: string;
  try {
    const session = await requireSession();
    orgId = session.orgId;
    actor = session.user;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  try {
    await fn(parsed.data, orgId, actor);
    revalidatePath("/watchlists");
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    const friendly = mapDbConstraintError(e);
    if (friendly !== null) {
      return { ok: false, error: friendly };
    }
    const safe = safeErrShape(e);
    // Constant format string + structured extras — keeps the log format
    // free of caller-controlled substitution patterns (CWE-134).
    console.error("[watchlists action] error", { action: opts.action, ...safe });
    Sentry.captureException(new Error("watchlists action failed"), {
      tags: { layer: "watchlists-action", action: opts.action },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}

/**
 * watchEntity — UPSERT on the (org_id, actor, entity_type, entity_id) unique
 * key. Re-watching the same entity updates notify_email instead of erroring.
 * org_id + actor come from the session, never the wire, so there's no
 * cross-org-write surface even if the client lies about its org.
 *
 * Audit event references the WATCHED entity (readable summary/payload) and
 * deliberately omits notifyEmail — the address lives only in the watchlists
 * table (PII discipline, see spec §8).
 */
export async function watchEntity(raw: unknown): Promise<ActionResult> {
  return run(
    watchEntityInput,
    raw,
    async (input: WatchEntityInput, orgId, actor) => {
      const [row] = await db()
        .insert(watchlists)
        .values({
          orgId,
          actor,
          entityType: input.entityType,
          entityId: input.entityId,
          notifyEmail: input.notifyEmail,
        })
        .onConflictDoUpdate({
          target: [
            watchlists.orgId,
            watchlists.actor,
            watchlists.entityType,
            watchlists.entityId,
          ],
          set: { notifyEmail: input.notifyEmail },
        })
        .returning();
      await recordActivitySafely(
        db(),
        {
          orgId,
          actor,
          entityType: "watchlist",
          entityId: row.id,
          verb: "watched",
          summary: `Watching ${input.entityType} #${input.entityId}`,
          payload: {
            watchedEntityType: input.entityType,
            watchedEntityId: input.entityId,
          },
        },
        { action: "watchlists.watch" },
      );
    },
    { action: "watchEntity" },
  );
}

/**
 * unwatchEntity — DELETE scoped to (org_id, actor, entity_type, entity_id).
 * Idempotent: deleting a watch that doesn't exist (already unwatched, never
 * watched, or belongs to a different org/actor) is still `{ ok: true }` with
 * NO audit event — only an actual row removal is worth recording.
 */
export async function unwatchEntity(raw: unknown): Promise<ActionResult> {
  return run(
    unwatchEntityInput,
    raw,
    async (input: UnwatchEntityInput, orgId, actor) => {
      const res = await db()
        .delete(watchlists)
        .where(
          and(
            eq(watchlists.orgId, orgId),
            eq(watchlists.actor, actor),
            eq(watchlists.entityType, input.entityType),
            eq(watchlists.entityId, input.entityId),
          ),
        )
        .returning();
      if (res.length === 0) return;
      const deleted = res[0]!;
      await recordActivitySafely(
        db(),
        {
          orgId,
          actor,
          entityType: "watchlist",
          entityId: deleted.id,
          verb: "unwatched",
          summary: `Unwatched ${input.entityType} #${input.entityId}`,
          payload: {
            watchedEntityType: input.entityType,
            watchedEntityId: input.entityId,
          },
        },
        { action: "watchlists.unwatch" },
      );
    },
    { action: "unwatchEntity" },
  );
}
