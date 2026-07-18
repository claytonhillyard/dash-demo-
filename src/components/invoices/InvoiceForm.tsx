"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { createInvoice, updateInvoice } from "@/lib/invoices/actions";
import { computeTotals } from "@/lib/invoices/totals";
import { formatCentsExact } from "@/lib/company/format";
import type { InvoiceDetail } from "@/db/invoices";

export type InvoiceFormProps =
  | { mode: "create"; customers: Array<{ id: number; name: string }> }
  | { mode: "edit"; invoice: InvoiceDetail; customers: Array<{ id: number; name: string }> };

type LineRow = {
  key: number;
  description: string;
  /** String inputs — parsed to numbers only at compute/submit time (spec §7). */
  quantity: string;
  unitPrice: string;
};

// ---------------------------------------------------------------------------
// Boundary conversions — human-friendly decimal strings <-> integer
// cents/bps. Malformed input (empty, garbage) computes as 0 for the live
// preview; Zod is the hard backstop server-side at submit (spec/plan 27-4),
// not this form, so these never throw or block typing.
// ---------------------------------------------------------------------------

function toCentsFromDollars(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function toBpsFromPercent(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function toQuantity(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}
/** Integer cents -> a "12.34"-style decimal string for prefilling the dollar
 *  input (inverse of toCentsFromDollars at the display boundary). */
function centsToDollarsString(cents: number): string {
  return (cents / 100).toFixed(2);
}
/** Integer bps -> a "8.25"-style percent string (inverse of toBpsFromPercent). */
function bpsToPercentString(bps: number): string {
  return (bps / 100).toString();
}

/**
 * InvoiceForm — the net-new line-items editor (slice 27-4, spec §7).
 *
 * Line rows are keyed by a monotonically-increasing counter (`nextKey`), NOT
 * array index — index keys would let React misattribute a mid-list row's
 * DOM/identity to a different logical row after a middle removal. The
 * counter is seeded once per mount (edit mode pre-seeds one key per existing
 * item) and only ever increments, so keys stay stable across add/remove.
 *
 * Unit prices are typed in DOLLARS ("1234.56"), tax as a PERCENT
 * ("8.25" -> 825 bps) — both convert to integer cents/bps only at the
 * compute/submit boundary via the helpers above, matching the diamonds CSV
 * precedent (src/components/diamonds/DiamondAdmin.tsx) for money inputs.
 *
 * `createInvoice`/`updateInvoice` are imported directly (not prop-injected)
 * — mirrors WatchToggle's action-call convention; tests mock the module.
 */
export function InvoiceForm(props: InvoiceFormProps) {
  const router = useRouter();
  const customers = props.customers;
  const invoice = props.mode === "edit" ? props.invoice : undefined;

  const nextKey = useRef(0);
  function makeRow(overrides: Partial<Omit<LineRow, "key">> = {}): LineRow {
    return { key: nextKey.current++, description: "", quantity: "1", unitPrice: "", ...overrides };
  }

  const [customerId, setCustomerId] = useState<number | null>(
    invoice ? invoice.customerId : (customers[0]?.id ?? null),
  );
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? "");
  const [taxPercent, setTaxPercent] = useState(
    invoice ? bpsToPercentString(invoice.taxRateBps) : "",
  );
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(invoice?.invoiceNumber ?? "");
  const [rows, setRows] = useState<LineRow[]>(() => {
    if (invoice && invoice.items.length > 0) {
      return invoice.items.map((item) =>
        makeRow({
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: centsToDollarsString(item.unitPriceCents),
        }),
      );
    }
    return [makeRow()];
  });

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const parsedItems = rows.map((r) => ({
    quantity: toQuantity(r.quantity),
    unitPriceCents: toCentsFromDollars(r.unitPrice),
  }));
  const totals = computeTotals(parsedItems, toBpsFromPercent(taxPercent));

  function updateRow(key: number, patch: Partial<Omit<LineRow, "key">>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, makeRow()]);
  }
  function removeRow(key: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);

    const payload: Record<string, unknown> = {
      customerId,
      items: rows.map((r) => ({
        description: r.description.trim(),
        quantity: toQuantity(r.quantity),
        unitPriceCents: toCentsFromDollars(r.unitPrice),
      })),
      taxRateBps: toBpsFromPercent(taxPercent),
      dueDate: dueDate || undefined,
      notes: notes.trim() || undefined,
      // Shared field, both modes: typed -> send trimmed; blank -> omit so
      // the server auto-suggests (create) or keeps the existing number
      // (update) — see src/lib/invoices/actions.ts.
      invoiceNumber: invoiceNumber.trim() || undefined,
    };
    if (props.mode === "edit") {
      payload.id = props.invoice.id;
    }

    startTransition(async () => {
      if (props.mode === "create") {
        const res = await createInvoice(payload);
        if (res.ok) {
          setOk(true);
          router.push("/invoices");
        } else {
          setError(res.error);
        }
      } else {
        const res = await updateInvoice(payload);
        if (res.ok) {
          setOk(true);
          router.refresh();
        } else {
          setError(res.error);
        }
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      aria-label="invoice form"
      className="surface-card flex flex-col gap-3 rounded-xl p-4 text-sm"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Customer
          <select
            aria-label="customer"
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
            value={customerId ?? ""}
            onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Invoice number
          <input
            aria-label="invoice number"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="auto (INV-YYYY-NNNN)"
            maxLength={50}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Due date
          <input
            aria-label="due date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Tax rate (%)
          <input
            aria-label="tax rate"
            type="number"
            min={0}
            max={25}
            step="0.01"
            placeholder="0"
            value={taxPercent}
            onChange={(e) => setTaxPercent(e.target.value)}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2 rounded border border-border p-3">
        <legend className="px-2 text-[10px] uppercase tracking-widest text-text/40">
          Line items
        </legend>
        <div className="hidden grid-cols-12 gap-2 text-[10px] uppercase tracking-widest text-text/40 md:grid">
          <div className="col-span-6">Description</div>
          <div className="col-span-2">Qty</div>
          <div className="col-span-2">Unit price ($)</div>
          <div className="col-span-1 text-right">Total</div>
          <div className="col-span-1" />
        </div>
        {rows.map((row, i) => (
          <div key={row.key} className="grid grid-cols-12 items-center gap-2">
            <input
              aria-label={`line ${i + 1} description`}
              value={row.description}
              onChange={(e) => updateRow(row.key, { description: e.target.value })}
              maxLength={500}
              className="col-span-6 bg-bg p-2 text-sm text-text"
            />
            <input
              aria-label={`line ${i + 1} quantity`}
              type="number"
              min={1}
              value={row.quantity}
              onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
              className="col-span-2 bg-bg p-2 text-sm text-text"
            />
            <input
              aria-label={`line ${i + 1} unit price`}
              type="number"
              min={0}
              step="0.01"
              value={row.unitPrice}
              onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
              className="col-span-2 bg-bg p-2 text-sm text-text"
            />
            <div
              data-testid={`line-total-${i}`}
              className="col-span-1 text-right font-mono text-xs text-text/80"
            >
              {formatCentsExact(totals.lineTotals[i])}
            </div>
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              disabled={rows.length <= 1}
              aria-label={`remove line ${i + 1}`}
              className="col-span-1 rounded border border-border px-2 py-2 text-[11px] uppercase tracking-wider text-bad hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="self-start rounded border border-border px-3 py-1.5 text-xs uppercase tracking-wider text-text/70 hover:text-text"
        >
          Add item
        </button>
      </fieldset>

      <div className="flex flex-col items-end gap-1 self-end text-xs text-text/80">
        <div>
          Subtotal:{" "}
          <span data-testid="invoice-subtotal" className="font-mono">
            {formatCentsExact(totals.subtotalCents)}
          </span>
        </div>
        <div>
          Tax:{" "}
          <span data-testid="invoice-tax" className="font-mono">
            {formatCentsExact(totals.taxCents)}
          </span>
        </div>
        <div className="text-sm font-semibold text-text">
          Total:{" "}
          <span data-testid="invoice-total" className="font-mono">
            {formatCentsExact(totals.totalCents)}
          </span>
        </div>
      </div>

      <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
        Notes
        <textarea
          aria-label="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={3}
          className="mt-1 bg-bg p-2 font-mono text-sm text-text normal-case tracking-normal"
        />
      </label>

      <FormStatus error={error} ok={ok} />

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={pending || customerId == null}
          className="rounded bg-gold px-3 py-2 text-sm text-black disabled:opacity-50"
        >
          {pending ? "Saving…" : props.mode === "edit" ? "Save changes" : "Create invoice"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/invoices")}
          className="rounded border border-border px-3 py-2 text-sm text-text/70 hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
