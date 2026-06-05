import type { AssetClass, Quote, ProviderId, QuoteProvider, SymbolDef } from "./types";
import { computeFreshness } from "./freshness";
import { coingeckoProvider } from "./providers/coingecko";
import { frankfurterProvider } from "./providers/frankfurter";
import { finnhubProvider } from "./providers/finnhub";
import { twelvedataProvider } from "./providers/twelvedata";
import { metalsProvider } from "./providers/metals";
import { indexEtfProxyProvider } from "./providers/index-etf";
import { simulatedProvider } from "./providers/simulated";

export const CHAINS: Record<AssetClass, QuoteProvider[]> = {
  crypto: [coingeckoProvider, finnhubProvider, simulatedProvider],
  fx: [frankfurterProvider, finnhubProvider, simulatedProvider],
  equity: [finnhubProvider, twelvedataProvider, simulatedProvider],
  index: [indexEtfProxyProvider, twelvedataProvider, simulatedProvider],
  commodity: [twelvedataProvider, metalsProvider, simulatedProvider],
  bond: [twelvedataProvider, simulatedProvider],
};

export type OnProviderResult = (id: ProviderId, ok: boolean, err?: unknown) => void;

/**
 * Resolve quotes for `symbols` across the provider chain.
 *
 * Slice 11: when `onProviderResult` is supplied, the callback fires once per
 * provider per asset-class pass — `(id, true)` when the fetch yielded ≥1 raw
 * quote, `(id, false, err)` when the provider threw. Used by
 * `defaultQuoteFetcher` in cache.ts to update the health map.
 */
export async function resolveQuotes(
  symbols: SymbolDef[],
  chainOverride?: QuoteProvider[],
  onProviderResult?: OnProviderResult,
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
      } catch (err) {
        onProviderResult?.(provider.id, false, err);
        continue;
      }
      const beforeSize = pending.size;
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
      // "ok" = the provider returned at least one usable quote. A provider
      // that returned an empty map for everything pending is treated as
      // a soft failure for health-tracking purposes (it didn't throw, but
      // it also didn't help).
      if (pending.size < beforeSize) {
        onProviderResult?.(provider.id, true);
      } else if (raws.size === 0) {
        onProviderResult?.(provider.id, false, new Error("empty result"));
      }
    }
  }
  return result;
}
