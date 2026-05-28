export type AssetClass = "equity" | "crypto" | "fx" | "index" | "commodity" | "bond";
export type ProviderId =
  | "finnhub" | "twelvedata" | "coingecko" | "frankfurter" | "metals" | "index-etf" | "simulated";
export type Freshness = "live" | "delayed" | "stale" | "simulated";

export interface SymbolDef {
  symbol: string;
  assetClass: AssetClass;
  display: string;
  currency: string;
}

export interface Quote {
  symbol: string;
  assetClass: AssetClass;
  display: string;
  price: number;
  changeAbs: number;
  changePct: number;
  currency: string;
  asOf: number;       // epoch ms
  source: ProviderId;
  freshness: Freshness;
}

export interface RawQuote {
  price: number;
  changeAbs: number;
  changePct: number;
  asOf: number;
}

export interface QuoteProvider {
  id: ProviderId;
  supports(assetClass: AssetClass): boolean;
  fetchQuotes(symbols: SymbolDef[]): Promise<Map<string, RawQuote>>;
}
