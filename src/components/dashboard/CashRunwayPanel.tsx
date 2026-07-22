import { Panel } from "@/components/Panel";
import { formatCentsExact } from "@/lib/company/format";
import type { AgingBucketKey, ReceivableRow, ReceivablesAging, RunwayResult } from "@/lib/runway/compute";

/** A receivable row decorated with its precomputed `daysOverdue` — the ctx
 *  assembly (src/app/page.tsx) computes this once, upstream, using the same
 *  UTC day-diff as `computeReceivablesAging`, so this component stays a
 *  pure prop-in renderer with no date math of its own. */
export type TopOldestReceivable = ReceivableRow & { daysOverdue: number };

const BUCKET_ORDER: AgingBucketKey[] = ["current", "d1_30", "d31_60", "d61_plus"];

/** Bucket → display label + house palette classes. Same "small dot + raw
 *  Tailwind color" convention as HealthBadge (src/components/customers/HealthBadge.tsx)
 *  and ActivityList's verbDotClass — current/1-30/61+ reuse HealthBadge's exact
 *  emerald-400/amber-300/rose-400 shades; 31-60 (orange) is new here, chosen
 *  from the same "-400" shade family to sit between amber-300 and rose-400. */
const BUCKET_META: Record<AgingBucketKey, { label: string; colorClass: string }> = {
  current: { label: "Current", colorClass: "bg-emerald-400" },
  d1_30: { label: "1–30 days", colorClass: "bg-amber-300" },
  d31_60: { label: "31–60 days", colorClass: "bg-orange-400" },
  d61_plus: { label: "61+ days", colorClass: "bg-rose-400" },
};

/** The §3 honesty sentence — verbatim, every render, regardless of state:
 *  the burn figure is company-wide (legacy single-tenant profit_months) while
 *  the receivables are org-scoped, and the panel must never let that
 *  distinction get lost. */
const FOOTER_SENTENCE = "Runway from company profit trend; receivables for this org.";

function runwayLine(runway: RunwayResult): string {
  switch (runway.kind) {
    case "insufficient_history":
      return `Not enough profit history (${runway.monthsAvailable} of 3 months)`;
    case "cash_positive":
      return `Cash-positive — no runway clock (avg ${formatCentsExact(runway.avgMonthlyProfitCents)}/mo)`;
    case "burning": {
      // computeRunway already caps at exactly 99.9 (spec §4); render that
      // exact cap as "99.9+" so the UI never implies false precision on an
      // effectively-infinite runway.
      const monthsLabel =
        runway.monthsOfRunwayFromReceivables >= 99.9
          ? "99.9+"
          : runway.monthsOfRunwayFromReceivables.toFixed(1);
      return `≈${monthsLabel} months of runway from receivables at ${formatCentsExact(runway.avgMonthlyBurnCents)}/mo burn`;
    }
  }
}

function overdueLabel(daysOverdue: number): string {
  return daysOverdue > 0 ? `${daysOverdue}d overdue` : "current";
}

export function CashRunwayPanel({
  aging, runway, topOldest,
}: {
  aging: ReceivablesAging;
  runway: RunwayResult;
  topOldest: TopOldestReceivable[];
}) {
  if (aging.count === 0) {
    return (
      <Panel title="Cash & Receivables" state="ready">
        <div className="py-4 text-center text-sm text-text/40">
          No outstanding receivables.
        </div>
        <p className="mt-2 text-sm text-text/70">{runwayLine(runway)}</p>
        <div className="mt-2 text-right text-[10px] text-text/40">{FOOTER_SENTENCE}</div>
      </Panel>
    );
  }

  const nonZeroBuckets = BUCKET_ORDER.filter((k) => aging.buckets[k].totalCents > 0);

  return (
    <Panel title="Cash & Receivables" state="ready">
      <div className="flex items-baseline justify-between">
        <span data-testid="cash-runway-total" className="font-mono text-lg text-gold">
          {formatCentsExact(aging.totalCents)}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-text/50">
          {aging.count} {aging.count === 1 ? "invoice" : "invoices"} outstanding
        </span>
      </div>

      {/* Aging bar: width per segment is proportional to totalCents via
          flex-grow (flex-basis 0), with a min-width guard so a small but
          non-zero bucket stays visible/hoverable. Zero buckets are omitted
          here but still appear in the legend below (spec §6). */}
      <div
        className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-surface-2/40"
        role="img"
        aria-label="Receivables aging distribution"
      >
        {nonZeroBuckets.map((k) => (
          <div
            key={k}
            data-testid={`aging-bar-${k}`}
            className={BUCKET_META[k].colorClass}
            style={{ flexGrow: aging.buckets[k].totalCents, flexBasis: 0, minWidth: "6px" }}
            title={`${BUCKET_META[k].label}: ${formatCentsExact(aging.buckets[k].totalCents)}`}
          />
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {BUCKET_ORDER.map((k) => (
          <div key={k} className="flex items-center gap-1.5 text-[10px]">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BUCKET_META[k].colorClass}`} />
            <span className="text-text/50">{BUCKET_META[k].label}</span>
            <span className="ml-auto font-mono text-text/70">
              {formatCentsExact(aging.buckets[k].totalCents)}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm text-text/70">{runwayLine(runway)}</p>

      {topOldest.length > 0 && (
        <ul className="mt-2 divide-y divide-text/10 text-sm">
          {topOldest.map((row) => (
            <li key={row.invoiceId} className="flex items-center gap-2 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-text/40">
                {row.invoiceNumber}
              </span>
              <span className="flex-1 truncate text-text/80" title={row.billToName}>
                {row.billToName}
              </span>
              <span className="font-mono text-text/70">{formatCentsExact(row.balanceCents)}</span>
              <span className="shrink-0 text-[10px] text-text/40">
                {overdueLabel(row.daysOverdue)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 text-right text-[10px] text-text/40">{FOOTER_SENTENCE}</div>
    </Panel>
  );
}
