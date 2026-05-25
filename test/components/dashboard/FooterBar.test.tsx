import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { FooterBar } from "@/components/dashboard/FooterBar";
import type { Quote } from "@/lib/market/types";

const gold: Quote = {
  symbol: "XAU", assetClass: "commodity", display: "Gold", currency: "USD",
  price: 2386.45, changeAbs: 20, changePct: 0.85, asOf: Date.now(),
  source: "twelvedata", freshness: "live",
};

describe("FooterBar", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: { XAU: gold } }));
  it("shows a live Gold value with a freshness dot", () => {
    render(<FooterBar />);
    expect(screen.getByText(/2386\.45/)).toBeInTheDocument();
    expect(screen.getAllByTestId("freshness-dot").length).toBeGreaterThanOrEqual(1);
  });
});
