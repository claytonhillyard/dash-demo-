// Hardcoded (not built from the `year` argument) so there's no dynamic
// RegExp construction to worry about — matches "INV-<digits>-<digits>" and
// the two capture groups are compared/parsed in plain JS below.
const INVOICE_NUMBER_PATTERN = /^INV-(\d+)-(\d+)$/;

/**
 * Suggests the next invoice number for a given year, scanning the org's
 * existing numbers for the `INV-<year>-NNNN` pattern (spec §4). Pure: the
 * caller (createInvoice action) supplies the org's existing numbers.
 *
 * - No matches for the year -> "0001".
 * - Otherwise -> (max matching NNNN) + 1.
 * - Zero-padded to 4 digits; once the counter exceeds 9999 it grows
 *   naturally (padStart is a no-op once the number is already >= 4 digits),
 *   e.g. 9999 -> 10000, never re-padded back down.
 * - Numbers from other years, or that don't match the pattern at all, are
 *   ignored entirely.
 */
export function suggestInvoiceNumber(
  existingNumbers: readonly string[],
  year: number,
): string {
  let max = 0;
  for (const candidate of existingNumbers) {
    const match = candidate.match(INVOICE_NUMBER_PATTERN);
    if (!match) continue;
    const [, matchedYear, matchedNumber] = match;
    if (Number(matchedYear) !== year) continue;
    const n = parseInt(matchedNumber!, 10);
    if (n > max) max = n;
  }
  const next = max + 1;
  return `INV-${year}-${String(next).padStart(4, "0")}`;
}
