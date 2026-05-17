import type { Quote } from "./types";
import { ALL_SYMBOLS } from "./registry";
import { resolveQuotes } from "./router";

export class QuoteCache {
  private data = new Map<string, Quote>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private fetcher: () => Promise<Quote[]> =
    () => resolveQuotes(ALL_SYMBOLS)) {}

  snapshot(): Quote[] {
    return [...this.data.values()];
  }

  async refresh(): Promise<void> {
    try {
      const quotes = await this.fetcher();
      for (const q of quotes) this.data.set(q.symbol, q);
    } catch {
      // keep last good snapshot — never wipe on failure
    }
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
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
