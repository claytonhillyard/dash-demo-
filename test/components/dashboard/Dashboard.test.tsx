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
    const inventory = {
      counts: {
        Rings: 5, Necklaces: 0, Earrings: 0, Bracelets: 0, Pendants: 0,
        Chains: 0, "Watch Bands": 0, Diamonds: 10, Gems: 0,
      },
      total: 15,
      updatedLabel: "updated today",
    };
    const diamond = {
      kpis: { naturalIndex: { cents: 800000, change24hPct: 1.2 }, labIndex: null },
      rows: [{ label: "Natural 1ct", cents: 800000, change24hPct: 1.2 }],
    };
    render(<DashboardGrid inventory={inventory} diamond={diamond} />);
    // Live panels present:
    expect(screen.getByText("Market Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Price Trend Analytics")).toBeInTheDocument();
    expect(screen.getByText("Unit Converter (Advanced)")).toBeInTheDocument();
    // Inventory is now REAL (not a placeholder):
    expect(screen.getByTestId("inv-tile-Diamonds")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-natural-diamond").textContent).toMatch(/8000\.00|8,000\.00/);
    // Remaining business placeholders still honest:
    for (const id of [
      "panel-orders-pipeline", "panel-portfolio-snapshot", "panel-financial-overview",
      "panel-crypto-wallet", "panel-tradenet-exchange", "panel-ai-insights",
      "panel-todays-schedule", "panel-social-inbox",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});
