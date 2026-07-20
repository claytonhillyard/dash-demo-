import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderInvoicePdf } from "@/lib/invoices/pdfRender";
import { buildInvoicePdfModel } from "@/lib/invoices/pdfModel";
import { getSeedInvoiceById, DEMO_AIYA_ORG_ID } from "@/lib/demo/seed";
import type { InvoiceDetail, InvoiceItemRow } from "@/db/invoices";

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
    ...overrides,
  };
}

function pdfMagicBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.slice(0, 5)).toString("utf-8");
}

describe("renderInvoicePdf", () => {
  it("renders seed 9302 (issued, no banner) to a single-page, loadable PDF", async () => {
    const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9302)!;
    const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);

    const bytes = await renderInvoicePdf(model);

    expect(pdfMagicBytes(bytes)).toBe("%PDF-");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("paginates a synthetic 50-item invoice with long descriptions across 2+ pages", async () => {
    const longDescription = "Detailed custom engraving specification ".repeat(6).slice(0, 200);
    const items: InvoiceItemRow[] = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      position: i,
      description: longDescription,
      quantity: 1,
      unitPriceCents: 1_000,
      lineTotalCents: 1_000,
    }));
    const invoice = makeInvoice({
      items,
      subtotalCents: 50_000,
      totalCents: 50_000,
    });
    const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);

    const bytes = await renderInvoicePdf(model);

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("renders a DRAFT-banner model (seed 9301) without throwing", async () => {
    const invoice = getSeedInvoiceById(DEMO_AIYA_ORG_ID, 9301)!;
    const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
    expect(model.banner).toBe("DRAFT"); // sanity: exercising the banner path

    const bytes = await renderInvoicePdf(model);

    expect(pdfMagicBytes(bytes)).toBe("%PDF-");
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it("renders fine with notes: null and a minimal billTo (name only)", async () => {
    const invoice = makeInvoice({ notes: null, billTo: { name: "Solo Customer" } });
    const model = buildInvoicePdfModel(invoice, ORG_NAME, NOW);
    expect(model.notes).toBeNull();
    expect(model.billTo).toEqual(["Solo Customer"]);

    const bytes = await renderInvoicePdf(model);

    expect(pdfMagicBytes(bytes)).toBe("%PDF-");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });
});
