import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

// gold-api.com is a free, keyless spot-metals source (USD). Symbols map 1:1 to
// our internal codes. It returns spot price only — no 24h change — so change
// fields are reported as 0 rather than fabricated.
const SUPPORTED = new Set(["XAU", "XAG", "XPT", "XPD"]);

export const metalsProvider: QuoteProvider = {
  id: "metals",
  supports: (c) => c === "commodity",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const now = Date.now();
    for (const s of symbols) {
      if (!SUPPORTED.has(s.symbol)) continue;
      try {
        const res = await fetch(`https://api.gold-api.com/price/${encodeURIComponent(s.symbol)}`, {
          cache: "no-store",
        });
        if (!res.ok) continue;
        const d = (await res.json()) as { price?: number };
        if (typeof d.price !== "number" || !Number.isFinite(d.price)) continue;
        out.set(s.symbol, { price: d.price, changeAbs: 0, changePct: 0, asOf: now });
      } catch {
        continue;
      }
    }
    return out;
  },
};
