# iDesign Command Center — Slice 27: Invoices (schema + create/edit, W3) — Design

**Date:** 2026-07-18
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 22/26 (customers + import — invoices reference them), slice 24 (audit), slice 25 (watch/alert plumbing — invoices become watchable for free via the entityType whitelist).
**Unlocks:** 28 (PDF + email via the Resend seam), 29 (payments + `paid`), 30 (WinJewel invoice-history import — the editable invoice_number field is its door).

---

## 1. Overview & Goals

Core invoice mechanic: two tables, four lifecycle actions, three pages, one net-new UI pattern (the line-items editor). Financial-record correctness is the design center: **bill-to is snapshotted and frozen at issue; totals are stored, server-recomputed on every write; nothing is ever deleted** (void is a tombstone).

## 2. Non-goals (named homes)

PDF + email send → 28. Payments/`paid`/balance → 29. WinJewel history import → 30 (reuses the slice-26 parser). Line-item↔inventory links, fractional quantities, multi-currency conversion, credit notes, jewelry templates (module) → later. Delete → never (void only).

## 3. Schema (migration `0020`)

### 3.1 `invoices`

```
id serial PK
org_id        int NOT NULL FK → orgs(id)            -- no-action (house tenant convention)
customer_id   int NOT NULL FK → customers(id)       -- no-action: DB blocks deleting a customer with invoices; mapDbConstraintError gives the friendly message
invoice_number text NOT NULL                        -- editable; auto-suggested INV-YYYY-NNNN
status        text NOT NULL DEFAULT 'draft'         -- 'draft' | 'issued' | 'void' ('paid' added by slice 29)
bill_to       jsonb NOT NULL                        -- { name, businessName?, email?, address? } snapshot (slice-22 CustomerAddress shape inside)
issue_date    text NULL                             -- "YYYY-MM-DD", stamped by issueInvoice
due_date      text NULL                             -- "YYYY-MM-DD", operator-set
currency      text NOT NULL DEFAULT 'USD'
subtotal_cents int NOT NULL
tax_rate_bps  int NOT NULL DEFAULT 0                -- basis points, 0..2500
tax_cents     int NOT NULL
total_cents   int NOT NULL
notes         text NULL                             -- ≤2000
created_at / updated_at timestamptz (house mode:"date" convention + comment)
UNIQUE (org_id, invoice_number)  → invoices_org_number_unique
INDEX  (org_id, status, created_at DESC) → invoices_org_status_created_idx
INDEX  (org_id, customer_id) → invoices_org_customer_idx
```

### 3.2 `invoice_items`

```
id serial PK
invoice_id       int NOT NULL FK → invoices(id) ON DELETE CASCADE  -- child-ownership convention
position         int NOT NULL                                      -- 0-based render order
description      text NOT NULL (1..500)
quantity         int NOT NULL DEFAULT 1 (1..10000)
unit_price_cents int NOT NULL (0..100_000_000)                     -- $0..$1M
line_total_cents int NOT NULL                                      -- quantity × unit_price, server-computed
INDEX (invoice_id, position) → invoice_items_invoice_position_idx
```

### 3.3 Whitelist appends (string unions, no migration)
`ACTIVITY_ENTITY_TYPES` += `"invoice"`. `ACTIVITY_VERBS` += `"issued"`, `"voided"` (lifecycle group).

## 4. Money + numbering helpers (pure)

- `src/lib/invoices/totals.ts` — `computeTotals(items, taxRateBps)` → `{ subtotalCents, taxCents, totalCents, lineTotals }`. `tax = Math.round(subtotal * bps / 10000)` (round-half-up via Math.round). All integer math.
- `src/lib/invoices/numbering.ts` — `suggestInvoiceNumber(existingNumbers: string[], year: number)` → `INV-<year>-NNNN` where NNNN = 4-padded (max matching `INV-<year>-\d+` + 1, else 1). Pure; the action supplies the org's numbers.
- `src/lib/company/format.ts` — add `formatCentsExact(cents)` → `$1,234.56` (Intl 2-fraction-digits; null/undefined → "—"). The existing whole-dollar `formatCents` is untouched (KPI panels rely on it).

## 5. Queries — `src/db/invoices.ts`

- `getInvoices(db, viewerOrgId, opts?: { status?, limit? (50/200) })` → list rows `{ id, invoiceNumber, status, billToName, totalCents, currency, issueDate, dueDate, createdAt }` (billToName extracted from the jsonb — display never joins customers).
- `getInvoiceById(db, viewerOrgId, id)` → full invoice + ordered items, or null (cross-org → null, house pattern).
- Demo branches: `DEMO_INVOICES`/`DEMO_INVOICE_ITEMS` (3 invoices on customers 2201/2204: one draft, one issued, one void; ids 9301-9303 / items 9401+).

## 6. Actions — `src/lib/invoices/actions.ts` (the `run()` scaffold)

- `createInvoice(raw)` → draft. Zod: customerId, items 1..50 (description/quantity/unitPriceCents per §3.2 caps), taxRateBps 0..2500, dueDate optional `YYYY-MM-DD`, invoiceNumber optional (absent → suggest from the org's existing numbers), notes ≤2000, currency default USD. Verifies the customer belongs to the org (SELECT; Forbidden otherwise), snapshots bill_to from the CURRENT customer row, computes + stores totals, inserts invoice + items in a transaction. Audit `created` (summary `` `Created invoice ${number} for ${billTo.name}` ``, payload counts/total only). Returns `{ ok: true, id }`.
- `updateInvoice(raw)` → **draft-only** (issued/void → ForbiddenError). Re-verifies customer org-membership if changed, REFRESHES the bill_to snapshot, recomputes totals, replaces items wholesale (delete + reinsert, same transaction). Audit `updated`.
- `issueInvoice({ id })` → draft-only. Stamps `issue_date` = today (UTC), status `issued`. Snapshot already current from the last save — issue does NOT re-read the customer (the operator reviewed what's on screen; that's what gets frozen). Audit `issued`.
- `voidInvoice({ id })` → draft or issued → `void`. Terminal. Audit `voided`.
- All writes org-scoped in the WHERE (0 rows → ForbiddenError). Unique violation on invoice_number → friendly message via `mapDbConstraintError` extension (add an `invoices_org_number_unique` case — CHECK how mapDbConstraintError matches constraints and extend it in `src/lib/actionErrors.ts`).

## 7. Surfaces

- **`/invoices`** — RSC list: number, bill-to name, status (DealList token classes: draft `text-amber-300`-equivalent token, issued `text-ok`, void `text-text/40`), total via `formatCentsExact`, issue/due dates, row links to edit. Header: "New invoice" + back link. Nav: "Invoices" after "Watchlists" (SECTIONS + ROUTES). Status filter chips (link-based, `/invoices?status=draft` — the 24c pattern).
- **`/invoices/new`** — `InvoiceForm` in create mode.
- **`/invoices/[id]/edit`** — draft: full form + Issue button. issued: read-only rendering + Void button. void: read-only + terminal note. notFound on missing/cross-org.
- **`InvoiceForm`** (client, net-new line-items pattern): customer `<select>` (circles-picker pattern, options from `getCustomers` mapped `{id, name}`); dueDate date input; taxRateBps as a percent input (UI shows "8.25%", state stores bps — convert at the boundary, document it); notes; line-item rows (client-side keyed by an incrementing counter — NOT array index — with description/quantity/unitPrice inputs, remove button, Add-item button, live line totals + subtotal/tax/total footer via the same pure `computeTotals` — import it client-side, single source of math); submit via `createInvoice`/`updateInvoice`; `useTransition` + role=alert + router conventions.

## 8. Test plan (~55)

Migration smoke (both tables, FKs incl. customers no-action block, unique, indexes). totals truth table (rounding at .5 boundaries, zero-tax, caps, empty-items rejection is Zod's job not totals'). numbering (empty → 0001, max+1, year partition, non-matching numbers ignored, 9999→10000 no pad break). Queries (org isolation, status filter, item ordering by position, demo branches). Actions truth table: create happy (+snapshot content assert), customer-from-other-org → Forbidden, custom number, dupe number → friendly error, update draft ok + snapshot REFRESH assert (change customer email between create and update → snapshot moves), update issued → Forbidden, issue stamps date + freeze assert (change customer AFTER issue → snapshot does NOT move), void from draft + issued, void terminal (update after void → Forbidden), audit events per action incl. new verbs, cross-org on every action, items wholesale-replace verified (old item ids gone). Customers regression: deleting a customer WITH invoices → friendly FK error (extend customers actions tests + the mapDbConstraintError case). formatCentsExact. InvoiceForm: add/remove rows (keyed stability — remove middle row, others keep values), live totals, percent↔bps boundary, submit payload shape, disabled states. Pages via demo harness (list renders 3 seeds w/ statuses; edit renders issued read-only).

## 9. Decisions

- bill_to snapshot refreshes on every DRAFT save, freezes at issue — the operator issues what they see.
- Issue does not re-read the customer (no surprise data swap at the moment of freezing).
- Wholesale item replacement in a transaction — ≤50 items makes diffing pointless.
- `formatCentsExact` added rather than changing `formatCents` — KPI panels intentionally show whole dollars.
- Editable invoice_number with a unique backstop — slice 30's door, single-user suggestion race accepted.
- Dates as `text` YYYY-MM-DD (not timestamptz) — invoices carry calendar dates, not instants; matches `captured_on` precedent from slice 38.
