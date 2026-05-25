import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useQuotes, selectQuote } from "@/store/quotes";
import { FreshnessDot } from "@/components/FreshnessDot";
import type { Quote } from "@/lib/market/types";

const mk = (symbol: string, price: number): Quote => ({
  symbol, assetClass: "commodity", display: symbol, currency: "USD",
  price, changeAbs: 0, changePct: 0, asOf: 1, source: "twelvedata", freshness: "live",
});

// Mirror of the KpiTicker LiveCard subscription contract.
function Card({ symbol, onRender }: { symbol: string; onRender: () => void }) {
  const q = useQuotes(selectQuote(symbol));
  onRender();
  return <span>{q?.price}<FreshnessDot freshness={q?.freshness ?? "live"} /></span>;
}

describe("KPI render isolation", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: { XAU: mk("XAU", 2400), BTC: mk("BTC", 67000) } }));

  it("a Gold tick does not re-render the Bitcoin card", () => {
    let gold = 0, btc = 0;
    render(<><Card symbol="XAU" onRender={() => gold++} /><Card symbol="BTC" onRender={() => btc++} /></>);
    const baseBtc = btc;
    act(() => { useQuotes.getState().ingest([mk("XAU", 2450)]); });
    expect(gold).toBeGreaterThan(1);
    expect(btc).toBe(baseBtc);
  });
});
