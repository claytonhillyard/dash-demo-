/** A single line item's billable inputs — the minimum computeTotals needs.
 *  Callers (actions, InvoiceForm) may carry richer shapes; only these two
 *  fields participate in the math. */
export type TotalsLineItem = {
  quantity: number;
  unitPriceCents: number;
};

export type InvoiceTotals = {
  /** quantity * unitPriceCents per item, same order/length as the input. */
  lineTotals: number[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Pure integer money math shared by the create/update actions and the
 * InvoiceForm's live preview (single source of truth — spec §4).
 *
 * Range/shape validation (item count, price caps, tax-rate caps) is the
 * caller's Zod schema's job, not this function's — it trusts its inputs and
 * only does arithmetic.
 *
 * Rounding: `taxCents = Math.round(subtotalCents * taxRateBps / 10000)` —
 * round-half-up (Math.round rounds .5 toward +Infinity for non-negative
 * inputs, which is what every value here is).
 */
export function computeTotals(
  items: readonly TotalsLineItem[],
  taxRateBps: number,
): InvoiceTotals {
  const lineTotals = items.map((item) => item.quantity * item.unitPriceCents);
  const subtotalCents = lineTotals.reduce((sum, line) => sum + line, 0);
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;
  return { lineTotals, subtotalCents, taxCents, totalCents };
}
