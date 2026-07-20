# iDesign Command Center — Slice 29: Payments + Balance Tracking (W5) — Design

**Date:** 2026-07-20
**Status:** Approved; implementation plan pending
**Builds on:** slice 27 (invoices — the thing being paid), slice 28 (sent invoices — what prompts payment), slice 24 (audit).
**Unlocks:** slice 30 (WinJewel history import needs somewhere to put historical payments), slice 33 (cash runway needs balances).

---

## 1. Overview & Goals

Issued invoices accumulate payments; the balance is **derived** (`total_cents − SUM(payments.amount_cents)`), never stored — the same philosophy as slice 28's sent-tracking: payment state is data about the invoice, not a new lifecycle status. `draft/issued/void` stays the complete status set; "Paid" is a derived badge (`balanceCents === 0` on an issued invoice), "Partial" is `0 < paid < total`.

**Goals:**
- Migration `0022`: `payments` table, additive only.
- `recordPayment` / `deletePayment` server actions on the established `run()` scaffold, org-scoped, transactional overpay guard.
- Audit: new verbs `payment_recorded` / `payment_deleted` recorded against **entityType `invoice`** (entityId = invoice id) — payment history appears in the invoice's own activity feed, and the existing entity-link registry resolves for free. No new entity type.
- Queries: `InvoiceDetail` gains `payments[]` + `paidCents` + `balanceCents`; `InvoiceListRow` gains `paidCents` (LEFT JOIN SUM, one query — no N+1).
- UI: Payments section on the invoice edit page; balance/paid state on the invoices list.
- Demo: seed payments on 9302 (partial), integrity-tested.

## 2. Non-goals (named homes)

Deposits/credits/overpayment handling → future named slice (v1 rejects overpay with a friendly error). Refunds → same home. Editing a payment → never (delete + re-record; both audited). Payment methods beyond the fixed five → later. Receipt PDFs/emails → reuses slice-28 infra later. Multi-currency → invoices are single-currency already (`currency` copied to display only).

## 3. Schema — migration `0022`

```ts
// src/db/schema.ts — house conventions: integer cents, dates-as-text for
// calendar dates, mode:"date" timestamps, <table>_<cols>_idx naming.
export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    // Plain no-action FK: payments must block nothing (invoices are
    // void-not-delete anyway) and must never cascade away — financial rows.
    orgId: integer("org_id").notNull().references(() => orgs.id),
    invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
    amountCents: integer("amount_cents").notNull(), // > 0 enforced at the Zod boundary
    method: text("method").notNull(), // cash | check | card | wire | other (Zod-enforced)
    receivedDate: text("received_date").notNull(), // YYYY-MM-DD calendar date (house dates-as-text)
    note: text("note"),
    // Timestamps use mode:"date" so drizzle returns real Date objects.
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("payments_org_invoice_idx").on(t.orgId, t.invoiceId)],
);
```

No `updatedAt` — payments are immutable (delete + re-record). Index serves the only read path (per-invoice sums and lists, always org-scoped).

## 4. Types & validation

```ts
// src/lib/payments/actions.ts
export const PAYMENT_METHODS = ["cash", "check", "card", "wire", "other"] as const;
const recordPaymentInput = z.object({
  invoiceId: z.number().int().positive(),
  amountCents: z.number().int().positive().max(2_147_483_647),
  method: z.enum(PAYMENT_METHODS),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  note: z.string().trim().max(500).optional(),
});
const deletePaymentInput = z.object({ id: z.number().int().positive() });
```

`receivedDate` additionally must not be in the future (compare against `toUtcDay(new Date())`, the existing helper) — friendly error "Payment date can't be in the future". Past dates unrestricted (slice 30 imports history).

## 5. Actions — `src/lib/payments/actions.ts` (new file, same `run()` scaffold copied from invoices — including the FriendlyError catch used since 28-3; extract nothing, mirror the sibling file's structure)

### 5.1 `recordPayment`

1. Load invoice org-scoped (missing/cross-org → ForbiddenError).
2. Status must be `issued` — draft: FriendlyError "Payments can only be recorded on issued invoices"; void: FriendlyError "This invoice is void — payments can't be recorded".
3. Future `receivedDate` → FriendlyError (above).
4. **Transactional overpay guard:** inside `db.transaction()`: `SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE invoice_id = ? AND org_id = ?` → `Number()` (bigint aggregate, house rule); if `paid + amountCents > totalCents` → FriendlyError `` `Payment exceeds the remaining balance (${formatCentsExact(remaining)} left)` ``; else INSERT. The transaction closes the check-then-insert race (pglite is single-writer; Neon is not).
5. Audit (after commit): verb `payment_recorded`, entityType `invoice`, entityId = invoice.id, summary `` `Recorded ${formatCentsExact(amountCents)} ${method} payment on ${invoice.invoiceNumber}` `` (amounts + invoice numbers only — no customer PII needed), payload `{ amountCents, method }`.
6. Return `{ ok: true }`; revalidate `/invoices` + `/invoices/${invoiceId}/edit`.

### 5.2 `deletePayment`

1. Load the payment org-scoped (join not needed — payments carry org_id); missing/cross-org → ForbiddenError.
2. Delete org-scoped by id. Allowed regardless of invoice status (cleanup of a mistaken entry must work even after a void).
3. Audit: verb `payment_deleted`, entityType `invoice`, entityId = payment.invoiceId, summary `` `Deleted ${formatCentsExact(amountCents)} payment on ${invoice.invoiceNumber}` `` (fetch the number org-scoped; if the invoice row is somehow gone, fall back to `#${invoiceId}`), payload `{ amountCents, method }`.
4. Return `{ ok: true }`; revalidate both paths.

## 6. Queries — `src/db/invoices.ts` (extend) + `src/db/payments.ts` (new)

```ts
export type PaymentRow = {
  id: number; amountCents: number; method: string;
  receivedDate: string; note: string | null; createdAt: Date;
};
// InvoiceDetail gains: payments: PaymentRow[]; paidCents: number; balanceCents: number;
// InvoiceListRow gains: paidCents: number;  (balance derivable: total - paid)
```

- `getInvoiceById`: one extra org-scoped query for the payment rows (ordered receivedDate DESC, id DESC); `paidCents` summed in JS from the rows already fetched (no second aggregate); `balanceCents = totalCents - paidCents`. `instanceof Date` coercion at the reader boundary for `createdAt`.
- `getInvoices`: LEFT JOIN a grouped subquery (`SELECT invoice_id, SUM(amount_cents) AS paid FROM payments WHERE org_id = ? GROUP BY invoice_id`) → `paidCents: Number(coalesce(paid, 0))`. One query, no N+1.
- Demo branches: both readers serve `DEMO_PAYMENTS` filtered by invoice.

## 7. Demo seed — `src/lib/demo/seed.ts`

`DEMO_PAYMENTS` ids 9501+: two payments on invoice 9302 (e.g. 9501: card, ~40% of total, `HOURS_AGO(36)`-derived received date; 9502: wire, ~20%, more recent) — 9302 shows **Partial**. 9301 (draft) and 9303 (void) get none. Amounts must be derived from 9302's seeded `totalCents` fractions (integers), NOT hardcoded to match a wall-clock-dependent value — the integrity test asserts `sum(DEMO_PAYMENTS on 9302) < totalCents` and both > 0. Add `getSeedPaymentsByInvoiceId(orgId, invoiceId)`.

## 8. UI

### 8.1 `src/components/invoices/PaymentsPanel.tsx` (client; conventions from InvoiceStatusActions/SendInvoicePanel — useTransition, alert styling, router.refresh)

Props: `{ invoiceId: number; status: InvoiceStatus; payments: PaymentRow[]; totalCents: number; paidCents: number; balanceCents: number; currency: string }`.
- **Summary line** (always when any payment or issued): `Paid ${formatCentsExact(paidCents)} of ${formatCentsExact(totalCents)} — ${formatCentsExact(balanceCents)} remaining`, or a green "Paid in full" when balance 0.
- **History list**: date, method, amount, note?, per-row Delete (confirm via the house pattern — check how other destructive buttons confirm; if none exists, a two-click "Delete?/Confirm" inline state, no window.confirm).
- **Record form** (issued only, hidden when balance 0): amount (dollars input → cents, reuse the InvoiceForm money-input convention), method select, received date (default UTC today), optional note, submit → `recordPayment`, pending/alert, ok → `router.refresh()`.
- Void invoices: history + summary render read-only (no form); the delete buttons stay (cleanup path).

### 8.2 Edit page wiring — `src/app/(admin)/invoices/[id]/edit/page.tsx`

Render `<PaymentsPanel …/>` for `issued` and `void` (skip draft entirely — nothing owed yet). Placement: after the send panel / status actions block.

### 8.3 List — `src/app/(admin)/invoices/page.tsx` (+ its row component)

New "Balance" column: draft → "—"; issued with `paid === 0` → full remaining amount; partial → remaining amount + a subtle "partial" tint; issued balance 0 → green "Paid" chip; void → "—". Derived inline from `totalCents - paidCents`, no client logic.

## 9. Activity wiring

- `ACTIVITY_VERBS` += `payment_recorded`, `payment_deleted` (new "// payments (slice 29)" group).
- `ActivityList.verbDotClass`: `payment_recorded` → the emerald/positive group; `payment_deleted` → the deleted/rose group. Extend the dot-map test.

## 10. Test plan (~55)

- **Migration smoke** (+3): table + columns + index exist; FK no-action behavior (delete attempt on referenced invoice blocked — though void-not-delete makes this theoretical, lock it).
- **Schema/queries** (~10): getInvoiceById payments ordering, paidCents/balanceCents math, Date coercion; getInvoices paidCents via JOIN (invoice with 0/1/2 payments; cross-org payments never leak into sums — seed org 999 payment on same invoice id must not count); demo branches serve DEMO_PAYMENTS.
- **recordPayment truth table** (~14): happy path inserts + audit `payment_recorded` on entityType invoice; draft and void distinct friendly messages; overpay exact-boundary (remaining exactly → ok; remaining+1 → friendly error listing remaining); a second payment summing to exactly total → ok, third rejected ("Paid in full" state); future receivedDate rejected, today accepted, past accepted; malformed date; zero/negative amount Zod; cross-org Forbidden; unauthenticated; demo-guard blocked; int4 max amount accepted when balance allows.
- **deletePayment** (~6): deletes + audit `payment_deleted`; works on a void invoice; cross-org Forbidden; missing id Forbidden; summary uses invoice number; balance recomputes after delete (re-fetch).
- **PaymentsPanel** (~8, jsdom): summary math renders; form submits correct payload (dollars→cents); paid-in-full hides form + shows badge; void hides form, keeps history; delete confirm flow calls action; error alert; router.refresh on ok.
- **RSC pages** (+4): edit page shows panel for issued (9302 with seed payments visible) and void, not draft; list page shows Balance column with 9302 partial remaining; demo harness.
- **Seed integrity** (+2): DEMO_PAYMENTS all on 9302, sum < total, ids 9501+ unique.

## 11. Decisions

- Balance derived, never stored; paid-state derived, never a status.
- Overpay rejected in-transaction; deposits/credits are a future named slice.
- Payments immutable: delete (audited) + re-record; delete survives void (cleanup path).
- Audit rides entityType `invoice` — payment history lands in the invoice's feed; two new verbs, no new entity type.
- Amounts/invoice numbers in audit summaries are fine (house PII rule concerns emails/prompts, not money).
