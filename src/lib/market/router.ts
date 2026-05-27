import type { AssetClass, Quote, QuoteProvider, SymbolDef } from "./types";
import { computeFreshness } from "./freshness";
import { coingeckoProvider } from "./providers/coingecko";
import { frankfurterProvider } from "./providers/frankfurter";
import { finnhubProvider } from "./providers/finnhub";
import { twelvedataProvider } from "./providers/twelvedata";
import { metalsProvider } from "./providers/metals";
import { simulatedProvider } from "./providers/simulated";

export const CHAINS: Record<AssetClass, QuoteProvider[]> = {
  crypto: [coingeckoProvider, finnhubProvider, simulatedProvider],
  fx: [frankfurterProvider, finnhubProvider, simulatedProvider],
  equity: [finnhubProvider, twelvedataProvider, simulatedProvider],
  index: [twelvedataProvider, finnhubProvider, simulatedProvider],
  commodity: [twelvedataProvider, metalsProvider, simulatedProvider],
  bond: [twelvedataProvider, simulatedProvider],
};

export async function resolveQuotes(
  symbols: SymbolDef[],
  chainOverride?: QuoteProvider[]
): Promise<Quote[]> {
  const result: Quote[] = [];
  const byClass = new Map<AssetClass, SymbolDef[]>();
  for (const s of symbols) {
    byClass.set(s.assetClass, [...(byClass.get(s.assetClass) ?? []), s]);
  }
  for (const [assetClass, syms] of byClass) {
    const base = chainOverride ?? CHAINS[assetClass];
    // simulatedProvider is always the guaranteed terminal fallback so a
    // panel is never blank (spec §5.5), even with a custom override chain.
    const chain = base.includes(simulatedProvider)
      ? base
      : [...base, simulatedProvider];
    const pending = new Map(syms.map((s) => [s.symbol, s]));
    for (const provider of chain) {
      if (pending.size === 0) break;
      if (!provider.supports(assetClass)) continue;
      let raws: Awaited<ReturnType<QuoteProvider["fetchQuotes"]>>;
      try {
        raws = await provider.fetchQuotes([...pending.values()]);
      } catch {
        continue;
      }
      for (const [symbol, raw] of raws) {
        const def = pending.get(symbol);
        if (!def) continue;
        result.push({
          symbol: def.symbol,
          assetClass: def.assetClass,
          display: def.display,
          currency: def.currency,
          price: raw.price,
          changeAbs: raw.changeAbs,
          changePct: raw.changePct,
          asOf: raw.asOf,
          source: provider.id,
          freshness: computeFreshness(provider.id, raw.asOf),
        });
        pending.delete(symbol);
      }
    }
  }
  return result;
}
