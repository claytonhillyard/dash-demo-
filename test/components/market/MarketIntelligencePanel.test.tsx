import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { MarketIntelligencePanel } from "@/components/market/MarketIntelligencePanel";
import type { Quote } from "@/lib/market/types";

const q = (symbol: string, display: string, price: number, klass: Quote["assetClass"]): Quote => ({
  symbol, assetClass: klass, display, currency: "USD",
  price, changeAbs: 1, changePct: 1.0, asOf: Date.now(),
  source: "twelvedata", freshness: "live",
});

describe("MarketIntelligencePanel", () => {
  beforeEach(() =>
    useQuotes.setState({
      bySymbol: {
        XAU: q("XAU", "Gold", 2386.45, "commodity"),
        XAG: q("XAG", "Silver", 31.25, "commodity"),
        XPT: q("XPT", "Platinum", 1021.3, "commodity"),
        BTC: q("BTC", "Bitcoin", 67450.2, "crypto"),
        ETH: q("ETH", "Ethereum", 3412.89, "crypto"),
      },
    }));

  it("shows live metals rows with freshness dots by default", () => {
    render(<MarketIntelligencePanel />);
    // "Gold" is both the default tab label and the row's display name; target the
    // row cell specifically so the assertion isn't ambiguous with the tab button.
    expect(screen.getByRole("cell", { name: "Gold" })).toBeInTheDocument();
    expect(screen.getByText(/2386\.45/)).toBeInTheDocument();
    expect(screen.getAllByTestId("freshness-dot").length).toBeGreaterThanOrEqual(1);
  });

  it("switches to crypto rows", () => {
    render(<MarketIntelligencePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Crypto" }));
    expect(screen.getByText("Bitcoin")).toBeInTheDocument();
  });

  it("labels the Diamonds tab as not yet wired", () => {
    render(<MarketIntelligencePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Diamonds" }));
    expect(screen.getByText(/not yet wired/i)).toBeInTheDocument();
  });
});
