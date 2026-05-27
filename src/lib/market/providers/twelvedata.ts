import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

const TD_SYMBOL: Record<string, string> = {
  SPX: "SPX", NDX: "NDX", DJI: "DJI", VIX: "VIX",
  XAU: "XAU/USD", XAG: "XAG/USD", XPT: "XPT/USD",
};

type TdQuote = { close?: string; change?: string; percent_change?: string; status?: string };

function toRaw(d: TdQuote, now: number): RawQuote | null {
  if (d == null || d.close == null) return null;
  return {
    price: Number(d.close),
    changeAbs: Number(d.change ?? 0),
    changePct: Number(d.percent_change ?? 0),
    asOf: now,
  };
}

export const twelvedataProvider: QuoteProvider = {
  id: "twelvedata",
  supports: (c) => c === "index" || c === "commodity",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const key = process.env.TWELVEDATA_API_KEY;
    if (!key || symbols.length === 0) return out;
    const now = Date.now();

    // Map our symbols -> TD symbols, keeping a reverse lookup to map results back.
    const tdToOurs = new Map<string, string>();
    for (const s of symbols) tdToOurs.set(TD_SYMBOL[s.symbol] ?? s.symbol, s.symbol);
    const tdList = [...tdToOurs.keys()];

    // ONE batched request for all symbols. Twelve Data's free tier is 8 credits/min;
    // a request per symbol (7 here) burns the budget and 429s. Comma-joined symbols
    // cost a single credit and return a keyed object. Note: TD returns HTTP 200 even
    // for errors, so we detect failure by the body, not res.ok.
    const res = await fetch(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(tdList.join(","))}&apikey=${key}`,
      { cache: "no-store" }
    );
    if (!res.ok) return out;

    const body = (await res.json()) as TdQuote | Record<string, TdQuote>;
    // Batch-level error (e.g. 429, invalid key) comes back as a flat error object.
    if (body && (body as TdQuote).status === "error") return out;

    // A single requested symbol returns a flat quote; multiple return a keyed object.
    const entries: Array<[string, TdQuote]> =
      tdList.length === 1
        ? [[tdList[0], body as TdQuote]]
        : Object.entries(body as Record<string, TdQuote>);

    for (const [td, d] of entries) {
      const ours = tdToOurs.get(td);
      if (!ours) continue;
      const raw = toRaw(d, now);
      if (raw) out.set(ours, raw);
    }
    return out;
  },
};
