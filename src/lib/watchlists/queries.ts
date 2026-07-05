import { and, eq, desc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { watchlists } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_WATCHLISTS } from "@/lib/demo/seed";
import type { ActivityEntityType } from "@/lib/activity/types";

/** Shape returned by both readers — mirrors the `watchlists` row exactly
 *  (minus orgId/actor, which are the caller's own scoping inputs, not
 *  something the UI needs to display). */
export type WatchlistView = {
  id: number;
  entityType: ActivityEntityType;
  entityId: number;
  notifyEmail: string;
  lastNotifiedAt: Date | null;
  createdAt: Date;
};

const COLUMNS = {
  id: watchlists.id,
  entityType: watchlists.entityType,
  entityId: watchlists.entityId,
  notifyEmail: watchlists.notifyEmail,
  lastNotifiedAt: watchlists.lastNotifiedAt,
  createdAt: watchlists.createdAt,
} as const;

/** The `/watchlists` page list — every watch the actor owns in their org,
 *  newest first. */
export async function getWatchlistsForActor(
  db: Db,
  orgId: number,
  actor: string,
): Promise<WatchlistView[]> {
  if (isDemoMode()) {
    return DEMO_WATCHLISTS.filter((w) => w.orgId === orgId && w.actor === actor)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(({ orgId: _o, actor: _a, ...view }) => view);
  }
  const rows = await db
    .select(COLUMNS)
    .from(watchlists)
    .where(and(eq(watchlists.orgId, orgId), eq(watchlists.actor, actor)))
    .orderBy(desc(watchlists.createdAt), desc(watchlists.id));
  return rows as WatchlistView[];
}

/** Drives the WatchToggle's initial state — the single watch (if any) this
 *  actor holds on a specific entity. Null when not watching. */
export async function getWatchForEntity(
  db: Db,
  orgId: number,
  actor: string,
  entityType: ActivityEntityType,
  entityId: number,
): Promise<WatchlistView | null> {
  if (isDemoMode()) {
    const row = DEMO_WATCHLISTS.find(
      (w) =>
        w.orgId === orgId &&
        w.actor === actor &&
        w.entityType === entityType &&
        w.entityId === entityId,
    );
    if (!row) return null;
    const { orgId: _o, actor: _a, ...view } = row;
    return view;
  }
  const [row] = await db
    .select(COLUMNS)
    .from(watchlists)
    .where(
      and(
        eq(watchlists.orgId, orgId),
        eq(watchlists.actor, actor),
        eq(watchlists.entityType, entityType),
        eq(watchlists.entityId, entityId),
      ),
    )
    .limit(1);
  return (row as WatchlistView) ?? null;
}
