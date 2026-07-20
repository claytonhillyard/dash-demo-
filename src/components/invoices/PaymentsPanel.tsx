"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { recordPayment, deletePayment } from "@/lib/payments/actions";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/payments/types";
import { formatCentsExact } from "@/lib/company/format";
import type { InvoiceStatus } from "@/db/invoices";
import type { PaymentRow } from "@/db/payments";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  wire: "Wire",
  other: "Other",
};

// ---------------------------------------------------------------------------
// Dollars -> cents boundary conversion, copied verbatim from InvoiceForm's
// toCentsFromDollars (src/components/invoices/InvoiceForm.tsx, spec §7's
// money-input convention): malformed input (empty/garbage) computes as 0
// rather than throwing or blocking typing — Zod is the hard backstop
// server-side at submit (src/lib/payments/actions.ts), not this form.
// ---------------------------------------------------------------------------
function toCentsFromDollars(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * PaymentsPanel — edit-page payments section (slice 29-3, spec §8.1). The
 * edit page renders this only for `issued`/`void` invoices (never `draft` —
 * nothing owed yet, src/app/(admin)/invoices/[id]/edit/page.tsx); this
 * component doesn't re-check that beyond gating its own record form.
 *
 * Mirrors SendInvoicePanel/InvoiceStatusActions' conventions: a single
 * useTransition shared by every action in the panel (record + every row's
 * delete), an inline role="alert" error via FormStatus, and
 * router.refresh() on success to pick up the server-recomputed
 * payments/paidCents/balanceCents. Plain divs/buttons throughout — no
 * `<form>` element, matching those two siblings (InvoiceForm is the one
 * place in this codebase an actual `<form>` submit belongs).
 *
 * totalCents/paidCents/balanceCents are all derived server-side
 * (src/db/invoices.ts's getInvoiceById) and passed down read-only; this
 * component never recomputes them, only formats what it's given.
 *
 * Delete uses an inline two-step "Delete" -> "Confirm"/"Cancel" state per
 * row (spec §8.1 — no window.confirm anywhere in this codebase's newer
 * components), tracked by a single `confirmDeleteId` since only one row can
 * be mid-confirm at a time.
 */
export function PaymentsPanel({
  invoiceId,
  status,
  payments,
  totalCents,
  paidCents,
  balanceCents,
}: {
  invoiceId: number;
  status: InvoiceStatus;
  payments: PaymentRow[];
  totalCents: number;
  paidCents: number;
  balanceCents: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(PAYMENT_METHODS[0]);
  // Inline UTC-today rather than importing @/lib/sentinel/capture's
  // toUtcDay: that module's import graph pulls drizzle + the whole server
  // schema into this client bundle (review F3).
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Record form: issued only (draft never reaches this component; void is
  // explicitly read-only per spec §8.1), and only while something is owed.
  const showForm = status === "issued" && balanceCents > 0;
  const paidInFull = balanceCents <= 0;

  function doRecord() {
    setError(null);
    startTransition(async () => {
      const res = await recordPayment({
        invoiceId,
        amountCents: toCentsFromDollars(amount),
        method,
        receivedDate,
        note: note.trim() || undefined,
      });
      if (res.ok) {
        setAmount("");
        setNote("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function doDelete(id: number) {
    setError(null);
    startTransition(async () => {
      const res = await deletePayment({ id });
      if (res.ok) {
        setConfirmDeleteId(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div
      data-testid="payments-panel"
      className="surface-card flex flex-col gap-3 rounded-xl p-4 text-sm"
    >
      <h2 className="text-[10px] uppercase tracking-widest text-text/40">Payments</h2>

      <p className={paidInFull ? "text-sm font-semibold text-ok" : "text-text/80"}>
        {paidInFull
          ? "Paid in full"
          : `Paid ${formatCentsExact(paidCents)} of ${formatCentsExact(totalCents)} — ${formatCentsExact(balanceCents)} remaining`}
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-[10px] uppercase tracking-widest text-text/40">History</h3>
        {payments.length === 0 ? (
          <p className="text-text/50">No payments recorded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-text/10">
            {payments.map((p) => {
              const confirming = confirmDeleteId === p.id;
              return (
                <li
                  key={p.id}
                  data-testid={`payment-row-${p.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-text">
                      {p.receivedDate} · {METHOD_LABEL[p.method as PaymentMethod] ?? p.method} ·{" "}
                      <span className="font-mono">{formatCentsExact(p.amountCents)}</span>
                    </span>
                    {p.note ? <span className="text-xs text-text/50">{p.note}</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {confirming ? (
                      <>
                        <button
                          type="button"
                          onClick={() => doDelete(p.id)}
                          disabled={pending}
                          className="rounded border border-bad/40 px-2 py-1 text-[11px] uppercase tracking-wider text-bad hover:bg-bad/10 disabled:opacity-50"
                        >
                          {pending ? "Deleting…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={pending}
                          className="text-[11px] uppercase tracking-wider text-text/50 hover:text-text disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="text-[11px] uppercase tracking-wider text-bad hover:underline"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showForm ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-[10px] uppercase tracking-widest text-text/40">Record payment</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
              Amount
              <input
                aria-label="payment amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
              />
            </label>
            <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
              Method
              <select
                aria-label="payment method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
              Received date
              <input
                aria-label="received date"
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
              />
            </label>
            <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
              Note (optional)
              <input
                aria-label="payment note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={doRecord}
              disabled={pending}
              className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
            >
              {pending ? "Recording…" : "Record payment"}
            </button>
          </div>
        </div>
      ) : null}

      <FormStatus error={error} />
    </div>
  );
}
