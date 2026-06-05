import type { ProviderId, Freshness } from "./types";
import { computeFreshness } from "./freshness";
import { isDemoMode } from "@/lib/demo/mode";

export type ProviderHealth = {
  id: ProviderId;
  display: string;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  freshness: Freshness;
};

/**
 * Human-friendly labels for the Provider Status panel. The KEY ORDER is the
 * declared display order in the UI — keep it stable (the row-order test in
 * health.test.ts pins it).
 */
export const PROVIDER_DISPLAY: Record<ProviderId, string> = {
  "finnhub":     "Equities · Finnhub",
  "twelvedata":  "Indices/Commodities · Twelve Data",
  "coingecko":   "Crypto · CoinGecko",
  "frankfurter": "FX · Frankfurter (ECB)",
  "metals":      "Spot Metals · gold-api.com",
  "index-etf":   "Index ETF proxy",
  "simulated":   "Simulated (fallback)",
};

/**
 * In-memory per-process health map. Survives across requests in a single
 * Node.js server instance, NOT across cold starts. The Provider Status panel
 * is honest about this — "lastOkAt: null" renders as "never" in the UI.
 *
 * This is platform telemetry, NOT tenant data. There is intentionally NO
 * orgId column or per-org partitioning here — every tenant on this deploy
 * sees the same provider health (slice 11 §4.3).
 */
type HealthState = {
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
};
const health = new Map<ProviderId, HealthState>();

/**
 * Side-effect wired from `defaultQuoteFetcher` in `cache.ts` via the
 * `onProviderResult` callback added to `resolveQuotes` in `router.ts`.
 *
 * The optional `at` parameter is for tests — production callers omit it and
 * we stamp Date.now().
 */
export function recordProviderResult(
  id: ProviderId,
  ok: boolean,
  err?: unknown,
  at: number = Date.now(),
): void {
  const prev = health.get(id) ?? { lastOkAt: null, lastErrorAt: null, lastErrorMessage: null };
  if (ok) {
    health.set(id, { ...prev, lastOkAt: at });
  } else {
    const message = err instanceof Error ? err.message : err == null ? null : String(err);
    health.set(id, { ...prev, lastErrorAt: at, lastErrorMessage: message });
  }
}

/**
 * Returns one ProviderHealth row per known provider, in PROVIDER_DISPLAY's
 * declared order.
 *
 * Demo-mode: every row is `simulated` regardless of any prior recordProviderResult
 * calls. Consistent with the slice-1a "simulated dot" honesty contract — the
 * demo deploy has no live providers, the panel says so.
 *
 * "Never fetched" (`lastOkAt: null`) renders as `freshness: "stale"` — we
 * treat absence as worst-case rather than misleading the operator into
 * thinking it's healthy.
 */
export function getProviderStatus(): ProviderHealth[] {
  if (isDemoMode()) {
    return (Object.entries(PROVIDER_DISPLAY) as [ProviderId, string][]).map(
      ([id, display]) => ({
        id,
        display,
        lastOkAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        freshness: "simulated" as Freshness,
      }),
    );
  }
  return (Object.entries(PROVIDER_DISPLAY) as [ProviderId, string][]).map(
    ([id, display]) => {
      const h = health.get(id);
      const lastOkAt = h?.lastOkAt ?? null;
      const freshness: Freshness =
        lastOkAt === null
          ? "stale"
          : computeFreshness(id, lastOkAt);
      return {
        id,
        display,
        lastOkAt,
        lastErrorAt: h?.lastErrorAt ?? null,
        lastErrorMessage: h?.lastErrorMessage ?? null,
        freshness,
      };
    },
  );
}

/** Test-only — clears the in-memory health map. Used by `beforeEach`. */
export function __resetHealth(): void {
  health.clear();
}
