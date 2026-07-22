# Slice 41 — Investor Update Auto-Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** One click → one-page investor-update PDF (KPI grid + AI narrative, deterministic simulated fallback with a visible banner). Read-only; no migration; no writes; zero new deps.

**Spec (authoritative — read cited §§ first):** `docs/superpowers/specs/2026-07-22-investor-update-slice-41-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-41-investor-update`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; demo RSC harness; NEVER write the literal `@vitest-environment` string in test-file prose comments; route files export ONLY handlers + config consts (next build enforces what tsc can't see).

**Reference files:** `src/lib/ai/types.ts` + `generateAiText.ts` (the seam), `src/lib/runway/compute.ts` + `src/db/runway.ts` (slice 33), `src/lib/invoices/pdfModel.ts` + `pdfRender.ts` (primitives to reuse — export, don't copy), `src/app/(admin)/invoices/[id]/pdf/route.ts` (route template), `src/lib/sentinel/trend.ts` (latest-snapshot-per-customer idiom), `src/db/dashboard.ts`, `src/app/(admin)/company/projections/page.tsx`, `test/middleware.test.ts`.

---

## Task 41-1 — KPI collector + AI feature whitelist

**Files:** `src/lib/ai/types.ts` (`AI_FEATURES` += `"investor-update"` with a `// slice 41` comment — grep test/lib/ai for feature-list assertions and ripple); `src/lib/investor/collect.ts` (spec §3 EXACTLY — `InvestorKpis` verbatim, aggregates only, reuse the slice-33 readers + resolveOrgLabel; new org-scoped SQL only for month invoicing/collections, customer count, latest-snapshot band mix per the sentinel idiom; legacy-tables honesty comment); `test/lib/investor/collect.test.ts` (~12 per spec §7 row 1 — shared-db; month-boundary seeds; org-999 adversarial rows; demo-mode full-population incl. the 1,194,000 receivable).

Verify scoped (+ any rippled ai test) + tsc. Commit `feat(investor): KPI collector + ai feature (slice 41-1)`.

## Task 41-2 — Narrative + report PDF

**Files:** `src/lib/invoices/pdfModel.ts` (export `toWinAnsiSafe` — no behavior change); `src/lib/investor/narrative.ts` (spec §4 — buildInvestorPrompt/simulatedNarrative pure; generateInvestorNarrative(kpis, orgId) with the simulated-substitution + error mapping); `src/lib/investor/reportPdf.ts` (spec §5 — model + painter on slice-28 conventions, banner, right-aligned KPI values, page-break helper); tests `test/lib/investor/narrative.test.ts` (~10 per spec §7 row 2 — mock `@/lib/ai/generateAiText`) + `test/lib/investor/reportPdf.test.ts` (~10 per spec §7 row 3 incl. the CJK sanitize assertion and the ≥2-page synthetic narrative).

Verify scoped (+ invoices pdfModel test still green after the export) + tsc. Commit `feat(investor): narrative seam + report PDF (slice 41-2)`.

## Task 41-3 — Route + projections card

**Files:** `src/app/(admin)/company/investor-update/pdf/route.ts` (spec §6 — mirror the invoices PDF route; 503 JSON on narrative failure; NO non-handler exports); `src/app/(admin)/company/projections/page.tsx` (the download card per spec §6 — match the page's existing card/action styling); tests `test/app/investor-update-route.test.ts` (~5 per spec §7 row 4 — demo harness + a mocked-generateAiText failure case) + projections-page card assertion (+2 — find the existing projections/company page test or create one on the established demo RSC harness) + `test/middleware.test.ts` (+1 `/company/investor-update/pdf` matched by the /company matcher).

Verify scoped + tsc. Commit `feat(investor): PDF route + projections download card (slice 41-3)`.

---

## Final verification (controller)

Full suite detached AFTER all commits. `npx tsc --noEmit`. `npx next build`. Review probes: PII discipline (prompt no-@, aggregates-only type, seam Sentry rules), simulated-substitution correctness + banner honesty, month-boundary UTC math in the collector, org-scoping of every new query, route 503-vs-PDF failure split + no-extra-exports, toWinAnsiSafe export ripple, page-break on long narratives, cost note (one gateway call per download) accuracy, matcher coverage. Apply fixes → scoped re-verify → merge --no-ff → ROADMAP row 41 `shipped:` + HANDOFF row → clean up `.worktrees/slice-33-cash-runway` + branch.

## Done condition

- 3 commits + docs; zero new deps; no migration; no writes
- Keyless demo: the projections card downloads a valid PDF with the SIMULATED NARRATIVE banner and real seed-derived KPIs
- Full suite green; tsc clean; next build clean; ROADMAP row 41 shipped
