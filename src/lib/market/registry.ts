import type { SymbolDef } from "./types";

export const ALL_SYMBOLS: SymbolDef[] = [
  { symbol: "AAPL", assetClass: "equity", display: "Apple Inc.", currency: "USD" },
  { symbol: "MSFT", assetClass: "equity", display: "Microsoft Corp.", currency: "USD" },
  { symbol: "NVDA", assetClass: "equity", display: "NVIDIA Corp.", currency: "USD" },
  { symbol: "GOOGL", assetClass: "equity", display: "Alphabet Inc.", currency: "USD" },
  { symbol: "AMZN", assetClass: "equity", display: "Amazon.com", currency: "USD" },
  { symbol: "TSLA", assetClass: "equity", display: "Tesla Inc.", currency: "USD" },
  { symbol: "META", assetClass: "equity", display: "Meta Platforms", currency: "USD" },
  { symbol: "BTC", assetClass: "crypto", display: "Bitcoin", currency: "USD" },
  { symbol: "ETH", assetClass: "crypto", display: "Ethereum", currency: "USD" },
  { symbol: "SOL", assetClass: "crypto", display: "Solana", currency: "USD" },
  { symbol: "EURUSD", assetClass: "fx", display: "EUR/USD", currency: "USD" },
  { symbol: "GBPUSD", assetClass: "fx", display: "GBP/USD", currency: "USD" },
  { symbol: "SPX", assetClass: "index", display: "S&P 500", currency: "USD" },
  { symbol: "NDX", assetClass: "index", display: "NASDAQ 100", currency: "USD" },
  { symbol: "DJI", assetClass: "index", display: "Dow Jones", currency: "USD" },
  { symbol: "VIX", assetClass: "index", display: "VIX", currency: "USD" },
  { symbol: "XAU", assetClass: "commodity", display: "Gold", currency: "USD" },
  { symbol: "XAG", assetClass: "commodity", display: "Silver", currency: "USD" },
];

const BY_SYMBOL = new Map(ALL_SYMBOLS.map((s) => [s.symbol, s]));
export function lookup(symbol: string): SymbolDef | undefined {
  return BY_SYMBOL.get(symbol);
}
