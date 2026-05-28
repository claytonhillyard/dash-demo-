import type { Freshness } from "./types";
import { isBuildPhase } from "./buildPhase";

export type Range = "1D" | "7D" | "1M" | "3M" | "1Y" | "ALL";

export interface HistorySeries {
  symbol: string;
  points: number[];
  freshness: Freshness;
}

export function rangeToDays(range: Range): number {
  switch (range) {
    case "1D": return 1;
    case "7D": return 7;
    case "1M": return 30;
    case "3M": return 90;
    case "1Y": return 365;
    case "ALL": return 1825;
  }
}

const CG_ID: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana" };

async function cryptoHistory(symbol: string, days: number): Promise<number[]> {
  const id = CG_ID[symbol];
  if (!id) return [];
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { prices?: [number, number][] };
    return (data.prices ?? []).map(([, v]) => v);
  } catch {
    // Network failure or malformed JSON (truncated body, HTML error page, …).
    // Caller treats [] as "no live data → fall back to simulated".
    return [];
  }
}

async function tdHistory(tdSymbol: string, days: number): Promise<number[]> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}` +
        `&interval=1day&outputsize=${days}&apikey=${key}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { values?: { close: string }[] };
    return (data.values ?? []).map((v) => Number(v.close)).reverse();
  } catch {
    return [];
  }
}

function simulatedSeries(base: number, days: number): number[] {
  const n = Math.min(days, 180);
  return Array.from({ length: n }, (_, i) => +(base + Math.sin(i / 6) * base * 0.03).toFixed(2));
}

export async function fetchHistory(symbol: string, range: Range): Promise<HistorySeries> {
  const days = rangeToDays(range);
  // Never hit the network during `next build` — the build must be deterministic
  // and offline-safe. cryptoHistory/tdHistory still get exercised at runtime.
  const offline = isBuildPhase();
  if (CG_ID[symbol] && !offline) {
    const points = await cryptoHistory(symbol, days);
    if (points.length) return { symbol, points, freshness: "live" };
  }
  if (symbol === "XAU" || symbol === "XAG" || symbol === "XPT") {
    if (!offline) {
      const points = await tdHistory(`${symbol}/USD`, days);
      if (points.length) return { symbol, points, freshness: "live" };
    }
    const base = symbol === "XAU" ? 2389.25 : symbol === "XPT" ? 1021.3 : 28.56;
    return { symbol, points: simulatedSeries(base, days), freshness: "simulated" };
  }
  return { symbol, points: simulatedSeries(100, days), freshness: "simulated" };
}
