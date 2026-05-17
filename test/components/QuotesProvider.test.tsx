import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { useQuotes } from "@/store/quotes";

describe("QuotesProvider", () => {
  afterEach(() => vi.restoreAllMocks());
  it("polls /api/quotes and ingests into the store", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      quotes: [{
        symbol: "AAPL", assetClass: "equity", display: "Apple Inc.", currency: "USD",
        price: 195.84, changeAbs: 2, changePct: 1.1, asOf: Date.now(),
        source: "finnhub", freshness: "live",
      }],
    }))));
    render(<QuotesProvider><div>child</div></QuotesProvider>);
    expect(screen.getByText("child")).toBeInTheDocument();
    await waitFor(() =>
      expect(useQuotes.getState().bySymbol.AAPL?.price).toBe(195.84));
  });
});
