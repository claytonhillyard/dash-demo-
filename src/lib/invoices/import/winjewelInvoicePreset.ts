/**
 * WinJewel invoice-history CSV preset — pure header-matching + row-mapping,
 * no db, no session. Spec §3 (docs/superpowers/specs/2026-07-20-winjewel-invoice-import-slice-30-design.md).
 *
 * Mirrors the shape of src/lib/customers/import/winjewelPreset.ts (slice 26,
 * THE template for this machinery) with one deliberate structural
 * divergence: `InvoiceImportRowResult` carries a single `reason: string`
 * (spec §3.2, verbatim), not an accumulated `errors: string[]` — so
 * `mapInvoiceRow` reports the FIRST failing check on a row, not every
 * failing field. `rowIndex` lives as its own field on the failure variant
 * (not embedded in the reason text like the customers preset's "Row N: ..."
 * strings), so reason strings here are bare, field-agnostic sentences.
 */

/** Every field this preset can populate on an imported invoice row. */
export type InvoiceImportField =
  | "invoiceNumber"
  | "customerRef"
  | "customerName"
  | "issueDate"
  | "dueDate"
  | "totalAmount"
  | "paidAmount"
  | "status";

/** field -> the CSV column index it was matched to, for fields present in the file. */
export type InvoiceHeaderMap = Partial<Record<InvoiceImportField, number>>;

export type ImportInvoice = {
  invoiceNumber: string; // trimmed, 1..50
  customerRef: string | null; // trimmed WinJewel customer id
  customerName: string | null; // trimmed
  issueDate: string; // normalized YYYY-MM-DD
  dueDate: string | null;
  totalCents: number; // >= 0, <= 2_147_483_647
  paidCents: number; // >= 0 (0 when column absent/blank)
  status: "issued" | "void";
};

export type InvoiceImportRowResult =
  | { ok: true; value: ImportInvoice }
  | { ok: false; rowIndex: number; reason: string };

type InvoiceHeaderAlias = { field: InvoiceImportField; aliases: readonly string[]; required: boolean };

/**
 * Data-driven alias table (spec §3.1). Case/space-insensitive.
 *
 * customerRef and customerName are both marked `required: false` here —
 * neither is individually required. The actual rule ("at least one of the
 * two must be mapped") is an either-or check layered on top in
 * `matchInvoiceHeaders`, since it can't be expressed as a per-field
 * `required` flag in a table this shape.
 */
export const WINJEWEL_INVOICE_HEADER_ALIASES: readonly InvoiceHeaderAlias[] = [
  { field: "invoiceNumber", aliases: ["Invoice No", "Invoice #", "Inv No", "Invoice Number"], required: true },
  { field: "customerRef", aliases: ["Customer ID", "Cust ID", "Customer No"], required: false },
  { field: "customerName", aliases: ["Customer Name", "Name", "Customer"], required: false },
  { field: "issueDate", aliases: ["Invoice Date", "Date", "Inv Date"], required: true },
  { field: "dueDate", aliases: ["Due Date", "Due"], required: false },
  { field: "totalAmount", aliases: ["Total", "Amount", "Invoice Total", "Total Amount"], required: true },
  { field: "paidAmount", aliases: ["Paid", "Amount Paid", "Payments", "Paid Amount"], required: false },
  { field: "status", aliases: ["Status", "Type"], required: false },
] as const;

// int4 (Postgres integer) max — the width of invoices.total_cents /
// payments.amount_cents (src/db/schema.ts). Same constant + same rationale
// as src/lib/invoices/actions.ts's MAX_MONEY_CENTS (that file's comment
// explicitly names this recurrence).
const MAX_MONEY_CENTS = 2_147_483_647;

const MAX_INVOICE_NUMBER_LEN = 50;

/** trim + lowercase + collapse internal whitespace runs to one space. */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Matches a CSV header row against the WinJewel invoice alias table. Unknown
 * columns are silently ignored. When the same field's alias appears more
 * than once, the first (leftmost) matching column wins.
 *
 * Returns `{ ok: false, missing }` naming exactly which required fields
 * couldn't be matched: invoiceNumber / issueDate / totalAmount whenever
 * their column is absent, PLUS — spec §3.1's either-or rule — both
 * "customerRef" and "customerName" together whenever NEITHER of that pair
 * is mapped (either one alone satisfies the requirement).
 */
export function matchInvoiceHeaders(
  headers: string[],
): { ok: true; map: InvoiceHeaderMap } | { ok: false; missing: string[] } {
  const aliasToField = new Map<string, InvoiceImportField>();
  for (const { field, aliases } of WINJEWEL_INVOICE_HEADER_ALIASES) {
    for (const alias of aliases) {
      aliasToField.set(normalizeHeader(alias), field);
    }
  }

  const map: InvoiceHeaderMap = {};
  headers.forEach((header, index) => {
    const field = aliasToField.get(normalizeHeader(header));
    if (field !== undefined && map[field] === undefined) {
      map[field] = index;
    }
  });

  const missing = WINJEWEL_INVOICE_HEADER_ALIASES.filter(
    (a) => a.required && map[a.field] === undefined,
  ).map((a) => a.field);

  if (map.customerRef === undefined && map.customerName === undefined) {
    missing.push("customerRef", "customerName");
  }

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, map };
}

/** Reads + trims a mapped field out of a data row; "" when unmapped or blank. */
function readField(map: InvoiceHeaderMap, row: string[], field: InvoiceImportField): string {
  const idx = map[field];
  if (idx === undefined) return "";
  return (row[idx] ?? "").trim();
}

/**
 * Validates year/month/day as a real calendar date (rejects month 13, Feb
 * 30, etc. — the naive `new Date(Date.UTC(...))` constructor rolls those
 * over into the next month instead of erroring, which would silently
 * corrupt imported invoice dates). Identical rationale + shape to the
 * customers preset's `buildUtcDate`.
 */
function buildUtcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// WinJewel's history-export date format: M/D/YYYY or MM/DD/YYYY — always a
// 4-digit year (unlike the customers preset's firstSeenAt parser, which
// additionally pivots 2-digit years; that leniency doesn't apply here).
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Accepts `YYYY-MM-DD` and `M/D/YYYY`/`MM/DD/YYYY`, emits `YYYY-MM-DD`.
 * Returns null for anything else, including syntactically-shaped-but-out-
 * of-range dates (Feb 30, month 13) — calendar validity is enforced via a
 * UTC Date round-trip (`buildUtcDate`), not just regex shape.
 */
export function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim();

  const iso = trimmed.match(ISO_DATE);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = buildUtcDate(year, month, day);
    if (!date) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const us = trimmed.match(US_DATE);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    const date = buildUtcDate(year, month, day);
    if (!date) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

// Matches a plain non-negative decimal number after `$`/comma/paren/minus
// handling has already been stripped away below — either "1234", "1234.56",
// or the leading-digit-omitted ".5" (a real money-parser edge: see the
// parseMoneyToCents table tests).
const PLAIN_NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * Parses a WinJewel money cell to integer cents (spec §3.2). Accepts
 * `1234.56`, `$1,234.56`, `1234` (thousands commas + a leading `$` are both
 * optional and stripped, comma GROUPING is not validated — WinJewel exports
 * never misgroup digits). Rejects negatives, including the parenthesized
 * accounting style `(1234.56)` / `($1,234.56)` — reason "negative amount".
 * Rejects anything that doesn't parse as a plain decimal at all (blank,
 * garbage text) — reason "unparseable amount". A value that parses fine but
 * rounds to more cents than Postgres int4 can hold — reason "amount too
 * large".
 *
 * Field-agnostic and reused for both totalAmount (required) and paidAmount
 * (optional, blank -> 0 handled by the caller before this is even invoked).
 */
export function parseMoneyToCents(
  raw: string,
): { ok: true; cents: number } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "unparseable amount" };

  const parenMatch = trimmed.match(/^\((.+)\)$/);
  const isParenNegative = parenMatch !== null;
  const body = (isParenNegative ? parenMatch[1] : trimmed).trim();

  const isLeadingMinus = body.startsWith("-");
  const unsigned = (isLeadingMinus ? body.slice(1) : body).trim();

  const dollarStripped = unsigned.replace(/^\$\s*/, "");
  // When a comma is present it must be genuine thousands-grouping. Without
  // this, an EU-format export ("1.234,56") or a misplaced comma ("1,23.45")
  // strips into a plausible-but-wrong amount — the parser's one
  // silent-corruption vector (review finding, slice 30).
  if (dollarStripped.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(dollarStripped)) {
    return { ok: false, reason: "unparseable amount" };
  }
  const numeric = dollarStripped.replace(/,/g, "");

  if (!PLAIN_NUMBER.test(numeric)) {
    return { ok: false, reason: "unparseable amount" };
  }

  if (isParenNegative || isLeadingMinus) {
    return { ok: false, reason: "negative amount" };
  }

  const cents = Math.round(Number(numeric) * 100);
  if (cents > MAX_MONEY_CENTS) {
    return { ok: false, reason: "amount too large" };
  }
  return { ok: true, cents };
}

const VOID_STATUS_VALUES = new Set(["void", "voided", "cancelled", "canceled", "v"]);

/**
 * Maps a WinJewel status cell to the invoice's frozen status (spec §3.2):
 * case-insensitive void|voided|cancelled|canceled|v -> "void"; blank or
 * anything else -> "issued" (history exports rarely bother labeling the
 * normal case, so the absence of a recognized void keyword is treated as
 * "this was a normal invoice").
 */
export function normalizeInvoiceStatus(raw: string): "issued" | "void" {
  const normalized = raw.trim().toLowerCase();
  return VOID_STATUS_VALUES.has(normalized) ? "void" : "issued";
}

/**
 * Maps one already-shape-normalized CSV data row (see src/lib/csv/parse.ts —
 * ragged rows are pre-padded/truncated to header length) to an
 * `ImportInvoice`, or a single typed skip reason.
 *
 * Unlike the customers preset's `mapRow` (which accumulates every failing
 * field into an `errors: string[]`), `InvoiceImportRowResult`'s failure
 * variant carries exactly ONE `reason: string` (spec §3.2, verbatim) — so
 * checks below short-circuit on the FIRST failure in field-table order,
 * they don't keep validating the rest of the row once one thing is wrong.
 *
 * `rowIndex` is 1-based, counting data rows only (header excluded), and is
 * carried as its own field on the failure variant (not stitched into the
 * reason text) since the type already structures it separately.
 */
export function mapInvoiceRow(
  map: InvoiceHeaderMap,
  row: string[],
  rowIndex: number,
): InvoiceImportRowResult {
  const invoiceNumber = readField(map, row, "invoiceNumber");
  if (invoiceNumber === "") {
    return { ok: false, rowIndex, reason: "invoiceNumber is required" };
  }
  if (invoiceNumber.length > MAX_INVOICE_NUMBER_LEN) {
    return {
      ok: false,
      rowIndex,
      reason: `invoiceNumber must be ${MAX_INVOICE_NUMBER_LEN} characters or fewer`,
    };
  }

  const issueDateRaw = readField(map, row, "issueDate");
  if (issueDateRaw === "") {
    return { ok: false, rowIndex, reason: "issueDate is required" };
  }
  const issueDate = normalizeDate(issueDateRaw);
  if (issueDate === null) {
    return { ok: false, rowIndex, reason: "unparseable date" };
  }

  const dueDateRaw = readField(map, row, "dueDate");
  let dueDate: string | null = null;
  if (dueDateRaw !== "") {
    dueDate = normalizeDate(dueDateRaw);
    if (dueDate === null) {
      return { ok: false, rowIndex, reason: "unparseable date" };
    }
  }

  const totalParsed = parseMoneyToCents(readField(map, row, "totalAmount"));
  if (!totalParsed.ok) {
    return { ok: false, rowIndex, reason: totalParsed.reason };
  }
  const totalCents = totalParsed.cents;

  const paidRaw = readField(map, row, "paidAmount");
  let paidCents = 0;
  if (paidRaw !== "") {
    const paidParsed = parseMoneyToCents(paidRaw);
    if (!paidParsed.ok) {
      return { ok: false, rowIndex, reason: paidParsed.reason };
    }
    paidCents = paidParsed.cents;
  }

  if (paidCents > totalCents) {
    return { ok: false, rowIndex, reason: "paid exceeds total — fix the export row" };
  }

  const status = normalizeInvoiceStatus(readField(map, row, "status"));

  const customerRefRaw = readField(map, row, "customerRef");
  const customerNameRaw = readField(map, row, "customerName");

  return {
    ok: true,
    value: {
      invoiceNumber,
      customerRef: customerRefRaw !== "" ? customerRefRaw : null,
      customerName: customerNameRaw !== "" ? customerNameRaw : null,
      issueDate,
      dueDate,
      totalCents,
      paidCents,
      status,
    },
  };
}
