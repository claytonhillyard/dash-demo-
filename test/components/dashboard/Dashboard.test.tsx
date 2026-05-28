import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DashboardGrid } from "@/app/DashboardGrid";
import { useSettings } from "@/store/settings";

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
    const deals = {
      deals: [{
        id: 1, kind: "SELL" as const, category: "Diamond" as const,
        subject: "Round 1.02ct G/VS1", quantity: 1, priceCents: 1240000,
        currency: "USD", status: "Open" as const, postedByLabel: "boss",
        createdAt: new Date(Date.now() - 3_600_000),
      }],
    };
    render(<DashboardGrid inventory={inventory} diamond={diamond} deals={deals} />);
    // Live panels present:
    expect(screen.getByText("Market Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Price Trend Analytics")).toBeInTheDocument();
    expect(screen.getByText("Unit Converter (Advanced)")).toBeInTheDocument();
    // Inventory is now REAL (not a placeholder):
    expect(screen.getByTestId("inv-tile-Diamonds")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-natural-diamond").textContent).toMatch(/8000\.00|8,000\.00/);
    // Deal Room panel is now REAL (replaced the tradenet-exchange placeholder)
    expect(screen.getByText("Deal Room")).toBeInTheDocument();
    expect(screen.getByText("Round 1.02ct G/VS1")).toBeInTheDocument();
    // Remaining business placeholders still honest:
    for (const id of [
      "panel-orders-pipeline", "panel-portfolio-snapshot", "panel-financial-overview",
      "panel-crypto-wallet", "panel-ai-insights",
      "panel-todays-schedule", "panel-social-inbox",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("renders the edit-mode controls when editMode is on", () => {
    useSettings.setState({ editMode: true, dashboardLayout: null } as never);
    const inventory = {
      counts: {
        Rings: 5, Necklaces: 0, Earrings: 0, Bracelets: 0, Pendants: 0,
        Chains: 0, "Watch Bands": 0, Diamonds: 10, Gems: 0,
      },
      total: 15,
      updatedLabel: "updated today",
    };
    render(<DashboardGrid inventory={inventory} />);
    expect(screen.getByLabelText(/move panel price-trend/i)).toBeInTheDocument();
    useSettings.setState({ editMode: false } as never);
  });
});
