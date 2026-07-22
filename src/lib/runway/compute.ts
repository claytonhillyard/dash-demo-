/**
 * Pure, deterministic compute for the "Cash & receivables" dashboard panel
 * (spec §4, authoritative — types and behavior below are verbatim from it).
 * No I/O and no wall-clock reads: callers supply `todayUtc` and the trailing
 * profit/receivables figures, so results are exactly reproducible in tests
 * and safe to call from server or client code alike.
 */

/** One outstanding invoice (balance > 0, guaranteed by the reader) as fed to
 *  `computeReceivablesAging`. */
export type ReceivableRow = {
  invoiceId: number;
  invoiceNumber: string;
  billToName: string;
  balanceCents: number; // > 0 guaranteed by the reader
  dueDate: string | null; // YYYY-MM-DD
  issueDate: string | null; // YYYY-MM-DD
};

export type AgingBucketKey = "current" | "d1_30" | "d31_60" | "d61_plus";

export type ReceivablesAging = {
  buckets: Record<AgingBucketKey, { totalCents: number; count: number }>;
  totalCents: number;
  count: number;
  /** The single most-overdue row (max daysOverdue among rows with
   *  daysOverdue > 0), or null when nothing is overdue. */
  oldest: { invoiceNumber: string; daysOverdue: number } | null;
};

/** Parses a `YYYY-MM-DD` string into its UTC-midnight epoch-ms instant. No
 *  calendar validation here: `todayUtc` and every row's dueDate/issueDate are
 *  trusted to already be well-formed (the reader's job), so this is pure
 *  arithmetic, not parsing/validation. */
function utcDayMs(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Whole days from `fromYmd` to `toYmd` (positive when `toYmd` is later).
 *  Both sides are resolved to UTC-midnight instants via `Date.UTC` before
 *  differencing, so DST and local-timezone offsets never enter the
 *  computation — the trap this avoids is any date math that depends on the
 *  runtime's local timezone.
 *
 *  Exported (slice 33-3) so the dashboard ctx assembly can derive
 *  `daysOverdue` for the top-oldest receivables list with the exact same
 *  arithmetic `computeReceivablesAging` uses below — the alternative would
 *  be a second, easy-to-drift reimplementation of UTC date-diffing. */
export function daysBetweenUtc(fromYmd: string, toYmd: string): number {
  return Math.floor((utcDayMs(toYmd) - utcDayMs(fromYmd)) / 86_400_000);
}

function bucketFor(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  return "d61_plus";
}

/**
 * Buckets outstanding receivables by days overdue as of `todayUtc` (spec §4).
 *
 * Reference date per row is `dueDate ?? issueDate`. Bucket boundaries (whole
 * days overdue): <=0 current, 1-30 d1_30, 31-60 d31_60, 61+ d61_plus.
 *
 * `oldest` is the row with the max daysOverdue among rows with
 * daysOverdue > 0 (i.e. actually overdue, not merely "current"), or null
 * when nothing qualifies.
 */
export function computeReceivablesAging(rows: ReceivableRow[], todayUtc: string): ReceivablesAging {
  const buckets: Record<AgingBucketKey, { totalCents: number; count: number }> = {
    current: { totalCents: 0, count: 0 },
    d1_30: { totalCents: 0, count: 0 },
    d31_60: { totalCents: 0, count: 0 },
    d61_plus: { totalCents: 0, count: 0 },
  };
  let totalCents = 0;
  let count = 0;
  let oldest: { invoiceNumber: string; daysOverdue: number } | null = null;

  for (const row of rows) {
    const refDate = row.dueDate ?? row.issueDate;
    // When BOTH dueDate and issueDate are null there's no date to measure
    // overdue-ness against, so treat it as "0 days overdue" (-> current)
    // rather than guessing: we have no evidence the invoice is overdue.
    const daysOverdue = refDate === null ? 0 : daysBetweenUtc(refDate, todayUtc);
    const key = bucketFor(daysOverdue);

    buckets[key].totalCents += row.balanceCents;
    buckets[key].count += 1;
    totalCents += row.balanceCents;
    count += 1;

    if (daysOverdue > 0 && (oldest === null || daysOverdue > oldest.daysOverdue)) {
      oldest = { invoiceNumber: row.invoiceNumber, daysOverdue };
    }
  }

  return { buckets, totalCents, count, oldest };
}

/** Input to `computeRunway` — trailing monthly profit and current
 *  receivables, both integer cents. */
export type RunwayInput = {
  trailingProfitCents: number[]; // most-recent-first, one per month, length 0..N as available
  receivablesTotalCents: number;
};

export type RunwayResult =
  | { kind: "insufficient_history"; monthsAvailable: number } // < 3 months
  | { kind: "cash_positive"; avgMonthlyProfitCents: number } // avg >= 0
  | {
      kind: "burning";
      avgMonthlyBurnCents: number; // positive number = monthly burn
      monthsOfRunwayFromReceivables: number; // receivables / burn, 1 decimal, capped at 99.9
    };

const RUNWAY_WINDOW_MONTHS = 6;
const RUNWAY_MIN_MONTHS = 3;
const RUNWAY_CAP_MONTHS = 99.9;

/**
 * Turns trailing monthly profit into a runway verdict (spec §4).
 *
 * - Windows to the 6 most recent months (`trailingProfitCents` is
 *   most-recent-first, so any extra history beyond 6 is simply sliced off —
 *   see the poisoned-7th-month test).
 * - Fewer than 3 months available → `insufficient_history`; a one- or
 *   two-point average isn't a trend, so we say so rather than project one.
 * - Average is `Math.round(sum / monthsAvailable)` — inputs are integer
 *   cents, so rounding the mean (rather than truncating) is the only fudge
 *   and it's confined to this one line.
 * - Average >= 0 (including exactly 0) → `cash_positive`. Zero is
 *   breakeven, not burn; treating it as burn would divide receivables by
 *   zero, so the `>= 0` guard makes that division impossible by
 *   construction rather than something callers must separately check for.
 * - Otherwise `burning`: `avgMonthlyBurnCents` is the positive magnitude of
 *   the (negative) average, and `monthsOfRunwayFromReceivables` is
 *   `receivablesTotalCents / avgMonthlyBurnCents` quantized to 1 decimal
 *   (`Math.round(x * 10) / 10`) and capped at 99.9 so the UI never has to
 *   render a spuriously precise "1,000,000.0 months" — it renders "99.9+"
 *   instead.
 */
export function computeRunway(input: RunwayInput): RunwayResult {
  const window = input.trailingProfitCents.slice(0, RUNWAY_WINDOW_MONTHS);
  const monthsAvailable = window.length;

  if (monthsAvailable < RUNWAY_MIN_MONTHS) {
    return { kind: "insufficient_history", monthsAvailable };
  }

  const sum = window.reduce((total, cents) => total + cents, 0);
  const avgCents = Math.round(sum / monthsAvailable);

  if (avgCents >= 0) {
    return { kind: "cash_positive", avgMonthlyProfitCents: avgCents };
  }

  const avgMonthlyBurnCents = -avgCents;
  const rawMonths = input.receivablesTotalCents / avgMonthlyBurnCents;
  const monthsOfRunwayFromReceivables = Math.min(RUNWAY_CAP_MONTHS, Math.round(rawMonths * 10) / 10);

  return { kind: "burning", avgMonthlyBurnCents, monthsOfRunwayFromReceivables };
}
