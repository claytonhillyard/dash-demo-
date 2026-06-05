import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProviderStatusPanel } from "@/components/dashboard/ProviderStatusPanel";
import type { ProviderHealth } from "@/lib/market/health";

function row(over: Partial<ProviderHealth>): ProviderHealth {
  return {
    id: "finnhub",
    display: "Equities · Finnhub",
    lastOkAt: Date.now() - 5_000,
    lastErrorAt: null,
    lastErrorMessage: null,
    freshness: "live",
    ...over,
  };
}

describe("ProviderStatusPanel", () => {
  it("renders one row per provider", () => {
    render(
      <ProviderStatusPanel
        rows={[
          row({ id: "finnhub", display: "A" }),
          row({ id: "coingecko", display: "B" }),
        ]}
        demo={false}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
  });

  it("renders a live dot for a live row", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "live" })]}
        demo={false}
      />,
    );
    const dot = screen.getByTestId("freshness-dot");
    expect(dot).toHaveAttribute("data-freshness", "live");
  });

  it("renders the simulated dot for every row in demo mode", () => {
    render(
      <ProviderStatusPanel
        rows={[
          row({ id: "finnhub", freshness: "simulated", lastOkAt: null }),
          row({ id: "coingecko", freshness: "simulated", lastOkAt: null }),
        ]}
        demo={true}
      />,
    );
    const dots = screen.getAllByTestId("freshness-dot");
    expect(dots).toHaveLength(2);
    for (const d of dots) expect(d).toHaveAttribute("data-freshness", "simulated");
  });

  it("surfaces lastErrorMessage in the row's title attribute when set", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "stale", lastErrorMessage: "ECONNRESET" })]}
        demo={false}
      />,
    );
    const li = screen.getByRole("listitem");
    expect(li).toHaveAttribute("title", "ECONNRESET");
  });

  it("renders 'never' for a row with lastOkAt: null", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "stale", lastOkAt: null })]}
        demo={false}
      />,
    );
    expect(screen.getByText(/never/i)).toBeInTheDocument();
  });

  it("renders the demo-mode footnote when demo=true", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "simulated", lastOkAt: null })]}
        demo={true}
      />,
    );
    expect(screen.getByText(/no live providers/i)).toBeInTheDocument();
  });

  it("does NOT render the footnote when demo=false", () => {
    render(
      <ProviderStatusPanel
        rows={[row({ freshness: "live" })]}
        demo={false}
      />,
    );
    expect(screen.queryByText(/no live providers/i)).toBeNull();
  });
});
