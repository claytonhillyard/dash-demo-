import { create } from "zustand";
import type { Quote } from "@/lib/market/types";

interface QuotesState {
  bySymbol: Record<string, Quote>;
  ingest: (quotes: Quote[]) => void;
}

export const useQuotes = create<QuotesState>()((set) => ({
  bySymbol: {},
  ingest: (quotes) =>
    set((state) => {
      const next = { ...state.bySymbol };
      for (const q of quotes) {
        const prev = next[q.symbol];
        // preserve object identity if nothing changed -> selector subs skip render
        if (
          prev &&
          prev.price === q.price &&
          prev.changePct === q.changePct &&
          prev.freshness === q.freshness
        ) {
          continue;
        }
        next[q.symbol] = q;
      }
      return { bySymbol: next };
    }),
}));

export const selectQuote = (symbol: string) => (s: QuotesState) => s.bySymbol[symbol];
