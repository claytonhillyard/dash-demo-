# Slice 33 — Predictive Cash Runway Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** Deterministic "Cash & receivables" dashboard panel — receivables aging + runway verdict from trailing profit. Read-only; no migration; no deps.

**Spec (authoritative — read cited §§ first):** `docs/superpowers/specs/2026-07-20-cash-runway-slice-33-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-33-cash-runway`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; demo RSC harness; NEVER write the literal `@vitest-environment` string inside test-file prose comments (docblock scanner matches anywhere).

**Reference files:** `src/lib/layout/registry.tsx` (panel entry shape + getEffectiveLayout semantics), `src/components/dashboard/ActivityPanel.tsx` (presentational panel conventions), the dashboard page that assembles ctx (grep `ctx.activity` / where ActivityPanel's events come from — likely `src/app/page.tsx`), `src/db/invoices.ts` (the slice-29 balance JOIN to reuse), `src/db/schema.ts` (`profit_months` ACTUAL column names — read before coding), `src/lib/company/format.ts` (`formatCentsExact`), `src/lib/demo/seed.ts`, `test/lib/sentinel/` + `test/lib/customers/health` style tables for pure-fn tests.

---

## Task 33-1 — Pure compute module

**Files:** `src/lib/runway/compute.ts` (spec §4 EXACTLY — types verbatim; UTC string date-diff helper; boundary semantics current ≤0 / 1–30 / 31–60 / 61+; runway kinds + 6-month window + 1-decimal quantization + 99.9 cap + avg-0 → cash_positive); `test/lib/runway/compute.test.ts` (~20 per spec §8 rows 1–2 — boundary table driven, poisoned-7th-month window test, leap-day span).

Verify scoped + tsc. Commit `feat(runway): pure receivables-aging + runway compute (slice 33-1)`.

## Task 33-2 — Readers + demo seed derivation

**Files:** `src/db/runway.ts` (spec §5 — `getReceivablesRows(db, orgId)` reusing the slice-29 grouped-subquery shape with the org filter INSIDE the subquery, balance > 0, oldest-first ordering; `getTrailingProfitMonths(db, n)` against the legacy single-tenant `profit_months` (comment per spec §3 — read actual column names first); demo branches per spec §5 incl. the deterministic negative-average demo profit array derived from named constants); extend `src/lib/demo/seed.ts` ONLY if a helper export is needed for the demo branch (prefer deriving inside src/db/runway.ts from existing seed exports); `test/db/runway.test.ts` (~10 per spec §8 row 3 — shared-db; the org-999 adversarial payment fixture; year-boundary trailing order; demo branches).

Verify scoped + tsc. Commit `feat(runway): receivables + trailing-profit readers (slice 33-2)`.

## Task 33-3 — Panel + registry + dashboard wiring

**Files:** `src/components/dashboard/CashRunwayPanel.tsx` (spec §6 — presentational only, props `{aging, runway, topOldest}`; aging bar + legend, runway line per kind, top-5 oldest list, empty state, footer honesty sentence; house palette classes matched from existing panels/badges); `src/lib/layout/registry.tsx` (entry `"cash-runway"` following the activity entry's shape; read getEffectiveLayout to confirm how new ids reach persisted layouts and note it in the report); dashboard ctx assembly page (find where ctx.activity is built; add server-side fetch + compute with todayUtc, degrade-on-failure matching the established panel pattern); tests: `test/components/dashboard/CashRunwayPanel.test.tsx` (~5 per spec §8 row 4) + extend the dashboard/registry tests (+2 per spec §8 row 5 — find the existing dashboard RSC test file and registry test from 24c and extend those, don't create parallel harnesses).

Verify scoped + tsc. Commit `feat(runway): cash & receivables dashboard panel (slice 33-3)`.

---

## Final verification (controller)

Full suite detached AFTER all commits (no mid-run edits). `npx tsc --noEmit`. `npx next build`. Review probes: bucket boundary math (0/1/30/31/60/61 + leap), runway window/quantization/caps, org-scoping of the receivables JOIN (adversarial payment), legacy-table honesty (no phantom org filter), ctx assembly failure degradation (one panel's fetch failing must not 500 the dashboard), registry/persisted-layout interaction for the new id, demo determinism (no wall-clock-sensitive assertions), panel a11y/copy. Apply fixes → scoped re-verify (+build if client graph changed) → merge --no-ff → ROADMAP row 33 `shipped:` + HANDOFF row → clean up `.worktrees/slice-30-invoice-import` + branch.

## Done condition

- 3 commits + docs; no migration; zero new deps
- Demo dashboard shows the panel with 9302's receivable + a real runway figure
- Full suite green; tsc clean; next build clean; ROADMAP row 33 shipped
