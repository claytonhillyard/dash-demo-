# iDesign Command Center — Slice 33: Predictive Cash Runway Panel — Design

**Date:** 2026-07-20
**Status:** Approved; implementation plan pending
**Builds on:** slice 27/29 (invoices + payments → receivables), slice 2 (`revenue_months`/`profit_months` company financials), slice 24c (dashboard panel registry).
**First post-migration-arc slice:** the WinJewel data becomes forward-looking intelligence.

---

## 1. Overview & Goals

A deterministic "Cash & receivables" dashboard panel: receivables aging (from issued-invoice balances), expected collections, and a runway verdict (from trailing monthly profit/burn). Read-only slice — no migration, no deps, no writes, no AI (named non-goal; the slice-36 insight pattern can garnish later).

**Goals:**
- `src/lib/runway/compute.ts` — pure, exhaustively tested: `computeReceivablesAging`, `computeRunway`.
- `src/db/runway.ts` — `getReceivablesRows(db, orgId)` (org-scoped) + `getTrailingProfitMonths(db, n)` (legacy company tables), demo branches.
- `CashRunwayPanel` + `PANEL_REGISTRY` entry `"cash-runway"` + dashboard ctx wiring.
- ~35 tests.

## 2. Non-goals (named homes)

AI narrative insight (slice-36 pattern, later). Cash-balance ledger / bank sync (never from this data — runway is profit-trend-based and labeled as such). Per-customer collection probability (needs history we don't have yet). Editing anything.

## 3. Data honesty (load-bearing)

- `revenue_months` / `profit_months` are **legacy single-tenant tables** (slice-2 era, NO org_id — consistent with the /company pages that manage them). `getTrailingProfitMonths` reads them as-is and the panel labels the burn figure "company profit trend". Document this in the reader's comment; do NOT add org filtering that the schema can't support, and do NOT migrate them in this slice (a cleanup-slice candidate, noted in ROADMAP §C if not already).
- Receivables ARE org-scoped (invoices/payments carry org_id) — `getReceivablesRows(db, orgId)`.
- The panel therefore mixes org-scoped receivables with company-wide profit trend; for AIYA (single real org) they coincide. One sentence in the panel footer: "Runway from company profit trend; receivables for this org."

## 4. Pure compute — `src/lib/runway/compute.ts`

```ts
export type ReceivableRow = {
  invoiceId: number;
  invoiceNumber: string;
  billToName: string;
  balanceCents: number;   // > 0 guaranteed by the reader
  dueDate: string | null; // YYYY-MM-DD
  issueDate: string | null;
};
export type AgingBucketKey = "current" | "d1_30" | "d31_60" | "d61_plus";
export type ReceivablesAging = {
  buckets: Record<AgingBucketKey, { totalCents: number; count: number }>;
  totalCents: number;
  count: number;
  oldest: { invoiceNumber: string; daysOverdue: number } | null;
};
export function computeReceivablesAging(rows: ReceivableRow[], todayUtc: string): ReceivablesAging;
```

- Reference date per row: `dueDate ?? issueDate`; if BOTH null → bucket "current" (no evidence of overdue-ness; comment why).
- daysOverdue = whole days `todayUtc − refDate` via UTC date math on the YYYY-MM-DD strings (no Date-timezone traps: `Date.UTC(y,m-1,d)` diff / 86_400_000, floor). `<= 0` → current; 1..30 → d1_30; 31..60 → d31_60; else d61_plus. Boundary days 0/1/30/31/60/61 locked by tests.
- `oldest` = max daysOverdue among rows with daysOverdue > 0, else null.

```ts
export type RunwayInput = {
  trailingProfitCents: number[]; // most-recent-first, one per month, length 0..N as available
  receivablesTotalCents: number;
};
export type RunwayResult =
  | { kind: "insufficient_history"; monthsAvailable: number }        // < 3 months
  | { kind: "cash_positive"; avgMonthlyProfitCents: number }         // avg >= 0
  | {
      kind: "burning";
      avgMonthlyBurnCents: number;                                    // positive number = monthly burn
      monthsOfRunwayFromReceivables: number;                          // receivables / burn, 1 decimal, capped at 99.9
    };
export function computeRunway(input: RunwayInput): RunwayResult;
```

- Average over up to the 6 most recent months (fewer if less history; < 3 → insufficient_history).
- Integer-cents math; the single division for months quantized to 1 decimal (`Math.round(x*10)/10`), capped 99.9.
- avg exactly 0 → cash_positive (not burning by zero — division guard; comment).

## 5. Readers — `src/db/runway.ts`

- `getReceivablesRows(db, orgId): Promise<ReceivableRow[]>` — issued invoices with `totalCents - COALESCE(SUM(payments),0) > 0`, reusing the slice-29 grouped-subquery JOIN shape (org filter INSIDE the subquery AND outer where; `Number()` on the aggregate). Order by refDate ascending (oldest first) — the panel lists the top 5 oldest. Demo branch: derive from `DEMO_INVOICES` + `DEMO_PAYMENTS` (9302's partial balance shows up; 9301 draft and 9303 void excluded).
- `getTrailingProfitMonths(db, n): Promise<number[]>` — most-recent-first `profit_months.amountCents` ordered by (year, month) DESC limit n (READ the actual profit_months column names from schema.ts first and use those). Legacy single-tenant comment per §3. Demo branch: a deterministic 6-month array (mix that averages NEGATIVE so the demo shows a real runway figure — e.g. months that avg ≈ −$8,500/mo against the seeded receivable balance; derive in code from constants, don't scatter magic numbers).

## 6. Panel — `src/components/dashboard/CashRunwayPanel.tsx` (server-compatible presentational component like the other panels — check ActivityPanel's shape: props in, no fetching)

Props: `{ aging: ReceivablesAging; runway: RunwayResult; topOldest: ReceivableRow[] }` (top 5 oldest with computed daysOverdue — precompute in the ctx assembly so the component stays dumb).
- Header row: total outstanding (formatCentsExact) + count.
- Aging bar: four segments proportional by totalCents (min-width guard for visibility; hide zero buckets from the bar but show all four in the legend with amounts). Colors: current emerald, 1–30 amber, 31–60 orange, 61+ rose (match the house palette classes used by HealthBadge/status chips).
- Runway line by kind: insufficient_history → "Not enough profit history (N of 3 months)"; cash_positive → "Cash-positive — no runway clock" + avg; burning → "≈X.X months of runway from receivables at $Y/mo burn" (99.9 cap renders "99.9+").
- Top-oldest list (≤5): number, name, balance, "Nd overdue" (or "current").
- Footer: the §3 honesty sentence.
- Empty receivables: friendly "No outstanding receivables" state (+ runway line still shown).

## 7. Wiring

- `PANEL_REGISTRY` entry `{ id: "cash-runway", … render: (ctx) => <CashRunwayPanel {...ctx.runway} /> }` — follow the activity entry's exact shape; pick a sensible defaultSize matching similar half-width panels.
- Dashboard page ctx assembly (src/app/page.tsx or wherever ctx.activity is built — find it): fetch receivables + trailing profits, compute aging/runway/topOldest server-side with `todayUtc = new Date().toISOString().slice(0,10)`, add `ctx.runway`. Failures degrade like other panels (check the established pattern — likely try/catch to a safe empty state, never a crashed dashboard).
- `defaultLayout()` consequence: the new panel appears for users with persisted layouts via `getEffectiveLayout` — verify how existing persisted layouts absorb NEW registry ids (read that function; if new ids are appended automatically, fine; if not, note behavior in the plan and match precedent from when "activity" was added in 24c).

## 8. Test plan (~35)

- **computeReceivablesAging (~12):** empty → zeros + null oldest; boundary table for days 0/1/30/31/60/61 (fixed todayUtc string, synthetic rows); dueDate precedence over issueDate; both-null → current; totals/counts sum; oldest picks max; leap-day span; multi-row mixed distribution.
- **computeRunway (~8):** 0/1/2 months → insufficient; exactly 3 → computed; avg positive → cash_positive; avg exactly 0 → cash_positive; burning happy path (known avg, known division, 1-decimal); cap at 99.9; only 6 most recent used (7th ignored — assert with a poisoned 7th value); mixed signs average correctly.
- **Readers (~8, shared-db):** receivables excludes draft/void/fully-paid, includes partial with exact balance; org-scoping (org-999 invoice invisible; org-999 payment doesn't deflate org-1 balance — reuse the 29-1 adversarial fixture trick); ordering oldest-first; trailing profits ordered most-recent-first + limit honored across a year boundary (Dec→Jan); demo branches return the deterministic shapes.
- **Panel (~5, jsdom or RSC-string):** burning renders the months figure; cash-positive line; insufficient-history line; empty receivables state; footer honesty sentence present.
- **Dashboard integration (+2, demo RSC harness):** dashboard page renders the panel with seed data (assert a seed-derived amount string); registry contains "cash-runway" and defaultLayout includes it.

## 9. Decisions

- Runway is profit-trend-based and labeled as such — no fake cash-balance precision.
- Legacy company tables read as-is (single-tenant), documented; org-scoping only where the schema supports it.
- < 3 months history → honest "not enough history", never a one-point projection.
- Deterministic only; AI garnish deferred to the slice-36 pattern.
- All date math on YYYY-MM-DD strings via Date.UTC diffs — no timezone traps.
