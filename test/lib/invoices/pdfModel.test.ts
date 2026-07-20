import { describe, it, expect } from "vitest";
import { buildInvoicePdfModel, wrapText } from "@/lib/invoices/pdfModel";
import { getSeedInvoiceById, DEMO_AIYA_ORG_ID } from "@/lib/demo/seed";
import type { InvoiceDetail } from "@/db/invoices";

const NOW = new Date("2026-07-20T12:00:00Z");
const ORG_NAME = "Aiya Fine Jewelry";

function makeInvoice(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: 1,
    customerId: 1,
    invoiceNumber: "INV-2026-0099",
    status: "issued",
    billTo: { name: "Test Customer" },
    issueDate: "2026-07-01",
    dueDate: "2026-07-31",
    currency: "USD",
    subtotalCents: 10_000,
    taxRateBps: 0,
    taxCents: 0,
    totalCents: 10_000,
    notes: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    sentAt: null,
    sentTo: null,
    items: [
      { id: 1, position: 0, description: "Widget", quantity: 1, unitPriceCents: 10_000, lineTotalCents: 10_000 },
    ],
    payments: [],
    paidCents: 0,
    balanceCents: 10_000,
    ...overrides,
  };
}

describe("wrapText", () => {
  it("passes a short string through as a single line", () => {
    expect(wrapText("Hello world", 90)).toEqual(["Hello world"]);
  });

  it("returns [] for an empty string", () => {
    expect(wrapText("", 90)).toEqual([]);
  });

  it("returns [] for a whitespace-only string", () => {
    expect(wrapText("   ", 90)).toEqual([]);
  });

  it("hard-splits a single word longer than the width into width-sized chunks", () => {
    const word = "A".repeat(120);
    const lines = wrapText(word, 90);
    expect(lines).toEqual([word.slice(0, 90), word.slice(90)]);
    expect(lines[0]).toHaveLength(90);
    expect(lines[1]).toHaveLength(30);
    // Hard-split never drops or reorders characters.
    expect(lines.join("")).toBe(word);
  });

  it("word-wraps a ~200-character multi-word string at a 90-char width without breaking words", () => {
    const words = Array.from({ length: 20 }, () => "AAAAAAAAA"); // 9 chars each
    const text = words.join(" "); // 20*9 + 19 spaces = 199 chars
    expect(text).toHaveLength(199);

    const lines = wrapText(text, 90);

    expect(lines).toEqual([
      words.slice(0, 9).join(" "),
      words.slice(9, 18).join(" "),
      words.slice(18, 20).join(" "),
    ]);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(90);
  });
});

describe("buildInvoicePdfModel", () => {
  describe("banner", () => {
    it("is DRAFT for a draft invoice (seed 9301)", () => {
      const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9301)!;
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.banner).toBe("DRAFT");
    });

    it("is null for an issued invoice (seed 9302)", () => {
      const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9302)!;
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.banner).toBeNull();
    });

    it("is VOID for a void invoice (seed 9303)", () => {
      const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9303)!;
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.banner).toBe("VOID");
    });
  });

  describe("header", () => {
    it("carries orgName/title/number through", () => {
      const invoice = makeInvoice({ invoiceNumber: "INV-2026-0042" });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.header).toEqual({ orgName: ORG_NAME, title: "Invoice", number: "INV-2026-0042" });
    });
  });

  describe("meta", () => {
    it("falls back to '—' for a null issue date and uppercases a draft status (seed 9301)", () => {
      const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9301)!;
      expect(invoice.issueDate).toBeNull(); // sanity: draft hasn't been issued yet
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.meta).toEqual([
        ["Issue date", "—"],
        ["Due date", invoice.dueDate],
        ["Status", "DRAFT"],
      ]);
    });

    it("passes both dates through unchanged and uppercases an issued status (seed 9302)", () => {
      const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9302)!;
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.meta).toEqual([
        ["Issue date", invoice.issueDate],
        ["Due date", invoice.dueDate],
        ["Status", "ISSUED"],
      ]);
    });

    it("uppercases a void status (seed 9303)", () => {
      const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9303)!;
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.meta[2]).toEqual(["Status", "VOID"]);
    });
  });

  describe("billTo", () => {
    it("assembles a full address: name, business, email, street1/2, city+state+zip, country", () => {
      const invoice = makeInvoice({
        billTo: {
          name: "Priya Mehta",
          businessName: "Mehta Diamonds Pvt Ltd",
          email: "priya@mehtadiamonds.in",
          address: {
            street1: "12 Opera House",
            street2: "Suite 4B",
            city: "Mumbai",
            state: "MH",
            zip: "400004",
            country: "IN",
          },
        },
      });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.billTo).toEqual([
        "Priya Mehta",
        "Mehta Diamonds Pvt Ltd",
        "priya@mehtadiamonds.in",
        "12 Opera House",
        "Suite 4B",
        "Mumbai, MH 400004",
        "IN",
      ]);
    });

    it("skips absent parts, folding city/country onto their own lines (no state/zip)", () => {
      const invoice = makeInvoice({
        billTo: { name: "Yuki Tanaka", address: { city: "Tokyo", country: "JP" } },
      });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.billTo).toEqual(["Yuki Tanaka", "Tokyo", "JP"]);
    });

    it("is just the name when there is no business, email, or address", () => {
      const invoice = makeInvoice({ billTo: { name: "Solo Customer" } });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.billTo).toEqual(["Solo Customer"]);
    });
  });

  describe("itemRows", () => {
    it("formats qty/unit/lineTotal and keeps short descriptions on one line (seed 9302)", () => {
      const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9302)!;
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.itemRows).toHaveLength(3);
      expect(model.itemRows[0]).toEqual({
        description: ["Fancy Yellow Round Diamond, 0.85ct, GIA certified"],
        qty: "1",
        unit: "$26,500.00",
        lineTotal: "$26,500.00",
      });
    });

    it("pre-wraps long descriptions using the same rules as wrapText (90 chars)", () => {
      const longDescription =
        "Custom platinum setting with hand-engraved filigree detail along the shank, designed to complement a 2.5 carat emerald-cut center stone with trapezoid side stones";
      const invoice = makeInvoice({
        items: [
          {
            id: 1,
            position: 0,
            description: longDescription,
            quantity: 2,
            unitPriceCents: 500_000,
            lineTotalCents: 1_000_000,
          },
        ],
      });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.itemRows).toHaveLength(1);
      expect(model.itemRows[0].description).toEqual(wrapText(longDescription, 90));
      expect(model.itemRows[0].description.length).toBeGreaterThan(1);
      expect(model.itemRows[0]).toMatchObject({ qty: "2", unit: "$5,000.00", lineTotal: "$10,000.00" });
    });
  });

  describe("totals", () => {
    it("omits the tax row at 0 bps, leaving only Subtotal and an emphasized Total (seed 9302)", () => {
      const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9302)!;
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.totals).toEqual([
        ["Subtotal", "$29,850.00", false],
        ["Total", "$29,850.00", true],
      ]);
    });

    it("includes a percent-labeled tax row for non-zero bps (seed 9303, 825bps)", () => {
      const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9303)!;
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.totals).toEqual([
        ["Subtotal", "$22,750.00", false],
        ["Tax (8.25%)", "$1,876.88", false],
        ["Total", "$24,626.88", true],
      ]);
    });

    it("trims trailing zeros from the tax percent label (500bps -> 5%)", () => {
      const invoice = makeInvoice({
        subtotalCents: 10_000,
        taxRateBps: 500,
        taxCents: 500,
        totalCents: 10_500,
      });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.totals).toEqual([
        ["Subtotal", "$100.00", false],
        ["Tax (5%)", "$5.00", false],
        ["Total", "$105.00", true],
      ]);
    });
  });

  describe("notes", () => {
    it("is null when the invoice has no notes", () => {
      const invoice = makeInvoice({ notes: null });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.notes).toBeNull();
    });

    it("is null for a whitespace-only notes string", () => {
      const invoice = makeInvoice({ notes: "   " });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.notes).toBeNull();
    });

    it("is word-wrapped at 90 chars when present", () => {
      const longNote =
        "Ships via insured courier from Tokyo; signature required on delivery. Please inspect the box before signing and keep all packaging for insurance purposes.";
      const invoice = makeInvoice({ notes: longNote });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.notes).toEqual(wrapText(longNote, 90));
      expect(model.notes!.length).toBeGreaterThan(1);
    });
  });

  describe("footer", () => {
    it("uses the injected `now`, not the real clock", () => {
      const invoice = makeInvoice();
      const model = buildInvoicePdfModel(invoice, ORG_NAME, new Date("2025-03-04T23:59:00Z"));
      expect(model.footer).toBe("Generated by iDesign Command Center — 2025-03-04");
    });
  });

  // pdf-lib's standard (WinAnsi-encoded) Helvetica throws on any character
  // outside CP-1252 — the model must therefore never emit one (review
  // finding C1: CJK customer data crashed the whole PDF path).
  describe("WinAnsi sanitization", () => {
    const NON_WINANSI = /[^\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;

    it("replaces CJK in name/business/address and the invoice number with '?'", () => {
      const invoice = makeInvoice({
        invoiceNumber: "請求-2026-0001",
        billTo: {
          name: "銀座パール",
          businessName: "Ginza 真珠 House",
          address: { street1: "中央区銀座4丁目" },
        },
      });
      const model = buildInvoicePdfModel(invoice, "銀座パール株式会社", NOW);
      expect(model.header.number).toBe("??-2026-0001");
      expect(model.header.orgName).toBe("?????????");
      expect(model.billTo[0]).toBe("?????");
      expect(model.billTo[1]).toBe("Ginza ?? House");
      // The ASCII "4" inside 中央区銀座4丁目 survives; CJK becomes "?".
      expect(model.billTo[2]).toBe("?????4??");
    });

    it("sanitizes emoji in a description BEFORE wrapping — no lone surrogates ever survive a hard-split", () => {
      const invoice = makeInvoice({
        items: [
          {
            id: 1,
            position: 0,
            description: "💍".repeat(120), // 120 code points = 240 UTF-16 units unsanitized
            quantity: 1,
            unitPriceCents: 10_000,
            lineTotalCents: 10_000,
          },
        ],
      });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.itemRows[0].description).toEqual(["?".repeat(90), "?".repeat(30)]);
      for (const line of model.itemRows[0].description) {
        expect(line).not.toMatch(/[\ud800-\udfff]/);
      }
    });

    it("passes Latin-1 accents and WinAnsi extras (em-dash, curly quotes, €) through unchanged", () => {
      const invoice = makeInvoice({
        billTo: { name: "Café Nüñez" },
        notes: "Prix — “vingt” €20",
      });
      const model = buildInvoicePdfModel(invoice, "Beyoncé & Söhne", NOW);
      expect(model.header.orgName).toBe("Beyoncé & Söhne");
      expect(model.billTo[0]).toBe("Café Nüñez");
      expect(model.notes).toEqual(["Prix — “vingt” €20"]);
    });

    it("flattens embedded newlines in unwrapped fields to spaces and leaves no non-WinAnsi cp anywhere in the model", () => {
      const invoice = makeInvoice({
        billTo: { name: "Line1\nLine2", address: { street1: "銀座 ★ St\r\nSuite 5" } },
        notes: "note1\nnote2 ✨",
      });
      const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
      expect(model.billTo[0]).toBe("Line1 Line2");
      expect(model.billTo[1]).toBe("?? ? St  Suite 5");
      expect(model.notes).toEqual(["note1 note2 ?"]);

      const everyString = [
        model.header.orgName,
        model.header.number,
        ...model.meta.flat(),
        ...model.billTo,
        ...model.itemRows.flatMap((r) => [...r.description, r.qty, r.unit, r.lineTotal]),
        ...model.totals.map(([l, v]) => `${l}${v}`),
        ...(model.notes ?? []),
        model.footer,
      ];
      for (const s of everyString) expect(s).not.toMatch(NON_WINANSI);
    });
  });
});
