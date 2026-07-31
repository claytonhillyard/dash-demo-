import { generateAiText } from "@/lib/ai/generateAiText";
import { COMMANDS, type CommandId } from "./registry";

/**
 * Rules matcher + AI router (slice 35a-2, spec §4). Two independent ways to
 * turn a free-text question into `{command, params}` from the fixed
 * registry catalog:
 *
 *  - `routeByRules` — pure, deterministic, keyless. Powers the palette fully
 *    offline/in demo, and is the AI router's fallback on ANY failure.
 *  - `routeCommand` — the live path: one `generateAiText` call (feature
 *    "command-layer"), defensively parsed. NEVER throws, and NEVER falls
 *    through to an error — worst case it returns exactly what
 *    `routeByRules` would have (including that function's own `help`
 *    fallback), so the palette can never "error out" on routing.
 *
 * Neither path ever puts org data in a prompt: the AI system message is a
 * STATIC catalog (ids/descriptions/param hints, computed once from the
 * registry, independent of any question); the only per-call dynamic text is
 * the user's own question, echoed verbatim as the prompt (same class of
 * content as the free-text `instruction` slice 37's drafting prompt already
 * sends — see src/lib/drafting/generate.ts's buildDraftPrompt).
 */

export type RoutedCommand = { id: CommandId; params: unknown } | { id: "help" };

// ---------------------------------------------------------------------------
// Normalization — shared by both the rules matcher and the query/param
// heuristics below.
// ---------------------------------------------------------------------------

/** Lowercase; every non alnum char becomes a space (not dropped — dropping
 *  would glue adjacent words together, e.g. "who's" -> "whos" rather than
 *  "who s"); split on whitespace. Digits are kept (the day/minDays
 *  heuristics below need them as their own tokens). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Generic function/filler words, stripped only when building
 *  `customer_lookup`'s `query` param and the cross-command "residual token"
 *  signal below — NEVER used to filter the rules-matcher's own scoring
 *  tokens (a shared word like "who" or "is" is still real scoring signal
 *  there, just outweighed by the stronger keyword/example signals). Includes
 *  generic time-unit nouns ("day"/"week"/"month"...) so a param-ish phrase
 *  like "what happened in the last 3 days" doesn't leave "days" behind as a
 *  false proper-noun residual for `customer_lookup`. */
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "i", "me", "my", "mine", "you", "your", "he", "she", "it", "we", "they", "them",
  "this", "that", "these", "those",
  "what", "who", "when", "where", "why", "how",
  "do", "does", "did", "doing",
  "with", "about", "for", "of", "to", "in", "on", "at", "by", "from", "up", "down", "off", "out",
  "show", "tell", "give", "look", "lookup", "find", "get", "see",
  "last", "next", "over", "more", "than", "only",
  "day", "days", "week", "weeks", "month", "months", "year", "years",
  "s", "t",
]);

// ---------------------------------------------------------------------------
// Rules matcher (spec §4) — bag-of-words overlap against each command's
// (a) `examples` (from the registry, spec §3) and (b) a small hand-authored
// keyword list, below.
//
// A keyword entry is either ONE word ("cash") or a hyphen-joined PHRASE
// ("who-owes" = the two words "who" "owes", matched only when they appear
// CONSECUTIVELY in the question) — phrases are a stronger, more specific
// signal than a lone word, so they're weighted higher. This split is what
// lets the two "owes"-shaped commands disambiguate: overdue_invoices'
// keyword list is lateness-only (overdue/late/past-due), and NEVER contains
// "owe"-family words, even though "who owes me money" is verbatim
// overdue_invoices.examples[0] (registry.ts, 35a-1) — see the routing
// correction below.
// ---------------------------------------------------------------------------

/**
 * ROUTING CORRECTION (controller decision, slice 35a-2 — overrides spec §3's
 * table phrasing): "who owes me money" / "money owed" / "outstanding
 * balances" route to `unpaid_by_customer`, not `overdue_invoices` — owing
 * money isn't the same fact as a payment being LATE, and unpaid_by_customer
 * is demo-populated (seed invoice 9302) while overdue_invoices' seed
 * invoice isn't past its due date yet (see test/lib/command/registry.test.ts's
 * demo-mode sweep). `overdue_invoices` only wins on an EXPLICIT lateness
 * word: overdue/late/past due. Realized entirely through the keyword lists
 * below (overdue_invoices' list is lateness-only; unpaid_by_customer's
 * carries the owe/balance family) rather than by editing the registry's
 * already-landed `examples` arrays.
 */
const KEYWORDS: Record<CommandId, string[]> = {
  runway: ["runway", "cash", "burn", "money-left"],
  receivables_summary: ["outstanding", "receivables", "owed-total"],
  unpaid_by_customer: ["who-owes", "owes", "owe", "owed", "balances", "balance", "by-customer"],
  overdue_invoices: ["overdue", "late", "past-due"],
  at_risk_customers: ["risk", "at-risk", "cooling", "churn", "watch"],
  customer_lookup: ["about", "story", "lookup", "who-is"],
  recent_activity: ["happened", "activity", "recent", "lately", "week"],
  revenue_trend: ["revenue", "sales", "trend"],
};

const WORD_WEIGHT = 2; // one keyword word present anywhere in the question
const PHRASE_WEIGHT = 3; // a hyphenated keyword's words present CONSECUTIVELY
const EXAMPLE_WEIGHT = 1; // one question token also appears in that command's examples
const PROPER_NOUN_BONUS = 3; // customer_lookup only — see residualTokens below
const SCORE_FLOOR = 1; // a command must score STRICTLY more than this to win

/** "who-owes" -> ["who","owes"]; "cash" -> ["cash"]. */
function keywordParts(keyword: string): string[] {
  return keyword.split("-");
}

function hasConsecutive(tokens: string[], phrase: string[]): boolean {
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    if (phrase.every((word, j) => tokens[i + j] === word)) return true;
  }
  return false;
}

/** Each command's `examples` (registry.ts), tokenized and unioned once at
 *  module load — the example-overlap half of the score. */
const EXAMPLE_TOKENS: Record<CommandId, Set<string>> = Object.fromEntries(
  (Object.keys(COMMANDS) as CommandId[]).map((id) => [
    id,
    new Set(COMMANDS[id].examples.flatMap((ex: string) => tokenize(ex))),
  ]),
) as Record<CommandId, Set<string>>;

/** Union of every command's keyword words (phrases flattened) and example
 *  tokens — "recognized vocabulary" for the cross-command residual check
 *  below. Computed once. */
const ALL_VOCAB: Set<string> = new Set([
  ...Object.values(KEYWORDS).flatMap((list) => list.flatMap(keywordParts)),
  ...Object.values(EXAMPLE_TOKENS).flatMap((set) => [...set]),
]);

function scoreCommand(tokens: string[], id: CommandId): number {
  let score = 0;
  for (const kw of KEYWORDS[id]) {
    const parts = keywordParts(kw);
    if (parts.length > 1) {
      if (hasConsecutive(tokens, parts)) score += PHRASE_WEIGHT;
    } else if (tokens.includes(parts[0]!)) {
      score += WORD_WEIGHT;
    }
  }
  const examples = EXAMPLE_TOKENS[id];
  for (const t of tokens) {
    if (examples.has(t)) score += EXAMPLE_WEIGHT;
  }
  return score;
}

/** Question tokens that are neither a stopword, a number, nor part of ANY
 *  command's recognized vocabulary — i.e. words the matcher doesn't
 *  understand at all. A non-empty residual is exactly the "there's a name
 *  in here I don't recognize" signal (spec §4: customer_lookup "+ presence
 *  of a proper-noun-ish leftover token") — real customer/business names
 *  ("Tanaka", "Mehta Diamonds") are never in the vocabulary above, so they
 *  always show up here. */
function residualTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t) && !ALL_VOCAB.has(t) && !/^\d+$/.test(t));
}

// ---------------------------------------------------------------------------
// Param heuristics (spec §4).
// ---------------------------------------------------------------------------

function firstInt(text: string): number | null {
  const m = text.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** `customer_lookup`'s query: the question with stopwords AND this
 *  command's own keyword words removed, trimmed to the residual noun
 *  ("what's the story with Tanaka" -> "tanaka"). Layered fallback so the
 *  result is never empty (the executor's Zod requires 1+ char): residual ->
 *  stopwords-only-stripped -> every token -> the raw question. */
function extractLookupQuery(rawQuestion: string, tokens: string[]): string {
  const kw = new Set(KEYWORDS.customer_lookup.flatMap(keywordParts));
  const withoutStopwords = tokens.filter((t) => !STOPWORDS.has(t));
  const residual = withoutStopwords.filter((t) => !kw.has(t));
  const chosen = residual.length > 0 ? residual : withoutStopwords.length > 0 ? withoutStopwords : tokens;
  const joined = chosen.join(" ").trim();
  return (joined.length > 0 ? joined : rawQuestion.trim()).slice(0, 100);
}

// ---------------------------------------------------------------------------
// routeByRules — pure, deterministic (spec §4).
// ---------------------------------------------------------------------------

export function routeByRules(question: string): RoutedCommand {
  const tokens = tokenize(question);
  if (tokens.length === 0) return { id: "help" };

  const ids = Object.keys(COMMANDS) as CommandId[];
  const scores = ids.map((id) => {
    const base = scoreCommand(tokens, id);
    // The proper-noun bonus only ever AMPLIFIES an existing signal — it
    // requires customer_lookup to already have SOME keyword/example overlap
    // (base > 0) before an unrecognized leftover token adds to it. Without
    // that guard, any pure-gibberish question (zero signal for every
    // command) would still hand customer_lookup a bonus-only win merely for
    // being the one command whose signature is "I don't recognize this
    // word" — exactly the false positive the gibberish-to-help test below
    // caught.
    const bonus = id === "customer_lookup" && base > 0 && residualTokens(tokens).length > 0 ? PROPER_NOUN_BONUS : 0;
    return { id, score: base + bonus };
  });

  const top = scores.reduce((best, s) => (s.score > best.score ? s : best));
  const winners = scores.filter((s) => s.score === top.score);
  if (top.score <= SCORE_FLOOR || winners.length > 1) {
    return { id: "help" };
  }

  const id = top.id;
  switch (id) {
    case "customer_lookup":
      return { id, params: { query: extractLookupQuery(question, tokens) } };
    case "recent_activity": {
      const n = firstInt(question);
      return { id, params: n === null ? {} : { days: Math.min(90, Math.max(1, n)) } };
    }
    case "overdue_invoices": {
      const n = firstInt(question);
      return { id, params: n === null ? {} : { minDays: Math.min(3650, Math.max(0, n)) } };
    }
    default:
      return { id, params: {} };
  }
}

// ---------------------------------------------------------------------------
// AI router (spec §4) — live path over the whitelisted catalog.
// ---------------------------------------------------------------------------

/** One line per command: id, its own description, and a tiny static param
 *  hint — hand-written rather than introspected from each Zod schema
 *  (simpler, and every hint stays a plain, model-readable string). Purely a
 *  function of the registry's OWN static fields (id/description), never of
 *  a question, so it (and the system message built from it) is byte-
 *  identical across every call — the "zero business data in prompts"
 *  property this whole slice exists to guarantee. */
const PARAM_HINTS: Record<CommandId, string> = {
  overdue_invoices: '{"minDays"?: number}',
  receivables_summary: "{}",
  runway: "{}",
  at_risk_customers: '{"band"?: "at_risk" | "watch"}',
  customer_lookup: '{"query": string}',
  recent_activity: '{"days"?: number}',
  revenue_trend: "{}",
  unpaid_by_customer: "{}",
};

const ROUTER_SYSTEM =
  'You map a question to ONE command from this catalog. Output ONLY JSON {"command": id, "params": {...}}. ' +
  'Unknown -> {"command": "help"}.\n\n' +
  "Catalog:\n" +
  (Object.keys(COMMANDS) as CommandId[])
    .map((id) => `- ${id}: ${COMMANDS[id].description} params: ${PARAM_HINTS[id]}`)
    .join("\n");

/**
 * Finds the first balanced `{...}` JSON object in `text`, honoring JSON
 * string literals — a `{`/`}` INSIDE a quoted string (e.g.
 * `{"query":"notes {x}"}`) never desyncs the depth count, and text before
 * the first `{` or after the matching `}` (markdown fences, "Sure, here you
 * go:" prose, a trailing "hope that helps!") is naturally ignored without a
 * separate fence-stripping pass — unlike `parseDraft`'s line-oriented
 * SUBJECT:/BODY: markers (src/lib/drafting/generate.ts), a full-text
 * balanced scan doesn't care what surrounds the object. Returns null if no
 * balanced object is found.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Defensively parses the model's raw text into a `RoutedCommand`. Returns
 *  null on ANY problem (no JSON found, malformed JSON, unknown command id,
 *  non-object params, Zod-invalid params) — the caller's response to null
 *  is always the same: fall back to `routeByRules`. The params check here
 *  uses the SAME per-command Zod schema `runCommand` (src/lib/command/
 *  actions.ts) later re-validates on its own — deliberate double coverage,
 *  not redundant: THIS check is what keeps a valid command id paired with
 *  garbage params from ever reaching the fallback as if it were clean. */
function parseRouterResponse(text: string): RoutedCommand | null {
  const jsonText = extractFirstJsonObject(text);
  if (!jsonText) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  const command = (raw as Record<string, unknown>).command;
  if (typeof command !== "string") return null;
  if (command === "help") return { id: "help" };
  // Object.hasOwn, not `in` (review): `in` walks the prototype chain, so a
  // model returning {"command":"__proto__"} (or "constructor"/"toString"/…)
  // would pass the whitelist and then throw on `COMMANDS[id].params` — this
  // keeps the guard to genuine own command ids, matching the doc contract
  // ("returns null on an unknown command id").
  if (!Object.hasOwn(COMMANDS, command)) return null;

  const id = command as CommandId;
  const paramsInput = (raw as Record<string, unknown>).params ?? {};
  const parsedParams = COMMANDS[id].params.safeParse(paramsInput);
  if (!parsedParams.success) return null;

  return { id, params: parsedParams.data };
}

/**
 * routeCommand — the live path (spec §4). NEVER throws: any seam error,
 * simulated response, or malformed/invalid model output falls straight
 * through to `routeByRules(question)`, exactly the deterministic result the
 * palette would have gotten keyless/offline. `simulated: true` is checked
 * BEFORE any attempt to parse `res.text` — the simulated seam's own canned
 * placeholder copy (src/lib/ai/simulated.ts) is never valid routing JSON
 * and must never be parsed, mirroring `generateDraftCore`'s identical
 * "simulated success discards the seam's own text" handling
 * (src/lib/drafting/generate.ts).
 */
export async function routeCommand(question: string, orgId: number): Promise<RoutedCommand> {
  try {
    const res = await generateAiText({
      feature: "command-layer",
      system: ROUTER_SYSTEM,
      prompt: question,
      tier: "fast",
      maxOutputTokens: 200,
      user: `org:${orgId}`,
    });
    if (!res.ok || res.simulated) return routeByRules(question);

    const parsed = parseRouterResponse(res.text);
    return parsed ?? routeByRules(question);
  } catch {
    return routeByRules(question);
  }
}
