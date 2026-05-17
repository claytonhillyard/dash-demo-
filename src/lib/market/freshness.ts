import type { Freshness, ProviderId } from "./types";

export function computeFreshness(
  source: ProviderId,
  asOf: number,
  now: number = Date.now()
): Freshness {
  if (source === "simulated") return "simulated";
  const ageMs = now - asOf;
  if (ageMs <= 30_000) return "live";
  if (ageMs <= 5 * 60_000) return "delayed";
  return "stale";
}
