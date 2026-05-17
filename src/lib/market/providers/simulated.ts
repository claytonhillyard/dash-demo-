import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

function seeded(symbol: string): number {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 1000) / 10 + 10; // 10..110 base price
}

export const simulatedProvider: QuoteProvider = {
  id: "simulated",
  supports: () => true,
  async fetchQuotes(symbols: SymbolDef[]) {
    const now = Date.now();
    const out = new Map<string, RawQuote>();
    for (const s of symbols) {
      const base = seeded(s.symbol);
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
