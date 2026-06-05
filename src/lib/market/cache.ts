import type { Quote, SymbolDef } from "./types";
import { ALL_SYMBOLS } from "./registry";
import { resolveQuotes } from "./router";
import { simulatedProvider } from "./providers/simulated";
import { recordProviderResult } from "./health";
import { isDemoMode } from "@/lib/demo/mode";
import { isBuildPhase } from "./buildPhase";

// Twelve Data backs the index + commodity classes on a metered free tier
// (8 credits/min, 1 credit per symbol). Refresh those classes on a slow cadence
// so we stay within budget; the free / real-time sources (equity via Finnhub,
// crypto via CoinGecko, fx via Frankfurter) refresh fast. Spot metals move
// slowly, so ~90s latency is imperceptible.
const SLOW_CLASSES = new Set<SymbolDef["assetClass"]>(["index", "commodity"]);
const FAST_SYMBOLS = ALL_SYMBOLS.filter((s) => !SLOW_CLASSES.has(s.assetClass));
const SLOW_SYMBOLS = ALL_SYMBOLS.filter((s) => SLOW_CLASSES.has(s.assetClass));

/**
 * Default poller fetcher. Resolves the given symbol subset through the real
 * provider chain — or, in demo mode or during `next build`, forces the
 * simulated provider so neither the demo nor the build ever makes an external
 * call. Building offline must always succeed deterministically; see
 * `buildPhase.ts` for the rationale.
 *
 * Slice 11: wires resolveQuotes's `onProviderResult` callback to update the
 * in-memory health map for the Provider Status panel.
 */
export function defaultQuoteFetcher(symbols: SymbolDef[]): Promise<Quote[]> {
  return isDemoMode() || isBuildPhase()
    ? resolveQuotes(symbols, [simulatedProvider], recordProviderResult)
    : resolveQuotes(symbols, undefined, recordProviderResult);
}

export class QuoteCache {
  private data = new Map<string, Quote>();
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private fetcher: (symbols: SymbolDef[]) => Promise<Quote[]> = defaultQuoteFetcher) {}

  snapshot(): Quote[] {
    return [...this.data.values()];
  }

  private apply(quotes: Quote[]): void {
    for (const q of quotes) this.data.set(q.symbol, q);
  }

  /** Refresh a specific symbol subset. Never wipes the snapshot on failure. */
  async refreshSymbols(symbols: SymbolDef[]): Promise<void> {
    try {
      this.apply(await this.fetcher(symbols));
    } catch {
      // keep last good snapshot — never wipe on failure
    }
  }

  /** Full refresh of every symbol. */
  async refresh(): Promise<void> {
    await this.refreshSymbols(ALL_SYMBOLS);
  }

  /**
   * One immediate full refresh, then split timers: fast sources every `fastMs`,
   * metered Twelve Data classes every `slowMs` (keeps the free-tier credit budget).
   */
  start(fastMs = 15_000, slowMs = 90_000): void {
    if (this.timers.length) return;
    void this.refresh();
    this.timers.push(setInterval(() => void this.refreshSymbols(FAST_SYMBOLS), fastMs));
    this.timers.push(setInterval(() => void this.refreshSymbols(SLOW_SYMBOLS), slowMs));
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __quoteCache: QuoteCache | undefined;
}

export function getQuoteCache(): QuoteCache {
  if (!globalThis.__quoteCache) {
    globalThis.__quoteCache = new QuoteCache();
    globalThis.__quoteCache.start();
  }
  return globalThis.__quoteCache;
}
