import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { TickerStrip } from "@/components/market/TickerStrip";
import type { Quote } from "@/lib/market/types";

const live: Quote = {
  symbol: "BTC", assetClass: "crypto", display: "Bitcoin", currency: "USD",
  price: 67842, changeAbs: 100, changePct: 0.15, asOf: Date.now(),
  source: "coingecko", freshness: "live",
};
const sim: Quote = {
  symbol: "SPX", assetClass: "index", display: "S&P 500", currency: "USD",
  price: 5303.27, changeAbs: 5, changePct: 0.1, asOf: Date.now(),
  source: "simulated", freshness: "simulated",
};

describe("TickerStrip", () => {
  beforeEach(() =>
    useQuotes.setState({
      bySymbol: {
        BTC: live,
        XAU: { ...sim, symbol: "XAU", assetClass: "commodity", display: "Gold" },
      },
    }));

  it("shows a freshness dot for every present quote (spec §5.4 honesty)", () => {
    render(<TickerStrip />);
    const dots = screen.getAllByTestId("freshness-dot");
    expect(dots.length).toBeGreaterThanOrEqual(2);
    const freshnesses = dots.map((d) => d.getAttribute("data-freshness"));
    expect(freshnesses).toContain("live");
    expect(freshnesses).toContain("simulated");
  });
});
