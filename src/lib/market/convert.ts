import type { Freshness } from "./types";

const BASE = "https://api.frankfurter.app";

export interface ConversionResult {
  from: string;
  to: string;
  amount: number;
  rate: number;
  result: number;
  asOf: number;
  freshness: Freshness;
}

/** Frankfurter's full supported-currency map: code -> human name. */
export async function fetchCurrencyList(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/currencies`, { cache: "no-store" });
  if (!res.ok) return {};
  return (await res.json()) as Record<string, string>;
}

/** Convert via Frankfurter (ECB daily). Honest freshness: never "live". */
export async function convertCurrency(
  from: string,
  to: string,
  amount: number,
): Promise<ConversionResult> {
  const now = Date.now();
  if (from === to) {
    return { from, to, amount, rate: 1, result: amount, asOf: now, freshness: "delayed" };
  }
  try {
    const res = await fetch(
      `${BASE}/latest?amount=${amount}&from=${from}&to=${to}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error("frankfurter unavailable");
    const data = (await res.json()) as { rates?: Record<string, number> };
    const result = data.rates?.[to];
    if (result == null) throw new Error("rate missing");
    // Guard divide-by-zero: a zero amount has a defined result (0) but no
    // meaningful unit rate, so report rate 0 rather than a silent NaN.
    const rate = amount === 0 ? 0 : result / amount;
    return { from, to, amount, rate, result, asOf: now, freshness: "delayed" };
  } catch {
    // Honest degradation: pegged/last-resort estimate, clearly labeled simulated.
    return { from, to, amount, rate: 1, result: amount, asOf: now, freshness: "simulated" };
  }
}
