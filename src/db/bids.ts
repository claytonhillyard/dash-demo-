import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

export type BidStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "auto_rejected";

export type BidView = {
  id: number;
  dealId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  bidMode: "single" | "history";
  status: BidStatus;
  decidedAt: Date | null;
  createdAt: Date;
};

/**
 * Returns bids on a single deal visible to `viewerOrgId`, ordered newest-first.
 *
 * Visibility is SQL-enforced (NEVER application-layer filtering):
 *   bidder_org_id = viewer OR deals.org_id = viewer
 *
 * Visibility is INTENTIONALLY decoupled from deals.thread_mode. Bids are
 * structured trade negotiations; even in group thread_mode, a bid is for
 * the owner's eyes only. See slice-16 spec §4.
 *
 * ⚠ VISIBILITY PREDICATE — slice-16-local (NOT the slice-4 can-see-deal
 * rule). If you change this, update:
 *   - getTodaysBidsForOwner WHERE clause (below in this file)
 *   - canBidOn helper in src/lib/deals/actions.ts (slice-16 write side)
 *
 * Demo mode short-circuits to `[]` (matches slice-10 query helper convention).
 */
export async function getBidsForDeal(
  db: Db,
  viewerOrgId: number,
  dealId: number,
): Promise<BidView[]> {
  if (isDemoMode()) return [];

  const res = await db.execute(sql`
    SELECT b.id, b.deal_id, b.bidder_org_id, b.bidder_org_label,
           b.price_cents, b.currency, b.notes, b.bid_mode,
           b.status, b.decided_at, b.created_at
    FROM bids b
    JOIN deals d ON d.id = b.deal_id
    WHERE b.deal_id = ${dealId}
      AND (b.bidder_org_id = ${viewerOrgId} OR d.org_id = ${viewerOrgId})
    ORDER BY b.created_at DESC
  `);

  const rows = rowsOf<{
    id: number;
    deal_id: number;
    bidder_org_id: number;
    bidder_org_label: string;
    price_cents: number;
    currency: string;
    notes: string | null;
    bid_mode: "single" | "history";
    status: BidStatus;
    decided_at: Date | string | null;
    created_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id,
    bidderOrgId: r.bidder_org_id,
    bidderOrgLabel: r.bidder_org_label,
    priceCents: r.price_cents,
    currency: r.currency,
    notes: r.notes,
    bidMode: r.bid_mode,
    status: r.status,
    decidedAt:
      r.decided_at === null
        ? null
        : r.decided_at instanceof Date
        ? r.decided_at
        : new Date(r.decided_at),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

/**
 * Owner-only read of a deal's current `bid_mode`. Returns null when the
 * caller is not the owner (or the deal doesn't exist) — gating the owner's
 * bid-display selector in the Bids tab.
 *
 * Mirrors the slice-10 `getDealThreadModeForOwner` pattern.
 * NOT demo-mode-gated — consulted at render time on the demo seed too.
 */
export async function getDealBidModeForOwner(
  db: Db,
  viewerOrgId: number,
  dealId: number,
): Promise<"single" | "history" | null> {
  const res = await db.execute(sql`
    SELECT bid_mode AS bid_mode
    FROM deals
    WHERE id = ${dealId} AND org_id = ${viewerOrgId}
    LIMIT 1
  `);
  const rows = (res as unknown as { rows: { bid_mode: "single" | "history" }[] }).rows;
  return rows[0]?.bid_mode ?? null;
}

export type TodaysBidView = {
  bidId: number;
  dealId: number;
  dealSubject: string;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  createdAt: Date;
};

/**
 * Returns today's PENDING bids on deals owned by `viewerOrgId`.
 * "Today" = `created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`.
 * LIMIT 30.
 *
 * ⚠ VISIBILITY PREDICATE — mirrors the owner-side of getBidsForDeal.
 * If you change "deals.org_id = viewer" here, update getBidsForDeal +
 * canBidOn (src/lib/deals/actions.ts) at the same time.
 *
 * Demo mode short-circuits to `[]`.
 */
export async function getTodaysBidsForOwner(
  db: Db,
  viewerOrgId: number,
): Promise<TodaysBidView[]> {
  if (isDemoMode()) return [];

  // The "today UTC" cutoff is computed in three steps so both sides of the
  // >= comparison are timestamptz (never a bare timestamp). The trailing
  // `AT TIME ZONE 'UTC'` is LOAD-BEARING — don't remove it as "redundant":
  //   1. `now()`                                     → timestamptz (current UTC instant)
  //   2. `... AT TIME ZONE 'UTC'`                    → timestamp (UTC wall-clock, bare)
  //   3. `date_trunc('day', ...)`                    → timestamp (midnight UTC, bare)
  //   4. `... AT TIME ZONE 'UTC'`                    → timestamptz (midnight UTC instant)
  // Without step 4, PG implicitly converts the bare timestamp using the
  // SESSION timezone for the comparison — which can be ±12h off on a
  // non-UTC machine, silently filtering or admitting bids by the wrong day.
  const res = await db.execute(sql`
    SELECT b.id AS bid_id, d.id AS deal_id, d.subject AS deal_subject,
           b.bidder_org_label, b.price_cents, b.currency, b.created_at
    FROM bids b
    JOIN deals d ON d.id = b.deal_id
    WHERE d.org_id = ${viewerOrgId}
      AND b.status = 'pending'
      AND b.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ORDER BY b.created_at DESC
    LIMIT 30
  `);

  const rows = rowsOf<{
    bid_id: number;
    deal_id: number;
    deal_subject: string;
    bidder_org_label: string;
    price_cents: number;
    currency: string;
    created_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    bidId: r.bid_id,
    dealId: r.deal_id,
    dealSubject: r.deal_subject,
    bidderOrgLabel: r.bidder_org_label,
    priceCents: r.price_cents,
    currency: r.currency,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}
