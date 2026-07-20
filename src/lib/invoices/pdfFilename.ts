/**
 * Reduces an invoice number to a Content-Disposition-safe quoted filename:
 * everything outside printable ASCII is dropped (HTTP header values are
 * ByteStrings — a single CJK/emoji character makes Response construction
 * throw, and CR/LF could inject a header line), then `"` (which would end
 * the quoted string early). An invoice number that strips to nothing falls
 * back to "invoice". Lives outside the route module because Next 15 route
 * files may only export HTTP-method handlers — a named helper export fails
 * the build's route-type validation.
 */
export function sanitizePdfFilename(invoiceNumber: string): string {
  const ascii = invoiceNumber
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/"/g, "")
    .trim();
  return ascii === "" ? "invoice" : ascii;
}
