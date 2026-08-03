import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";
import type { BidStatus } from "@/db/bids";
import type { PartnerBidRow } from "@/lib/negotiation/compute";
import { resolveOrgLabel } from "@/lib/auth/orgLabel";

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

/**
 * Minimal deal snapshot needed to drive the negotiation coach (slice 42-2,
 * src/lib/negotiation/actions.ts `getNegotiationCoaching`): the owning org
 * (the OWNER-ONLY authz check compares this against the caller's session
 * org — the security core of that action), the deal's kind (BUY/SELL,
 * which flips every uplift/suggestion sign in `computeNegotiationStats`),
 * and its posted price (the coaching "ask"). Returns null for a
 * missing/unknown id; the caller collapses that into the SAME Forbidden as
 * a real cross-org id (house convention — never let a caller distinguish
 * "doesn't exist" from "not yours", e.g. `saveCustomerStyleNote` in
 * src/lib/drafting/actions.ts).
 *
 * Intentionally NOT scoped by org in its own WHERE clause — unlike every
 * other reader in this file, there is no "owner" to scope by yet at the
 * point this is called (finding out who owns it IS the point of this
 * read). The comparison happens in the caller, mirroring `canSeeDeal`'s
 * shape in src/lib/deals/actions.ts.
 *
 * Demo mode reads `getSeedDeals()` (src/lib/demo/seed.ts) rather than the
 * real `deals` table — same reason as `getPartnerBidHistory` above: this
 * codebase's demo seed is a pure-TS in-memory module, no runner inserts
 * into pglite/Neon for demo mode. Without this branch, the demo "coach me"
 * flow would find no row for deal 109 and permanently 403.
 */
export async function getDealForCoaching(
  db: Db,
  dealId: number,
): Promise<{ orgId: number; kind: "BUY" | "SELL"; priceCents: number } | null> {
  if (isDemoMode()) {
    const { getSeedDeals } = await import("@/lib/demo/seed");
    const row = getSeedDeals().find((d) => d.id === dealId);
    return row ? { orgId: row.orgId, kind: row.kind, priceCents: row.priceCents } : null;
  }

  const res = await db.execute(sql`
    SELECT org_id, kind, price_cents
    FROM deals
    WHERE id = ${dealId}
    LIMIT 1
  `);
  const [row] = rowsOf<{ org_id: number; kind: "BUY" | "SELL"; price_cents: number }>(res);
  return row ? { orgId: row.org_id, kind: row.kind, priceCents: row.price_cents } : null;
}

/**
 * This partner's PENDING bid(s) on the CURRENT deal, org-scoped to the
 * owner (defense-in-depth belt-and-suspenders: by the time
 * `getNegotiationCoaching` calls this, it has already verified
 * `deal.orgId === session.orgId`, but the WHERE clause re-asserts it anyway
 * — same convention as `setDealThreadMode`'s re-checked UPDATE in
 * src/lib/deals/actions.ts) — PLUS an always-non-null display label for
 * them, so the caller never has to reach for a second, conditional lookup
 * just to name the partner it's already coaching about.
 *
 * The label is read off the SAME bid rows when there is a pending one
 * (`bidder_org_label` is denormalized onto every bid, see src/db/bids.ts) —
 * free, no extra round-trip. When this partner has no pending bid on THIS
 * deal (closed-but-no-longer-bidding, or simply never bid here), it falls
 * back to `resolveOrgLabel` (src/lib/auth/orgLabel.ts), the same org-name
 * reader `postDealMessage`/`postBid` use — safe here because `bidderOrgId`
 * FK-references `orgs.id`, so any real org id resolves to a real name (or
 * that helper's own generic "Org {id}" fallback, never a throw).
 *
 * Demo mode filters `DEMO_BIDS` (src/lib/demo/seed.ts) instead — same
 * reason as `getPartnerBidHistory`/`getDealForCoaching` above — and never
 * calls `resolveOrgLabel` at all (there is no live `orgs` table to lean on
 * in a real demo deployment): an unmatched demo id falls back to the same
 * generic "Org {id}" shape `resolveOrgLabel` itself would produce, just
 * built locally instead of round-tripping a query that would find nothing.
 *
 * ⚠ Same "owner-only analytic read, not a viewer predicate" distinction as
 * `getPartnerBidHistory` above — do not merge this with `getBidsForDeal`'s
 * bidder|owner OR clause (src/db/bids.ts). Re-derive from what THIS read is
 * for if you ever touch it.
 */
export async function getPartnerPendingBidsOnDeal(
  db: Db,
  ownerOrgId: number,
  dealId: number,
  bidderOrgId: number,
): Promise<{ priceCents: number[]; partnerLabel: string }> {
  if (isDemoMode()) {
    const { DEMO_BIDS } = await import("@/lib/demo/seed");
    const rows = DEMO_BIDS.filter(
      (b) => b.dealId === dealId && b.bidderOrgId === bidderOrgId && b.status === "pending",
    );
    return {
      priceCents: rows.map((b) => b.priceCents),
      partnerLabel: rows[0]?.bidderOrgLabel ?? `Org ${bidderOrgId}`,
    };
  }

  const res = await db.execute(sql`
    SELECT b.price_cents, b.bidder_org_label
    FROM bids b
    JOIN deals d ON d.id = b.deal_id
    WHERE d.id = ${dealId}
      AND d.org_id = ${ownerOrgId}
      AND b.bidder_org_id = ${bidderOrgId}
      AND b.status = 'pending'
  `);
  const rows = rowsOf<{ price_cents: number; bidder_org_label: string }>(res);
  const partnerLabel = rows[0]?.bidder_org_label ?? (await resolveOrgLabel(db, bidderOrgId));
  return { priceCents: rows.map((r) => r.price_cents), partnerLabel };
}
