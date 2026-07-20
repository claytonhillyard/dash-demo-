import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";
import type { CustomerAddress } from "@/db/customers";
import { getPaymentsByInvoiceId, type PaymentRow } from "@/db/payments";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

export type InvoiceStatus = "draft" | "issued" | "void";

/**
 * Snapshot of the customer row frozen onto the invoice at save time (spec
 * §3.1 `bill_to` jsonb). Refreshed on every draft save; frozen at issue.
 * `address`, when present, is the same shape as `CustomerAddress`
 * (src/db/customers.ts) — reused rather than duplicated.
 */
export type BillTo = {
  name: string;
  businessName?: string;
  email?: string;
  address?: CustomerAddress;
};

/** The `/invoices` list row shape — `billToName` comes from the bill_to
 *  snapshot, never a customers join (display never joins customers).
 *  `paidCents` (slice 29) comes from a LEFT JOIN grouped SUM over payments —
 *  balance is derivable by the caller as `totalCents - paidCents`. */
export type InvoiceListRow = {
  id: number;
  invoiceNumber: string;
  status: InvoiceStatus;
  billToName: string;
  totalCents: number;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  createdAt: Date;
  sentAt: Date | null;
  sentTo: string | null;
  paidCents: number;
};

export type InvoiceItemRow = {
  id: number;
  position: number;
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

/** Full invoice + its ordered line items — the edit page / InvoiceForm's
 *  "edit" mode shape. `payments` (slice 29) is ordered receivedDate DESC,
 *  id DESC; `paidCents` is summed in JS from those rows (no second
 *  aggregate query) and `balanceCents = totalCents - paidCents` — both
 *  derived, never stored. */
export type InvoiceDetail = {
  id: number;
  customerId: number;
  invoiceNumber: string;
  status: InvoiceStatus;
  billTo: BillTo;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  sentTo: string | null;
  items: InvoiceItemRow[];
  payments: PaymentRow[];
  paidCents: number;
  balanceCents: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The `/invoices` list — org-scoped, optionally filtered by status, most
 * recent first (spec §5). Demo mode short-circuits to DEMO_INVOICES,
 * filtered by org (+status) in-memory — same convention as getCustomers.
 */
export async function getInvoices(
  db: Db,
  viewerOrgId: number,
  opts: { status?: InvoiceStatus; limit?: number } = {},
): Promise<InvoiceListRow[]> {
  if (isDemoMode()) {
    const { getSeedInvoicesForOrg } = await import("@/lib/demo/seed");
    return getSeedInvoicesForOrg(viewerOrgId, opts);
  }

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const status = opts.status ?? null;

  // paidCents via a LEFT JOIN onto a grouped subquery (spec §6) — one query,
  // no N+1. The subquery is org-scoped INSIDE itself (not just relying on
  // the outer `i.org_id` filter): payments carry their own org_id column,
  // and a payment row whose org_id disagrees with its invoice's real owner
  // must never inflate this viewer's sum — see the cross-org test in
  // test/db/invoices.test.ts. SUM(amount_cents) is a bigint aggregate;
  // pglite/pg return it as a string over the raw execute() path, hence the
  // Number() below (same convention as src/db/activityEvents.ts).
  const res = await db.execute(sql`
    SELECT i.id, i.invoice_number, i.status, i.bill_to, i.total_cents, i.currency,
           i.issue_date, i.due_date, i.created_at, i.sent_at, i.sent_to,
           COALESCE(p.paid_cents, 0) AS paid_cents
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount_cents) AS paid_cents
      FROM payments
      WHERE org_id = ${viewerOrgId}
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    WHERE i.org_id = ${viewerOrgId}
      AND (${status}::text IS NULL OR i.status = ${status}::text)
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ${limit}
  `);

  const rows = rowsOf<{
    id: number;
    invoice_number: string;
    status: InvoiceStatus;
    bill_to: BillTo;
    total_cents: number;
    currency: string;
    issue_date: string | null;
    due_date: string | null;
    created_at: Date | string;
    sent_at: Date | string | null;
    sent_to: string | null;
    paid_cents: string | number;
  }>(res);

  return rows.map((r) => ({
    id: Number(r.id),
    invoiceNumber: r.invoice_number,
    status: r.status,
    billToName: r.bill_to?.name ?? "",
    totalCents: Number(r.total_cents),
    currency: r.currency,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    sentAt: r.sent_at == null ? null : r.sent_at instanceof Date ? r.sent_at : new Date(r.sent_at),
    sentTo: r.sent_to,
    paidCents: Number(r.paid_cents),
  }));
}

/**
 * One invoice + its ordered line items, or null when the row doesn't exist
 * OR exists in a different org — caller has no way to distinguish the two
 * cases (house pattern, mirrors getCustomerById). Demo mode short-circuits
 * to DEMO_INVOICES/DEMO_INVOICE_ITEMS.
 */
export async function getInvoiceById(
  db: Db,
  viewerOrgId: number,
  id: number,
): Promise<InvoiceDetail | null> {
  if (isDemoMode()) {
    const { getSeedInvoiceById } = await import("@/lib/demo/seed");
    return getSeedInvoiceById(viewerOrgId, id);
  }

  const res = await db.execute(sql`
    SELECT id, customer_id, invoice_number, status, bill_to, issue_date, due_date,
           currency, subtotal_cents, tax_rate_bps, tax_cents, total_cents, notes,
           created_at, updated_at, sent_at, sent_to
    FROM invoices
    WHERE id = ${id} AND org_id = ${viewerOrgId}
    LIMIT 1
  `);

  const [r] = rowsOf<{
    id: number;
    customer_id: number;
    invoice_number: string;
    status: InvoiceStatus;
    bill_to: BillTo;
    issue_date: string | null;
    due_date: string | null;
    currency: string;
    subtotal_cents: number;
    tax_rate_bps: number;
    tax_cents: number;
    total_cents: number;
    notes: string | null;
    created_at: Date | string;
    updated_at: Date | string;
    sent_at: Date | string | null;
    sent_to: string | null;
  }>(res);
  if (!r) return null;

  const itemsRes = await db.execute(sql`
    SELECT id, position, description, quantity, unit_price_cents, line_total_cents
    FROM invoice_items
    WHERE invoice_id = ${r.id}
    ORDER BY position ASC
  `);
  const items = rowsOf<{
    id: number;
    position: number;
    description: string;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
  }>(itemsRes).map((it) => ({
    id: Number(it.id),
    position: Number(it.position),
    description: it.description,
    quantity: Number(it.quantity),
    unitPriceCents: Number(it.unit_price_cents),
    lineTotalCents: Number(it.line_total_cents),
  }));

  // One extra org-scoped query for the payment rows (already ordered
  // receivedDate DESC, id DESC by getPaymentsByInvoiceId). paidCents is
  // summed in JS from those rows — no second aggregate query (spec §6).
  const payments = await getPaymentsByInvoiceId(db, viewerOrgId, Number(r.id));
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  const totalCents = Number(r.total_cents);

  return {
    id: Number(r.id),
    customerId: Number(r.customer_id),
    invoiceNumber: r.invoice_number,
    status: r.status,
    billTo: r.bill_to,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    currency: r.currency,
    subtotalCents: Number(r.subtotal_cents),
    taxRateBps: Number(r.tax_rate_bps),
    taxCents: Number(r.tax_cents),
    totalCents,
    notes: r.notes,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
    sentAt: r.sent_at == null ? null : r.sent_at instanceof Date ? r.sent_at : new Date(r.sent_at),
    sentTo: r.sent_to,
    items,
    payments,
    paidCents,
    balanceCents: totalCents - paidCents,
  };
}
