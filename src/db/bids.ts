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
