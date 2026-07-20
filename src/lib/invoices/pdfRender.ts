import { PDFDocument, StandardFonts, rgb, PageSizes, type PDFFont, type Color } from "pdf-lib";
import type { InvoicePdfModel } from "./pdfModel";

const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.Letter;
const MARGIN = 50;
// y-cursor floor: once the cursor crosses below this, force a page break
// before drawing the next row rather than let it collide with the bottom
// margin. 20pt of slack under MARGIN for descenders/line-height.
const BOTTOM_LIMIT = 70;
const RIGHT_EDGE = PAGE_WIDTH - MARGIN;

// Items table column x-positions (spec §3.2). `description` is a left
// start; the other three are right edges that `drawRightText` aligns to.
const COL_X = { description: MARGIN, qty: 380, unit: 440, lineTotal: 520 };
const TOTALS_LABEL_RIGHT = 490;

const BLACK: Color = rgb(0, 0, 0);
const GRAY: Color = rgb(0.45, 0.45, 0.45);
const LIGHT_GRAY: Color = rgb(0.82, 0.82, 0.82);
const RULE_GRAY: Color = rgb(0.75, 0.75, 0.75);

/**
 * Paints an `InvoicePdfModel` onto a Letter-size (612x792) PDF with
 * pdf-lib. Pure painter — every string, wrap, and formatting decision was
 * already made by `buildInvoicePdfModel`; this only lays it out and turns
 * the page when the y-cursor runs out of room (spec §3.2).
 */
export async function renderInvoicePdf(model: InvoicePdfModel): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage(PageSizes.Letter);
  let y = PAGE_HEIGHT - MARGIN;

  function newPage(): void {
    page = pdfDoc.addPage(PageSizes.Letter);
    y = PAGE_HEIGHT - MARGIN;
  }

  // Ensures room for the next row, breaking to a fresh page first when the
  // cursor has crossed BOTTOM_LIMIT. `onBreak` repaints anything that needs
  // to repeat at the top of a continuation page (the items table's column
  // header) — cheap, and keeps a spilled table readable.
  function ensureSpace(onBreak?: () => void): void {
    if (y < BOTTOM_LIMIT) {
      newPage();
      onBreak?.();
    }
  }

  function drawLeftText(text: string, x: number, size: number, f: PDFFont, color: Color = BLACK): void {
    page.drawText(text, { x, y, size, font: f, color });
  }

  // Right-aligns `text` so it ends at `rightX`, measuring width with the
  // real font/size pair — StandardFonts carry the metrics for this without
  // needing to embed a font file.
  function drawRightText(text: string, rightX: number, size: number, f: PDFFont, color: Color = BLACK): void {
    const width = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: rightX - width, y, size, font: f, color });
  }

  const drawTableHeader = (): void => {
    drawLeftText("Description", COL_X.description, 9, fontBold, GRAY);
    drawRightText("Qty", COL_X.qty, 9, fontBold, GRAY);
    drawRightText("Unit price", COL_X.unit, 9, fontBold, GRAY);
    drawRightText("Total", COL_X.lineTotal, 9, fontBold, GRAY);
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT_EDGE, y }, thickness: 0.5, color: RULE_GRAY });
    y -= 12;
  };

  // --- Banner ------------------------------------------------------------
  // Draft/void invoices get a big, light-gray flag above the header.
  // Deliberately horizontal, not a diagonal/rotated watermark: rotated text
  // needs extra bounding-box math (rotation origin, the wider footprint it
  // sweeps across the page) for what is a purely cosmetic signal — plain
  // horizontal text reads exactly as clearly at a fraction of the
  // complexity, and pagination math above only has to reason in one axis.
  if (model.banner) {
    drawLeftText(model.banner, MARGIN, 36, fontBold, LIGHT_GRAY);
    y -= 40;
  }

  // --- Header --------------------------------------------------------
  drawLeftText(model.header.orgName, MARGIN, 18, fontBold);
  y -= 22;
  drawLeftText(`${model.header.title} ${model.header.number}`, MARGIN, 14, font);
  y -= 28;

  // --- Meta rows (Invoice date / Due date / Status) -----------------
  for (const [label, value] of model.meta) {
    ensureSpace();
    drawLeftText(`${label}: ${value}`, MARGIN, 10, font);
    y -= 14;
  }
  y -= 10;

  // --- Bill to -------------------------------------------------------
  ensureSpace();
  drawLeftText("Bill To", MARGIN, 9, fontBold, GRAY);
  y -= 14;
  for (const line of model.billTo) {
    ensureSpace();
    drawLeftText(line, MARGIN, 10, font);
    y -= 13;
  }
  y -= 16;

  // --- Items table -----------------------------------------------------
  ensureSpace();
  drawTableHeader();
  for (const item of model.itemRows) {
    ensureSpace(drawTableHeader);
    // Numeric columns ride with the description's first line so they're
    // never orphaned from their row by a page break; only overflow lines
    // from a very long wrapped description can roll onto a continuation
    // page (rare — the 50-item cap keeps this the exception).
    const lines = item.description.length > 0 ? item.description : [""];
    drawRightText(item.qty, COL_X.qty, 10, font);
    drawRightText(item.unit, COL_X.unit, 10, font);
    drawRightText(item.lineTotal, COL_X.lineTotal, 10, font);
    drawLeftText(lines[0], COL_X.description, 10, font);
    y -= 13;
    for (const line of lines.slice(1)) {
      ensureSpace(drawTableHeader);
      drawLeftText(line, COL_X.description, 10, font);
      y -= 13;
    }
  }
  y -= 10;

  // --- Totals (right-aligned; Total emphasized) -----------------------
  for (const [label, value, emphasize] of model.totals) {
    ensureSpace();
    if (emphasize) {
      y -= 4;
      page.drawLine({
        start: { x: TOTALS_LABEL_RIGHT - 80, y: y + 14 },
        end: { x: RIGHT_EDGE, y: y + 14 },
        thickness: 0.75,
        color: RULE_GRAY,
      });
    }
    const rowFont = emphasize ? fontBold : font;
    const size = emphasize ? 12 : 10;
    drawRightText(label, TOTALS_LABEL_RIGHT, size, rowFont);
    drawRightText(value, RIGHT_EDGE, size, rowFont);
    y -= emphasize ? 18 : 14;
  }

  // --- Notes -----------------------------------------------------------
  if (model.notes) {
    y -= 6;
    ensureSpace();
    drawLeftText("Notes", MARGIN, 9, fontBold, GRAY);
    y -= 14;
    for (const line of model.notes) {
      ensureSpace();
      drawLeftText(line, MARGIN, 10, font);
      y -= 13;
    }
  }

  // --- Footer --------------------------------------------------------
  // Fixed position at the bottom margin of whichever page ended up last —
  // independent of the content cursor above, not part of the normal flow.
  page.drawText(model.footer, { x: MARGIN, y: MARGIN - 20, size: 8, font, color: GRAY });

  return pdfDoc.save();
}
