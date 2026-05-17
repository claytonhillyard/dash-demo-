import { describe, it, expect, beforeEach } from "vitest";
import { useQuotes } from "@/store/quotes";
import type { Quote } from "@/lib/market/types";

const mk = (symbol: string, price: number): Quote => ({
  symbol, assetClass: "equity", display: symbol, currency: "USD",
  price, changeAbs: 0, changePct: 0, asOf: 1, source: "finnhub", freshness: "live",
});

describe("quotes store", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: {} }));

  it("ingests quotes keyed by symbol", () => {
    useQuotes.getState().ingest([mk("AAPL", 100), mk("MSFT", 200)]);
    expect(useQuotes.getState().bySymbol.AAPL.price).toBe(100);
  });

  it("selectQuote returns a stable reference when unrelated symbol changes", () => {
    useQuotes.getState().ingest([mk("AAPL", 100), mk("MSFT", 200)]);
    const a1 = useQuotes.getState().bySymbol.AAPL;
    useQuotes.getState().ingest([mk("MSFT", 201)]);
    const a2 = useQuotes.getState().bySymbol.AAPL;
    expect(a2).toBe(a1); // AAPL object identity preserved -> no re-render
  });
});
