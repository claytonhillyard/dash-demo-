import type { BidStatus } from "@/db/bids";

/**
 * Pure, deterministic negotiation-coach stats (slice 42 spec —
 * docs/superpowers/plans/2026-07-31-negotiation-coach-slice-42.md). No
 * clock, no I/O: every input is injected by the caller
 * (src/lib/negotiation/actions.ts, slice 42-2), so results are exactly
 * reproducible in tests and safe to call from server or client code alike.
 *
 * Domain semantics (get this right — it inverts the math): `deals.kind` is
 * from the OWNER's perspective. SELL = the owner is selling, bidders bid to
 * buy, so the owner wants the HIGHEST price — a "better" bid is higher, and
 * uplift is upward movement. BUY = the owner is buying, bidders offer to
 * sell, so the owner wants the LOWEST price — better is lower, and uplift
 * is downward movement. Every comparison below respects this per-deal,
 * never assuming the current deal's kind applies to historical deals too.
 */

/**
 * One bid this partner placed on one of the owner's OTHER deals — the raw
 * material `getPartnerBidHistory` (src/db/negotiation.ts) reads and
 * `computeNegotiationStats` below turns into coaching stats.
 *
 * `dealKind`/`dealPriceCents` describe the DEAL the bid was placed on. This
 * is deliberately per-row (not a single shared kind for the whole history
 * array): a partner who has both sold TO the owner and bought FROM the
 * owner in the past will have BOTH kinds mixed in one `history` array, and
 * every historical close's uplift sign must be judged against ITS OWN
 * deal's kind — never against the CURRENT deal's kind (`current.kind`
 * below is a completely separate, independent input).
 */
export type PartnerBidRow = {
  dealId: number;
  dealKind: "BUY" | "SELL";
  dealPriceCents: number;
  bidPriceCents: number;
  status: BidStatus;
  createdAt: Date;
  decidedAt: Date | null;
};

/**
 * Negotiation-coach verdict for one partner against the deal currently
 * being negotiated.
 *
 * `insufficient_history` is deliberately NOT an empty/blank state — it
 * still reports whatever IS known (closes so far, the partner's current
 * best pending bid, the ask) so the card can be honest without being
 * useless. `coached` additionally requires >= 2 closes: a single data point
 * isn't a pattern worth coaching from.
 */
export type NegotiationStats =
  | {
      kind: "insufficient_history";
      partnerLabel: string;
      closes: number;
      currentBestCents: number | null;
      askCents: number;
    }
  | {
      kind: "coached";
      partnerLabel: string;
      closes: number; // prior deals where THIS partner's bid was accepted
      decidedDeals: number; // prior deals with this partner that reached a decision
      winRatePct: number; // closes / decidedDeals, 0..100 integer
      avgUpliftCents: number; // mean |accepted − their first bid| signed toward the owner's favor
      avgRounds: number; // mean bids they placed per decided deal, 1 decimal
      medianDaysToDecide: number; // whole days, first bid → decidedAt
      currentBestCents: number | null; // their best PENDING bid on the CURRENT deal (kind-aware)
      askCents: number; // the current deal's posted price
      suggestedCounterCents: number; // currentBest ± avgUplift (kind-aware), clamped 1..2_147_483_647
    };

const MIN_CLOSES_FOR_COACHING = 2;

// Postgres int4 ceiling — every *_cents column in schema.ts is a plain
// `integer`, so a suggested counter must never exceed this. Same constant
// as src/lib/invoices/actions.ts's MAX_MONEY_CENTS (kept as a private local
// here rather than a shared import — this module must stay dependency-free
// of anything beyond the pure type it needs, see the module doc above).
const MAX_CENTS = 2_147_483_647;

/**
 * A bid row counts toward "decided" only when the OWNER made an explicit
 * call on THIS partner's bid — accepted it or rejected it. `withdrawn` (the
 * partner's own choice to leave) and `auto_rejected` (collateral from a
 * DIFFERENT bidder's bid winning the same deal) both carry a `decidedAt`
 * stamp too (see acceptBid/withdrawBid in src/lib/deals/actions.ts), but
 * neither reflects a decision ABOUT this partner's bid, so neither should
 * move the negotiation-coach's win rate, round count, or decide-time
 * stats — a partner who withdrew or lost to a competitor told us nothing
 * about how the owner negotiates with THEM specifically.
 */
function isExplicitDecision(status: BidStatus): boolean {
  return status === "accepted" || status === "rejected";
}

function groupByDeal(history: PartnerBidRow[]): PartnerBidRow[][] {
  const byDeal = new Map<number, PartnerBidRow[]>();
  for (const row of history) {
    const group = byDeal.get(row.dealId);
    if (group) group.push(row);
    else byDeal.set(row.dealId, [row]);
  }
  return [...byDeal.values()];
}

function isCloseGroup(rows: PartnerBidRow[]): boolean {
  return rows.some((r) => r.status === "accepted");
}

function isDecidedGroup(rows: PartnerBidRow[]): boolean {
  return rows.some((r) => isExplicitDecision(r.status));
}

/** The row with the earliest `createdAt` in the group — this partner's
 *  opening bid on that deal, regardless of what its status ended up being
 *  (an opening bid superseded by a later round is commonly auto_rejected,
 *  not pending, by the time the deal is decided). */
function firstBidOf(rows: PartnerBidRow[]): PartnerBidRow {
  return rows.reduce((earliest, r) => (r.createdAt.getTime() < earliest.createdAt.getTime() ? r : earliest));
}

/** The instant this deal was finally decided: the latest `decidedAt` among
 *  the group's rows. Almost always a single value in practice (one
 *  explicit-decision row per group), but a partner who was rejected once
 *  and re-bid successfully has TWO decidedAt stamps (the earlier rejection,
 *  the later acceptance) — the later one is when the deal, as a whole, was
 *  actually settled. */
function decidedAtOf(rows: PartnerBidRow[]): Date {
  const stamped = rows.filter((r): r is PartnerBidRow & { decidedAt: Date } => r.decidedAt !== null);
  // A group can only reach here via an accepted/rejected row, and every
  // production setter stamps `decidedAt` alongside the status — but there is
  // no DB constraint tying the two, so a data anomaly (decided status, NULL
  // decidedAt) would otherwise reduce an empty array and throw, surfacing as
  // an opaque "Server error" (review finding). Fall back to the first bid's
  // timestamp, which reads as a 0-day decision rather than a 500.
  if (stamped.length === 0) return firstBidOf(rows).createdAt;
  return stamped.reduce((latest, r) => (r.decidedAt.getTime() > latest.decidedAt.getTime() ? r : latest)).decidedAt;
}

/** Mean, rounded to an integer. `avgUpliftCents` can legitimately be
 *  negative (a partner's closes can average toward the owner conceding),
 *  so a raw mean in (-0.5, 0) rounds to `-0` — the `+ 0` below collapses
 *  that to +0 (same trap/fix as `computeRunway`'s `avgMonthlyProfitCents`
 *  in src/lib/runway/compute.ts: `Object.is(-0, 0)` is `false`, so a bare
 *  `-0` would fail a `toBe(0)` assertion even though it's mathematically
 *  zero). */
function meanRounded(values: number[]): number {
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) + 0;
}

/** Mean quantized to 1 decimal place, e.g. 5/3 = 1.6666... -> 1.7. */
function mean1Decimal(values: number[]): number {
  const raw = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(raw * 10) / 10;
}

/** Median of whole-day integers: the middle value for an odd count, the
 *  rounded mean of the middle two for an even count. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Kind-aware "best" price among a partner's pending bids on the CURRENT
 *  deal: the highest offer is best for a SELL (the owner is selling), the
 *  lowest is best for a BUY (the owner is buying). `[]` -> null — honestly
 *  "no pending bid," not a fabricated 0. */
function pendingBest(kind: "BUY" | "SELL", pendingCents: number[]): number | null {
  if (pendingCents.length === 0) return null;
  return kind === "SELL" ? Math.max(...pendingCents) : Math.min(...pendingCents);
}

function clampCents(raw: number): number {
  return Math.max(1, Math.min(MAX_CENTS, Math.round(raw)));
}

/**
 * Turns one partner's bid history against the owner (on the owner's OTHER
 * deals) plus the live state of the CURRENT deal into a coaching verdict.
 *
 * - Groups `history` by `dealId`. A group is a *close* if it has an
 *   `"accepted"` row; it's *decided* if it has an accepted OR rejected row
 *   (see `isExplicitDecision` above for why withdrawn/auto_rejected don't
 *   qualify).
 * - `< 2` closes -> `insufficient_history`, still reporting closes/
 *   currentBest/ask.
 * - Per close: `firstBid` is the earliest-`createdAt` row in the group;
 *   `accepted` is its accepted row. Uplift is signed toward the owner's
 *   favor using THAT group's OWN `dealKind` (never `current.kind`):
 *   SELL -> accepted − first; BUY -> first − accepted. Averaged
 *   (`Math.round`) into `avgUpliftCents`.
 * - `currentBestCents` is the kind-aware best of
 *   `current.partnerPendingBidsCents` (max for SELL, min for BUY; `[]` ->
 *   null) — reported in BOTH branches.
 * - `suggestedCounterCents` is `askCents` when there's no current pending
 *   bid, else `currentBest ± avgUplift` (kind-aware), clamped to the int4
 *   range `1..2_147_483_647`.
 * - `medianDaysToDecide` is the median, across the *decided* set, of whole
 *   UTC days (`Math.floor`) from each group's first bid to its
 *   `decidedAtOf` instant.
 */
export function computeNegotiationStats(
  history: PartnerBidRow[],
  current: { kind: "BUY" | "SELL"; askCents: number; partnerPendingBidsCents: number[] },
  partnerLabel: string,
): NegotiationStats {
  const groups = groupByDeal(history);
  const closeGroups = groups.filter(isCloseGroup);
  const closes = closeGroups.length;
  const currentBestCents = pendingBest(current.kind, current.partnerPendingBidsCents);

  if (closes < MIN_CLOSES_FOR_COACHING) {
    return {
      kind: "insufficient_history",
      partnerLabel,
      closes,
      currentBestCents,
      askCents: current.askCents,
    };
  }

  const decidedGroups = groups.filter(isDecidedGroup);
  const decidedDeals = decidedGroups.length;

  const upliftValues = closeGroups.map((rows) => {
    const first = firstBidOf(rows);
    const accepted = rows.find((r) => r.status === "accepted")!;
    return rows[0].dealKind === "SELL"
      ? accepted.bidPriceCents - first.bidPriceCents
      : first.bidPriceCents - accepted.bidPriceCents;
  });
  const avgUpliftCents = meanRounded(upliftValues);

  const winRatePct = Math.round((closes / decidedDeals) * 100);
  const avgRounds = mean1Decimal(decidedGroups.map((rows) => rows.length));
  const medianDaysToDecide = median(
    decidedGroups.map((rows) => {
      const first = firstBidOf(rows);
      const decidedAt = decidedAtOf(rows);
      // Clamped: clock skew between the bid insert and the decision stamp
      // could otherwise report a negative "days to decide" (review finding).
      return Math.max(0, Math.floor((decidedAt.getTime() - first.createdAt.getTime()) / 86_400_000));
    }),
  );

  const suggestedRaw =
    currentBestCents === null
      ? current.askCents
      : current.kind === "SELL"
      ? currentBestCents + avgUpliftCents
      : currentBestCents - avgUpliftCents;

  return {
    kind: "coached",
    partnerLabel,
    closes,
    decidedDeals,
    winRatePct,
    avgUpliftCents,
    avgRounds,
    medianDaysToDecide,
    currentBestCents,
    askCents: current.askCents,
    suggestedCounterCents: clampCents(suggestedRaw),
  };
}
