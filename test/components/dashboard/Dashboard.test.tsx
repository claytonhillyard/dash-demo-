import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DashboardGrid } from "@/app/DashboardGrid";

// PriceTrendPanel and UnitConverterPanel fetch on mount; stub so the grid test is quiet.
beforeEach(() =>
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ points: [], freshness: "live", currencies: {} }),
  } as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("DashboardGrid", () => {
  it("renders the live panels and honest business placeholders", () => {
    render(<DashboardGrid />);
    // Live panels present:
    expect(screen.getByText("Market Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Price Trend Analytics")).toBeInTheDocument();
    expect(screen.getByText("Unit Converter (Advanced)")).toBeInTheDocument();
    // Business placeholders present and honest:
    const inventory = screen.getByTestId("panel-inventory-overview");
    expect(within(inventory).getByText(/not yet wired/i)).toBeInTheDocument();
    for (const id of [
      "panel-orders-pipeline", "panel-portfolio-snapshot", "panel-financial-overview",
      "panel-crypto-wallet", "panel-tradenet-exchange", "panel-ai-insights",
      "panel-todays-schedule", "panel-social-inbox",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});
