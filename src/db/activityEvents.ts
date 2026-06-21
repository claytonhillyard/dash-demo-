import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activityEvents } from "@/db/schema";
import {
  type ActivityEntityType,
  type ActivityEvent,
  type ActivityVerb,
} from "@/lib/activity/types";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_ACTIVITY } from "@/lib/demo/seed";

export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 200;

function clampLimit(requested?: number): number {
  if (requested === undefined) return ACTIVITY_DEFAULT_LIMIT;
  if (requested < 1) return 1;
  if (requested > ACTIVITY_MAX_LIMIT) return ACTIVITY_MAX_LIMIT;
  return Math.floor(requested);
}

function toActivityEvent(row: typeof activityEvents.$inferSelect): ActivityEvent {
  return {
    id: row.id,
    orgId: row.orgId,
    actor: row.actor,
    entityType: row.entityType as ActivityEntityType,
    entityId: row.entityId,
    verb: row.verb as ActivityVerb,
    summary: row.summary,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Paginated org-wide audit feed. Most recent first. Slice-3 invariant:
 * `org_id = $viewerOrgId` is SQL-enforced; no application-layer filter.
 */
export async function getOrgActivity(
  db: Db,
  viewerOrgId: number,
  opts?: {
    limit?: number;
    beforeId?: number;
    entityTypes?: readonly ActivityEntityType[];
  },
): Promise<ActivityEvent[]> {
  const limit = clampLimit(opts?.limit);

  if (isDemoMode()) {
    let pool = DEMO_ACTIVITY.filter((e) => e.orgId === viewerOrgId);
    if (opts?.entityTypes && opts.entityTypes.length > 0) {
      const allow = new Set(opts.entityTypes);
      pool = pool.filter((e) => allow.has(e.entityType));
    }
    if (opts?.beforeId !== undefined) {
      pool = pool.filter((e) => e.id < opts.beforeId!);
    }
    pool = [...pool].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
    );
    return pool.slice(0, limit);
  }

  const conds = [eq(activityEvents.orgId, viewerOrgId)];
  if (opts?.beforeId !== undefined) {
    conds.push(lt(activityEvents.id, opts.beforeId));
  }
  if (opts?.entityTypes && opts.entityTypes.length > 0) {
    conds.push(inArray(activityEvents.entityType, [...opts.entityTypes]));
  }
  const rows = await db
    .select()
    .from(activityEvents)
    .where(and(...conds))
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit);
  return rows.map(toActivityEvent);
}

/**
 * Entity-scoped audit feed — "show me everything that ever happened to
 * customer 17". Slice-3 invariant: SQL-enforced org filter.
 */
export async function getEntityActivity(
  db: Db,
  viewerOrgId: number,
  entityType: ActivityEntityType,
  entityId: number,
  opts?: { limit?: number; beforeId?: number },
): Promise<ActivityEvent[]> {
  const limit = clampLimit(opts?.limit);

  if (isDemoMode()) {
    let pool = DEMO_ACTIVITY.filter(
      (e) =>
        e.orgId === viewerOrgId &&
        e.entityType === entityType &&
        e.entityId === entityId,
    );
    if (opts?.beforeId !== undefined) {
      pool = pool.filter((e) => e.id < opts.beforeId!);
    }
    pool = [...pool].sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
    );
    return pool.slice(0, limit);
  }

  const conds = [
    eq(activityEvents.orgId, viewerOrgId),
    eq(activityEvents.entityType, entityType),
    eq(activityEvents.entityId, entityId),
  ];
  if (opts?.beforeId !== undefined) {
    conds.push(lt(activityEvents.id, opts.beforeId));
  }
  const rows = await db
    .select()
    .from(activityEvents)
    .where(and(...conds))
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit);
  return rows.map(toActivityEvent);
}
