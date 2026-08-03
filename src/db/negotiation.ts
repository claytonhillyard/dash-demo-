import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";
import type { BidStatus } from "@/db/bids";
import type { PartnerBidRow } from "@/lib/negotiation/compute";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

/**
 * Returns every bid `bidderOrgId` has placed on deals OWNED by
 * `ownerOrgId`, excluding `excludeDealId` (the deal currently being
 * negotiated) — the raw material for the negotiation coach's per-partner
 * stats (`computeNegotiationStats`, src/lib/negotiation/compute.ts).
 * Ordered by `dealId` then `createdAt` ascending (oldest bid first within
 * each deal), matching `computeNegotiationStats`'s own first-bid-by-
 * earliest-createdAt logic — though that function re-derives "first" itself
 * and does not depend on input order.
 *
 * ⚠ Org-scoping here is DELIBERATELY `d.org_id = ownerOrgId` alone — this is
 * NOT the slice-16 `getBidsForDeal` visibility predicate
 * (`b.bidder_org_id = viewer OR d.org_id = viewer`), and the two must not be
 * confused or merged:
 *   - `getBidsForDeal` answers "what can THIS VIEWER see on THIS deal" — a
 *     bidder must see their OWN bid even on someone else's deal, so its
 *     predicate is an OR across both roles (see its own warning comment in
 *     src/db/bids.ts).
 *   - `getPartnerBidHistory` answers a different question: "how has THIS
 *     PARTNER historically negotiated against MY (the owner's) deals" — an
 *     aggregate, owner-only analytic read. It is consumed ONLY by the
 *     owner-gated `getNegotiationCoaching` action (slice 42-2), which
 *     checks `deal.orgId === session.orgId` before ever calling this. There
 *     is no "viewer" role here, only an owner and a partner — an
 *     OR-across-roles predicate would be actively wrong: it would also pull
 *     in bids this partner placed as an OWNER on ITS OWN deals elsewhere,
 *     which has nothing to do with "your history negotiating with me." If
 *     you ever touch this predicate, re-derive it from what this function
 *     is actually for — do not copy getBidsForDeal's.
 *
 * Demo mode returns the authored `DEMO_PARTNER_BID_HISTORY` (via
 * `getSeedPartnerBidHistory`) rather than `[]` — unlike every other
 * demo-mode short-circuit in this codebase. `getBidsForDeal` demo-branches
 * to `[]`, which would otherwise make the demo coach permanently report
 * `insufficient_history` (demo-is-canonical: the seed IS the product demo,
 * so it must show a real `coached` verdict).
 */
export async function getPartnerBidHistory(
  db: Db,
  ownerOrgId: number,
  bidderOrgId: number,
  excludeDealId: number,
): Promise<PartnerBidRow[]> {
  if (isDemoMode()) {
    const { getSeedPartnerBidHistory } = await import("@/lib/demo/seed");
    return getSeedPartnerBidHistory(ownerOrgId, bidderOrgId, excludeDealId);
  }

  const res = await db.execute(sql`
    SELECT b.deal_id, d.kind AS deal_kind, d.price_cents AS deal_price_cents,
           b.price_cents AS bid_price_cents, b.status, b.created_at, b.decided_at
    FROM bids b
    JOIN deals d ON d.id = b.deal_id
    WHERE d.org_id = ${ownerOrgId}
      AND b.bidder_org_id = ${bidderOrgId}
      AND b.deal_id != ${excludeDealId}
    ORDER BY b.deal_id ASC, b.created_at ASC
  `);

  const rows = rowsOf<{
    deal_id: number;
    deal_kind: "BUY" | "SELL";
    deal_price_cents: number;
    bid_price_cents: number;
    status: BidStatus;
    created_at: Date | string;
    decided_at: Date | string | null;
  }>(res);

  return rows.map((r) => ({
    dealId: r.deal_id,
    dealKind: r.deal_kind,
    dealPriceCents: r.deal_price_cents,
    bidPriceCents: r.bid_price_cents,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    decidedAt:
      r.decided_at === null
        ? null
        : r.decided_at instanceof Date
        ? r.decided_at
        : new Date(r.decided_at),
  }));
}
