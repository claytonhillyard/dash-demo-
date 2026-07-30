import { formatCentsExact } from "@/lib/company/format";
import { generateAiText } from "@/lib/ai/generateAiText";
import type { AiErrorCode } from "@/lib/ai/types";
import type { DraftingContext } from "./context";
import type { DraftingPrefs } from "@/db/drafting";

/**
 * Prompt, defensive parser, deterministic offline draft, and the
 * seam-calling core for AI email drafting (spec §5). The pure parts
 * (`buildDraftPrompt`, `parseDraft`, `simulatedDraft`) are unit-testable in
 * isolation; `generateDraftCore` is the thin wrapper that decides which of
 * the seam's real/simulated outcomes the caller actually sees, mirroring
 * `generateInvestorNarrative`'s handling exactly (src/lib/investor/
 * narrative.ts, slice 41).
 */

// The intents live in ./types (dependency-free, client-importable — review
// F5); re-exported here so server-side consumers and existing tests keep
// their import path.
export { DRAFT_INTENTS, type DraftIntent } from "./types";
import { DRAFT_INTENTS, type DraftIntent } from "./types";

export type ParsedDraft = { subject: string; body: string };

const DRAFT_SYSTEM =
  "You write a single plain-text email FROM this business TO the named customer. " +
  "Follow the requested tone if one is given, and honor the customer's style note verbatim if one is given. " +
  "Do not write a clickbait or sensational subject line. " +
  'Output EXACTLY this format and nothing else: a line starting with "SUBJECT:" followed by the subject, ' +
  'then a blank line, then a line "BODY:", then the email body. ' +
  "Do not invent facts beyond what is given below.";

const INTENT_DESCRIPTIONS: Record<DraftIntent, string> = {
  follow_up: "a friendly follow-up / check-in email",
  payment_reminder: "a polite reminder about an outstanding balance",
  thank_you: "a short thank-you note for their business",
};

/** "Outstanding balance: $X.XX" / "Account credit: $X.XX" / "Outstanding
 *  balance: none" — shared wording between the real prompt below and
 *  `simulatedDraft` further down, so a reader can't tell which produced a
 *  given line just from its phrasing. */
function balanceLine(cents: number): string {
  if (cents > 0) return `Outstanding balance: ${formatCentsExact(cents)}`;
  if (cents < 0) return `Account credit: ${formatCentsExact(-cents)}`;
  return "Outstanding balance: none";
}

function lastInvoiceLine(inv: DraftingContext["lastInvoice"]): string {
  if (!inv) return "Last invoice: none on file";
  const issued = inv.issueDate ? `, issued ${inv.issueDate}` : "";
  return `Last invoice: ${inv.number}, ${formatCentsExact(inv.totalCents)}, status ${inv.status}${issued}`;
}

/**
 * Pure prompt builder (spec §5). The org's voice (tone) and the
 * per-customer style note travel verbatim — the system message instructs
 * the model to honor both — alongside the grounding numbers from
 * `DraftingContext` and the optional free-text instruction. Structurally
 * PII-free: `DraftingContext` has no field an email address could occupy
 * (src/lib/drafting/context.ts), so nothing built from it here can put an
 * "@" into the prompt.
 */
export function buildDraftPrompt(
  ctx: DraftingContext,
  prefs: DraftingPrefs | null,
  intent: DraftIntent,
  instruction?: string,
): { system: string; prompt: string } {
  const lines = [
    `Customer: ${ctx.customerName}${ctx.businessName ? ` (${ctx.businessName})` : ""}`,
    `Write: ${INTENT_DESCRIPTIONS[intent]}.`,
    `Tone: ${prefs?.tone ?? "no preference set — use a warm, professional default"}`,
    `Style note for this customer: ${ctx.styleNote ?? "none"}`,
    ...(instruction ? [`Additional instruction: ${instruction}`] : []),
    "",
    balanceLine(ctx.outstandingBalanceCents),
    lastInvoiceLine(ctx.lastInvoice),
    `Last payment date: ${ctx.lastPaymentDate ?? "none on file"}`,
    `Relationship health: ${ctx.healthBand ?? "not yet scored"}`,
    ...(ctx.recentActivity.length > 0
      ? ["Recent activity:", ...ctx.recentActivity.map((s) => `- ${s}`)]
      : []),
  ];
  return { system: DRAFT_SYSTEM, prompt: lines.join("\n") };
}

/** Generic fallback subject when the model doesn't produce a `SUBJECT:`
 *  line at all — reads naturally regardless of which intent was requested,
 *  so `parseDraft` doesn't need the intent threaded through just to pick a
 *  fallback string (spec §5's literal example). */
const FALLBACK_SUBJECT = "Following up";
const MAX_SUBJECT_LEN = 200;

/**
 * Defensively parses the model's raw text into `{subject, body}` (spec §5).
 * Never throws — arbitrary/hostile model output (no markers at all, a
 * subject with no body, extra whitespace, a multi-line "subject") all
 * degrade gracefully. Returns null only when there is truly no body text to
 * send (the slice-41 N3 lesson: an ok-but-empty result must be treated as a
 * generation failure, not silently sent as a blank email) — this correctly
 * fails a "subject only, nothing else" response too, since there is no body
 * to recover.
 *
 * - The first line matching `SUBJECT:` (case-insensitive, leading
 *   whitespace tolerated — models don't always match the requested case)
 *   wins; its trailing content is trimmed and capped at 200 chars. Only
 *   that one line is consumed as the subject — anything after it (even if
 *   the model intended a wrapped multi-line subject) is left for the body
 *   pass below rather than silently dropped.
 * - No `SUBJECT:` line at all -> `FALLBACK_SUBJECT`.
 * - Whatever text remains once the subject line (if any) is removed is
 *   searched for a `BODY:` marker (again case-insensitive); everything from
 *   there on — including same-line trailing text after the colon — becomes
 *   the body.
 * - No `BODY:` marker at all -> the ENTIRE remaining text becomes the body
 *   (spec §5: "missing BODY marker -> whole remaining text as body").
 * - An empty (or whitespace-only) body after all of the above -> null.
 *
 * Uses `String.prototype.match` (non-global patterns) rather than
 * `RegExp.prototype.exec` — equivalent result shape (including `.index`),
 * just a different call site on the same one-shot match.
 *
 * Both marker regexes use `[ \t]*` rather than `\s*` for the "leading/
 * trailing whitespace" parts — `\s` also matches `\n`, which would let the
 * match silently swallow line breaks (and, for `BODY:`, the first line of
 * the actual body) into what's supposed to be a single-line marker. `^`/`$`
 * (with the `m` flag) already anchor each match to one line; `[ \t]*` keeps
 * it that way.
 */
export function parseDraft(text: string): ParsedDraft | null {
  // CRLF split (review F1: a bare "\n" split left "\r" on every line, so the
  // SUBJECT regex — whose $ has no m-flag — silently missed CRLF output and
  // every subject fell back to "Following up"). Markdown fence prefixes are
  // stripped per-line (review F2): models sometimes fence the whole response
  // despite instructions — a fence glued to a marker (```SUBJECT: …) hid the
  // subject, and bare fence lines leaked into the sendable body.
  // Two passes: a WHOLE line that is just a fence (with an optional language
  // tag, e.g. "```json") disappears; then backticks glued directly to content
  // ("```SUBJECT: …") are stripped without eating the marker word — a single
  // greedy [\w-]* would have consumed "SUBJECT" as a "language tag".
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[ \t]*```[a-z0-9-]*[ \t]*$/i, "").replace(/^[ \t]*```/, ""));
  let subject: string | null = null;
  let subjectLineIndex = -1;
  const subjectRe = /^[ \t]*SUBJECT:[ \t]*(.*)$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(subjectRe);
    if (m) {
      subject = m[1]!.trim().slice(0, MAX_SUBJECT_LEN);
      subjectLineIndex = i;
      break; // first match only
    }
  }

  const remainingLines =
    subjectLineIndex >= 0
      ? [...lines.slice(0, subjectLineIndex), ...lines.slice(subjectLineIndex + 1)]
      : lines;
  const remainingText = remainingLines.join("\n");

  const bodyRe = /^[ \t]*BODY:[ \t]*(.*)$/im;
  const bodyMatch = remainingText.match(bodyRe);
  let body: string;
  if (bodyMatch && bodyMatch.index !== undefined) {
    const markerEnd = bodyMatch.index + bodyMatch[0].length;
    body = (bodyMatch[1]! + "\n" + remainingText.slice(markerEnd)).trim();
  } else {
    body = remainingText.trim();
  }

  if (body.length === 0) return null;
  return { subject: subject ?? FALLBACK_SUBJECT, body };
}

/**
 * Deterministic offline draft (spec §5) — used verbatim whenever the AI seam
 * itself falls back to simulated mode (no key / demo / build), same "never
 * show canned placeholder copy" discipline as `simulatedNarrative`
 * (src/lib/investor/narrative.ts, slice 41). Intent-varying (each of the
 * three intents produces different wording) and grounded in the same
 * balance/last-invoice numbers the real prompt uses, with a parenthetical
 * nod to the org's saved tone and the customer's style note when either is
 * set. Deliberately signature-free — `prefs.signature` is appended once, at
 * send time, by `sendDraft` (src/lib/drafting/actions.ts, spec §9); baking
 * it in here would let a resend after an edit double it up.
 */
export function simulatedDraft(
  ctx: DraftingContext,
  intent: DraftIntent,
  prefs: DraftingPrefs | null,
): ParsedDraft {
  const firstName = ctx.customerName.split(" ")[0] || ctx.customerName;
  const toneNote = prefs?.tone ? `\n\n(Written to match your saved voice: ${prefs.tone}.)` : "";
  // The per-customer style note deliberately does NOT appear in the
  // simulated body (review F4): with RESEND live but AI keyless, one
  // unedited Send would mail the org's PRIVATE note about the customer to
  // that customer. The note still shapes the REAL prompt (buildDraftPrompt);
  // simulated drafts only get the org's own tone hint.
  const invoiceClause = ctx.lastInvoice
    ? ` Your most recent invoice, ${ctx.lastInvoice.number}, was for ${formatCentsExact(ctx.lastInvoice.totalCents)}.`
    : "";
  const balance = balanceLine(ctx.outstandingBalanceCents);

  switch (intent) {
    case "follow_up":
      return {
        subject: `Following up, ${ctx.customerName}`,
        body:
          `Hi ${firstName},\n\nI wanted to follow up and see how things are going on your end.` +
          `${invoiceClause} ${balance}\n\nLet me know if there's anything you need from us.` +
          `${toneNote}`,
      };
    case "payment_reminder":
      return {
        subject: ctx.lastInvoice
          ? `Payment reminder — invoice ${ctx.lastInvoice.number}`
          : "Payment reminder",
        body:
          `Hi ${firstName},\n\nThis is a friendly reminder about your account. ${balance}` +
          `${invoiceClause}\n\nPlease let us know if you have any questions about this.` +
          `${toneNote}`,
      };
    case "thank_you":
      return {
        subject: `Thank you, ${ctx.customerName}`,
        body:
          `Hi ${firstName},\n\nThank you for your continued business.${invoiceClause}` +
          `\n\nWe appreciate working with you.${toneNote}`,
      };
  }
}

/** Short, user-facing text for every `generateAiText` seam failure code —
 *  never the raw code, same spirit as `sendInvoice`'s `EMAIL_ERROR_MESSAGES`
 *  and `generateInvestorNarrative`'s `AI_ERROR_MESSAGES` (src/lib/invoices/
 *  actions.ts, src/lib/investor/narrative.ts). */
const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  rate_limited: "AI service is rate-limited — try again shortly",
  budget_exceeded: "AI usage budget for this month has been reached — try again later",
  unavailable: "AI service is temporarily unavailable — try again shortly",
  error: "Couldn't generate a draft — try again",
};

/**
 * Generates one email draft (spec §5) — the non-action, unit-testable core
 * that `draftEmail` (src/lib/drafting/actions.ts) calls after loading
 * context/prefs. Mirrors `generateInvestorNarrative`'s seam handling exactly
 * (src/lib/investor/narrative.ts, slice 41): simulated success discards the
 * seam's own canned text in favor of the deterministic `simulatedDraft`;
 * real success is defensively parsed, with an empty parse treated as a
 * failure rather than silently returning a blank draft; every seam error
 * code maps to a short friendly message; nothing here ever throws.
 */
export async function generateDraftCore(
  ctx: DraftingContext,
  prefs: DraftingPrefs | null,
  intent: DraftIntent,
  instruction: string | undefined,
  orgId: number,
): Promise<
  | { ok: true; subject: string; body: string; simulated: boolean }
  | { ok: false; error: string }
> {
  try {
    const { system, prompt } = buildDraftPrompt(ctx, prefs, intent, instruction);
    const res = await generateAiText({
      feature: "drafting",
      prompt,
      system,
      tier: "fast",
      user: `org:${orgId}`,
      maxOutputTokens: 700,
    });

    if (!res.ok) {
      return { ok: false, error: AI_ERROR_MESSAGES[res.error] };
    }

    if (res.simulated) {
      const draft = simulatedDraft(ctx, intent, prefs);
      return { ok: true, subject: draft.subject, body: draft.body, simulated: true };
    }

    const parsed = parseDraft(res.text);
    if (!parsed) {
      return { ok: false, error: AI_ERROR_MESSAGES.error };
    }
    return { ok: true, subject: parsed.subject, body: parsed.body, simulated: false };
  } catch {
    return { ok: false, error: AI_ERROR_MESSAGES.error };
  }
}
