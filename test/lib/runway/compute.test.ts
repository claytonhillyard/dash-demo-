import { describe, it, expect } from "vitest";
import { computeReceivablesAging, computeRunway, type ReceivableRow } from "@/lib/runway/compute";

// Fixed "today" for every aging test below except the leap-day span test
// (which needs its own fixed date to land on Feb 29 territory). All row
// dates are static YYYY-MM-DD string literals computed by hand against this
// constant — no wall clock, and no shared date-math helper with the
// implementation (that would risk a bug hiding on both sides of the test).
const TODAY_UTC = "2026-06-15";

const baseRow: ReceivableRow = {
  invoiceId: 1,
  invoiceNumber: "INV-1001",
  billToName: "Acme Co",
  balanceCents: 10_000,
  dueDate: null,
  issueDate: null,
};

describe("computeReceivablesAging", () => {
  it("empty input returns zeroed buckets, zero totals, and a null oldest", () => {
    const result = computeReceivablesAging([], TODAY_UTC);
    expect(result).toEqual({
      buckets: {
        current: { totalCents: 0, count: 0 },
        d1_30: { totalCents: 0, count: 0 },
        d31_60: { totalCents: 0, count: 0 },
        d61_plus: { totalCents: 0, count: 0 },
      },
      totalCents: 0,
      count: 0,
      oldest: null,
    });
  });

  // Boundary table (whole days overdue): <=0 current, 1-30 d1_30,
  // 31-60 d31_60, 61+ d61_plus. TODAY_UTC = 2026-06-15 throughout.

  it("boundary day 0 (due today): not overdue, lands in current", () => {
    // 2026-06-15 - 0 days = 2026-06-15 (due today, not yet overdue)
    const rows = [{ ...baseRow, dueDate: "2026-06-15" }];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.buckets.current).toEqual({ totalCents: 10_000, count: 1 });
    expect(result.oldest).toBeNull();
  });

  it("boundary day 1: first day inside d1_30", () => {
    // 2026-06-15 - 1 day = 2026-06-14
    const rows = [{ ...baseRow, dueDate: "2026-06-14" }];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.buckets.d1_30).toEqual({ totalCents: 10_000, count: 1 });
    expect(result.oldest).toEqual({ invoiceNumber: "INV-1001", daysOverdue: 1 });
  });

  it("boundary day 30: last day still inside d1_30", () => {
    // 2026-06-15 - 30 days = 2026-05-16
    const rows = [{ ...baseRow, dueDate: "2026-05-16" }];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.buckets.d1_30).toEqual({ totalCents: 10_000, count: 1 });
    expect(result.buckets.d31_60).toEqual({ totalCents: 0, count: 0 });
    expect(result.oldest).toEqual({ invoiceNumber: "INV-1001", daysOverdue: 30 });
  });

  it("boundary day 31: first day inside d31_60", () => {
    // 2026-06-15 - 31 days = 2026-05-15
    const rows = [{ ...baseRow, dueDate: "2026-05-15" }];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.buckets.d31_60).toEqual({ totalCents: 10_000, count: 1 });
    expect(result.buckets.d1_30).toEqual({ totalCents: 0, count: 0 });
    expect(result.oldest).toEqual({ invoiceNumber: "INV-1001", daysOverdue: 31 });
  });

  it("boundary day 60: last day still inside d31_60", () => {
    // 2026-06-15 - 60 days = 2026-04-16
    const rows = [{ ...baseRow, dueDate: "2026-04-16" }];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.buckets.d31_60).toEqual({ totalCents: 10_000, count: 1 });
    expect(result.buckets.d61_plus).toEqual({ totalCents: 0, count: 0 });
    expect(result.oldest).toEqual({ invoiceNumber: "INV-1001", daysOverdue: 60 });
  });

  it("boundary day 61: first day inside d61_plus", () => {
    // 2026-06-15 - 61 days = 2026-04-15
    const rows = [{ ...baseRow, dueDate: "2026-04-15" }];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.buckets.d61_plus).toEqual({ totalCents: 10_000, count: 1 });
    expect(result.buckets.d31_60).toEqual({ totalCents: 0, count: 0 });
    expect(result.oldest).toEqual({ invoiceNumber: "INV-1001", daysOverdue: 61 });
  });

  it("dueDate takes precedence over issueDate when both are present", () => {
    // dueDate is 1 day overdue (d1_30); issueDate is 90+ days old (would be
    // d61_plus if it were used instead). The result must follow dueDate.
    const rows = [{ ...baseRow, dueDate: "2026-06-14", issueDate: "2026-01-01" }];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.buckets.d1_30).toEqual({ totalCents: 10_000, count: 1 });
    expect(result.buckets.d61_plus).toEqual({ totalCents: 0, count: 0 });
    expect(result.oldest).toEqual({ invoiceNumber: "INV-1001", daysOverdue: 1 });
  });

  it("both dueDate and issueDate null: no evidence of overdue-ness, lands in current", () => {
    const rows = [{ ...baseRow, dueDate: null, issueDate: null }];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.buckets.current).toEqual({ totalCents: 10_000, count: 1 });
    expect(result.oldest).toBeNull();
  });

  it("sums totalCents and count across mixed rows spanning all four buckets", () => {
    const rows: ReceivableRow[] = [
      { ...baseRow, invoiceId: 1, invoiceNumber: "INV-A", dueDate: "2026-06-15", balanceCents: 1_000 }, // 0d -> current
      { ...baseRow, invoiceId: 2, invoiceNumber: "INV-B", dueDate: "2026-06-10", balanceCents: 2_000 }, // 5d -> d1_30
      { ...baseRow, invoiceId: 3, invoiceNumber: "INV-C", dueDate: "2026-05-01", balanceCents: 3_000 }, // 45d -> d31_60
      { ...baseRow, invoiceId: 4, invoiceNumber: "INV-D", dueDate: "2026-03-17", balanceCents: 4_000 }, // 90d -> d61_plus
    ];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.buckets.current).toEqual({ totalCents: 1_000, count: 1 });
    expect(result.buckets.d1_30).toEqual({ totalCents: 2_000, count: 1 });
    expect(result.buckets.d31_60).toEqual({ totalCents: 3_000, count: 1 });
    expect(result.buckets.d61_plus).toEqual({ totalCents: 4_000, count: 1 });
    expect(result.totalCents).toBe(10_000);
    expect(result.count).toBe(4);
  });

  it("oldest picks the row with the max daysOverdue, regardless of array position", () => {
    // Array order is [10d, 90d, 20d] -- the max (90d) sits in the middle, so
    // this fails a buggy "first wins" or "last wins" implementation too.
    const rows: ReceivableRow[] = [
      { ...baseRow, invoiceNumber: "INV-10D", dueDate: "2026-06-05" }, // 10d
      { ...baseRow, invoiceNumber: "INV-90D", dueDate: "2026-03-17" }, // 90d
      { ...baseRow, invoiceNumber: "INV-20D", dueDate: "2026-05-26" }, // 20d
    ];
    const result = computeReceivablesAging(rows, TODAY_UTC);
    expect(result.oldest).toEqual({ invoiceNumber: "INV-90D", daysOverdue: 90 });
  });

  it("leap-day span: 2024-02-28 to 2024-03-01 counts as 2 whole days (leap year, Feb has 29 days)", () => {
    const rows = [{ ...baseRow, dueDate: "2024-02-28" }];
    const result = computeReceivablesAging(rows, "2024-03-01");
    expect(result.oldest).toEqual({ invoiceNumber: "INV-1001", daysOverdue: 2 });
    expect(result.buckets.d1_30).toEqual({ totalCents: 10_000, count: 1 });
  });
});

describe("computeRunway", () => {
  it("0 months of history -> insufficient_history, reporting monthsAvailable: 0", () => {
    const result = computeRunway({ trailingProfitCents: [], receivablesTotalCents: 0 });
    expect(result).toEqual({ kind: "insufficient_history", monthsAvailable: 0 });
  });

  it("1 month of history -> insufficient_history, reporting monthsAvailable: 1", () => {
    const result = computeRunway({ trailingProfitCents: [12_345], receivablesTotalCents: 0 });
    expect(result).toEqual({ kind: "insufficient_history", monthsAvailable: 1 });
  });

  it("2 months of history -> insufficient_history, reporting monthsAvailable: 2", () => {
    const result = computeRunway({ trailingProfitCents: [12_345, -500], receivablesTotalCents: 0 });
    expect(result).toEqual({ kind: "insufficient_history", monthsAvailable: 2 });
  });

  it("exactly 3 months is enough to compute a verdict (the insufficient_history boundary)", () => {
    // avg = (-100000*3)/3 = -100000 -> burn 100000; 250000/100000 = 2.5
    const result = computeRunway({
      trailingProfitCents: [-100_000, -100_000, -100_000],
      receivablesTotalCents: 250_000,
    });
    expect(result).toEqual({
      kind: "burning",
      avgMonthlyBurnCents: 100_000,
      monthsOfRunwayFromReceivables: 2.5,
    });
  });

  it("positive average -> cash_positive, and the mean is rounded (not truncated)", () => {
    // sum = 25000+25000+25000+25003 = 100003; avg = 100003/4 = 25000.75 -> round -> 25001
    const result = computeRunway({
      trailingProfitCents: [25_000, 25_000, 25_000, 25_003],
      receivablesTotalCents: 999_999, // irrelevant to a cash_positive result
    });
    expect(result).toEqual({ kind: "cash_positive", avgMonthlyProfitCents: 25_001 });
  });

  it("average of exactly 0 -> cash_positive, not burning (division-by-zero guard)", () => {
    // sum = 100000-100000+50000-50000 = 0; avg = 0
    const result = computeRunway({
      trailingProfitCents: [100_000, -100_000, 50_000, -50_000],
      receivablesTotalCents: 500_000,
    });
    expect(result).toEqual({ kind: "cash_positive", avgMonthlyProfitCents: 0 });
  });

  it("burning: 1-decimal quantization of a repeating division", () => {
    // avg = -300000 (6 months, all equal) -> burn 300000
    // 1,000,000 / 300,000 = 3.3333... -> round(33.333...)/10 = 3.3
    const result = computeRunway({
      trailingProfitCents: [-300_000, -300_000, -300_000, -300_000, -300_000, -300_000],
      receivablesTotalCents: 1_000_000,
    });
    expect(result).toEqual({
      kind: "burning",
      avgMonthlyBurnCents: 300_000,
      monthsOfRunwayFromReceivables: 3.3,
    });
  });

  it("caps monthsOfRunwayFromReceivables at 99.9 for a tiny burn against large receivables", () => {
    // avg = -100 -> burn 100; 100,000,000 / 100 = 1,000,000 months, capped to 99.9
    const result = computeRunway({
      trailingProfitCents: [-100, -100, -100],
      receivablesTotalCents: 100_000_000,
    });
    expect(result).toEqual({
      kind: "burning",
      avgMonthlyBurnCents: 100,
      monthsOfRunwayFromReceivables: 99.9,
    });
  });

  it("only the 6 most recent months are used -- a poisoned 7th (oldest) month is ignored", () => {
    // trailingProfitCents is most-recent-first, so the 7th element is the
    // OLDEST month and must be sliced off. If it were wrongly included (or
    // the window taken from the wrong end), the huge positive 7th value
    // would flip this from burning to strongly cash_positive.
    const result = computeRunway({
      trailingProfitCents: [-100_000, -100_000, -100_000, -100_000, -100_000, -100_000, 10_000_000_000],
      receivablesTotalCents: 250_000,
    });
    expect(result).toEqual({
      kind: "burning",
      avgMonthlyBurnCents: 100_000,
      monthsOfRunwayFromReceivables: 2.5,
    });
  });

  it("mixed-sign months average correctly (positives and negatives net to a real burn figure)", () => {
    // sum = 50000-200000-150000+80000-280000 = -500000; avg = -500000/5 = -100000
    const result = computeRunway({
      trailingProfitCents: [50_000, -200_000, -150_000, 80_000, -280_000],
      receivablesTotalCents: 350_000,
    });
    expect(result).toEqual({
      kind: "burning",
      avgMonthlyBurnCents: 100_000,
      monthsOfRunwayFromReceivables: 3.5,
    });
  });
});
