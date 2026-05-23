import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GrowthAnalyticsPanel } from "@/components/company/GrowthAnalyticsPanel";
import type { MonthPoint } from "@/db/queries";

const emptySeries: MonthPoint[] = Array.from({ length: 12 }, (_, i) => ({
  year: 2026,
  month: i + 1,
  revenueCents: 0,
  profitCents: 0,
  clientsAdded: 0,
}));

describe("GrowthAnalyticsPanel", () => {
  it("renders an empty state when every month is zero", () => {
    render(<GrowthAnalyticsPanel series={emptySeries} updatedLabel={null} />);
    expect(screen.getByText(/no monthly history yet/i)).toBeInTheDocument();
  });

  it("shows the chart view (not the empty state) with provenance when there is real history", () => {
    const series: MonthPoint[] = emptySeries.map((m, i) =>
      i === 11 ? { ...m, revenueCents: 500_00, profitCents: 120_00, clientsAdded: 2 } : m
    );
    render(<GrowthAnalyticsPanel series={series} updatedLabel="updated today" />);
    // Recharts' chart subtree (incl. the <Legend> showing "Revenue"/"Profit")
    // does not render in jsdom — ResponsiveContainer collapses to 0x0. So assert
    // on the panel-level signals instead (mirrors the Revenue Projections test):
    // the history path is taken (no empty state) and provenance shows.
    expect(screen.queryByText(/no monthly history yet/i)).not.toBeInTheDocument();
    expect(screen.getByText("Company Growth Analytics")).toBeInTheDocument();
    expect(screen.getByText("updated today")).toBeInTheDocument();
  });
});
