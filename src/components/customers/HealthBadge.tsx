import type { HealthBand } from "@/lib/customers/healthScore";

/** Band → dot color. Presentation concern — lives here, not in healthScore.ts.
 *  Mirrors ActivityList's `verbDotClass` convention. */
const BAND_DOT: Record<HealthBand, string> = {
  healthy: "bg-emerald-400",
  watch: "bg-amber-300",
  at_risk: "bg-rose-400",
};
const BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
};

/** Presentational: colored dot + numeric score, `title` = band label.
 *  Used by both the customers list table and the edit-page Health card. */
export function HealthBadge({ score, band }: { score: number; band: HealthBand }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={BAND_LABEL[band]}
      data-health-band={band}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${BAND_DOT[band]}`} />
      <span className="text-sm text-zinc-200">{score}</span>
    </span>
  );
}
