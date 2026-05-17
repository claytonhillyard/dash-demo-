import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

const ID_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana",
};

export const coingeckoProvider: QuoteProvider = {
  id: "coingecko",
  supports: (c) => c === "crypto",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const ids = symbols.map((s) => ID_MAP[s.symbol]).filter(Boolean);
    if (ids.length === 0) return out;
    const url =
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}` +
      `&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return out;
    const data = (await res.json()) as Record<
      string, { usd: number; usd_24h_change: number }
    >;
    const now = Date.now();
    for (const s of symbols) {
      const row = data[ID_MAP[s.symbol]];
      if (!row) continue;
      const pct = row.usd_24h_change ?? 0;
      out.set(s.symbol, {
        price: row.usd,
        changePct: +pct.toFixed(2),
        changeAbs: +((row.usd * pct) / 100).toFixed(2),
        asOf: now,
      });
    }
    return out;
  },
};
