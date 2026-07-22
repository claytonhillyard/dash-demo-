import type { CustomerAddress } from "@/db/customers";
import type { BillTo, InvoiceDetail, InvoiceStatus } from "@/db/invoices";
import { formatCentsExact } from "@/lib/company/format";

/** Word-wrap width (characters) used for item descriptions and notes —
 *  a fixed char count, not a measured font metric, so the model stays pure
 *  and deterministic (spec §3.1: "no font metrics" here; pdfRender.ts does
 *  its own pixel-accurate measuring only for right-aligning amounts). */
const WRAP_WIDTH = 90;

const BANNER_BY_STATUS: Record<InvoiceStatus, "DRAFT" | "VOID" | null> = {
  draft: "DRAFT",
  issued: null,
  void: "VOID",
};

/** Code points in Windows-1252's 0x80–0x9F extension block (€ ‚ ƒ „ … † ‡ ˆ
 *  ‰ Š ‹ Œ Ž ' ' " " • – — ˜ ™ š › œ ž Ÿ) — drawable by pdf-lib's standard
 *  fonts alongside plain Latin-1. Listed numerically to keep the source file
 *  encoding-agnostic. */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/**
 * Replaces every character pdf-lib's standard (WinAnsi-encoded) Helvetica
 * cannot draw with "?" — without this, a single CJK character or emoji in a
 * customer name, item description, or notes makes `drawText` throw, turning
 * the PDF route into a 500 and sendInvoice into "Server error" (review
 * finding, slice 28). Applied to every string entering the model, BEFORE
 * `wrapText`, so the hard-splitter can never cut a surrogate pair in half.
 * Whitespace controls (tab/newline/CR) become plain spaces: wrapped fields
 * treat them as word breaks either way, and unwrapped fields stay one line.
 *
 * Exported (slice 41) so `src/lib/investor/reportPdf.ts` can reuse the exact
 * same sanitization instead of duplicating it — no behavior change here.
 */
export function toWinAnsiSafe(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      out += " ";
    } else if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRAS.has(cp)) {
      out += ch;
    } else {
      out += "?";
    }
  }
  return out;
}

/** Everything `renderInvoicePdf` needs to paint a page, with every
 *  formatting decision (money, dates, wrapping, labels) already made —
 *  the painter does layout only, never business logic (spec §3). */
export type InvoicePdfModel = {
  banner: "DRAFT" | "VOID" | null;
  header: { orgName: string; title: string; number: string };
  meta: Array<[label: string, value: string]>;
  billTo: string[];
  itemRows: Array<{ description: string[]; qty: string; unit: string; lineTotal: string }>;
  totals: Array<[label: string, value: string, emphasize: boolean]>;
  notes: string[] | null;
  footer: string;
};

/**
 * Word-wraps `s` to at most `width` characters per line, breaking on
 * whitespace. A single word longer than `width` is hard-split into
 * width-sized chunks rather than left to overflow a line.
 *
 * Empty or whitespace-only input yields `[]` (nothing to draw) rather than
 * a line of blanks — locked decision so callers can tell "no text" apart
 * from "one blank line" without an extra check.
 */
export function wrapText(s: string, width: number): string[] {
  const trimmed = s.trim();
  if (trimmed === "") return [];

  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  const flush = () => {
    if (current.length > 0) {
      lines.push(current);
      current = "";
    }
  };

  for (const word of words) {
    if (word.length > width) {
      // Over-long word: flush whatever's pending, then hard-split the word
      // itself into width-sized chunks; the remaining tail seeds the next
      // line (it may still take more words after it).
      flush();
      let remaining = word;
      while (remaining.length > width) {
        lines.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      current = remaining;
      continue;
    }

    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length > width) {
      flush();
      current = word;
    } else {
      current = candidate;
    }
  }
  flush();
  return lines;
}

/** bps (e.g. 825) -> percent label with up to 2 decimals, trailing zeros
 *  (and a bare trailing dot) trimmed: 825 -> "8.25", 500 -> "5", 810 -> "8.1". */
function formatBpsAsPercent(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.?0+$/, "");
}

/** Bill-to lines: name, business?, email?, then the address — street1,
 *  street2, "city, state zip" (present parts only), country. Mirrors the
 *  edit page's read-only `AddressLines` component (slice-22 shape,
 *  src/app/(admin)/invoices/[id]/edit/page.tsx) so the PDF and the in-app
 *  view agree on how an address renders. Absent/blank fields are skipped
 *  entirely rather than leaving a gap. */
function buildBillToLines(billTo: BillTo): string[] {
  const lines: string[] = [billTo.name];
  if (billTo.businessName) lines.push(billTo.businessName);
  if (billTo.email) lines.push(billTo.email);
  lines.push(...addressLines(billTo.address));
  return lines;
}

function addressLines(address: CustomerAddress | undefined): string[] {
  if (!address) return [];
  const cityStateZip = [address.city, [address.state, address.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [address.street1, address.street2, cityStateZip, address.country].filter(
    (l): l is string => !!l && l.trim() !== "",
  );
}

/**
 * Builds the pure, print-ready model for one invoice (spec §3.1). All
 * formatting lives here — money via `formatCentsExact`, dates passed
 * through as already-formatted strings (or "—"), the tax line's percent
 * label, description/notes word-wrapping — so `renderInvoicePdf` only has
 * to paint what it's given. `now` is injected (never `Date.now()` inside)
 * so the footer date is deterministic under test.
 */
export function buildInvoicePdfModel(
  invoice: InvoiceDetail,
  orgName: string,
  now: Date,
): InvoicePdfModel {
  const meta: Array<[string, string]> = [
    ["Issue date", toWinAnsiSafe(invoice.issueDate ?? "—")],
    ["Due date", toWinAnsiSafe(invoice.dueDate ?? "—")],
    ["Status", invoice.status.toUpperCase()],
  ];

  const itemRows = invoice.items.map((item) => ({
    description: wrapText(toWinAnsiSafe(item.description), WRAP_WIDTH),
    qty: String(item.quantity),
    unit: formatCentsExact(item.unitPriceCents),
    lineTotal: formatCentsExact(item.lineTotalCents),
  }));

  const totals: Array<[string, string, boolean]> = [
    ["Subtotal", formatCentsExact(invoice.subtotalCents), false],
  ];
  if (invoice.taxRateBps > 0) {
    totals.push([
      `Tax (${formatBpsAsPercent(invoice.taxRateBps)}%)`,
      formatCentsExact(invoice.taxCents),
      false,
    ]);
  }
  totals.push(["Total", formatCentsExact(invoice.totalCents), true]);

  const notes =
    invoice.notes && invoice.notes.trim() !== ""
      ? wrapText(toWinAnsiSafe(invoice.notes), WRAP_WIDTH)
      : null;

  return {
    banner: BANNER_BY_STATUS[invoice.status],
    header: {
      orgName: toWinAnsiSafe(orgName),
      title: "Invoice",
      number: toWinAnsiSafe(invoice.invoiceNumber),
    },
    meta,
    billTo: buildBillToLines(invoice.billTo).map(toWinAnsiSafe),
    itemRows,
    totals,
    notes,
    footer: `Generated by iDesign Command Center — ${now.toISOString().slice(0, 10)}`,
  };
}
