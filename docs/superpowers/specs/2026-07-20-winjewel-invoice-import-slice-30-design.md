# iDesign Command Center — Slice 30: WinJewel Invoice History Import (W6) — Design

**Date:** 2026-07-20
**Status:** Approved; implementation plan pending
**Builds on:** slice 26 (CSV parser + WinJewel customer import — the machinery and the `external_ref` link), slice 27 (invoices), slice 29 (payments).
**Vertical:** aiya-jewelry (the WinJewel-specific preset; the wizard mechanics stay generic).

---

## 1. Overview & Goals

Second consumer of the slice-26 import machinery: AIYA's WinJewel invoice-history export becomes real `invoices` (+ single summary item) and `payments` rows. Historical invoices land as `issued` (or `void`), with balances lighting up the slice-29 UI immediately. Idempotent re-runs ride the existing `invoices_org_number_unique` constraint.

**Goals:**
- `src/lib/invoices/import/winjewelInvoicePreset.ts` — pure preset: header aliases, `matchInvoiceHeaders`, `mapInvoiceRow` (money/date/status normalization, all skip-reasons typed).
- `src/lib/invoices/import/actions.ts` — `previewInvoiceImport` / `commitInvoiceImport` mirroring the slice-26 action shapes (demo-blocked, org-scoped, one audit summary event per commit).
- `/invoices/import` wizard page mirroring `/customers/import`; "Import history" link on the invoices list header.
- Fixture CSV in the real WinJewel export shape; ~50 tests.

## 2. Non-goals (named homes)

Line-item detail reconstruction (WinJewel history is flat — one summary item, spelled honestly). Editing imported invoices beyond what slice 27 allows (issued invoices stay frozen). Importing payment dates distinct from invoice dates (WinJewel's history export carries no per-payment date; documented mapping below). Draft import (history is never draft). Live WinJewel API sync → future slice.

## 3. CSV shape + preset — `winjewelInvoicePreset.ts` (pure)

### 3.1 Fields + aliases (mirror the slice-26 alias-table pattern)

| Field | Required | WinJewel header aliases (case/space-insensitive) |
|---|---|---|
| `invoiceNumber` | yes | "Invoice No", "Invoice #", "Inv No", "Invoice Number" |
| `customerRef` | no* | "Customer ID", "Cust ID", "Customer No" |
| `customerName` | no* | "Customer Name", "Name", "Customer" |
| `issueDate` | yes | "Invoice Date", "Date", "Inv Date" |
| `dueDate` | no | "Due Date", "Due" |
| `totalAmount` | yes | "Total", "Amount", "Invoice Total", "Total Amount" |
| `paidAmount` | no | "Paid", "Amount Paid", "Payments", "Paid Amount" |
| `status` | no | "Status", "Type" |

\* At least ONE of customerRef/customerName must be mapped or `matchInvoiceHeaders` fails with the missing-required error listing both.

### 3.2 `mapInvoiceRow(map, row, rowIndex): InvoiceImportRowResult`

```ts
export type ImportInvoice = {
  invoiceNumber: string;        // trimmed, 1..50
  customerRef: string | null;   // trimmed WinJewel customer id
  customerName: string | null;  // trimmed
  issueDate: string;            // normalized YYYY-MM-DD
  dueDate: string | null;
  totalCents: number;           // >= 0, <= 2_147_483_647
  paidCents: number;            // >= 0 (0 when column absent/blank)
  status: "issued" | "void";
};
export type InvoiceImportRowResult =
  | { ok: true; value: ImportInvoice }
  | { ok: false; rowIndex: number; reason: string };
```

Normalization (all pure, unit-tested):
- **Money:** `parseMoneyToCents(s)` — accepts `1234.56`, `$1,234.56`, `1234`, parenthesized negatives REJECTED (reason "negative amount"); result int cents; `> 2_147_483_647` → skip "amount too large"; `paidCents > totalCents` → skip "paid exceeds total — fix the export row" (v1 has no overpay concept, spec'd honest).
- **Dates:** `normalizeDate(s)` — accepts `YYYY-MM-DD` and `M/D/YYYY`·`MM/DD/YYYY` (WinJewel's format), emits `YYYY-MM-DD`; invalid → skip "unparseable date". Calendar validity checked (2/30 rejected via a UTC Date round-trip).
- **Status:** case-insensitive: `void|voided|cancelled|canceled|v` → "void"; blank/anything else → "issued" (history exports rarely label the normal case).
- Blank invoiceNumber / >50 chars / blank issueDate / unparseable total → typed skips.

## 4. Actions — `src/lib/invoices/import/actions.ts` (mirror slice-26's file: own `run()`-equivalent shape, `__setTestDb`, demo guard FIRST, requireSession, Zod on `{ csvText }` size-capped by BYTES via `Buffer.byteLength` (slice-26's multibyte lesson), 5MB)

### 4.1 `previewInvoiceImport({ csvText })`

Parse → match headers (fail → `{ ok:false, error }`) → map every row → **customer resolution pass** (read-only): batch-load org customers once (`id, name, externalRef`); per ok-row resolve: `externalRef === customerRef` first (exact, case-sensitive — refs are ids); else case-insensitive trimmed name match — 0 matches → skip "customer not found — import customers first"; 2+ → skip "ambiguous customer name"; also batch-load existing invoice numbers org-scoped → mark would-be duplicates as skips "duplicate invoice number" (preview-only signal; commit re-checks via the constraint). Return counts `{ importable, skipped, duplicates }` + samples (first 5 of each class, with reasons) — same `ImportSampleEntry`-style shape as slice 26.

### 4.2 `commitInvoiceImport({ csvText })`

Re-parse + re-map + re-resolve (server state may have changed since preview — slice-26 precedent). Then ONE `db.transaction`: per importable row —
1. INSERT invoice `{ orgId, customerId, invoiceNumber, status, billTo: snapshot from the matched customer's CURRENT fields (name/businessName/email/address — the historical snapshot doesn't exist; documented decision), issueDate, dueDate, currency "USD", subtotalCents: totalCents, taxRateBps 0, taxCents 0, totalCents }` with `.onConflictDoNothing({ target: [orgId+number unique] }).returning({ id })` — empty return → count as duplicate, INSERT NOTHING ELSE for the row (idempotent re-runs must not double-pay existing invoices).
2. INSERT one item `{ position 0, description "Imported from WinJewel — historical invoice", quantity 1, unitPriceCents: totalCents, lineTotalCents: totalCents }`.
3. `paidCents > 0` → INSERT payment `{ amountCents: paidCents, method "other", receivedDate: issueDate, note "Imported from WinJewel" }` (payments carry no per-payment date in the export; issueDate is the documented stand-in). Void rows import their payments too (refund history is still history; the slice-29 UI already renders void history read-only).
After the transaction: ONE audit event (slice-26 precedent): verb `imported`, entityType `org`, entityId orgId, summary `Imported ${created} invoices from WinJewel (${payments} payments, ${duplicates} duplicates, ${skipped} skipped)`, payload `{ created, payments, duplicates, skipped }`. Revalidate `/invoices`. Result `{ ok:true, created, payments, duplicates, skipped }`.

## 5. Wizard — `src/app/(admin)/invoices/import/page.tsx`

Mirror `/customers/import`'s structure (server page + client wizard component): file-pick (`readFile` prop defaulting to `(f) => f.text()` — the jsdom gotcha), preview call, count cards + sample tables with reasons, Commit button (disabled until preview ok), result panel, "Start over". Copy adapted ("invoices", "payments"). Link: an "Import history" secondary link/button in the invoices list header next to "New invoice". Middleware already guards `/invoices/:path*` (verified by the existing matcher test).

## 6. Fixture — `test/fixtures/winjewel-invoices.csv`

Realistic export: header row with WinJewel spellings ("Invoice No","Customer ID","Customer Name","Invoice Date","Due Date","Total","Paid","Status"); ~10 rows covering: clean issued fully-paid; clean issued partial; unpaid; void with payment (refund case); void unpaid; MM/DD/YYYY dates; $-and-comma money; a paid>total row (skip); an unknown-customer row (skip); a duplicate number pair (second → duplicate). Customer refs/names align with shared-db fixture customers (org 1) the tests create.

## 7. Test plan (~50)

- **Preset (~22):** alias matching (each field, case/space variants, missing-required incl. the ref/name either-or rule); money parser table ($, commas, plain, negative reject, >int4 reject, blank paid → 0); date normalizer table (ISO pass-through, M/D/YYYY, MM/DD/YYYY, 2/30 reject, garbage reject); status table; per-skip-reason rows; a full fixture-file mapRow sweep.
- **Actions (~18, shared-db):** preview counts/samples on the fixture (with seeded matching customers); external_ref match beats name; name-match case-insensitivity; ambiguous name → skip; unknown → skip; duplicate detection preview vs commit; commit creates invoice+item+payment with exact cents; paid=0 → no payment row; void row imports with payment; idempotent re-run (second commit → all duplicates, ZERO new payments — the critical assertion); billTo snapshot = current customer fields; audit event once with counts payload; demo-blocked; unauthenticated; cross-org isolation (customers of org 999 invisible to matching); csvText byte-cap (multibyte case).
- **Wizard RSC/component (~8):** page renders in demo harness; upload→preview→commit happy path with mocked actions; disabled-commit gating; sample reasons rendered; list-header link present.
- **Middleware:** existing matcher test already covers subroutes — extend with `/invoices/import` for the record (+1).

## 8. Decisions

- Bill-to snapshot = customer's CURRENT data (historical snapshot doesn't exist in the export; the invoice row is still the historical record of number/dates/amounts).
- One summary line item, honestly labeled — no fake line detail.
- Imported payments: method `other`, receivedDate = issueDate, note "Imported from WinJewel".
- paid > total rows are SKIPPED loudly, not clamped — the operator fixes the export; v1 has no overpay/credit concept (slice-29 decision).
- Duplicates never write anything (constraint-backed via onConflictDoNothing + empty returning check) — re-running a file is always safe.
- Direct inserts inside one transaction (slice-26 shape), not createInvoice/recordPayment calls — historical import must bypass the issued-only/current-date guards those actions rightly enforce.
