import type { HealthBand } from "@/lib/customers/healthScore";

/**
 * The only fields the AI insight prompt is allowed to see. This is a
 * type-level PII guard: email, phone, address, and notes simply are not
 * parameters here, so a caller spreading a full customer record in cannot
 * compile (excess-property checking rejects an inline object literal with
 * extra keys — see the `@ts-expect-error` test in healthInsight.test.ts).
 * Counts, dates, band, and display name only — never contact details.
 */
export type HealthInsightInput = {
  name: string;
  score: number;
  band: HealthBand;
  components: { recency: number; frequency: number; breadth: number };
  eventsLast30d: number;
  lastActivityAt: Date | null;
};

const BAND_LABEL: Record<HealthBand, string> = {
  healthy: "healthy",
  watch: "watch",
  at_risk: "at risk",
};

/** Human label for whichever of the three components currently contributes
 *  the least — the thing most worth improving. */
function weakestComponentLabel(components: HealthInsightInput["components"]): string {
  const entries: [string, number][] = [
    ["recency", components.recency],
    ["frequency", components.frequency],
    ["breadth", components.breadth],
  ];
  entries.sort((a, b) => a[1] - b[1]);
  return entries[0]![0];
}

/**
 * Builds a short, structured prompt asking the AI to write 2-3 sentences for
 * a business owner about a customer relationship's health. Pure and
 * deterministic — same input + `now` always yields the same string, since
 * the only relative-time computation (days since last touch) is derived
 * from the injected `now`, never `Date.now()`.
 *
 * PII discipline: only what's in `HealthInsightInput` can appear here —
 * name, score, band, component breakdown, event count, and a days-since
 * figure. No email/phone/address/notes ever reach this function or the
 * gateway call it feeds (slice 36 spec §5.4).
 */
export function buildHealthInsightPrompt(input: HealthInsightInput, now: Date): string {
  const daysSince = input.lastActivityAt
    ? Math.round((now.getTime() - input.lastActivityAt.getTime()) / 86_400_000)
    : null;
  const daysSinceText =
    daysSince === null
      ? "no recorded activity yet"
      : daysSince === 0
        ? "active today (0 days since last touch)"
        : `${daysSince} day${daysSince === 1 ? "" : "s"} since last touch`;
  const weakest = weakestComponentLabel(input.components);

  return [
    "Write 2-3 sentences for a business owner summarizing this customer relationship's health.",
    "Be plain, concrete, and actionable. Do not invent facts beyond what is given below.",
    "",
    `Customer: ${input.name}`,
    `Health score: ${input.score}/100 (band: ${BAND_LABEL[input.band]})`,
    `Recency: ${daysSinceText}`,
    `Activity in the last 30 days: ${input.eventsLast30d} event${input.eventsLast30d === 1 ? "" : "s"}`,
    `Weakest scoring factor: ${weakest}`,
  ].join("\n");
}
