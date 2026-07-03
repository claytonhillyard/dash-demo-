import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activityEvents } from "@/db/schema";
import {
  type ActivityEntityType,
  type ActivityEvent,
  type ActivityVerb,
} from "@/lib/activity/types";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_ACTIVITY } from "@/lib/demo/seed";

const THIRTY_DAYS_MS = 30 * 86_400_000;

/** Per-customer activity aggregates that feed `computeHealthScore` (slice 36).
 *  `lastActivityAt` is unwindowed (all time); the two counts are windowed to
 *  the trailing 30 days before the `now` passed to `getCustomerActivityStats`. */
export type CustomerActivityStats = {
  entityId: number;
  lastActivityAt: Date;
  eventsLast30d: number;
  distinctVerbs30d: number;
};

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
    // Defensive coercion at the reader boundary — same convention as every
    // other Date-surfacing reader (bids.ts, customers.ts, dealMessages.ts).
    // relativeTime() downstream trusts a real Date unconditionally.
    createdAt:
      row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
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
    // id-only cursor against a (created_at, id) DESC ordering is safe ONLY
    // because both are assigned atomically at INSERT (serial + defaultNow())
    // and nothing overrides created_at — so they are co-monotonic. If a
    // backfill/import path ever writes explicit created_at values, this
    // cursor must become a composite (created_at, id) keyset.
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

/**
 * Per-customer activity aggregates for the whole org in ONE GROUP BY query —
 * feeds `computeHealthScore` (slice 36) for the customers list + edit-page
 * Health card. No N+1: callers zip the returned Map against their own
 * `getCustomers` rows by id; a missing key means zero activity (the caller
 * falls back to `customerCreatedAt` recency).
 *
 * `lastActivityAt` is UNWINDOWED (max over all time) — a 45-day-old last
 * touch must still surface so the recency decay math can see it; NULLing it
 * out would punish long-standing customers twice. Only `eventsLast30d` and
 * `distinctVerbs30d` are windowed to the 30 days before `now`.
 *
 * `now` is injected (defaults to `new Date()`) for deterministic tests and a
 * single consistent render timestamp across a page.
 */
export async function getCustomerActivityStats(
  db: Db,
  viewerOrgId: number,
  now: Date = new Date(),
): Promise<Map<number, CustomerActivityStats>> {
  const cutoff = new Date(now.getTime() - THIRTY_DAYS_MS);

  if (isDemoMode()) {
    const acc = new Map<
      number,
      { entityId: number; lastActivityAt: Date; eventsLast30d: number; verbs: Set<string> }
    >();
    for (const e of DEMO_ACTIVITY) {
      if (e.orgId !== viewerOrgId || e.entityType !== "customer" || e.entityId === null) {
        continue;
      }
      const entityId = e.entityId;
      const cur = acc.get(entityId) ?? {
        entityId,
        lastActivityAt: e.createdAt,
        eventsLast30d: 0,
        verbs: new Set<string>(),
      };
      if (e.createdAt.getTime() > cur.lastActivityAt.getTime()) {
        cur.lastActivityAt = e.createdAt;
      }
      if (e.createdAt.getTime() > cutoff.getTime()) {
        cur.eventsLast30d += 1;
        cur.verbs.add(e.verb);
      }
      acc.set(entityId, cur);
    }
    const out = new Map<number, CustomerActivityStats>();
    for (const [entityId, v] of acc) {
      out.set(entityId, {
        entityId,
        lastActivityAt: v.lastActivityAt,
        eventsLast30d: v.eventsLast30d,
        distinctVerbs30d: v.verbs.size,
      });
    }
    return out;
  }

  const res = await db.execute(sql`
    SELECT entity_id,
           max(created_at) AS last_activity_at,
           count(*) FILTER (WHERE created_at > ${cutoff}) AS events_last_30d,
           count(DISTINCT verb) FILTER (WHERE created_at > ${cutoff}) AS distinct_verbs_30d
      FROM activity_events
     WHERE org_id = ${viewerOrgId} AND entity_type = 'customer' AND entity_id IS NOT NULL
     GROUP BY entity_id
  `);

  const rows = (
    res as unknown as {
      rows: {
        entity_id: number;
        last_activity_at: Date | string;
        events_last_30d: string | number;
        distinct_verbs_30d: string | number;
      }[];
    }
  ).rows;

  const out = new Map<number, CustomerActivityStats>();
  for (const r of rows) {
    out.set(r.entity_id, {
      entityId: r.entity_id,
      lastActivityAt:
        r.last_activity_at instanceof Date
          ? r.last_activity_at
          : new Date(r.last_activity_at),
      // pglite/pg return bigint aggregate results (count(*), count(DISTINCT ..))
      // as strings over the raw execute() path — Number(...) them here.
      eventsLast30d: Number(r.events_last_30d),
      distinctVerbs30d: Number(r.distinct_verbs_30d),
    });
  }
  return out;
}
