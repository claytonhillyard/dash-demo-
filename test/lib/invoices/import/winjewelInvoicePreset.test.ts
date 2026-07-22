import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCsv } from "@/lib/csv/parse";
import {
  matchInvoiceHeaders,
  mapInvoiceRow,
  parseMoneyToCents,
  normalizeDate,
  normalizeInvoiceStatus,
  WINJEWEL_INVOICE_HEADER_ALIASES,
  type InvoiceHeaderMap,
  type InvoiceImportField,
} from "@/lib/invoices/import/winjewelInvoicePreset";

// Contract: spec §3 (docs/superpowers/specs/2026-07-20-winjewel-invoice-import-slice-30-design.md)
// of the WinJewel invoice-history import design. matchInvoiceHeaders/
// mapInvoiceRow/parseMoneyToCents/normalizeDate/normalizeInvoiceStatus are
// all pure — no db, no session, no cross-row state.
//
// Structural note vs. the slice-26 customers preset (THE template): here
// `InvoiceImportRowResult`'s failure variant carries a single
// `reason: string` (spec §3.2, verbatim) plus a separate `rowIndex` field —
// not an accumulated `errors: string[]` with "Row N: " stitched into each
// message. So mapInvoiceRow short-circuits on the FIRST failing check per
// row, and every reason string below is bare (no row-number prefix).
//
// rowIndex convention: 1-based, counting DATA rows only (the header row is
// excluded — the first row after the header is row 1).

// ---------------------------------------------------------------------------
// Alias matrix — every alias in the exported table resolves to its field,
// case- and surrounding-whitespace-insensitively.
// ---------------------------------------------------------------------------
describe("matchInvoiceHeaders — alias matrix (every alias in WINJEWEL_INVOICE_HEADER_ALIASES)", () => {
  // invoiceNumber/issueDate/totalAmount are individually required; customerRef
  // and customerName are an either-or pair. Pad headers with satisfied
  // fillers for whichever requirement(s) ISN'T the field under test, so a
  // lone optional-field case isn't rejected for an unrelated missing
  // requirement, and so a required-field case under test isn't shadowed by
  // a duplicate filler alias for the same field.
  function requiredFillerFor(field: InvoiceImportField): string[] {
    const fillers: string[] = [];
    if (field !== "invoiceNumber") fillers.push("Invoice No");
    if (field !== "issueDate") fillers.push("Invoice Date");
    if (field !== "totalAmount") fillers.push("Total");
    if (field !== "customerRef" && field !== "customerName") fillers.push("Customer ID");
    return fillers;
  }

  for (const { field, aliases } of WINJEWEL_INVOICE_HEADER_ALIASES) {
    for (const alias of aliases) {
      it(`resolves "${alias}" -> ${field}, case-insensitively`, () => {
        const headers = [...requiredFillerFor(field), alias.toUpperCase()];
        const result = matchInvoiceHeaders(headers);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.map[field]).toBe(headers.length - 1);
        }
      });
    }
  }
});

describe("matchInvoiceHeaders — whitespace handling", () => {
  it("collapses internal whitespace when matching a multi-word alias", () => {
    const result = matchInvoiceHeaders([
      "Invoice No",
      "Invoice Date",
      "Total",
      "Customer ID",
      "Due   Date",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.map.dueDate).toBe(4);
  });

  it("trims leading/trailing whitespace around a header", () => {
    const result = matchInvoiceHeaders([
      "Invoice No",
      "Invoice Date",
      "Total",
      "Customer ID",
      "  Due  ",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.map.dueDate).toBe(4);
  });
});

describe("matchInvoiceHeaders — unknown columns", () => {
  it("ignores columns that match no alias (ok:true, unknown column simply unmapped)", () => {
    const result = matchInvoiceHeaders([
      "Invoice No",
      "Invoice Date",
      "Total",
      "Customer ID",
      "Loyalty Tier",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.map.invoiceNumber).toBe(0);
      expect(result.map.issueDate).toBe(1);
      expect(result.map.totalAmount).toBe(2);
      expect(result.map.customerRef).toBe(3);
      expect(Object.values(result.map)).not.toContain(4);
    }
  });
});

// ---------------------------------------------------------------------------
// Missing required headers — invoiceNumber/issueDate/totalAmount are
// individually required; customerRef/customerName form an either-or pair
// (spec §3.1 footnote) whose failure names BOTH fields together.
// ---------------------------------------------------------------------------
describe("matchInvoiceHeaders — missing required headers", () => {
  it("names every required field (incl. both customer fields) when the header row is completely unrelated", () => {
    const result = matchInvoiceHeaders(["Notes", "Memo"]);
    expect(result).toEqual({
      ok: false,
      missing: ["invoiceNumber", "issueDate", "totalAmount", "customerRef", "customerName"],
    });
  });

  it("names only invoiceNumber when everything else is present", () => {
    const result = matchInvoiceHeaders(["Invoice Date", "Total", "Customer ID"]);
    expect(result).toEqual({ ok: false, missing: ["invoiceNumber"] });
  });

  it("names only issueDate when everything else is present", () => {
    const result = matchInvoiceHeaders(["Invoice No", "Total", "Customer ID"]);
    expect(result).toEqual({ ok: false, missing: ["issueDate"] });
  });

  it("names only totalAmount when everything else is present", () => {
    const result = matchInvoiceHeaders(["Invoice No", "Invoice Date", "Customer ID"]);
    expect(result).toEqual({ ok: false, missing: ["totalAmount"] });
  });

  describe("the customerRef/customerName either-or rule", () => {
    it("names both customerRef and customerName when neither is present", () => {
      const result = matchInvoiceHeaders(["Invoice No", "Invoice Date", "Total"]);
      expect(result).toEqual({
        ok: false,
        missing: ["customerRef", "customerName"],
      });
    });

    it("customerRef alone satisfies the rule (ok:true)", () => {
      const result = matchInvoiceHeaders(["Invoice No", "Invoice Date", "Total", "Customer ID"]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.map.customerRef).toBe(3);
    });

    it("customerName alone satisfies the rule (ok:true)", () => {
      const result = matchInvoiceHeaders(["Invoice No", "Invoice Date", "Total", "Customer Name"]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.map.customerName).toBe(3);
    });

    it("both present is fine too (ok:true, both mapped independently)", () => {
      const result = matchInvoiceHeaders([
        "Invoice No",
        "Invoice Date",
        "Total",
        "Customer ID",
        "Customer Name",
      ]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.map.customerRef).toBe(3);
        expect(result.map.customerName).toBe(4);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// parseMoneyToCents — money parser table (spec §3.2).
// ---------------------------------------------------------------------------
describe("parseMoneyToCents — accepted formats", () => {
  const cases: Array<[string, number]> = [
    ["1234.56", 123456],
    ["1234", 123400],
    ["$1,234.56", 123456],
    ["1,234", 123400],
    ["1,234.5", 123450],
    [".5", 50],
    ["0", 0],
    ["0.00", 0],
    ["  42.10  ", 4210],
    ["$0", 0],
    ["12,345,678.90", 1234567890],
  ];

  for (const [input, expectedCents] of cases) {
    it(`"${input}" -> ${expectedCents} cents`, () => {
      expect(parseMoneyToCents(input)).toEqual({ ok: true, cents: expectedCents });
    });
  }
});

describe("parseMoneyToCents — negative rejection (reason: \"negative amount\")", () => {
  it("a plain minus-prefixed amount is rejected", () => {
    expect(parseMoneyToCents("-1234.56")).toEqual({ ok: false, reason: "negative amount" });
  });

  it("a parenthesized amount (accounting-style negative) is rejected", () => {
    expect(parseMoneyToCents("(1234.56)")).toEqual({ ok: false, reason: "negative amount" });
  });

  it("a parenthesized dollar-and-comma amount is rejected", () => {
    expect(parseMoneyToCents("($1,234.56)")).toEqual({ ok: false, reason: "negative amount" });
  });

  it("a dollar-prefixed minus amount is rejected", () => {
    expect(parseMoneyToCents("-$500")).toEqual({ ok: false, reason: "negative amount" });
  });
});

describe("parseMoneyToCents — overflow (int4 max = 2_147_483_647, reason: \"amount too large\")", () => {
  it("exactly at the int4 max is accepted (boundary)", () => {
    expect(parseMoneyToCents("21474836.47")).toEqual({ ok: true, cents: 2_147_483_647 });
  });

  it("one cent over the int4 max is rejected", () => {
    expect(parseMoneyToCents("21474836.48")).toEqual({ ok: false, reason: "amount too large" });
  });

  it("a wildly large amount is rejected", () => {
    expect(parseMoneyToCents("99999999999.99")).toEqual({ ok: false, reason: "amount too large" });
  });
});

describe("parseMoneyToCents — unparseable input (reason: \"unparseable amount\")", () => {
  it("blank is unparseable", () => {
    expect(parseMoneyToCents("")).toEqual({ ok: false, reason: "unparseable amount" });
  });

  it("whitespace-only is unparseable", () => {
    expect(parseMoneyToCents("   ")).toEqual({ ok: false, reason: "unparseable amount" });
  });

  it("free text is unparseable", () => {
    expect(parseMoneyToCents("N/A")).toEqual({ ok: false, reason: "unparseable amount" });
  });

  it("a trailing decimal point with no digits is unparseable", () => {
    expect(parseMoneyToCents("1234.")).toEqual({ ok: false, reason: "unparseable amount" });
  });

  // Comma-grouping validation (review finding): a comma that isn't genuine
  // thousands-grouping must reject loudly, never strip into a wrong amount.
  it("EU decimal-comma format is rejected, not misparsed ($1.23 trap)", () => {
    expect(parseMoneyToCents("1.234,56")).toEqual({ ok: false, reason: "unparseable amount" });
  });

  it("a misplaced grouping comma is rejected", () => {
    expect(parseMoneyToCents("1,23.45")).toEqual({ ok: false, reason: "unparseable amount" });
    expect(parseMoneyToCents("1,2,3")).toEqual({ ok: false, reason: "unparseable amount" });
  });

  it("a comma with no leading group is rejected", () => {
    expect(parseMoneyToCents(",234.56")).toEqual({ ok: false, reason: "unparseable amount" });
  });

  it("multiple decimal points is unparseable", () => {
    expect(parseMoneyToCents("12.34.56")).toEqual({ ok: false, reason: "unparseable amount" });
  });
});

// ---------------------------------------------------------------------------
// normalizeDate — date table (spec §3.2: ISO + M/D/YYYY + MM/DD/YYYY,
// calendar validity via a UTC round-trip; no 2-digit-year pivot, unlike the
// customers preset's firstSeenAt parser).
// ---------------------------------------------------------------------------
describe("normalizeDate", () => {
  it("passes through a valid ISO YYYY-MM-DD date", () => {
    expect(normalizeDate("2025-03-14")).toBe("2025-03-14");
  });

  it("normalizes M/D/YYYY (single-digit month and day) to ISO", () => {
    expect(normalizeDate("3/4/2025")).toBe("2025-03-04");
  });

  it("normalizes MM/DD/YYYY (zero-padded) to ISO", () => {
    expect(normalizeDate("03/04/2025")).toBe("2025-03-04");
  });

  it("normalizes a mixed single/double-digit M/DD/YYYY", () => {
    expect(normalizeDate("3/14/2025")).toBe("2025-03-14");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDate("  2025-03-14  ")).toBe("2025-03-14");
  });

  it("rejects Feb 30 (calendar-invalid, syntactically shaped) via the ISO branch", () => {
    expect(normalizeDate("2025-02-30")).toBeNull();
  });

  it("rejects 2/30/2025 (calendar-invalid, syntactically shaped) via the US-date branch", () => {
    expect(normalizeDate("2/30/2025")).toBeNull();
  });

  it("rejects month 13", () => {
    expect(normalizeDate("13/01/2025")).toBeNull();
  });

  it("rejects day 32", () => {
    expect(normalizeDate("01/32/2025")).toBeNull();
  });

  it("rejects free-text garbage", () => {
    expect(normalizeDate("not a date")).toBeNull();
  });

  it("rejects a 2-digit year (no pivot support in this preset)", () => {
    expect(normalizeDate("3/4/25")).toBeNull();
  });

  it("rejects blank", () => {
    expect(normalizeDate("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeInvoiceStatus — status table (spec §3.2).
// ---------------------------------------------------------------------------
describe("normalizeInvoiceStatus", () => {
  const voidValues = [
    "void",
    "voided",
    "cancelled",
    "canceled",
    "v",
    "VOID",
    "Voided",
    "CANCELLED",
    "Canceled",
    "V",
  ];
  for (const value of voidValues) {
    it(`"${value}" -> "void"`, () => {
      expect(normalizeInvoiceStatus(value)).toBe("void");
    });
  }

  it("surrounding whitespace is trimmed before matching", () => {
    expect(normalizeInvoiceStatus("  void  ")).toBe("void");
  });

  const issuedValues = ["", "issued", "Issued", "ISSUED", "paid", "open", "Sent", "N/A"];
  for (const value of issuedValues) {
    it(`"${value}" -> "issued"`, () => {
      expect(normalizeInvoiceStatus(value)).toBe("issued");
    });
  }
});

// ---------------------------------------------------------------------------
// mapInvoiceRow — targeted unit rows, isolated against a synthetic
// InvoiceHeaderMap, decoupled from the fixture's column layout.
// ---------------------------------------------------------------------------
describe("mapInvoiceRow — targeted unit rows", () => {
  const map: InvoiceHeaderMap = {
    invoiceNumber: 0,
    customerRef: 1,
    customerName: 2,
    issueDate: 3,
    dueDate: 4,
    totalAmount: 5,
    paidAmount: 6,
    status: 7,
  };

  function blankRow(): string[] {
    return Array(8).fill("");
  }

  /** A row that satisfies every required field, with optional overrides. */
  function rowWith(overrides: Partial<Record<keyof InvoiceHeaderMap, string>>): string[] {
    const row = blankRow();
    row[map.invoiceNumber!] = "INV-1";
    row[map.customerRef!] = "WJ-1";
    row[map.issueDate!] = "2025-01-01";
    row[map.totalAmount!] = "100.00";
    for (const [field, value] of Object.entries(overrides)) {
      const idx = map[field as keyof InvoiceHeaderMap];
      if (idx !== undefined) row[idx] = value;
    }
    return row;
  }

  describe("invoiceNumber", () => {
    it("blank invoiceNumber is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ invoiceNumber: "" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "invoiceNumber is required" });
    });

    it("whitespace-only invoiceNumber counts as blank (trimmed before the check)", () => {
      const result = mapInvoiceRow(map, rowWith({ invoiceNumber: "   " }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "invoiceNumber is required" });
    });

    it("invoiceNumber over 50 chars is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ invoiceNumber: "x".repeat(51) }), 1);
      expect(result).toEqual({
        ok: false,
        rowIndex: 1,
        reason: "invoiceNumber must be 50 characters or fewer",
      });
    });

    it("invoiceNumber at exactly 50 chars is fine (boundary)", () => {
      const result = mapInvoiceRow(map, rowWith({ invoiceNumber: "x".repeat(50) }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.invoiceNumber.length).toBe(50);
    });

    it("invoiceNumber is trimmed", () => {
      const result = mapInvoiceRow(map, rowWith({ invoiceNumber: "  INV-99  " }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.invoiceNumber).toBe("INV-99");
    });
  });

  describe("issueDate (required)", () => {
    it("blank issueDate is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ issueDate: "" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "issueDate is required" });
    });

    it("an unparseable issueDate is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ issueDate: "not a date" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "unparseable date" });
    });

    it("a calendar-invalid issueDate (2/30/2025) is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ issueDate: "2/30/2025" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "unparseable date" });
    });

    it("MM/DD/YYYY issueDate normalizes to ISO", () => {
      const result = mapInvoiceRow(map, rowWith({ issueDate: "03/04/2025" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.issueDate).toBe("2025-03-04");
    });
  });

  describe("dueDate (optional — absence is fine, invalidity is not)", () => {
    it("a blank dueDate maps to null, not a skip", () => {
      const result = mapInvoiceRow(map, rowWith({ dueDate: "" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.dueDate).toBeNull();
    });

    it("a present, valid dueDate normalizes to ISO", () => {
      const result = mapInvoiceRow(map, rowWith({ dueDate: "04/15/2025" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.dueDate).toBe("2025-04-15");
    });

    it("a present but unparseable dueDate IS a typed skip (optional presence, not optional validity)", () => {
      const result = mapInvoiceRow(map, rowWith({ dueDate: "not a date" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "unparseable date" });
    });
  });

  describe("totalAmount (required)", () => {
    it("blank total is a typed skip (no separate blank check — blank is just another unparseable value)", () => {
      const result = mapInvoiceRow(map, rowWith({ totalAmount: "" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "unparseable amount" });
    });

    it("garbage total is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ totalAmount: "N/A" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "unparseable amount" });
    });

    it("a negative total is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ totalAmount: "-100.00" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "negative amount" });
    });

    it("a parenthesized negative total is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ totalAmount: "(100.00)" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "negative amount" });
    });

    it("a too-large total is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ totalAmount: "99999999999.99" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "amount too large" });
    });

    it("a dollar-and-comma total parses correctly", () => {
      const result = mapInvoiceRow(map, rowWith({ totalAmount: "$1,234.56" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.totalCents).toBe(123456);
    });
  });

  describe("paidAmount (optional, blank/unmapped -> 0)", () => {
    it("a blank paid column maps to 0 cents, not a skip", () => {
      const result = mapInvoiceRow(map, rowWith({ paidAmount: "" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.paidCents).toBe(0);
    });

    it("an unmapped paid column (no such header at all) also maps to 0 cents", () => {
      const mapWithoutPaid: InvoiceHeaderMap = { ...map };
      delete mapWithoutPaid.paidAmount;
      const row = rowWith({});
      const result = mapInvoiceRow(mapWithoutPaid, row, 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.paidCents).toBe(0);
    });

    it("a negative paid amount is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ paidAmount: "-5.00" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "negative amount" });
    });

    it("garbage paid amount is a typed skip", () => {
      const result = mapInvoiceRow(map, rowWith({ paidAmount: "N/A" }), 1);
      expect(result).toEqual({ ok: false, rowIndex: 1, reason: "unparseable amount" });
    });
  });

  describe("paid > total cross-check", () => {
    it("paid exceeding total is a typed skip with the exact spec'd reason string", () => {
      const result = mapInvoiceRow(map, rowWith({ totalAmount: "100.00", paidAmount: "150.00" }), 1);
      expect(result).toEqual({
        ok: false,
        rowIndex: 1,
        reason: "paid exceeds total — fix the export row",
      });
    });

    it("paid exactly equal to total is fine (boundary — fully paid)", () => {
      const result = mapInvoiceRow(map, rowWith({ totalAmount: "100.00", paidAmount: "100.00" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.totalCents).toBe(10000);
        expect(result.value.paidCents).toBe(10000);
      }
    });
  });

  describe("status", () => {
    it("a void keyword maps the row to status void", () => {
      const result = mapInvoiceRow(map, rowWith({ status: "Void" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("void");
    });

    it("blank status maps to issued", () => {
      const result = mapInvoiceRow(map, rowWith({ status: "" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("issued");
    });

    it("an unrecognized status string maps to issued", () => {
      const result = mapInvoiceRow(map, rowWith({ status: "Open" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("issued");
    });
  });

  describe("customerRef / customerName (no resolution at this pure layer)", () => {
    it("both blank maps to both null", () => {
      const result = mapInvoiceRow(map, rowWith({ customerRef: "", customerName: "" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.customerRef).toBeNull();
        expect(result.value.customerName).toBeNull();
      }
    });

    it("customerRef alone maps through, customerName stays null", () => {
      const result = mapInvoiceRow(map, rowWith({ customerRef: "WJ-42", customerName: "" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.customerRef).toBe("WJ-42");
        expect(result.value.customerName).toBeNull();
      }
    });

    it("customerName alone maps through, customerRef stays null", () => {
      const result = mapInvoiceRow(map, rowWith({ customerRef: "", customerName: "Jane Doe" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.customerRef).toBeNull();
        expect(result.value.customerName).toBe("Jane Doe");
      }
    });

    it("both present map through untouched", () => {
      const result = mapInvoiceRow(
        map,
        rowWith({ customerRef: "WJ-42", customerName: "Jane Doe" }),
        1,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.customerRef).toBe("WJ-42");
        expect(result.value.customerName).toBe("Jane Doe");
      }
    });
  });

  it("rowIndex is carried through unchanged on both ok and skip outcomes", () => {
    const skip = mapInvoiceRow(map, rowWith({ invoiceNumber: "" }), 7);
    expect(skip).toEqual({ ok: false, rowIndex: 7, reason: "invoiceNumber is required" });
  });
});

// ---------------------------------------------------------------------------
// Fixture-driven integration — parse test/fixtures/winjewel-invoices.csv
// with the 26-1-era parser, match its header row, then map every row and
// assert the exact per-row outcome the fixture was authored to produce
// (spec §7 bullet: "a full fixture-file mapRow sweep").
// ---------------------------------------------------------------------------
describe("mapInvoiceRow — fixture-driven integration (test/fixtures/winjewel-invoices.csv)", () => {
  const csvText = readFileSync("test/fixtures/winjewel-invoices.csv", "utf8");
  const { headers, rows } = parseCsv(csvText);
  const matched = matchInvoiceHeaders(headers);
  if (!matched.ok) {
    throw new Error(
      `fixture header alias matching failed unexpectedly: missing ${JSON.stringify(
        (matched as { missing: string[] }).missing,
      )}`,
    );
  }
  const map: InvoiceHeaderMap = matched.map;
  const results = rows.map((row, i) => mapInvoiceRow(map, row, i + 1));

  it("the header row resolves every field the fixture uses", () => {
    expect(map).toEqual({
      invoiceNumber: 0,
      customerRef: 1,
      customerName: 2,
      issueDate: 3,
      dueDate: 4,
      totalAmount: 5,
      paidAmount: 6,
      status: 7,
    });
  });

  it("parses exactly 10 data rows from the fixture", () => {
    expect(rows.length).toBe(10);
  });

  it("row 1 — issued, fully paid", () => {
    expect(results[0]).toEqual({
      ok: true,
      value: {
        invoiceNumber: "INV-2001",
        customerRef: "WJ-101",
        customerName: "Priya Sharma",
        issueDate: "2025-01-05",
        dueDate: "2025-02-04",
        totalCents: 50000,
        paidCents: 50000,
        status: "issued",
      },
    });
  });

  it('row 2 — issued, partial payment, explicit "Issued" status', () => {
    expect(results[1]).toEqual({
      ok: true,
      value: {
        invoiceNumber: "INV-2002",
        customerRef: "WJ-102",
        customerName: "Owen Clarke",
        issueDate: "2025-01-10",
        dueDate: null,
        totalCents: 120000,
        paidCents: 40000,
        status: "issued",
      },
    });
  });

  it("row 3 — issued, unpaid (blank paid column -> 0)", () => {
    expect(results[2]).toEqual({
      ok: true,
      value: {
        invoiceNumber: "INV-2003",
        customerRef: "WJ-103",
        customerName: "Fatima Noor",
        issueDate: "2025-01-15",
        dueDate: "2025-02-14",
        totalCents: 30000,
        paidCents: 0,
        status: "issued",
      },
    });
  });

  it("row 4 — void with payment (refund-history case)", () => {
    expect(results[3]).toEqual({
      ok: true,
      value: {
        invoiceNumber: "INV-2004",
        customerRef: "WJ-104",
        customerName: "Diego Alvarez",
        issueDate: "2025-01-20",
        dueDate: null,
        totalCents: 80000,
        paidCents: 80000,
        status: "void",
      },
    });
  });

  it('row 5 — void, unpaid, explicit "0" paid value', () => {
    expect(results[4]).toEqual({
      ok: true,
      value: {
        invoiceNumber: "INV-2005",
        customerRef: "WJ-105",
        customerName: "Grace Kim",
        issueDate: "2025-01-25",
        dueDate: null,
        totalCents: 25000,
        paidCents: 0,
        status: "void",
      },
    });
  });

  it("row 6 — MM/DD/YYYY dates normalize to ISO (issue + due)", () => {
    expect(results[5]).toEqual({
      ok: true,
      value: {
        invoiceNumber: "INV-2006",
        customerRef: "WJ-101",
        customerName: "Priya Sharma",
        issueDate: "2025-02-01",
        dueDate: "2025-03-01",
        totalCents: 60000,
        paidCents: 60000,
        status: "issued",
      },
    });
  });

  it("row 7 — $-and-comma money on both total and paid", () => {
    expect(results[6]).toEqual({
      ok: true,
      value: {
        invoiceNumber: "INV-2007",
        customerRef: "WJ-102",
        customerName: "Owen Clarke",
        issueDate: "2025-02-05",
        dueDate: null,
        totalCents: 123456,
        paidCents: 23456,
        status: "issued",
      },
    });
  });

  it("row 8 — paid exceeds total, skipped with the exact spec'd reason", () => {
    expect(results[7]).toEqual({
      ok: false,
      rowIndex: 8,
      reason: "paid exceeds total — fix the export row",
    });
  });

  it("row 9 — unknown-customer row still maps ok:true (resolution is the action layer's job, not mapInvoiceRow's)", () => {
    expect(results[8]).toEqual({
      ok: true,
      value: {
        invoiceNumber: "INV-2009",
        customerRef: "WJ-999",
        customerName: null,
        issueDate: "2025-02-15",
        dueDate: null,
        totalCents: 40000,
        paidCents: 0,
        status: "issued",
      },
    });
  });

  it("row 10 — duplicate invoice number of row 1 still maps ok:true (duplicate detection is the action layer's job, not mapInvoiceRow's)", () => {
    expect(results[9]).toEqual({
      ok: true,
      value: {
        invoiceNumber: "INV-2001",
        customerRef: "WJ-105",
        customerName: "Grace Kim",
        issueDate: "2025-02-20",
        dueDate: null,
        totalCents: 15000,
        paidCents: 15000,
        status: "issued",
      },
    });
    expect((results[9] as { ok: true; value: { invoiceNumber: string } }).value.invoiceNumber).toBe(
      (results[0] as { ok: true; value: { invoiceNumber: string } }).value.invoiceNumber,
    );
  });

  it("exactly 1 of the 10 rows is skipped (paid > total); the rest map ok", () => {
    expect(results.filter((r) => !r.ok).length).toBe(1);
    expect(results.filter((r) => r.ok).length).toBe(9);
  });

  it("the one skip is row 8, reason \"paid exceeds total — fix the export row\", and no other reason appears", () => {
    const skips = results.filter((r): r is { ok: false; rowIndex: number; reason: string } => !r.ok);
    expect(skips).toEqual([
      { ok: false, rowIndex: 8, reason: "paid exceeds total — fix the export row" },
    ]);
  });

  it("every ok:true row has a non-empty invoiceNumber and a valid ISO issueDate", () => {
    for (const r of results) {
      if (r.ok) {
        expect(r.value.invoiceNumber.length).toBeGreaterThan(0);
        expect(r.value.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
