# Slice 29 — Payments + Balance Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** Issued invoices accumulate payments; balance derived (`total − SUM`), never stored; paid-state is a derived badge, not a status. Audit rides entityType `invoice` via two new verbs.

**Spec (authoritative — read cited §§ first):** `docs/superpowers/specs/2026-07-20-payments-balance-slice-29-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-29-payments`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; demo RSC harness; zod v4 idioms; generous timeouts on DB batches; the `run()` scaffold + `@/lib/actionErrors` + file-local FriendlyError conventions (see `src/lib/invoices/actions.ts` post-slice-28).

**Reference files:** `src/lib/invoices/actions.ts` (scaffold + FriendlyError to mirror), `src/db/invoices.ts` (readers to extend), `src/db/schema.ts` (invoices/invoice_items conventions), `src/lib/demo/seed.ts` (DEMO_INVOICES 9301–9303), `test/db/invoices-migration-smoke.test.ts`, `test/app/invoices-pages.test.tsx`, `src/components/invoices/SendInvoicePanel.tsx` + its test (client conventions).

---

## Task 29-1 — Schema + migration 0022 + verbs + queries + demo seed

**Files:** `src/db/schema.ts` (+`payments` table per spec §3 EXACTLY — no updatedAt, plain no-action FKs, `payments_org_invoice_idx`); generate `drizzle/0022_*.sql` (`npx drizzle-kit generate`, inspect it's additive-only); `src/lib/activity/types.ts` (+`payment_recorded`, `payment_deleted` under a `// payments (slice 29)` group comment); `src/components/activity/ActivityList.tsx` (dot map: recorded → emerald group, deleted → the deleted/rose group; extend the dot-map test); `src/db/payments.ts` (new: `PaymentRow` type + `getPaymentsByInvoiceId(db, orgId, invoiceId)` ordered receivedDate DESC id DESC, Date coercion at the boundary, demo branch); `src/db/invoices.ts` (`InvoiceDetail` += `payments: PaymentRow[]`, `paidCents`, `balanceCents` — paid summed in JS from the fetched rows; `InvoiceListRow` += `paidCents` via LEFT JOIN grouped subquery per spec §6, `Number()` on the bigint aggregate; demo branches); `src/lib/demo/seed.ts` (`DEMO_PAYMENTS` per spec §7 — ids 9501/9502 on 9302, amounts as integer fractions of 9302's totalCents, `getSeedPaymentsByInvoiceId`); tests: extend `test/db/invoices-migration-smoke.test.ts` (+3 per spec §10), `test/db/invoices.test.ts` (~8: detail payments/paid/balance math incl. 0-payment invoice, list JOIN with 0/1/2 payments, **cross-org payment never inflates another org's sum**, demo branches), `test/lib/demo/seed.test.ts` (+2 integrity), ActivityList dot test (+1). Ripple: any InvoiceDetail/ListRow test factories gain the new fields (grep `sentAt: null` for the slice-28 factory sites and extend those objects).

Verify scoped (migration smoke + invoices db + seed + ActivityList + any factory-rippled files) + tsc. Commit `feat(payments,db): payments table + balance queries + verbs (slice 29-1)`.

## Task 29-2 — recordPayment / deletePayment actions

**Files:** `src/lib/payments/actions.ts` (new, "use server" — mirror the invoices actions file structure: local `run()` copy or import pattern EXACTLY as invoices does it, demo guard, requireSession, firstZodError, FriendlyError, mapDbConstraintError, safeErrShape+Sentry; `PAYMENT_METHODS` const + both actions per spec §5 — transactional overpay guard via `db.transaction`, `toUtcDay` future-date check, audit verbs on entityType `invoice`, revalidate `/invoices` + the edit path); tests `test/lib/payments/actions.test.ts` (new, shared-db, `// @vitest-environment node` — the spec §10 recordPayment truth table ~14 + deletePayment ~6; mirror `test/lib/invoices/actions.test.ts` fixtures: insertCustomer/createInvoice/issueInvoice helpers can be imported or re-created locally — prefer a small local copy to keep files independent; assert audit rows via activityEvents select; boundary cases exact-remaining vs remaining+1).

Verify scoped (payments actions + tsc). Commit `feat(payments): record/delete payment actions with overpay guard (slice 29-2)`.

## Task 29-3 — PaymentsPanel + edit wiring + list balance column

**Files:** `src/components/invoices/PaymentsPanel.tsx` (new client component per spec §8.1 — study SendInvoicePanel + InvoiceStatusActions for useTransition/alert/refresh conventions and InvoiceForm for the dollars→cents money input; inline two-step delete confirm, NO window.confirm); `src/app/(admin)/invoices/[id]/edit/page.tsx` (render for issued + void, after the send panel block; pass the InvoiceDetail fields); `src/app/(admin)/invoices/page.tsx` (+Balance column per spec §8.3 — draft/void "—", paid → green "Paid" chip, else remaining, partial tint); tests: `test/components/invoices/PaymentsPanel.test.tsx` (~8 per spec §10 — mock `@/lib/payments/actions` + next/navigation; use the established enabled-button waitFor helper), extend `test/app/invoices-pages.test.tsx` (+4: panel on issued with seed payments visible, panel on void, absent on draft, list Balance column shows 9302's remaining — compute expected from seed totals minus DEMO_PAYMENTS sum, never hardcode).

Verify scoped (PaymentsPanel + invoices-pages + tsc). Commit `feat(payments): payments panel + list balance column (slice 29-3)`.

---

## Final verification (controller)

Full suite detached (expect ~1630 baseline + ~55) AFTER all commits land (no mid-run edits — gotcha #8). `npx tsc --noEmit`. **`npx next build`** (mandatory gate — route-module contracts + "use server" export rules are invisible to tsc/vitest; new "use server" file this slice). Adversarial review probes: transactional overpay guard actually closes the race (and boundary math), org-scoping on the JOIN sum (cross-org leak), FriendlyError parity with invoices, audit verb/entityType wiring + dot map, demo seed integrity vs wall-clock, delete-on-void semantics, money input dollars→cents rounding, int4 edges, list-query N+1 regression. Apply fixes → scoped re-verify → merge --no-ff → ROADMAP row 29 `shipped:` + HANDOFF §1.2 row → clean up `.worktrees/slice-28-invoice-send` + its branch.

## Done condition

- 3 commits + docs; migration 0022; ZERO new deps
- Demo: 9302 shows Partial with two seed payments; recording blocked by the demo guard; list shows balances
- Full suite green; tsc clean; next build clean; ROADMAP row 29 shipped
