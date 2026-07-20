# Slice 27 — Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** Core invoice mechanic — two tables, four lifecycle actions (create/update/issue/void), three pages, the net-new line-items editor. Financial-record correctness: bill_to snapshot frozen at issue, stored server-recomputed totals, void-not-delete.

**Spec (authoritative — read the cited §§ before coding):** `docs/superpowers/specs/2026-07-18-invoices-slice-27-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-27-invoices`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs (controller owns it); shared-db harness for DB/action tests; demo RSC harness per `test/app/customer-edit-activity.test.tsx`; zod v4 `z.email()`; long test batches get generous timeout params.

**Reference patterns:**
- `src/db/schema.ts` `watchlists`/`customerHealthSnapshots` — newest table conventions (mode:"date" comment, index naming)
- `src/lib/customers/actions.ts` + `src/lib/watchlists/actions.ts` — the `run()` scaffold; `@/lib/actionErrors` for safeErrShape/mapDbConstraintError
- `src/lib/customers/import/actions.ts` — transaction + chunk patterns
- `src/components/deals/PostDealForm.tsx` — the circles `<select>` picker pattern (clone for the customer picker)
- `src/components/deals/DealList.tsx` — token-style status classes + the pill badge
- `src/lib/company/format.ts` — where `formatCentsExact` lands
- `test/lib/customers/actions.test.ts` — truth-table conventions

---

## Task 27-1 — Schema + migration 0020 + whitelists + smoke

**Files:** modify `src/db/schema.ts` (append `invoices` + `invoiceItems` per spec §3.1/§3.2 — exact columns/nullability/defaults/index names; mode:"date" comment convention on timestamps), `src/lib/activity/types.ts` (+`"invoice"` entityType; +`"issued"`, `"voided"` verbs in the lifecycle group); generate `drizzle/0020_*.sql`; create `test/db/invoices-migration-smoke.test.ts`.

Smoke (mirror watchlists smoke, own PGlite): all columns/nullability both tables; defaults (status 'draft', currency 'USD', tax_rate_bps 0, quantity 1); FK customers **no-action blocks** (insert invoice for customer 1, then attempt raw `DELETE FROM customers WHERE id = 1` → rejects); items CASCADE (delete invoice → items gone); unique (org, invoice_number) dup rejects + same number different org OK; index names present; bill_to jsonb round-trip.

NOTE: the customers FK-block test needs a seeded customer — insert org 1 (ON CONFLICT DO NOTHING) + a customer row directly.

Verify (smoke + `test/lib/demo/seed.test.ts` whitelist canary + ActivityList dot-map still green — check whether `verbDotClass` needs `issued`/`voided` cases: `issued` → emerald group, `voided` → rose group, ADD them + extend its test) + tsc. Commit `feat(db): invoices + invoice_items tables + verbs (slice 27-1)`.

## Task 27-2 — Pure helpers + queries + demo seed + formatter

**Files:** create `src/lib/invoices/totals.ts`, `src/lib/invoices/numbering.ts`, `src/db/invoices.ts`, tests for each (`test/lib/invoices/totals.test.ts`, `test/lib/invoices/numbering.test.ts`, `test/db/invoices.test.ts`); modify `src/lib/company/format.ts` (+`formatCentsExact`, extend `test/lib/company/format.test.ts`), `src/lib/demo/seed.ts` (+`DEMO_INVOICES` ids 9301-9303 on customers 2201/2204 — one draft, one issued, one void, realistic jewelry line items; +`DEMO_INVOICE_ITEMS` ids 9401+; extend seed integrity tests).

Contracts: spec §4 (totals: integer math, `Math.round(subtotal * bps / 10000)`; numbering: `INV-<year>-` prefix scan, 4-pad, >9999 unpadded natural growth) + §5 (queries: list-row shape extracting billToName from jsonb; byId returns items ordered by position; org isolation; demo branches; status filter; limit clamp 50/200).

Tests per spec §8: totals rounding boundaries (e.g. 825 bps on $10.01 → verify half-up), numbering cases incl. year partition + 9999→10000, formatCentsExact ($1,234.56 / $0.05 / null → "—"), queries incl. cross-org null + demo branch shapes, seed integrity (statuses, whitelisted verbs n/a here, items reference the 3 invoices, totals internally consistent: stored totals === computeTotals of their items).

Verify + tsc. Commit `feat(invoices): totals + numbering + queries + demo seed (slice 27-2)`.

## Task 27-3 — Actions + lifecycle truth table

**Files:** create `src/lib/invoices/actions.ts`, `test/lib/invoices/actions.test.ts`; modify `src/lib/actionErrors.ts` (mapDbConstraintError: add the `invoices_org_number_unique` case → "That invoice number is already in use" — READ how the existing case matches constraint names and mirror), extend `test/lib/customers/actions.test.ts` (customer-with-invoices delete → friendly FK error: CHECK what deleteCustomer currently returns on FK violation — the PG error code is 23503 foreign_key_violation, NOT 23505 — mapDbConstraintError may need a 23503 branch: "Cannot delete a customer with invoices" — implement that too).

Contract: spec §6 EXACTLY. Key notes:
- `run()` scaffold copy; `__setTestDb`; revalidatePath `/invoices` (+ the edit page path via extraRevalidate).
- Transactions: `db().transaction(async (tx) => { ... })` — verify the Db type supports .transaction with pglite (the accept-bid action in inventory/actions.ts uses `d.transaction` — mirror it).
- createInvoice: verify customer org-membership FIRST (SELECT → Forbidden if absent/foreign); snapshot bill_to from that row; if no invoiceNumber supplied → `SELECT invoice_number FROM invoices WHERE org_id = $` → suggestInvoiceNumber; insert invoice + items (position = array index) in the tx; audit `created`.
- updateInvoice: load + status check (draft only, else ForbiddenError); refresh snapshot; recompute; wholesale item replace in tx (DELETE items → INSERT new); audit `updated`.
- issueInvoice: draft→issued, stamp issue_date (`toUtcDay(new Date())` — reuse from `@/lib/sentinel/capture` or inline the 3-liner, implementer's call, note it); does NOT re-read the customer. Audit `issued`.
- voidInvoice: draft|issued→void; audit `voided`.
- Zod caps per spec §6/§3.2. Items array 1..50.

Truth table per spec §8's actions list — the freeze/refresh pair is the heart: (a) create → change customer email → update draft → snapshot MOVED; (b) issue → change customer email → snapshot UNMOVED (re-fetch invoice, compare). Plus: cross-org per action; dupe number friendly; items replaced wholesale (capture old item ids, assert gone); void terminal; audit verbs per action; payload/summary PII rule (bill-to name allowed in summary per house convention, email NEVER).

Verify (new file + customers actions regression + tsc). Commit `feat(invoices): create/update/issue/void actions (slice 27-3)`.

## Task 27-4 — InvoiceForm (line-items editor)

**Files:** create `src/components/invoices/InvoiceForm.tsx`, `test/components/invoices/InvoiceForm.test.tsx`.

Spec §7's InvoiceForm paragraph is the contract. Implementation notes:
- Props: `{ mode: "create" } | { mode: "edit"; invoice: <byId shape> }` + `customers: Array<{ id: number; name: string }>` + optional injected actions for tests? NO — mock the actions module like CustomerForm tests do.
- Line rows: `useState<Array<{ key: number; description: string; quantity: string; unitPrice: string }>>` — string inputs, parsed at compute/submit; `key` from a `useRef` counter (stability under middle-removal). Unit price input is DOLLARS (e.g. "1234.56") → cents via `Math.round(parseFloat * 100)` at the boundary (matches diamonds csv precedent).
- Tax input is percent string ("8.25") → bps via `Math.round(parseFloat * 100)`.
- Live totals: import `computeTotals` (single source of math), feed parsed items, render via `formatCentsExact`.
- Submit builds the action payload (items with integer cents), calls create/update, routes to `/invoices` (create) or refreshes (edit). useTransition + role=alert conventions.
- Add-item appends; remove-item filters by key; minimum 1 row enforced in UI (remove disabled at 1).

Tests: initial render create mode (1 empty row); add/remove keyed stability (fill 3 rows, remove middle, assert values of remaining preserved); live totals update on quantity change; percent→bps + dollars→cents at submit (assert the mocked action payload); validation surface (submit with empty description → action returns error → alert); edit mode prefill from an invoice fixture.

Verify + tsc. Commit `feat(invoices): InvoiceForm with line-items editor (slice 27-4)`.

## Task 27-5 — Pages + nav

**Files:** create `src/app/(admin)/invoices/page.tsx`, `src/app/(admin)/invoices/new/page.tsx`, `src/app/(admin)/invoices/[id]/edit/page.tsx`, `test/app/invoices-pages.test.tsx`; modify `src/components/dashboard/Nav.tsx` (+"Invoices" after "Watchlists", SECTIONS + ROUTES), `src/middleware.ts` matcher (+`"/invoices/:path*"` — do NOT repeat the 22/24c/25 gap; extend `test/middleware.test.ts`), extend `test/components/dashboard/Nav.test.tsx`.

- List page: spec §7 — status chips as links (`/invoices?status=draft`, the 24c filter pattern with pickType-style validation), DealList token classes (draft `text-amber-300`, issued `text-ok`, void `text-text/40`), totals via formatCentsExact, rows link to edit. Fetches getInvoices + renders; "New invoice" header link.
- New page: fetch `getCustomers(db, orgId, { limit: 200 })` → map {id,name} → InvoiceForm create.
- Edit page: getInvoiceById (notFound on null); draft → InvoiceForm edit + Issue button (small client component calling issueInvoice, confirm via the WatchToggle-style pattern); issued → read-only block (bill_to, items table, totals) + Void button; void → read-only + "This invoice is void" note. Buttons: one small `InvoiceStatusActions` client component (issue/void per status).
- Page tests (demo harness): list renders the 3 seeds with statuses + formatted totals; status filter narrows; edit draft renders the form; edit issued renders read-only + Void; middleware matcher covers /invoices + /invoices/1/edit; nav link.

Verify (new tests + Nav + middleware + `test/components/invoices/`) + tsc. Commit `feat(invoices): /invoices pages + nav + matcher (slice 27-5)`.

---

## Final verification (controller)

Full suite detached → expect ~1438 baseline + ~55 ≈ 1495, VITEST_EXIT=0. tsc → 0. Final review probes: snapshot freeze/refresh correctness, totals rounding, transaction atomicity, FK-block friendly errors (23503 branch), lifecycle guards, matcher coverage, line-items keyed stability. Merge → docs → cleanup slice-26 worktree.

## Done condition

- 5 commits + docs; migration 0020; zero new deps
- Demo: /invoices lists 3 seeds; issued invoice renders read-only; matcher guards the routes from day one
- Full suite green; tsc clean; ROADMAP row 27 shipped
