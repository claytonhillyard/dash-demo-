import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CashRunwayPanel, type TopOldestReceivable } from "@/components/dashboard/CashRunwayPanel";
import type { ReceivablesAging, RunwayResult } from "@/lib/runway/compute";

function makeAging(overrides: Partial<ReceivablesAging> = {}): ReceivablesAging {
  return {
    buckets: {
      current: { totalCents: 0, count: 0 },
      d1_30: { totalCents: 0, count: 0 },
      d31_60: { totalCents: 0, count: 0 },
      d61_plus: { totalCents: 0, count: 0 },
    },
    totalCents: 0,
    count: 0,
    oldest: null,
    ...overrides,
  };
}

const ONE_RECEIVABLE_AGING: ReceivablesAging = makeAging({
  buckets: {
    current: { totalCents: 0, count: 0 },
    d1_30: { totalCents: 500_000, count: 1 },
    d31_60: { totalCents: 0, count: 0 },
    d61_plus: { totalCents: 0, count: 0 },
  },
  totalCents: 500_000,
  count: 1,
  oldest: { invoiceNumber: "INV-2026-0001", daysOverdue: 10 },
});

// Deliberately gives the zero-totalCents "current" bucket a nonzero count=0
// (no rows in it) so the legend-still-shows-zero-buckets behavior (spec §6)
// has something real to assert on.
const MIXED_AGING: ReceivablesAging = makeAging({
  buckets: {
    current: { totalCents: 0, count: 0 },
    d1_30: { totalCents: 300_000, count: 1 },
    d31_60: { totalCents: 150_000, count: 1 },
    d61_plus: { totalCents: 450_000, count: 1 },
  },
  totalCents: 900_000,
  count: 3,
  oldest: { invoiceNumber: "INV-2026-0005", daysOverdue: 75 },
});

const BURNING: RunwayResult = {
  kind: "burning",
  avgMonthlyBurnCents: 850_000, // $8,500.00/mo
  monthsOfRunwayFromReceivables: 4.2,
};

const BURNING_CAPPED: RunwayResult = {
  kind: "burning",
  avgMonthlyBurnCents: 100_00, // $100.00/mo — a tiny burn against real receivables caps out
  monthsOfRunwayFromReceivables: 99.9,
};

const CASH_POSITIVE: RunwayResult = { kind: "cash_positive", avgMonthlyProfitCents: 320_000 }; // $3,200.00/mo

const INSUFFICIENT: RunwayResult = { kind: "insufficient_history", monthsAvailable: 2 };

const TOP_OLDEST: TopOldestReceivable[] = [
  {
    invoiceId: 1, invoiceNumber: "INV-2026-0005", billToName: "Yuki Tanaka",
    balanceCents: 450_000, dueDate: "2026-05-01", issueDate: "2026-04-01", daysOverdue: 75,
  },
  {
    invoiceId: 2, invoiceNumber: "INV-2026-0006", billToName: "Priya Mehta",
    balanceCents: 150_000, dueDate: null, issueDate: null, daysOverdue: 0,
  },
];

describe("CashRunwayPanel", () => {
  it("renders the header total/count and the burning runway line (months figure + burn amount)", () => {
    render(<CashRunwayPanel aging={ONE_RECEIVABLE_AGING} runway={BURNING} topOldest={[]} />);
    expect(screen.getByText("Cash & Receivables")).toBeInTheDocument();
    expect(screen.getByTestId("cash-runway-total").textContent).toBe("$5,000.00");
    expect(screen.getByText(/1 invoice outstanding/i)).toBeInTheDocument();
    expect(
      screen.getByText("≈4.2 months of runway from receivables at $8,500.00/mo burn"),
    ).toBeInTheDocument();
  });

  it("caps the burning runway display at 99.9+", () => {
    render(<CashRunwayPanel aging={ONE_RECEIVABLE_AGING} runway={BURNING_CAPPED} topOldest={[]} />);
    expect(screen.getByText(/≈99\.9\+ months of runway/)).toBeInTheDocument();
  });

  it("renders the cash-positive runway line with the average", () => {
    render(<CashRunwayPanel aging={ONE_RECEIVABLE_AGING} runway={CASH_POSITIVE} topOldest={[]} />);
    expect(screen.getByText(/Cash-positive — no runway clock/)).toBeInTheDocument();
    expect(screen.getByText(/\$3,200\.00\/mo/)).toBeInTheDocument();
  });

  it("renders the insufficient-history runway line", () => {
    render(<CashRunwayPanel aging={ONE_RECEIVABLE_AGING} runway={INSUFFICIENT} topOldest={[]} />);
    expect(screen.getByText("Not enough profit history (2 of 3 months)")).toBeInTheDocument();
  });

  it("renders a friendly empty state when there are no outstanding receivables, with the runway line still shown", () => {
    render(<CashRunwayPanel aging={makeAging()} runway={BURNING} topOldest={[]} />);
    expect(screen.getByText("No outstanding receivables.")).toBeInTheDocument();
    expect(
      screen.getByText("≈4.2 months of runway from receivables at $8,500.00/mo burn"),
    ).toBeInTheDocument();
  });

  it("always renders the §3 footer honesty sentence", () => {
    render(<CashRunwayPanel aging={ONE_RECEIVABLE_AGING} runway={INSUFFICIENT} topOldest={[]} />);
    expect(
      screen.getByText("Runway from company profit trend; receivables for this org."),
    ).toBeInTheDocument();
  });

  it("legend lists all four aging buckets with amounts even when a bucket is zero; the bar omits the zero bucket", () => {
    render(<CashRunwayPanel aging={MIXED_AGING} runway={INSUFFICIENT} topOldest={[]} />);
    expect(screen.getByTestId("cash-runway-total").textContent).toBe("$9,000.00");
    expect(screen.getByText(/3 invoices outstanding/i)).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument(); // the empty "current" bucket, still in the legend
    expect(screen.queryByTestId("aging-bar-current")).toBeNull();
    expect(screen.getByTestId("aging-bar-d1_30")).toBeInTheDocument();
    expect(screen.getByTestId("aging-bar-d31_60")).toBeInTheDocument();
    expect(screen.getByTestId("aging-bar-d61_plus")).toBeInTheDocument();
  });

  it("renders the top-oldest list with 'Nd overdue' or 'current'", () => {
    render(<CashRunwayPanel aging={MIXED_AGING} runway={INSUFFICIENT} topOldest={TOP_OLDEST} />);
    expect(screen.getByText("Yuki Tanaka")).toBeInTheDocument();
    expect(screen.getByText("75d overdue")).toBeInTheDocument();
    expect(screen.getByText("Priya Mehta")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
  });
});
