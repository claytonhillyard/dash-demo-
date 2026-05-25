import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

// Plausible reference levels so simulated values never look absurd
// (e.g. "S&P 500 42.68"). Unknown symbols fall back to a stable seed.
const REFERENCE: Record<string, number> = {
  AAPL: 195.84, MSFT: 415.23, NVDA: 1024.59, GOOGL: 163.37,
  AMZN: 186.21, TSLA: 252.62, META: 531.49,
  BTC: 67842.11, ETH: 3412.89, SOL: 164.52,
  EURUSD: 1.0856, GBPUSD: 1.2713,
  SPX: 5303.27, NDX: 18512.53, DJI: 39869.38, VIX: 12.48,
  XAU: 2389.25, XAG: 28.56, XPT: 1021.30,
  USDAED: 3.6725,
};

function seeded(symbol: string): number {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 1000) / 10 + 10; // 10..110 fallback base price
}

function basePrice(symbol: string): number {
  return REFERENCE[symbol] ?? seeded(symbol);
}

export const simulatedProvider: QuoteProvider = {
  id: "simulated",
  supports: () => true,
  async fetchQuotes(symbols: SymbolDef[]) {
    const now = Date.now();
    const out = new Map<string, RawQuote>();
    for (const s of symbols) {
      const base = basePrice(s.symbol);
      const drift = Math.sin(now / 60_000 + base) * base * 0.01;
      const price = +(base + drift).toFixed(2);
      const changeAbs = +drift.toFixed(2);
      out.set(s.symbol, {
        price,
        changeAbs,
        changePct: +((changeAbs / base) * 100).toFixed(2),
        asOf: now,
      });
    }
    return out;
  },
};
