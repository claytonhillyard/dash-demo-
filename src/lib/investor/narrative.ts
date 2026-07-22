import { formatCentsExact } from "@/lib/company/format";
import type { RunwayResult } from "@/lib/runway/compute";
import { generateAiText } from "@/lib/ai/generateAiText";
import type { AiErrorCode } from "@/lib/ai/types";
import type { InvestorKpis } from "./collect";

/**
 * Narrative generation for the investor-update PDF (spec §4): a pure prompt
 * builder + a pure deterministic offline fallback + the thin seam-calling
 * wrapper that decides which of the two the caller actually sees.
 *
 * PII discipline: `InvestorKpis` (src/lib/investor/collect.ts) is aggregates
 * ONLY by construction — no customer names, emails, or per-customer detail
 * ever enters this module, so nothing built from it can leak PII into the
 * prompt or (via the seam's own Sentry rules) into telemetry.
 */

const NARRATIVE_SYSTEM =
  "You write concise investor updates. Three short paragraphs, plain factual tone, no hype, no bullet lists.";

/** "X.X" (one decimal) or the "99.9+" cap label — shared by the compact
 *  prompt-line verdict and the prose narrative sentence below so the two
 *  never drift apart on the same number. Mirrors the cap-display idiom
 *  `CashRunwayPanel` uses (src/components/dashboard/CashRunwayPanel.tsx) —
 *  reimplemented here rather than imported from a React component file. */
function cappedMonthsLabel(months: number): string {
  return months >= 99.9 ? "99.9+" : months.toFixed(1);
}

/**
 * One-line runway verdict (spec §4: "burning ~X.X months" / "cash-positive"
 * / "insufficient history"), shared between the AI prompt serialization
 * below and the report PDF's KPI grid (`src/lib/investor/reportPdf.ts`) so
 * the narrative and the grid always agree on what the runway numbers mean.
 *
 * Uses the plain ASCII "~" for "approximately" rather than "≈" (U+2248):
 * this string is reused verbatim as a KPI-grid cell in the PDF, which runs
 * every value through `toWinAnsiSafe` before drawing — "≈" isn't in
 * Windows-1252 and would silently become "?" there ("burning ?4.2 months"),
 * which is correct-but-ugly for what is the common case, not an edge case.
 * "~" reads just as clearly and is safe in both the LLM prompt and the PDF.
 */
export function formatRunwayVerdict(runway: RunwayResult): string {
  switch (runway.kind) {
    case "insufficient_history":
      return "insufficient history to project runway";
    case "cash_positive":
      return `cash-positive (avg ${formatCentsExact(runway.avgMonthlyProfitCents)}/mo)`;
    case "burning":
      return `burning ~${cappedMonthsLabel(runway.monthsOfRunwayFromReceivables)} months of runway (avg ${formatCentsExact(runway.avgMonthlyBurnCents)}/mo burn)`;
  }
}

/** "ym $X,XXX.XX, ym $X,XXX.XX, ..." — compact, most-recent-first month list
 *  for the prompt body; "no data" when the legacy table is empty (spec §3's
 *  honesty comment on `revenue_months`/`profit_months`). */
function formatMonthList(months: InvestorKpis["revenue"]["months"]): string {
  if (months.length === 0) return "no data";
  return months.map((m) => `${m.ym} ${formatCentsExact(m.cents)}`).join(", ");
}

/** " (H healthy, W watch, R at-risk)" or "" when there are no snapshots at
 *  all — omitted entirely rather than rendered as zeros so the model isn't
 *  told "0 healthy, 0 watch, 0 at-risk" for an org with no health data. */
function formatHealthMixClause(mix: InvestorKpis["customers"]["healthMix"]): string {
  return mix ? ` (${mix.healthy} healthy, ${mix.watch} watch, ${mix.at_risk} at-risk)` : "";
}

/**
 * Pure prompt builder (spec §4). The prompt body is a compact serialization
 * of `InvestorKpis` — dollars via `formatCentsExact`, the runway verdict
 * spelled out via `formatRunwayVerdict` — and nothing else: aggregates only,
 * so there is structurally no "@" (no email) surface for the no-PII guard
 * test to find.
 */
export function buildInvestorPrompt(kpis: InvestorKpis): { system: string; prompt: string } {
  const prompt = [
    `Period: ${kpis.periodLabel}`,
    `Organization: ${kpis.orgName}`,
    "",
    `Revenue by month (most recent first): ${formatMonthList(kpis.revenue.months)}`,
    `Profit by month (most recent first): ${formatMonthList(kpis.profit.months)}`,
    "",
    `Outstanding receivables: ${formatCentsExact(kpis.receivables.totalCents)} across ${kpis.receivables.count} invoice(s); ${formatCentsExact(kpis.receivables.overdueCents)} overdue`,
    `Runway: ${formatRunwayVerdict(kpis.runway)}`,
    "",
    `This period: ${kpis.invoicing.issuedCount} invoice(s) issued totaling ${formatCentsExact(kpis.invoicing.issuedCents)}; ${formatCentsExact(kpis.invoicing.collectedCents)} collected`,
    "",
    `Customers: ${kpis.customers.total}${formatHealthMixClause(kpis.customers.healthMix)}`,
  ].join("\n");

  return { system: NARRATIVE_SYSTEM, prompt };
}

/** Comparative clause against the prior month, or "" when there's under two
 *  months of history to compare (a single point isn't a trend). */
function revenueTrendClause(months: InvestorKpis["revenue"]["months"]): string {
  if (months.length < 2) return "";
  const [latest, prior] = months;
  if (latest!.cents > prior!.cents) return ", up from the prior month";
  if (latest!.cents < prior!.cents) return ", down from the prior month";
  return ", flat versus the prior month";
}

function revenueProfitParagraph(kpis: InvestorKpis): string {
  return (
    `In ${kpis.periodLabel}, revenue stood at ${formatCentsExact(kpis.revenue.latestCents)} and profit at ` +
    `${formatCentsExact(kpis.profit.latestCents)}${revenueTrendClause(kpis.revenue.months)}.`
  );
}

function receivablesParagraph(kpis: InvestorKpis): string {
  return (
    `Outstanding receivables total ${formatCentsExact(kpis.receivables.totalCents)} across ${kpis.receivables.count} ` +
    `invoice(s), of which ${formatCentsExact(kpis.receivables.overdueCents)} is overdue. This period, ` +
    `${kpis.invoicing.issuedCount} invoice(s) were issued totaling ${formatCentsExact(kpis.invoicing.issuedCents)}, ` +
    `and ${formatCentsExact(kpis.invoicing.collectedCents)} was collected.`
  );
}

/** Prose (not the compact §4 form) runway sentence for the narrative body —
 *  same underlying numbers/cap as `formatRunwayVerdict`, phrased to read as
 *  a sentence rather than a KPI-grid line. */
function runwaySentence(runway: RunwayResult): string {
  switch (runway.kind) {
    case "insufficient_history":
      return "There is not yet enough profit history to project a cash runway.";
    case "cash_positive":
      return `The business is cash-positive, averaging ${formatCentsExact(runway.avgMonthlyProfitCents)} per month.`;
    case "burning":
      return `At the current burn rate of ${formatCentsExact(runway.avgMonthlyBurnCents)} per month, receivables provide an estimated ${cappedMonthsLabel(runway.monthsOfRunwayFromReceivables)} months of runway.`;
  }
}

function runwayCustomersParagraph(kpis: InvestorKpis): string {
  const mix = kpis.customers.healthMix;
  const mixClause = mix
    ? `, with a health mix of ${mix.healthy} healthy, ${mix.watch} watch, and ${mix.at_risk} at-risk`
    : "";
  return `${runwaySentence(kpis.runway)} The customer base stands at ${kpis.customers.total}${mixClause}.`;
}

/**
 * Deterministic offline narrative (spec §4): three paragraphs — revenue/profit
 * trend, receivables/collections, runway/customers — derived purely from the
 * numbers already in `kpis`. Same input always yields the same output (no
 * randomness, no wall clock). Used verbatim (not the seam's generic canned
 * copy) whenever `generateAiText` itself falls back to simulated mode, so a
 * keyless/demo PDF still reads like a real update instead of placeholder text.
 */
export function simulatedNarrative(kpis: InvestorKpis): string {
  return [revenueProfitParagraph(kpis), receivablesParagraph(kpis), runwayCustomersParagraph(kpis)].join("\n\n");
}

/** Splits generated text into trimmed, non-empty paragraphs on blank-line
 *  boundaries (one or more blank lines between them), capped at 5 — shared
 *  by both the real-AI and simulated paths so a caller can't tell which
 *  produced a given result just by how it was split. */
function splitParagraphs(text: string, cap = 5): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, cap);
}

/** Short, user-facing text for every `generateAiText` seam failure code
 *  (src/lib/ai/types.ts `AiErrorCode`) — never the raw code, same spirit as
 *  sendInvoice's `EMAIL_ERROR_MESSAGES` (src/lib/invoices/actions.ts). */
const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  rate_limited: "AI service is rate-limited — try again shortly",
  budget_exceeded: "AI usage budget for this month has been reached — try again later",
  unavailable: "AI service is temporarily unavailable — try again shortly",
  error: "Couldn't generate the narrative — try again",
};

/**
 * Generates the investor-update narrative (spec §4). Calls the AI seam with
 * the compact aggregates-only prompt from `buildInvestorPrompt`; when the
 * seam itself falls back to simulated mode (no key / demo / build), the
 * seam's generic canned text is discarded in favor of `simulatedNarrative`
 * so the offline PDF stays honest AND readable. Never throws — any
 * unexpected rejection from the seam is caught and mapped to the same
 * generic friendly error a mapped `AiErrorCode` would produce.
 */
export async function generateInvestorNarrative(
  kpis: InvestorKpis,
  orgId: number,
): Promise<{ ok: true; paragraphs: string[]; simulated: boolean } | { ok: false; error: string }> {
  try {
    const { system, prompt } = buildInvestorPrompt(kpis);
    const res = await generateAiText({
      feature: "investor-update",
      prompt,
      system,
      tier: "fast",
      user: `org:${orgId}`,
    });

    if (!res.ok) {
      return { ok: false, error: AI_ERROR_MESSAGES[res.error] };
    }

    const text = res.simulated ? simulatedNarrative(kpis) : res.text;
    const paragraphs = splitParagraphs(text);
    // A model can return ok with an empty/whitespace-only body; a PDF with a
    // bare "Narrative" heading and no text is a worse artifact than a clean
    // error (review N3) — treat it as a generation failure.
    if (paragraphs.length === 0) {
      return { ok: false, error: AI_ERROR_MESSAGES.error };
    }
    return { ok: true, paragraphs, simulated: res.simulated };
  } catch {
    return { ok: false, error: AI_ERROR_MESSAGES.error };
  }
}
