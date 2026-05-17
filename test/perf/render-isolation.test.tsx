import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useQuotes, selectQuote } from "@/store/quotes";
import type { Quote } from "@/lib/market/types";

const mk = (symbol: string, price: number): Quote => ({
  symbol, assetClass: "equity", display: symbol, currency: "USD",
  price, changeAbs: 0, changePct: 0, asOf: 1, source: "finnhub", freshness: "live",
});

function Cell({ symbol, onRender }: { symbol: string; onRender: () => void }) {
  const q = useQuotes(selectQuote(symbol));
  onRender();
  return <span>{q?.price}</span>;
}

describe("render isolation", () => {
  beforeEach(() =>
    useQuotes.setState({ bySymbol: { AAPL: mk("AAPL", 1), MSFT: mk("MSFT", 1) } }));

  it("a tick on one symbol does not re-render an unrelated cell", () => {
    let aapl = 0;
    let msft = 0;
    render(<><Cell symbol="AAPL" onRender={() => aapl++} />
            <Cell symbol="MSFT" onRender={() => msft++} /></>);
    const baseMsft = msft;
    act(() => {
      useQuotes.getState().ingest([mk("AAPL", 999)]);
    });
    expect(aapl).toBeGreaterThan(1);   // AAPL cell re-rendered
    expect(msft).toBe(baseMsft);       // MSFT cell did NOT
  });
});
