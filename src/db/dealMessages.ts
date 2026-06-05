import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";

export type DealMessageView = {
  id: number;
  dealId: number;
  fromOrgId: number;
  fromOrgLabel: string;
  /** `null` when the message has been soft-deleted — caller renders a tombstone. */
  body: string | null;
  threadMode: "private" | "group";
  isDeleted: boolean;
  createdAt: Date;
};

/**
 * Returns the messages on a single deal that are visible to `viewerOrgId`,
 * ordered ascending by `created_at`.
 *
 * Visibility is enforced entirely in SQL (NEVER in TS) and is the AND of:
 *   (1) the slice-4 "can-see-this-deal" rule: owner OR in-circle member
 *   (2) the slice-10 "can-see-this-message" rule: group, OR self-authored,
 *       OR the viewer is the deal owner (owner sees every private thread).
 *
 * Demo mode short-circuits to `[]` (matches slice-4 query helper convention —
 * demo data is seed-rendered statically; no live writes).
 */
export async function getDealMessages(
  db: Db,
  viewerOrgId: number,
  dealId: number,
): Promise<DealMessageView[]> {
  if (isDemoMode()) return [];

  const res = await db.execute(sql`
    SELECT m.id            AS id,
           m.deal_id       AS deal_id,
           m.from_org_id   AS from_org_id,
           m.from_org_label AS from_org_label,
           CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.body END AS body,
           m.thread_mode   AS thread_mode,
           (m.deleted_at IS NOT NULL) AS is_deleted,
           m.created_at    AS created_at
    FROM deal_messages m
    JOIN deals d ON d.id = m.deal_id
    WHERE m.deal_id = ${dealId}
      AND (
        d.org_id = ${viewerOrgId}
        OR (
          d.visibility_circle_id IS NOT NULL
          AND d.visibility_circle_id IN (
            SELECT circle_id FROM circle_members WHERE org_id = ${viewerOrgId}
          )
        )
      )
      AND (
        m.thread_mode = 'group'
        OR m.from_org_id = ${viewerOrgId}
        OR d.org_id = ${viewerOrgId}
      )
    ORDER BY m.created_at ASC
  `);

  const rows = (res as unknown as {
    rows: {
      id: number;
      deal_id: number;
      from_org_id: number;
      from_org_label: string;
      body: string | null;
      thread_mode: "private" | "group";
      is_deleted: boolean;
      created_at: Date | string;
    }[];
  }).rows;

  return rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id,
    fromOrgId: r.from_org_id,
    fromOrgLabel: r.from_org_label,
    body: r.body,
    threadMode: r.thread_mode,
    isDeleted: r.is_deleted,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

/**
 * Returns a Map<dealId, unreadCount> for the supplied deals.
 *
 * "Unread" = messages on each deal where:
 *   - the viewer can see the message (slice-4 + slice-10 visibility, same as getDealMessages)
 *   - created_at > coalesce(last_read_at, '-infinity')
 *   - from_org_id != viewerOrgId (own messages never count)
 *   - deleted_at IS NULL
 *
 * Deals with no unread messages are still returned with `0` so the caller
 * can render "💬 N" (subtle) badges for deals with messages but nothing new.
 * Deals with literally zero messages are NOT in the result map.
 *
 * Demo-mode short-circuit: returns an empty Map.
 */
export async function getUnreadCountsForOrg(
  db: Db,
  viewerOrgId: number,
  dealIds: number[],
): Promise<Map<number, number>> {
  if (isDemoMode() || dealIds.length === 0) return new Map();

  const res = await db.execute(sql`
    SELECT m.deal_id AS deal_id,
           COUNT(*) FILTER (
             WHERE m.from_org_id != ${viewerOrgId}
               AND m.deleted_at IS NULL
               AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz)
           )::int AS unread
    FROM deal_messages m
    JOIN deals d ON d.id = m.deal_id
    LEFT JOIN deal_thread_reads r
      ON r.deal_id = m.deal_id AND r.org_id = ${viewerOrgId}
    WHERE m.deal_id IN (${sql.join(
      dealIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND (
        d.org_id = ${viewerOrgId}
        OR (
          d.visibility_circle_id IS NOT NULL
          AND d.visibility_circle_id IN (
            SELECT circle_id FROM circle_members WHERE org_id = ${viewerOrgId}
          )
        )
      )
      AND (
        m.thread_mode = 'group'
        OR m.from_org_id = ${viewerOrgId}
        OR d.org_id = ${viewerOrgId}
      )
    GROUP BY m.deal_id
  `);

  const rows = (res as unknown as { rows: { deal_id: number; unread: number }[] }).rows;
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.deal_id, r.unread);
  return map;
}

/**
 * Returns the current `deals.thread_mode` for the caller IFF the caller is
 * the deal's owner, else `null`. The panel uses the null return to decide
 * whether to render the mode-selector UI.
 *
 * NOT demo-mode-gated: this is consulted at render time and we want the
 * mode banner to show even on the seeded demo dataset.
 */
export async function getDealThreadModeForOwner(
  db: Db,
  viewerOrgId: number,
  dealId: number,
): Promise<"private" | "group" | null> {
  const res = await db.execute(sql`
    SELECT thread_mode AS thread_mode
    FROM deals
    WHERE id = ${dealId} AND org_id = ${viewerOrgId}
    LIMIT 1
  `);
  const rows = (res as unknown as { rows: { thread_mode: "private" | "group" }[] }).rows;
  return rows[0]?.thread_mode ?? null;
}
