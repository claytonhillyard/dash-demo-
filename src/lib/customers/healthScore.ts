export const HEALTH_WEIGHTS = {
  recencyMax: 40,
  recencyFullDays: 2,
  recencyZeroDays: 30,
  frequencyMax: 35,
  frequencySaturation: 8,
  breadthMax: 25,
  breadthSaturation: 4,
  healthyMin: 70,
  watchMin: 40,
} as const;

export type HealthBand = "healthy" | "watch" | "at_risk";
export type HealthInputs = { lastActivityAt: Date | null; eventsLast30d: number; distinctVerbs30d: number; customerCreatedAt: Date };
export type HealthScore = { score: number; band: HealthBand; components: { recency: number; frequency: number; breadth: number } };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Deterministic, explainable health heuristic. The math scores; the AI
 *  (healthInsight.ts) only explains. `now` injected — no Date.now() here. */
export function computeHealthScore(inputs: HealthInputs, now: Date): HealthScore {
  const anchor = inputs.lastActivityAt ?? inputs.customerCreatedAt;
  const daysSince = (now.getTime() - anchor.getTime()) / 86_400_000;
  const { recencyMax, recencyFullDays, recencyZeroDays, frequencyMax, frequencySaturation, breadthMax, breadthSaturation, healthyMin, watchMin } = HEALTH_WEIGHTS;

  const recency =
    daysSince <= recencyFullDays
      ? recencyMax
      : recencyMax * clamp01((recencyZeroDays - daysSince) / (recencyZeroDays - recencyFullDays));
  const frequency = frequencyMax * clamp01(inputs.eventsLast30d / frequencySaturation);
  const breadth = breadthMax * clamp01(inputs.distinctVerbs30d / breadthSaturation);

  const score = Math.min(100, Math.max(0, Math.round(recency + frequency + breadth)));
  const band: HealthBand = score >= healthyMin ? "healthy" : score >= watchMin ? "watch" : "at_risk";
  return { score, band, components: { recency, frequency, breadth } };
}
