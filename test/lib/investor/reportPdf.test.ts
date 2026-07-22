import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { InvestorKpis } from "@/lib/investor/collect";
import { wrapText, toWinAnsiSafe } from "@/lib/invoices/pdfModel";
import { buildInvestorReportModel, renderInvestorReportPdf } from "@/lib/investor/reportPdf";

const NOW = new Date("2026-07-20T12:00:00Z");

function makeKpis(overrides: Partial<InvestorKpis> = {}): InvestorKpis {
  return {
    periodLabel: "July 2026",
    orgName: "Acme Studio",
    revenue: {
      months: [
        { ym: "2026-07", cents: 500_000 },
        { ym: "2026-06", cents: 420_000 },
      ],
      latestCents: 500_000,
    },
    profit: {
      months: [
        { ym: "2026-07", cents: 80_000 },
        { ym: "2026-06", cents: 60_000 },
      ],
      latestCents: 80_000,
    },
    receivables: { totalCents: 150_000, count: 3, overdueCents: 40_000 },
    runway: {
      kind: "burning",
      avgMonthlyBurnCents: 100_000,
      monthsOfRunwayFromReceivables: 4.2,
    },
    invoicing: { issuedCount: 5, issuedCents: 300_000, collectedCents: 250_000 },
    customers: { total: 12, healthMix: { healthy: 8, watch: 3, at_risk: 1 } },
    ...overrides,
  };
}

const PARAGRAPHS = [
  "Revenue held steady this period, with profit trending in the same direction as last month.",
  "Receivables remain manageable and collections tracked close to what was invoiced.",
  "Runway looks healthy given current burn, and the customer base is stable.",
];

function pdfMagicBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.slice(0, 5)).toString("utf-8");
}

describe("buildInvestorReportModel — banner", () => {
  it("is null when simulated is false", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);
    expect(model.banner).toBeNull();
  });

  it("is 'SIMULATED NARRATIVE' when simulated is true", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, true, NOW);
    expect(model.banner).toBe("SIMULATED NARRATIVE");
  });
});

describe("buildInvestorReportModel — header", () => {
  it("carries orgName, a fixed title, and the periodLabel", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);
    expect(model.header).toEqual({
      orgName: "Acme Studio",
      title: "Investor Update",
      periodLabel: "July 2026",
    });
  });
});

describe("buildInvestorReportModel — kpiGrid", () => {
  it("has ~8 rows, both cells present as [label, value] tuples", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);
    expect(model.kpiGrid.length).toBeGreaterThanOrEqual(7);
    expect(model.kpiGrid.length).toBeLessThanOrEqual(9);
    for (const row of model.kpiGrid) {
      expect(row).toHaveLength(2);
    }
  });

  it("formats revenue/profit as exact dollars from the latest month", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);
    const revenueRow = model.kpiGrid.find(([label]) => label.includes("Revenue"));
    const profitRow = model.kpiGrid.find(([label]) => label.includes("Profit"));
    expect(revenueRow?.[1]).toBe("$5,000.00");
    expect(profitRow?.[1]).toBe("$800.00");
  });

  it("falls back to '—' for revenue/profit when latestCents is absent (null)", () => {
    const kpis = makeKpis({
      revenue: { months: [], latestCents: null },
      profit: { months: [], latestCents: null },
    });
    const model = buildInvestorReportModel(kpis, PARAGRAPHS, false, NOW);
    const revenueRow = model.kpiGrid.find(([label]) => label.includes("Revenue"));
    const profitRow = model.kpiGrid.find(([label]) => label.includes("Profit"));
    expect(revenueRow?.[1]).toBe("—");
    expect(profitRow?.[1]).toBe("—");
  });

  it("includes the receivables count and the overdue portion", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);
    const receivablesRow = model.kpiGrid.find(([label]) => label.toLowerCase().includes("receivable"));
    const overdueRow = model.kpiGrid.find(([label]) => label.toLowerCase().includes("overdue"));
    expect(receivablesRow?.[1]).toContain("$1,500.00");
    expect(receivablesRow?.[1]).toContain("3");
    expect(overdueRow?.[1]).toBe("$400.00");
  });

  it("includes the one-line runway verdict", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);
    const runwayRow = model.kpiGrid.find(([label]) => label.toLowerCase().includes("runway"));
    expect(runwayRow?.[1]).toContain("burning ~4.2 months");
    // The value must survive toWinAnsiSafe unchanged — "~" (unlike "≈") is
    // plain ASCII, so the grid never renders a "?" for the common case of a
    // burning-runway verdict.
    expect(runwayRow?.[1]).not.toContain("?");
  });

  it("includes invoices issued (dollars + count) and collected this period", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);
    const issuedRow = model.kpiGrid.find(([label]) => label.toLowerCase().includes("issued"));
    const collectedRow = model.kpiGrid.find(([label]) => label.toLowerCase().includes("collected"));
    expect(issuedRow?.[1]).toContain("$3,000.00");
    expect(issuedRow?.[1]).toContain("5");
    expect(collectedRow?.[1]).toBe("$2,500.00");
  });

  it("renders the customers row with a health mix when present", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);
    const customersRow = model.kpiGrid.find(([label]) => label.toLowerCase().includes("customer"));
    expect(customersRow?.[1]).toContain("12");
    expect(customersRow?.[1]).toContain("8H");
    expect(customersRow?.[1]).toContain("3W");
    expect(customersRow?.[1]).toContain("1R");
  });

  it("renders the customers row as just the total when there is no health mix", () => {
    const kpis = makeKpis({ customers: { total: 4, healthMix: null } });
    const model = buildInvestorReportModel(kpis, PARAGRAPHS, false, NOW);
    const customersRow = model.kpiGrid.find(([label]) => label.toLowerCase().includes("customer"));
    expect(customersRow?.[1]).toBe("4");
  });
});

describe("buildInvestorReportModel — narrative", () => {
  it("wraps each paragraph at 90 chars using the shared wrapText", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);
    expect(model.narrative).toEqual(PARAGRAPHS.map((p) => wrapText(p, 90)));
  });
});

describe("buildInvestorReportModel — footer", () => {
  it("uses the injected `now`, not the real clock", () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, new Date("2025-03-04T23:59:00Z"));
    expect(model.footer).toBe("Generated by iDesign Command Center — 2025-03-04");
  });
});

describe("buildInvestorReportModel — WinAnsi sanitization", () => {
  const NON_WINANSI = /[^\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;

  it("sanitizes CJK/emoji in orgName to '?' in the header", () => {
    const kpis = makeKpis({ orgName: "銀座パール株式会社" });
    const model = buildInvestorReportModel(kpis, PARAGRAPHS, false, NOW);
    expect(model.header.orgName).toBe(toWinAnsiSafe("銀座パール株式会社"));
    expect(model.header.orgName).not.toMatch(NON_WINANSI);
  });

  it("sanitizes CJK/emoji in a narrative paragraph BEFORE wrapping, with no lone surrogates surviving", () => {
    const dirtyParagraph = "銀座 💍 " + "とても長い説明 ".repeat(20);
    const model = buildInvestorReportModel(makeKpis(), [dirtyParagraph], false, NOW);
    expect(model.narrative[0]).toEqual(wrapText(toWinAnsiSafe(dirtyParagraph), 90));
    for (const line of model.narrative[0]!) {
      expect(line).not.toMatch(/[\ud800-\udfff]/);
      expect(line).not.toMatch(NON_WINANSI);
    }
  });

  it("leaves no non-WinAnsi code point anywhere in the model for a maximally hostile fixture", () => {
    const kpis = makeKpis({ orgName: "銀座パール ✨" });
    const model = buildInvestorReportModel(kpis, ["ネックレス 💍 note\nwith a newline"], true, NOW);

    const everyString = [
      model.header.orgName,
      model.header.title,
      model.header.periodLabel,
      ...model.kpiGrid.flat(),
      ...model.narrative.flat(),
      model.footer,
      model.banner ?? "",
    ];
    for (const s of everyString) expect(s).not.toMatch(NON_WINANSI);
  });
});

describe("renderInvestorReportPdf", () => {
  it("renders a normal update to a single-page, loadable PDF", async () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, false, NOW);

    const bytes = await renderInvestorReportPdf(model);

    expect(pdfMagicBytes(bytes)).toBe("%PDF-");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("paginates a synthetic 100-line narrative (100 short paragraphs) across 2+ pages", async () => {
    const manyParagraphs = Array.from({ length: 100 }, (_, i) => `Line ${i + 1} of a very long update.`);
    const model = buildInvestorReportModel(makeKpis(), manyParagraphs, false, NOW);
    // Sanity: each short paragraph wraps to exactly one line, so this really
    // is a ~100-line narrative, not just 100 short paragraph entries.
    expect(model.narrative).toHaveLength(100);
    for (const lines of model.narrative) expect(lines).toHaveLength(1);

    const bytes = await renderInvestorReportPdf(model);

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("renders the SIMULATED NARRATIVE banner without throwing", async () => {
    const model = buildInvestorReportModel(makeKpis(), PARAGRAPHS, true, NOW);
    expect(model.banner).toBe("SIMULATED NARRATIVE"); // sanity: exercising the banner path

    const bytes = await renderInvestorReportPdf(model);

    expect(pdfMagicBytes(bytes)).toBe("%PDF-");
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });
});
