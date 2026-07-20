import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

/** One payment row (spec §6) — the shape `getPaymentsByInvoiceId` returns
 *  and `InvoiceDetail.payments` embeds. No orgId/invoiceId — callers already
 *  know both (they supplied them to fetch this list). */
export type PaymentRow = {
  id: number;
  amountCents: number;
  method: string;
  receivedDate: string;
  note: string | null;
  createdAt: Date;
};

/**
 * All payments recorded against one invoice, org-scoped, most recent
 * received date first (receivedDate DESC, id DESC — spec §6). Used by
 * `getInvoiceById` (src/db/invoices.ts) to build `InvoiceDetail.payments`
 * and derive `paidCents`/`balanceCents` in JS from the returned rows — this
 * function never computes an aggregate itself.
 *
 * Demo mode short-circuits to DEMO_PAYMENTS filtered by org + invoice
 * (src/lib/demo/seed.ts), same convention as every other demo-mode reader.
 */
export async function getPaymentsByInvoiceId(
  db: Db,
  viewerOrgId: number,
  invoiceId: number,
): Promise<PaymentRow[]> {
  if (isDemoMode()) {
    const { getSeedPaymentsByInvoiceId } = await import("@/lib/demo/seed");
    return getSeedPaymentsByInvoiceId(viewerOrgId, invoiceId);
  }

  const res = await db.execute(sql`
    SELECT id, amount_cents, method, received_date, note, created_at
    FROM payments
    WHERE org_id = ${viewerOrgId} AND invoice_id = ${invoiceId}
    ORDER BY received_date DESC, id DESC
  `);

  const rows = rowsOf<{
    id: number;
    amount_cents: number;
    method: string;
    received_date: string;
    note: string | null;
    created_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    id: Number(r.id),
    amountCents: Number(r.amount_cents),
    method: r.method,
    receivedDate: r.received_date,
    note: r.note,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}
