# Slice 42 — Negotiation Coach AI — Design + Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. This doc is BOTH the spec and the plan (the C-7 pattern).

**Goal:** In a deal's bids tab, the owner clicks "Coach me" and gets grounded tactical advice about the leading bidder — "your last 3 closes with Ginza Pearl averaged +$1,200 over their first bid; counter at $12,500." Deterministic stats + an AI sentence with a keyless fallback. **Read-only, owner-only, on-demand** (a button → action; NOT computed on every dashboard render — that would bill AI on every page load).

**Working directory:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-42-negotiation-coach`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; NEVER write the literal `@vitest-environment` in prose comments; "use server" export rules; a silent exit-1 may be the flapping sandbox — retry.

**Reference files:** `src/db/bids.ts` (`BidView`, `getBidsForDeal` — note its SQL-enforced visibility predicate + demo `[]`), `src/db/schema.ts` (`bids`, `deals`), `src/components/deals/DealBidsTab.tsx` (the surface) + `DealThreadAccordion.tsx`, `src/lib/investor/narrative.ts` (the AI-garnish + simulated-fallback pattern to mirror EXACTLY), `src/lib/customers/healthInsight.ts` (prompt-PII precedent), `src/lib/drafting/actions.ts` (`draftEmail` — the read-only demo-guard-skip + hand-rolled session precedent), `src/lib/company/format.ts` (`formatCentsExact`).

---

## Domain semantics (get this right — it inverts the math)

`deals.kind` is from the **owner's** perspective:
- `SELL` — the owner is selling; bidders bid to buy → the owner wants the **highest** price. A "better" bid is higher; uplift is positive movement upward.
- `BUY` — the owner is buying; bidders offer to sell → the owner wants the **lowest** price. Better is lower; uplift is downward movement.

Every comparison/suggestion below must respect this. Tests must cover BOTH kinds.

## Task 42-1 — Pure compute + partner-history reader

**Files:**
1. `src/lib/negotiation/compute.ts`:
```ts
export type PartnerBidRow = {
  dealId: number; dealKind: "BUY" | "SELL"; dealPriceCents: number;
  bidPriceCents: number; status: BidStatus;
  createdAt: Date; decidedAt: Date | null;
};
export type NegotiationStats =
  | { kind: "insufficient_history"; partnerLabel: string; closes: number;
      currentBestCents: number | null; askCents: number }
  | { kind: "coached"; partnerLabel: string;
      closes: number;                      // prior deals where THIS partner's bid was accepted
      decidedDeals: number;                // prior deals with this partner that reached a decision
      winRatePct: number;                  // closes / decidedDeals, 0..100 integer
      avgUpliftCents: number;              // mean |accepted − their first bid| signed toward the owner's favor
      avgRounds: number;                   // mean bids they placed per decided deal, 1 decimal
      medianDaysToDecide: number;          // whole days, first bid → decidedAt
      currentBestCents: number | null;     // their best PENDING bid on the CURRENT deal (kind-aware)
      askCents: number;                    // the current deal's posted price
      suggestedCounterCents: number };     // currentBest ± avgUplift (kind-aware), clamped 1..2_147_483_647
export function computeNegotiationStats(
  history: PartnerBidRow[],        // prior bids by this partner on the owner's OTHER deals
  current: { kind: "BUY"|"SELL"; askCents: number; partnerPendingBidsCents: number[] },
  partnerLabel: string,
): NegotiationStats;
```
   - Group `history` by `dealId`. A deal is *decided* if any of its rows has `decidedAt != null`. A deal is a *close* if a row with `status === "accepted"` exists.
   - Per close: `firstBid` = the row with the earliest `createdAt`; `accepted` = the accepted row. `uplift = SELL ? accepted − first : first − accepted` (positive = moved in the owner's favor). Mean over closes → `avgUpliftCents` (integer, `Math.round`).
   - `< 2 closes` → `insufficient_history` (still report closes/currentBest/ask — honest, not empty).
   - `currentBestCents` = kind-aware best of `partnerPendingBidsCents` (max for SELL, min for BUY); `[]` → null.
   - `suggestedCounterCents` = `currentBest == null ? ask : (SELL ? currentBest + avgUplift : currentBest − avgUplift)`, clamped to `1..2_147_483_647`.
   - `medianDaysToDecide`: whole days via UTC-ms diff, `Math.floor`, median of the decided set (even count → mean of the middle two, rounded).
   - PURE: no clock, no db. All inputs injected.
2. `src/db/negotiation.ts`: `getPartnerBidHistory(db, ownerOrgId, bidderOrgId, excludeDealId): Promise<PartnerBidRow[]>` — every bid by `bidderOrgId` on deals **owned by `ownerOrgId`**, excluding `excludeDealId`, joined for `deals.kind`/`deals.price_cents`. Org-scoping is `d.org_id = ownerOrgId` (NOT the slice-16 viewer predicate — this is an owner-only analytic read; comment that distinction loudly). Demo branch: return an authored `DEMO_PARTNER_BID_HISTORY` from seed so the demo coach shows a real *coached* verdict (demo-is-canonical: `getBidsForDeal` demo-branches to `[]`, so without this the demo card would be permanently "insufficient").
3. `src/lib/demo/seed.ts`: `DEMO_PARTNER_BID_HISTORY` (ids 9701+) — enough rows for ≥ 3 closes with one partner on a demo deal (varied uplift, 2–3 rounds each, decided dates) so the demo verdict is `coached` with sane numbers. Export a `getSeedPartnerBidHistory(ownerOrgId, bidderOrgId, excludeDealId)`.

**Tests** `test/lib/negotiation/compute.test.ts` (~18, pure/table-driven: SELL uplift; **BUY inverted uplift**; 0/1 close → insufficient; exactly 2 → coached; win-rate math; avgRounds 1-decimal; median days even/odd; currentBest max-for-SELL vs min-for-BUY; empty pending → null + suggestion falls back to ask; clamp at the int4 ceiling and at ≤0; a withdrawn/auto_rejected row doesn't count as decided-or-close) + `test/db/negotiation.test.ts` (~7, shared-db: history scoped to the owner's deals; a bid by that partner on ANOTHER org's deal is invisible; excludeDealId honored; demo branch returns the authored history).

Verify scoped + tsc. Commit `feat(negotiation): stats compute + partner history reader (slice 42-1)`.

## Task 42-2 — Coach narrative + action

**Files:**
1. `src/lib/ai/types.ts`: `AI_FEATURES += "negotiation-coach"` (`// slice 42`).
2. `src/lib/negotiation/coach.ts` — mirror `src/lib/investor/narrative.ts` EXACTLY: `buildCoachPrompt(stats)` (system: terse trade-desk coach, 2–3 sentences, plain, no hype, never invent numbers; prompt: the stats serialized with `formatCentsExact` — **partner LABEL + aggregates only; the no-@ test locks it**), `simulatedCoaching(stats)` (deterministic 2–3 sentences from the same numbers — used whenever the seam reports `simulated`, ignoring its canned text), `generateCoaching(stats, orgId)` → `{ok:true, lines: string[], simulated} | {ok:false, error}` (seam call `feature:"negotiation-coach"`, tier `"fast"`, `user: org:${orgId}`; empty/blank response → `{ok:false}` — the slice-41 N3 lesson; seam error codes → short friendly messages; never throws).
3. `src/lib/negotiation/actions.ts` ("use server") — `getNegotiationCoaching({ dealId, bidderOrgId })`:
   - Hand-rolled session-first sequence (copy `draftEmail`'s), **demo guard SKIPPED** (read-only + the demo branch has authored history — document it).
   - **OWNER-ONLY authz (the security core):** load the deal and require `deal.orgId === session.orgId` → else `ForbiddenError`. A *bidder* must never receive coaching about the owner. Test this explicitly from the bidder's side.
   - Load `getPartnerBidHistory` + the partner's pending bids on the current deal (org-scoped) → `computeNegotiationStats` → `generateCoaching`.
   - Returns `{ok:true, stats, lines, simulated} | {ok:false, error}`. NO audit (a read), no revalidate.

**Tests** `test/lib/negotiation/coach.test.ts` (~10, mock the AI seam: prompt carries labels+dollars and **no "@"**; simulated substitution ignores the seam's canned text; real path splits lines; empty → error; each seam code mapped; deterministic simulated) + `test/lib/negotiation/actions.test.ts` (~10, shared-db: happy coached path; **a bidder-org caller → Forbidden, zero seam calls**; cross-org dealId → Forbidden; unauthenticated; demo mode returns a coached verdict from the authored history; insufficient-history path; the question/stats never reach Sentry on an executor throw).

Verify scoped + tsc. Commit `feat(negotiation): coach narrative + owner-only coaching action (slice 42-2)`.

## Task 42-3 — Coach card in the bids tab

**Files:**
1. `src/components/deals/NegotiationCoachCard.tsx` (client): props `{ dealId, leadBidderOrgId, leadBidderLabel }`. Idle = a "Coach me" button + one muted line naming the partner. Click → `getNegotiationCoaching` in `useTransition` (button disabled while pending). Rendered result: the advice lines, a compact stat strip (closes · win rate · avg uplift · avg rounds), and the suggested counter as the visual hero (`formatCentsExact`); `insufficient_history` → an honest "Not enough history with <partner> yet (N closes)" + what IS known (their best bid / your ask). `simulated` → the muted "Simulated — set AI_GATEWAY_API_KEY for live coaching" note. `{ok:false}` → an error alert. Conventions from `SendInvoicePanel`/`PaymentsPanel` (no `<form>`, house alert classes). Import ONLY the action + React (client-bundle rule — never the compute/db modules as values; the stats type may be imported `import type`).
2. `src/components/deals/DealBidsTab.tsx`: render the card **owner-only** (`props.isOwner`), above the bid list, for the **leading bidder** — the partner holding the best kind-aware pending bid (compute the leader from the `bids` prop it already has; ties → the earliest `createdAt`). No leader (no pending bids) → render nothing. `DealBidsTab` already has `dealId` + `isOwner`; it needs the deal `kind` to pick the leader — thread `dealKind` down from `DealThreadAccordion` (which has the deal) as a new prop; update its call site + any test factories.

**Tests** `test/components/deals/NegotiationCoachCard.test.tsx` (~8, jsdom, mock `@/lib/negotiation/actions`: idle renders the button + partner; click calls the action with `{dealId, bidderOrgId}`; coached renders the counter + stat strip; insufficient renders the honest line; simulated note; error alert; pending disables; no double-fire) + extend `test/components/deals/DealBidsTab.test.tsx` (~4: card shown for the owner with a leading bidder; hidden for a non-owner; hidden with no pending bids; the leader is the kind-aware best — assert the right `bidderOrgId` reaches the card, incl. one BUY case).

Verify scoped + tsc + `npx next build` (client-graph check: the card must not pull db/compute values). Commit `feat(negotiation): coach card in the deal bids tab (slice 42-3)`.

---

## Final verification (controller)

Full suite detached AFTER all commits. tsc. `next build`. Review probes: **owner-only authz is airtight (a bidder gets Forbidden with zero seam calls)**; BUY-vs-SELL math inversion is right everywhere (compute + leader pick + suggestion); org-scoping on the history read (a partner's bids on another org's deals invisible); no PII/@ in the prompt, no stats/labels in Sentry; the insufficient-history path is honest not empty; demo shows a coached verdict; simulated substitution; client bundle clean; `DealBidsTab`'s new `dealKind` prop rippled everywhere it's constructed. Apply fixes → merge --no-ff → ROADMAP 42 shipped + HANDOFF → clean up `.worktrees/slice-31-doc-vault` + branch.

## Done condition

- 3 commits + docs; ZERO new deps; no migration; no writes
- Demo: open a deal's bids tab as the owner → "Coach me" returns a coached verdict with a suggested counter
- Full suite green; tsc clean; next build clean; ROADMAP 42 shipped
