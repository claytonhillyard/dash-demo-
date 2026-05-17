import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

export const finnhubProvider: QuoteProvider = {
  id: "finnhub",
  supports: (c) => c === "equity" || c === "fx",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const key = process.env.FINNHUB_API_KEY;
    if (!key) return out;
    const now = Date.now();
    for (const s of symbols) {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${s.symbol}&token=${key}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const d = (await res.json()) as { c: number; d: number; dp: number };
      if (!d.c) continue;
      out.set(s.symbol, {
        price: d.c, changeAbs: d.d ?? 0, changePct: d.dp ?? 0, asOf: now,
      });
    }
    return out;
  },
};
