import { formatCentsExact } from "@/lib/company/format";
import { generateAiText } from "@/lib/ai/generateAiText";
import type { AiErrorCode } from "@/lib/ai/types";
import type { NegotiationStats } from "./compute";

/**
 * Coach-narrative generation for the negotiation coach (slice 42 spec —
 * docs/superpowers/plans/2026-07-31-negotiation-coach-slice-42.md, Task
 * 42-2): a pure prompt builder + a pure deterministic offline fallback + the
 * thin seam-calling wrapper that decides which of the two the caller
 * actually sees. Mirrors src/lib/investor/narrative.ts's shape exactly.
 *
 * PII discipline: `NegotiationStats` (src/lib/negotiation/compute.ts) is
 * partner LABEL + aggregates ONLY by construction — no contact details, no
 * per-bid free-text notes, ever enters this module — so nothing built from
 * it can leak PII into the prompt (the "no @" test below locks this in).
 */

const COACH_SYSTEM =
  "You are a terse trade-desk negotiation coach speaking directly to the deal owner. " +
  "Write 2-3 short, plain, declarative sentences — no hype, no exclamation points, no bullet lists. " +
  "Use only the numbers given below; never invent or estimate a figure that isn't provided.";

/** "$X,XXX.XX" or "no pending bid on this deal" — shared by the prompt
 *  serialization and the simulated fallback below so the two phrasings of
 *  "their current best offer" never drift apart. */
function formatBestClause(cents: number | null): string {
  return cents === null ? "no pending bid on this deal" : formatCentsExact(cents);
}

/**
 * Pure prompt builder. The prompt body is a compact serialization of
 * `NegotiationStats` — the partner's label plus whatever aggregates the
 * stats kind actually carries, dollars via `formatCentsExact` — and nothing
 * else: label + aggregates only, so there is structurally no "@" (no
 * email) surface for the no-PII guard test to find. `insufficient_history`
 * only serializes what IS known (closes so far, current best, ask);
 * `coached` additionally includes the win-rate/uplift/rounds/decide-time
 * pattern plus the suggested counter — the tactical facts the system
 * prompt tells the model to reason from, never to invent beyond.
 */
export function buildCoachPrompt(stats: NegotiationStats): { system: string; prompt: string } {
  const lines: string[] =
    stats.kind === "insufficient_history"
      ? [
          `Partner: ${stats.partnerLabel}`,
          `Prior closes with this partner: ${stats.closes}`,
          `Their current best pending bid: ${formatBestClause(stats.currentBestCents)}`,
          `Your ask: ${formatCentsExact(stats.askCents)}`,
          "",
          "There is not yet enough closed history with this partner to project a pattern.",
        ]
      : [
          `Partner: ${stats.partnerLabel}`,
          `Prior closes with this partner: ${stats.closes} of ${stats.decidedDeals} decided negotiations (${stats.winRatePct}% win rate)`,
          `Average uplift per close (positive = moved toward your favor): ${formatCentsExact(stats.avgUpliftCents)}`,
          `Average rounds per negotiation: ${stats.avgRounds}`,
          `Median days to decide: ${stats.medianDaysToDecide}`,
          `Their current best pending bid: ${formatBestClause(stats.currentBestCents)}`,
          `Your ask: ${formatCentsExact(stats.askCents)}`,
          `Suggested counter: ${formatCentsExact(stats.suggestedCounterCents)}`,
        ];

  return { system: COACH_SYSTEM, prompt: lines.join("\n") };
}

/**
 * Deterministic offline coaching (spec Task 42-2): 2-3 sentences derived
 * purely from the numbers already in `stats`. Same input always yields the
 * same output (no randomness, no wall clock). Used verbatim (not the
 * seam's generic canned copy) whenever `generateAiText` itself falls back
 * to simulated mode, so a keyless/demo card still reads like real coaching
 * instead of placeholder text — same precedent as
 * `simulatedNarrative` (src/lib/investor/narrative.ts, slice 41).
 *
 * Deliberately branches on `stats.kind` FIRST — the two kinds must read as
 * genuinely different advice, not the same template with blanks left out:
 * `insufficient_history` is an honest "not enough pattern yet" plus
 * whatever IS known; `coached` leads with the win-rate/uplift pattern and
 * closes on the suggested counter.
 */
export function simulatedCoaching(stats: NegotiationStats): string {
  if (stats.kind === "insufficient_history") {
    const bestClause =
      stats.currentBestCents === null
        ? `no pending bid yet against your ask of ${formatCentsExact(stats.askCents)}`
        : `a current best pending bid of ${formatCentsExact(stats.currentBestCents)} against your ask of ${formatCentsExact(stats.askCents)}`;
    return [
      `Not enough closed history with ${stats.partnerLabel} yet — ${stats.closes} close(s) so far isn't enough to project a pattern.`,
      `Right now ${stats.partnerLabel} has ${bestClause}.`,
    ].join("\n");
  }

  const directionClause =
    stats.avgUpliftCents >= 0
      ? `moving about ${formatCentsExact(stats.avgUpliftCents)} in your favor`
      : `conceding about ${formatCentsExact(Math.abs(stats.avgUpliftCents))} against your favor`;

  return [
    `${stats.partnerLabel} has closed ${stats.closes} of ${stats.decidedDeals} negotiated deals with you ` +
      `(${stats.winRatePct}% win rate), typically ${directionClause} over ${stats.avgRounds} round(s) ` +
      `and about ${stats.medianDaysToDecide} day(s) to decide.`,
    `Their current best pending bid is ${formatBestClause(stats.currentBestCents)} against your ask of ` +
      `${formatCentsExact(stats.askCents)} — counter at ${formatCentsExact(stats.suggestedCounterCents)}.`,
  ].join("\n");
}

/** Splits generated text into trimmed, non-empty LINES (not blank-line
 *  paragraphs — coaching reads as short punchy lines, not prose
 *  paragraphs), capped at 4 — shared by both the real-AI and simulated
 *  paths so a caller can't tell which produced a given result just by how
 *  it was split. Mirrors `splitParagraphs` in
 *  src/lib/investor/narrative.ts, split on "\n" instead of blank-line runs. */
function splitLines(text: string, cap = 4): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, cap);
}

/** Short, user-facing text for every `generateAiText` seam failure code
 *  (src/lib/ai/types.ts `AiErrorCode`) — never the raw code, same spirit as
 *  `AI_ERROR_MESSAGES` in src/lib/investor/narrative.ts. */
const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  rate_limited: "AI coaching is rate-limited — try again shortly",
  budget_exceeded: "AI usage budget for this month has been reached — try again later",
  unavailable: "AI coaching is temporarily unavailable — try again shortly",
  error: "Couldn't generate coaching — try again",
};

/**
 * Generates the negotiation-coach narrative (slice 42 Task 42-2). Calls the
 * AI seam with the compact label-plus-aggregates prompt from
 * `buildCoachPrompt`; when the seam itself falls back to simulated mode (no
 * key / demo / build), the seam's generic canned text is discarded in favor
 * of `simulatedCoaching` so the offline card stays honest AND readable.
 * Never throws — any unexpected rejection from the seam is caught and
 * mapped to the same generic friendly error a mapped `AiErrorCode` would
 * produce.
 */
export async function generateCoaching(
  stats: NegotiationStats,
  orgId: number,
): Promise<{ ok: true; lines: string[]; simulated: boolean } | { ok: false; error: string }> {
  try {
    const { system, prompt } = buildCoachPrompt(stats);
    const res = await generateAiText({
      feature: "negotiation-coach",
      prompt,
      system,
      tier: "fast",
      maxOutputTokens: 300,
      user: `org:${orgId}`,
    });

    if (!res.ok) {
      return { ok: false, error: AI_ERROR_MESSAGES[res.error] };
    }

    const text = res.simulated ? simulatedCoaching(stats) : res.text;
    const lines = splitLines(text);
    // A model can return ok with an empty/whitespace-only body; a card with
    // no advice lines at all is a worse artifact than a clean error (the
    // slice-41 N3 lesson) — treat it as a generation failure.
    if (lines.length === 0) {
      return { ok: false, error: AI_ERROR_MESSAGES.error };
    }
    return { ok: true, lines, simulated: res.simulated };
  } catch {
    return { ok: false, error: AI_ERROR_MESSAGES.error };
  }
}
