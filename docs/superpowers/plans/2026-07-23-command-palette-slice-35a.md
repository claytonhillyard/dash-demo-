# Slice 35a — Read-Only AI Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** `/command`: NL question → whitelisted command registry (AI maps question→intent+params ONLY; keyless = deterministic rules) → org-scoped readers → inline results. No writes, no migration, no deps.

**Spec (authoritative — read cited §§ first):** `docs/superpowers/specs/2026-07-23-command-palette-slice-35a-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-35a-command-palette`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; demo RSC harness; NEVER write the literal `@vitest-environment` string in prose comments; "use server" export rules; a silent exit-1 with no output may be the flapping host sandbox — retry before believing it.

**Reference files:** `src/db/runway.ts` + `src/lib/runway/compute.ts` (33), `src/lib/investor/collect.ts` + `narrative.ts` (41 — incl. `formatRunwayVerdict`), `src/lib/sentinel/` (latest-snapshot idiom), `src/lib/customers/` + `src/db/customers.ts`, `src/db/activityEvents.ts` (getOrgActivity), `src/lib/invoices/import/actions.ts` (the name-resolution idiom), `src/lib/drafting/actions.ts` (the demo-guard-skip precedent + hand-rolled session sequence + Sentry parity), `src/lib/drafting/generate.ts` (JSON/fence parse-defense lineage), `src/components/` panels for client conventions, `Nav.tsx`, `test/middleware.test.ts`.

---

## Task 35a-1 — Registry + executors

**Files:** `src/lib/command/registry.ts` (spec §3 EXACTLY — `CommandResult`/`CommandDef` types, the 8 commands with descriptions/examples/Zod params/executors; reuse readers per the spec table; the ONE new query (unpaid_by_customer grouping) org-scoped inside and out; `customer_lookup` result excludes styleNote — comment why; `HELP_RESULT` + `HELP_EXAMPLES` export); `test/lib/command/registry.test.ts` (~16 per spec §7 row 1 — shared-db, org-999 adversarial rows everywhere, demo-mode population sweep).

Verify scoped + tsc. Commit `feat(command): read-only command registry + executors (slice 35a-1)`.

## Task 35a-2 — Router + action

**Files:** `src/lib/command/route.ts` (spec §4 — `routeByRules` pure scorer with per-command keywords + param heuristics; `routeCommand` AI path via `generateAiText` feature "command-layer" tier "fast" maxOutputTokens 200; parse defense: fence strip → first balanced `{...}` → JSON.parse try/catch → id/params validation → rules fallback on ANY failure incl. simulated); `src/lib/command/actions.ts` ("use server" — `runCommand({question})` per spec §5: demo-guard SKIPPED with the documented rationale + the drafting hand-rolled session sequence copied EXACTLY incl. its Sentry-parity catch; question never captured to Sentry — tags only; params re-validated; executor try/catch → friendly error); tests `test/lib/command/route.test.ts` (~20 per spec §7 rows 2–3 — rules table + AI-router mock table + the structural only-dynamic-content-is-the-question assertion) + `test/lib/command/actions.test.ts` (~8 per spec §7 row 4 — incl. the mocked-Sentry-to-globalThis no-question-in-capture assertion and the demo-mode deviation test).

Verify scoped + tsc. Commit `feat(command): rules + AI router and runCommand action (slice 35a-2)`.

## Task 35a-3 — Page + palette + nav

**Files:** `src/app/(admin)/command/page.tsx` (server shell, force-dynamic); `src/components/command/CommandPalette.tsx` (client — spec §6: input/submit/pending, result renderers per kind, help chips fill input, error alert, last-3 local history; house table/alert classes from existing panels); `Nav.tsx` (+ "Command" entry per its conventions); middleware matcher (+ `/command` if not already covered by a wildcard — CHECK first) + `test/middleware.test.ts` (+1); tests `test/components/command/CommandPalette.test.tsx` (~6 per spec §7 row 5 — mock `@/lib/command/actions`) + `test/app/command-page.test.tsx` (+1 demo RSC render; note the page has a client child → useRouter mock if the palette uses router — it shouldn't need router at all, keep it router-free).

Verify scoped + tsc. Commit `feat(command): /command page + palette + nav (slice 35a-3)`.

---

## Final verification (controller)

Full suite detached AFTER all commits. `npx tsc --noEmit`. `npx next build`. Review probes: the zero-data-in-prompts claim (adversarial: serialize every prompt the router can build — only static catalog + the question); demo-guard skip session-first ordering (empirical, the 37 bar); org-scoping per executor incl. the new grouping query; rules-matcher gameability (a question matching NOTHING must yield help, not a wrong command with garbage params); JSON parse defense against hostile model output (prose+JSON, nested braces in strings, 10k output); styleNote exclusion; result-link hrefs correct per entity; Sentry hygiene (question never captured); client bundle (palette imports registry? it must NOT — registry pulls the db graph; the palette gets HELP_EXAMPLES via page props and results via the action — verify structurally, the 37-F5 lesson); Nav/middleware coverage. Apply fixes → scoped re-verify (+build if client graph changed) → merge --no-ff → ROADMAP row 35 (35a shipped, 35b reopened as its own row) + HANDOFF → clean up `.worktrees/slice-37-email-drafting` + branch.

## Done condition

- 3 commits + docs; zero new deps; no migration; no writes
- Demo: `/command` answers "who owes me money?" (9302's balance), "how's my runway?", "show at-risk customers" from seed data via the rules matcher
- Full suite green; tsc clean; next build clean; ROADMAP updated (35a shipped, 35b split out)
