# Slice 30 — WinJewel Invoice History Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** WinJewel invoice-history CSV → real invoices (+ one summary item) + payments, idempotent on `invoices_org_number_unique`, via a second preset on the slice-26 machinery.

**Spec (authoritative — read cited §§ first):** `docs/superpowers/specs/2026-07-20-winjewel-invoice-import-slice-30-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-30-invoice-import`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; demo RSC harness; zod v4 idioms; `Buffer.byteLength` for size caps; the slice-26 import file shapes are the templates.

**Reference files:** `src/lib/csv/parse.ts`, `src/lib/customers/import/winjewelPreset.ts` + `actions.ts` + their tests (THE templates — mirror their structure/naming/skip-union shapes), `src/app/(admin)/customers/import/page.tsx` (+ any client wizard component it uses), `src/db/schema.ts` (invoices/invoice_items/payments), `src/lib/demo/seed.ts`, `test/middleware.test.ts`.

---

## Task 30-1 — Preset module + fixture

**Files:** `src/lib/invoices/import/winjewelInvoicePreset.ts` (spec §3 EXACTLY: field/alias table incl. the ref-or-name either-or requirement; `ImportInvoice`/`InvoiceImportRowResult`; `matchInvoiceHeaders`; `mapInvoiceRow`; pure helpers `parseMoneyToCents` + `normalizeDate` + status mapping — export the helpers for direct unit tests); `test/fixtures/winjewel-invoices.csv` (spec §6 — ~10 rows covering every class); `test/lib/invoices/import/winjewelInvoicePreset.test.ts` (~22 per spec §7: alias variants, either-or header failure, money table, date table incl. 2/30 calendar rejection, status table, per-reason skips, full-fixture sweep asserting exact ok/skip splits).

Verify scoped + tsc. Commit `feat(invoices): WinJewel invoice-history preset + fixture (slice 30-1)`.

## Task 30-2 — Preview/commit actions

**Files:** `src/lib/invoices/import/actions.ts` (mirror `src/lib/customers/import/actions.ts` byte-for-byte in structure — `__setTestDb`, demo guard FIRST, requireSession, Zod `{ csvText }` with the 5MB `Buffer.byteLength` refine, preview/commit result types named like slice-26's): `previewInvoiceImport` (spec §4.1 — batch customer load, ref-then-name resolution with ambiguity skip, batch existing-number duplicate marking, counts + first-5 samples per class) and `commitInvoiceImport` (spec §4.2 — ONE transaction; per row: invoice insert `.onConflictDoNothing().returning()` with empty→duplicate-and-skip-row semantics, summary item insert, conditional payment insert; after commit ONE `imported` audit event with `{created, payments, duplicates, skipped}` payload; revalidate `/invoices`). `test/lib/invoices/import/actions.test.ts` (~18 per spec §7 — shared-db; seed org-1 customers matching the fixture refs/names; THE critical case: run commit twice → second reports all duplicates and inserts ZERO invoices/items/payments; cross-org customer invisibility; billTo snapshot equality; audit payload; demo/auth guards; multibyte byte-cap).

Verify scoped + tsc. Commit `feat(invoices): invoice-history preview/commit import actions (slice 30-2)`.

## Task 30-3 — Wizard page + list link

**Files:** `src/app/(admin)/invoices/import/page.tsx` (+ client wizard component colocated the same way customers/import does it — check whether the customers wizard is inline in page.tsx or a separate component file and mirror EXACTLY, incl. the `readFile` prop jsdom seam); invoices list header gains an "Import history" link next to "New invoice"; tests: `test/app/invoice-import-page.test.tsx` (~7: demo-harness render; upload→preview happy path with mocked actions incl. counts+samples rendering; commit gating disabled-until-preview; commit result panel; error path renders friendly message; readFile seam used) + extend `test/app/invoices-pages.test.tsx` (+1 list-header link) + extend `test/middleware.test.ts` (+1 `/invoices/import` matched).

Verify scoped + tsc. Commit `feat(invoices): import wizard page + list link (slice 30-3)`.

---

## Final verification (controller)

Full suite detached AFTER all commits (no mid-run edits). `npx tsc --noEmit`. `npx next build` (mandatory — new page + "use server" file). Review probes: idempotency-under-rerun (zero new payments), transaction atomicity on a mid-file failure, org-scoping of the customer resolution + duplicate check, billTo snapshot correctness, money/date parser edges (locale traps, `1,234` without decimals, `.5`), status mapping surprises, audit payload PII (names ok, no emails), wizard action-mock fidelity, byte-cap multibyte, direct-insert bypass staying org-scoped, fixture realism. Apply fixes → scoped re-verify (+build if client graph changed) → merge --no-ff → ROADMAP row 30 `shipped:` + HANDOFF row → clean up `.worktrees/slice-29-payments` + branch.

## Done condition

- 3 commits + docs; ZERO new deps; no migration (rides 0020/0022)
- Idempotent: committing the same file twice changes nothing the second time
- Full suite green; tsc clean; next build clean; ROADMAP row 30 shipped
