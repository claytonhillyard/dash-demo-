export interface ProjectionPoint {
  year: number;
  amountCents: number;
}

/** Operating margin as a whole-number percent, or null when revenue is 0 (divide-by-zero guard). */
export function operatingMarginPct(profitCents: number, revenueCents: number): number | null {
  if (revenueCents === 0) return null;
  return Math.round((profitCents / revenueCents) * 100);
}

/**
 * Revenue precedence (spec section 3.1): if a month has any transactions, its revenue is their sum;
 * otherwise it is the manual monthly bucket; otherwise 0.
 */
export function resolveMonthRevenue(
  bucketCents: number | null,
  transactionCentsList: number[]
): number {
  if (transactionCentsList.length > 0) {
    return transactionCentsList.reduce((sum, c) => sum + c, 0);
  }
  return bucketCents ?? 0;
}

/**
 * 5-year revenue projection (spec section 4): base x (1 + cagr)^n, with per-year overrides taking
 * precedence for any year explicitly set. Overrides do NOT alter the compounding baseline —
 * later non-overridden years still compound off the original base.
 */
export function projectFiveYears(
  baseYear: number,
  baseRevenueCents: number,
  cagrPct: number,
  perYearOverrides: Record<string, number>
): ProjectionPoint[] {
  const rate = cagrPct / 100;
  const out: ProjectionPoint[] = [];
  for (let n = 0; n < 5; n++) {
    const year = baseYear + n;
    const override = perYearOverrides[String(year)];
    const computed = Math.round(baseRevenueCents * Math.pow(1 + rate, n));
    out.push({ year, amountCents: override ?? computed });
  }
  return out;
}
