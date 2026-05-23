import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompanyPanels } from "@/components/company/CompanyPanels";
import type { CompanyDashboard } from "@/db/dashboard";

const empty: CompanyDashboard = {
  kpis: { revenueCents: 0, profitCents: 0, marginPct: null, activeClients: 0, totalClients: 0, employees: 0 },
  series: Array.from({ length: 12 }, (_, i) => ({
    year: 2026,
    month: i + 1,
    revenueCents: 0,
    profitCents: 0,
    clientsAdded: 0,
  })),
  projection: null,
  companyUpdatedAt: null,
  hasAnyData: false,
};

describe("CompanyPanels", () => {
  it("renders all three company panels in their empty states", () => {
    render(<CompanyPanels data={empty} companyUpdatedLabel={null} projectionUpdatedLabel={null} />);
    expect(screen.getByText("Company Overview")).toBeInTheDocument();
    expect(screen.getByText("Revenue Projections")).toBeInTheDocument();
    expect(screen.getByText("Company Growth Analytics")).toBeInTheDocument();
  });
});
