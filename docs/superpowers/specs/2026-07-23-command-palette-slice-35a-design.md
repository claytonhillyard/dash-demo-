# iDesign Command Center — Slice 35a: Read-Only AI Command Palette — Design

**Date:** 2026-07-23
**Status:** Approved; implementation plan pending
**Builds on:** slice 32 (AI seam — feature `"command-layer"` pre-whitelisted), and every reader shipped since: customers/health (22/36/38), invoices/payments/balances (27/29), runway (33), activity (24). Slice 35b (confirmed WRITE actions) stays a separate future slice.

---

## 1. Overview & Goals

A `/command` page: type a question ("who owes me money?", "how's my runway?", "show at-risk customers"), get an inline answer rendered from the org's own data. Architecture is a **whitelisted command registry**: the AI's ONLY job is mapping the question to `{command, params}` from a fixed catalog — **no business data ever enters a prompt** (stronger than the slice-36/37 name+aggregates rule: here it's structurally zero). Keyless/demo routes through a deterministic keyword matcher, so the palette works fully offline.

**Goals:**
- `src/lib/command/registry.ts` — typed catalog: 8 read-only commands, each with Zod params, an org-scoped executor, example phrasings, and a typed result.
- `src/lib/command/route.ts` — rules matcher (keyless) + AI router (live) with defensive JSON parsing; invalid/unknown → a helpful "here's what I can answer" result.
- `runCommand` action (demo-guard skipped — read-only, the slice-37 draftEmail precedent; session/org enforced).
- `/command` page + `CommandPalette` client component + nav entry.
- ~50 tests. No migration, no writes, no audit, zero new deps.

## 2. Non-goals (named homes)

Write actions with confirmation (35b). Free-form RAG/answer synthesis — the AI never sees data, so it can't hallucinate numbers; answers come from deterministic renderers (revisit post-35b). Conversation memory/follow-ups. Keyboard-shortcut global palette (polish). Per-module command packs (module registry slice).

## 3. Command registry — `src/lib/command/registry.ts`

```ts
export type CommandResult =
  | { kind: "stat"; label: string; value: string; detail?: string }
  | { kind: "table"; title: string; columns: string[]; rows: string[][]; links?: Array<string | null> } // links[i] = href for row i
  | { kind: "list"; title: string; items: Array<{ text: string; href?: string }> }
  | { kind: "help"; intro: string; examples: string[] };

export type CommandDef<P> = {
  id: CommandId;
  description: string;          // one line — shown to the AI router AND in help
  examples: string[];           // 3-5 phrasings — power the rules matcher AND help
  params: z.ZodType<P>;
  run(db: Db, orgId: number, params: P): Promise<CommandResult>;
};
```

Catalog (all executors reuse existing readers — new SQL only where noted, always org-scoped):

| id | params | answers | backing |
|---|---|---|---|
| `overdue_invoices` | `{minDays?: number}` (default 1) | "who owes me money / overdue invoices" | `getReceivablesRows` + `daysBetweenUtc` filter → table (number, customer, balance, days overdue) with `/invoices/:id/edit` links |
| `receivables_summary` | `{}` | "how much is outstanding" | `computeReceivablesAging` → stat + bucket list |
| `runway` | `{}` | "how's my runway / cash" | `getTrailingProfitMonths` + `computeRunway` → stat (verdict phrasing reuses `formatRunwayVerdict` from slice 41) |
| `at_risk_customers` | `{band?: "at_risk" \| "watch"}` (default at_risk) | "which customers are at risk / cooling" | latest-snapshot-per-customer (sentinel idiom) filtered by band → table with customer links |
| `customer_lookup` | `{query: string}` (1..100) | "what's the story with Tanaka" | slice-30 resolution idiom (name/business contains, case-insensitive) → 0: help-ish "no match"; 1: list (balance via the per-customer sum, last invoice, health band, style-note-free!); 2+: table of matches with links |
| `recent_activity` | `{days?: number}` (default 7, max 90) | "what happened this week" | `getOrgActivity` capped 15 → list (summaries + relative time) |
| `revenue_trend` | `{}` | "revenue lately / trend" | the slice-41 labeled month readers (legacy tables, honesty note) → table (month, revenue, profit) |
| `unpaid_by_customer` | `{}` | "balances by customer" | ONE new org-scoped query: outstanding grouped by customer (reuse the receivables JOIN, GROUP BY customer) → table with links |

`HELP_RESULT` (kind "help") lists every command's first example — returned by the router on no-match and by the palette's empty state.

**PII/leak rules:** results render names, numbers, invoice ids — org's own data to the org's own session; NOTHING here touches Sentry or the AI. `customer_lookup` must NOT include `styleNote` in its result (private org note — the slice-37 F4 lesson).

## 4. Router — `src/lib/command/route.ts`

```ts
export type RoutedCommand = { id: CommandId; params: unknown } | { id: "help" };
export function routeByRules(question: string): RoutedCommand;           // pure, deterministic
export async function routeCommand(question: string, orgId: number): Promise<RoutedCommand>;
```

- **Rules matcher (pure):** normalized-token scoring against each command's `examples` + a small per-command keyword list (e.g. runway: ["runway","cash","burn"]). Simple bag-of-words overlap; best score above a floor wins; params extracted with tiny per-command heuristics (`customer_lookup`: the question minus stopwords/keywords becomes `query`; `recent_activity`: first integer → days; `overdue_invoices`: first integer → minDays). Ties/below-floor → help. Deterministic, table-tested.
- **AI router (live only):** `generateAiText({feature: "command-layer", tier: "fast", maxOutputTokens: 200, user: org tag})`; system = "You map a question to ONE command from this catalog. Output ONLY JSON {\"command\": id, \"params\": {...}}. Unknown → {\"command\": \"help\"}." + the catalog (ids, descriptions, param hints — STATIC text, no data); prompt = the user's question verbatim (user-typed input — the only non-static prompt content, same class as slice-37 instructions).
- **Parse defense (the slice-37 lessons):** strip markdown fences; find the first `{...}` block (balanced-brace scan or a lazy regex + JSON.parse try/catch); unknown command id, non-object params, or Zod-invalid params → fall back to `routeByRules(question)`; seam simulated or any seam error → `routeByRules` too. The palette therefore NEVER errors on routing — worst case is the help result.

## 5. Action — extend nothing; new `src/lib/command/actions.ts` ("use server")

`runCommand({question})`:
- Zod: question trim 1..300.
- **Demo-guard skipped** (documented — read-only + keyless rules matcher works in demo; the slice-37 draftEmail precedent with its empirically-verified session-first ordering). Session required; orgId from session.
- `routeCommand` → registry lookup → Zod-parse params (router already validated; re-validate anyway — defense in depth) → `run(db, orgId, params)` inside try/catch: executor throw → Sentry (tags only, question NEVER captured — it's user free text) + `{ok:false, error:"Couldn't run that — try again"}`.
- Returns `{ok:true, result: CommandResult, command: CommandId | "help"} | {ok:false, error}`.
- No audit (reads), no revalidate.

## 6. UI — `/command` page + `src/components/command/CommandPalette.tsx`

- **Page** `src/app/(admin)/command/page.tsx`: force-dynamic server shell (title "Command", subtitle) rendering the client palette; demo harness compatible. Middleware: add `/command` to the matcher (+ test).
- **Palette (client):** input (placeholder "Ask about customers, invoices, cash…"), submit on Enter/button with useTransition pending; renders `CommandResult` by kind — stat (big value + label + detail), table (the house table classes; row links wrap the first cell), list (items with optional links), help (intro + example chips that fill the input on click); an error alert for `{ok:false}`; empty state = the help result rendered client-side from a serialized `HELP_EXAMPLES` prop (static strings — no server call needed for the empty state). Keep history of the last 3 Q→result pairs in local state (nice, cheap, no persistence).
- **Nav**: add "Command" to the sidebar (read `Nav.tsx` conventions; place near the top — it's a launcher).

## 7. Test plan (~50)

- **Registry executors (~16, shared-db):** each command against seeded data with org-999 adversarial rows (overdue filter math incl. minDays; aging summary equals slice-33 numbers; runway stat; band filter + latest-snapshot dedup; lookup 0/1/2+ paths + case-insensitivity + **styleNote absent from serialized result**; activity cap + days window; revenue months labels; unpaid grouping sums + links shape). Demo mode: every command returns a populated result (seed-derived).
- **Rules matcher (~12, pure table):** each command's example phrasings route to it; keyword variants ("who owes me", "money owed", "outstanding"); integer extraction (days/minDays); lookup query extraction ("what's the story with Tanaka" → query "Tanaka"); gibberish → help; empty-ish → help; ties resolve deterministically.
- **AI router (~8):** mock the seam — clean JSON routes; fenced JSON; JSON with prose around it; unknown id → rules fallback; invalid params → rules fallback; seam error → rules fallback; simulated → rules (no seam text used); the system prompt contains catalog ids but the QUESTION is the only dynamic content (assert the prompt built from a canned question contains no other dynamic strings — structural).
- **Action (~8, shared-db):** demo-mode works (rules-routed, seed data — the deviation test); unauthenticated; question caps; executor-throw → friendly error + Sentry WITHOUT the question in the capture (assert via the mocked-Sentry-to-globalThis pattern); happy path end-to-end for two commands; re-validation rejects a poisoned RoutedCommand (unit-call the internal with bad params if reachable, else skip — implementer judgment).
- **Palette (~6, jsdom):** submit calls action; stat/table/list/help renderings; example-chip fills input; error alert; pending disables.
- **Page/middleware (+2):** RSC render in demo harness; matcher covers `/command`.

## 8. Decisions

- The AI routes; it never answers. Numbers on screen always come from deterministic org-scoped readers — hallucination is structurally impossible in 35a.
- Keyless = rules matcher, not a canned response: the palette genuinely works offline/demo.
- Router failures degrade to help, never to an error — worst case the user sees what they CAN ask.
- The user's question goes to the gateway (live mode only) as the sole dynamic prompt content; it never goes to Sentry.
- `customer_lookup` excludes the private style note from results (37-F4 lineage).
- No audit rows for reads; 35b's writes will audit + confirm.
