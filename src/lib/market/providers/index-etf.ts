import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

/**
 * Finnhub's free tier doesn't cover stock indices directly (SPX/NDX/DJI/VIX
 * are 404 / paid-tier) but DOES cover US ETFs in real time. This provider
 * routes each index symbol to its tracking ETF (SPY/QQQ/DIA), applies a
 * documented multiplier to roughly approximate the index level, and reports
 * the result as a quote against the original index symbol.
 *
 * Caveats:
 *   - ETF price × multiplier ~= index level (within 0.5-1% — ETFs drift from
 *     their index due to tracking error, dividends, expense ratio). Fine for a
 *     context display; would not be acceptable for trading.
 *   - % change passes through directly (the multiplier cancels), so movement
 *     direction + magnitude are accurate.
 *   - VIX has no clean ETF proxy at a comparable scale (VIXY tracks futures,
 *     not the VIX spot value), so it's intentionally omitted and stays
 *     simulated until a paid Twelve Data tier covers it.
 */
const ETF: Record<string, { etf: string; multiplier: number }> = {
  SPX: { etf: "SPY", multiplier: 10 },
  NDX: { etf: "QQQ", multiplier: 10 },
  DJI: { etf: "DIA", multiplier: 100 },
  // VIX intentionally absent — see header note.
};

export const indexEtfProxyProvider: QuoteProvider = {
  id: "index-etf",
  supports: (c) => c === "index",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const key = process.env.FINNHUB_API_KEY;
    if (!key) return out;
    const now = Date.now();
    for (const s of symbols) {
      const mapping = ETF[s.symbol];
      if (!mapping) continue;
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(mapping.etf)}&token=${key}`,
          { cache: "no-store" }
        );
        if (!res.ok) continue;
        const d = (await res.json()) as { c?: number; d?: number; dp?: number };
        if (typeof d.c !== "number" || !Number.isFinite(d.c)) continue;
        const m = mapping.multiplier;
        out.set(s.symbol, {
          price: +(d.c * m).toFixed(2),
          changeAbs: +((d.d ?? 0) * m).toFixed(2),
          changePct: +(d.dp ?? 0).toFixed(2), // unchanged by the multiplier
          asOf: now,
        });
      } catch {
        continue;
      }
    }
    return out;
  },
};
