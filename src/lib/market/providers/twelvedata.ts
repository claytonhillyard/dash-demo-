import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

const TD_SYMBOL: Record<string, string> = {
  SPX: "SPX", NDX: "NDX", DJI: "DJI", VIX: "VIX",
  XAU: "XAU/USD", XAG: "XAG/USD",
};

export const twelvedataProvider: QuoteProvider = {
  id: "twelvedata",
  supports: (c) => c === "index" || c === "commodity",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const key = process.env.TWELVEDATA_API_KEY;
    if (!key) return out;
    const now = Date.now();
    for (const s of symbols) {
      const td = TD_SYMBOL[s.symbol] ?? s.symbol;
      const res = await fetch(
        `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(td)}&apikey=${key}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const d = (await res.json()) as
        { close?: string; change?: string; percent_change?: string };
      if (d.close == null) continue;
      out.set(s.symbol, {
        price: Number(d.close),
        changeAbs: Number(d.change ?? 0),
        changePct: Number(d.percent_change ?? 0),
        asOf: now,
      });
    }
    return out;
  },
};
