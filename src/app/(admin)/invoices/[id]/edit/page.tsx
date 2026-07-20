import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getInvoiceById, type InvoiceDetail, type InvoiceStatus } from "@/db/invoices";
import { getCustomers, type CustomerAddress } from "@/db/customers";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { InvoiceStatusActions } from "@/components/invoices/InvoiceStatusActions";
import { SendInvoicePanel } from "@/components/invoices/SendInvoicePanel";
import { formatCentsExact } from "@/lib/company/format";

export const dynamic = "force-dynamic";

// Same token-style status classes as the /invoices list page — duplicated
// rather than shared/exported since each copy is tiny (3 entries) and the
// two pages otherwise have nothing in common worth a shared module.
const STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft: "text-amber-300",
  issued: "text-ok",
  void: "text-text/40",
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  void: "Void",
};

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  // Owner-only fetch: null fires notFound() for both "doesn't exist" and
  // "exists in another org" — same house pattern as the customers edit page.
  if (!Number.isInteger(id) || id <= 0) notFound();

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const invoice = await getInvoiceById(db, orgId, id);
  if (!invoice) notFound();

  const isDraft = invoice.status === "draft";

  // Only a draft edit needs the customer picker — issued/void render
  // read-only, so skip the extra query (and demo-seed fetch) for those.
  const customers = isDraft
    ? (await getCustomers(db, orgId, { limit: 200 })).map((c) => ({ id: c.id, name: c.name }))
    : [];

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          {invoice.invoiceNumber}
        </h1>
        <div className="flex items-center gap-4">
          {/* Download allowed at any status — proofreading a draft is
              legitimate, spec §8. Plain link, no client component needed:
              the route itself streams the PDF bytes. */}
          <a
            href={`/invoices/${invoice.id}/pdf`}
            className="text-sm text-text/50 hover:text-text"
          >
            Download PDF
          </a>
          <Link href="/invoices" className="text-sm text-text/50 hover:text-text">
            Back to invoices
          </Link>
        </div>
      </header>

      {isDraft ? (
        <InvoiceForm mode="edit" invoice={invoice} customers={customers} />
      ) : (
        <ReadOnlyInvoice invoice={invoice} />
      )}

      <div className="mt-4">
        <InvoiceStatusActions id={invoice.id} status={invoice.status} />
      </div>

      {/* Sending is the issued-only act (spec §6/§8) — draft/void don't
          get a send panel, only the download link above. */}
      {invoice.status === "issued" ? (
        <div className="mt-4">
          <SendInvoicePanel
            id={invoice.id}
            billToEmail={invoice.billTo.email ?? null}
            sentAt={invoice.sentAt}
            sentTo={invoice.sentTo}
          />
        </div>
      ) : null}
    </main>
  );
}

/**
 * issued/void rendering (spec §7): the same information InvoiceForm shows —
 * bill-to snapshot, line items, totals footer, notes — minus the inputs.
 * issued invoices are immutable via updateInvoice (draft-only, see
 * src/lib/invoices/actions.ts), so there's nothing here to edit; void
 * additionally gets a terminal note. Deliberately a plain server-rendered
 * section, not a client component — there's no interactivity in a read-only
 * view.
 */
function ReadOnlyInvoice({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <div className="surface-card flex flex-col gap-4 rounded-xl p-4 text-sm">
      <section>
        <h2 className="mb-1 text-[10px] uppercase tracking-widest text-text/40">
          Bill to
        </h2>
        <p className="text-text">{invoice.billTo.name}</p>
        {invoice.billTo.businessName ? (
          <p className="text-text/70">{invoice.billTo.businessName}</p>
        ) : null}
        {invoice.billTo.email ? (
          <p className="text-text/60">{invoice.billTo.email}</p>
        ) : null}
        <AddressLines address={invoice.billTo.address} />
      </section>

      <div className="grid grid-cols-2 gap-3 text-xs text-text/70 sm:grid-cols-4">
        <div>
          <div className="uppercase tracking-widest text-text/40">Status</div>
          <div className={STATUS_CLASS[invoice.status]}>
            {STATUS_LABEL[invoice.status]}
          </div>
        </div>
        <div>
          <div className="uppercase tracking-widest text-text/40">Issue date</div>
          <div>{invoice.issueDate ?? "—"}</div>
        </div>
        <div>
          <div className="uppercase tracking-widest text-text/40">Due date</div>
          <div>{invoice.dueDate ?? "—"}</div>
        </div>
        <div>
          <div className="uppercase tracking-widest text-text/40">Currency</div>
          <div>{invoice.currency}</div>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-widest text-text/40">
          Line items
        </h2>
        <table role="table" className="w-full text-sm">
          <thead>
            <tr
              role="row"
              className="text-left text-[10px] uppercase tracking-wider text-text/40"
            >
              <th role="columnheader" className="py-1">
                Description
              </th>
              <th role="columnheader" className="text-right">
                Qty
              </th>
              <th role="columnheader" className="text-right">
                Unit price
              </th>
              <th role="columnheader" className="text-right">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-text/10">
            {invoice.items.map((item) => (
              <tr role="row" key={item.id}>
                <td role="cell" className="py-1 text-text/85">
                  {item.description}
                </td>
                <td role="cell" className="text-right text-text/70">
                  {item.quantity}
                </td>
                <td role="cell" className="text-right font-mono text-text/70">
                  {formatCentsExact(item.unitPriceCents)}
                </td>
                <td role="cell" className="text-right font-mono text-text">
                  {formatCentsExact(item.lineTotalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex flex-col items-end gap-1 self-end text-xs text-text/80">
        <div>
          Subtotal:{" "}
          <span className="font-mono">{formatCentsExact(invoice.subtotalCents)}</span>
        </div>
        <div>
          Tax: <span className="font-mono">{formatCentsExact(invoice.taxCents)}</span>
        </div>
        <div className="text-sm font-semibold text-text">
          Total:{" "}
          <span className="font-mono">{formatCentsExact(invoice.totalCents)}</span>
        </div>
      </div>

      {invoice.notes ? (
        <section>
          <h2 className="mb-1 text-[10px] uppercase tracking-widest text-text/40">
            Notes
          </h2>
          <p className="whitespace-pre-wrap text-text/80">{invoice.notes}</p>
        </section>
      ) : null}

      {invoice.status === "void" ? (
        <p className="text-sm text-bad">This invoice is void.</p>
      ) : null}
    </div>
  );
}

/** Bill-to address, one line per present field — city/state/zip folded onto
 *  a single line, street1/street2/country each their own. Mirrors the
 *  CustomerAddress shape (src/db/customers.ts) reused inside `bill_to`. */
function AddressLines({ address }: { address?: CustomerAddress }) {
  if (!address) return null;
  const cityStateZip = [address.city, [address.state, address.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const lines = [address.street1, address.street2, cityStateZip, address.country].filter(
    (l): l is string => !!l && l.trim() !== "",
  );
  if (lines.length === 0) return null;
  return (
    <div className="text-text/60">
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );
}
