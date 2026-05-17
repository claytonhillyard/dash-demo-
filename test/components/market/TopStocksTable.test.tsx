import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { TopStocksTable } from "@/components/market/TopStocksTable";
import type { Quote } from "@/lib/market/types";

const q: Quote = {
  symbol: "AAPL", assetClass: "equity", display: "Apple Inc.", currency: "USD",
  price: 195.84, changeAbs: 2.17, changePct: 1.12, asOf: Date.now(),
  source: "finnhub", freshness: "live",
};

describe("TopStocksTable", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: { AAPL: q } }));
  it("renders a row with price and a freshness dot", () => {
    render(<TopStocksTable />);
    expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
    expect(screen.getByText("195.84")).toBeInTheDocument();
    expect(screen.getAllByTestId("freshness-dot")[0]).toHaveAttribute(
      "data-freshness", "live");
  });
});
