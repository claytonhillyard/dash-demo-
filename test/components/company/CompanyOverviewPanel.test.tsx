import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompanyOverviewPanel } from "@/components/company/CompanyOverviewPanel";

const kpis = {
  revenueCents: 100_00,
  profitCents: 25_00,
  marginPct: 25,
  activeClients: 3,
  totalClients: 5,
  employees: 7,
};

describe("CompanyOverviewPanel", () => {
  it("shows an empty CTA when there is no data, never fake numbers", () => {
    render(
      <CompanyOverviewPanel
        kpis={{ revenueCents: 0, profitCents: 0, marginPct: null, activeClients: 0, totalClients: 0, employees: 0 }}
        hasAnyData={false}
        updatedLabel={null}
      />
    );
    expect(screen.getByText(/add your first/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$1/)).not.toBeInTheDocument();
  });

  it("renders real KPIs and an em dash for a null margin", () => {
    render(
      <CompanyOverviewPanel kpis={{ ...kpis, marginPct: null }} hasAnyData={true} updatedLabel="updated 2d ago" />
    );
    expect(screen.getByText("$100")).toBeInTheDocument();
    expect(screen.getByText("updated 2d ago")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-margin")).toHaveTextContent("—");
  });

  it("shows margin percent when present", () => {
    render(<CompanyOverviewPanel kpis={kpis} hasAnyData={true} updatedLabel="updated today" />);
    expect(screen.getByTestId("kpi-margin")).toHaveTextContent("25%");
  });
});
