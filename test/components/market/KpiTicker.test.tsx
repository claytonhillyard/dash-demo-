import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { KpiTicker } from "@/components/market/KpiTicker";
import type { Quote } from "@/lib/market/types";

const q = (symbol: string, display: string, price: number): Quote => ({
  symbol, assetClass: "commodity", display, currency: "USD",
  price, changeAbs: 1, changePct: 0.85, asOf: Date.now(),
  source: "twelvedata", freshness: "live",
});

describe("KpiTicker", () => {
  beforeEach(() =>
    useQuotes.setState({
      bySymbol: {
        XAU: q("XAU", "Gold 24K", 2386.45),
        XAG: q("XAG", "Silver", 31.25),
        XPT: q("XPT", "Platinum", 1021.3),
        BTC: q("BTC", "Bitcoin", 67450.2),
        USDAED: q("USDAED", "USD/AED", 3.6725),
        EURUSD: q("EURUSD", "EUR/USD", 1.085),
      },
    }));

  it("renders a live card with a freshness dot for each priced symbol", () => {
    render(<KpiTicker />);
    expect(screen.getByText(/2386\.45/)).toBeInTheDocument();
    expect(screen.getByText(/67450\.20/)).toBeInTheDocument();
    expect(screen.getAllByTestId("freshness-dot").length).toBeGreaterThanOrEqual(6);
  });

  it("shows honest placeholders for the diamond indices (no fake numbers)", () => {
    render(<KpiTicker />);
    const natural = screen.getByTestId("kpi-natural-diamond");
    expect(within(natural).getByText("—")).toBeInTheDocument();
    expect(within(natural).getByText(/awaiting price list/i)).toBeInTheDocument();
  });

  it("shows the diamond index value + change when provided", () => {
    render(<KpiTicker diamond={{ naturalIndex: { cents: 800000, change24hPct: 1.5 }, labIndex: null }} />);
    const natural = screen.getByTestId("kpi-natural-diamond");
    expect(within(natural).getByText(/8000\.00/)).toBeInTheDocument();
    const lab = screen.getByTestId("kpi-lab-diamond");
    expect(within(lab).getByText(/awaiting price list/i)).toBeInTheDocument();
  });
});
