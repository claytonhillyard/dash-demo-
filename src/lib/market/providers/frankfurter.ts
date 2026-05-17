import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

export const frankfurterProvider: QuoteProvider = {
  id: "frankfurter",
  supports: (c) => c === "fx",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const now = Date.now();
    for (const s of symbols) {
      const base = s.symbol.slice(0, 3);
      const quote = s.symbol.slice(3, 6);
      const res = await fetch(
        `https://api.frankfurter.app/latest?from=${base}&to=${quote}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { rates: Record<string, number> };
      const price = data.rates?.[quote];
      if (price == null) continue;
      out.set(s.symbol, { price, changeAbs: 0, changePct: 0, asOf: now });
    }
    return out;
  },
};
