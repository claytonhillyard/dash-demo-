import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getInvoices, type InvoiceStatus } from "@/db/invoices";
import { formatCentsExact } from "@/lib/company/format";

export const dynamic = "force-dynamic";

// No shared runtime whitelist array exists for InvoiceStatus (unlike
// ACTIVITY_ENTITY_TYPES) — schema/actions only carry the string-union type.
// Scoped here rather than exported since this page is the only place that
// needs to validate a raw searchParams string against it.
const INVOICE_STATUSES = ["draft", "issued", "void"] as const;

// DealList's token-style status classes (src/components/deals/DealList.tsx),
// extended per spec §7: draft/issued/void instead of Open/Filled/Withdrawn.
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

const FILTERS: Array<{ label: string; status?: InvoiceStatus }> = [
  { label: "All" },
  { label: "Draft", status: "draft" },
  { label: "Issued", status: "issued" },
  { label: "Void", status: "void" },
];

/** Same ignore-invalid-values contract as /activity's `pickType`
 *  (src/app/(admin)/activity/page.tsx) — an unrecognized or missing value
 *  falls back to `undefined` (no filter, i.e. "All"), never a 400. */
function pickStatus(raw: string | string[] | undefined): InvoiceStatus | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (INVOICE_STATUSES as readonly string[]).includes(v ?? "")
    ? (v as InvoiceStatus)
    : undefined;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = pickStatus(params.status);

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const invoices = await getInvoices(db, orgId, { status });

  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          Invoices
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href="/invoices/new"
            className="rounded bg-gold px-3 py-1.5 text-xs uppercase tracking-wider text-black"
          >
            New invoice
          </Link>
          <Link href="/" className="text-sm text-text/50 hover:text-text">
            Back to dashboard
          </Link>
        </div>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filter by status">
        {FILTERS.map((f) => {
          const active = f.status === status;
          return (
            <Link
              key={f.label}
              href={f.status ? `/invoices?status=${f.status}` : "/invoices"}
              className={`rounded px-2 py-0.5 text-xs ${
                active
                  ? "border border-gold/30 bg-gold/10 text-gold"
                  : "border border-transparent text-text/65 hover:bg-surface-2 hover:text-gold"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {invoices.length === 0 ? (
        <div className="surface-card rounded-xl p-8 text-center text-sm text-text/60">
          <p className="mb-2">No invoices yet.</p>
          <Link href="/invoices/new" className="text-gold hover:underline">
            Create your first invoice →
          </Link>
        </div>
      ) : (
        <div className="surface-card overflow-x-auto rounded-xl p-3">
          <table role="table" className="w-full text-sm">
            <thead>
              <tr
                role="row"
                className="text-left text-[10px] uppercase tracking-wider text-text/40"
              >
                <th role="columnheader" className="py-2">
                  Number
                </th>
                <th role="columnheader">Bill to</th>
                <th role="columnheader">Status</th>
                <th role="columnheader">Issue date</th>
                <th role="columnheader">Due date</th>
                <th role="columnheader" className="text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-text/10">
              {invoices.map((inv) => (
                <tr role="row" key={inv.id} data-testid={`invoice-row-${inv.id}`}>
                  <td role="cell" className="py-2">
                    <Link
                      href={`/invoices/${inv.id}/edit`}
                      className="text-text hover:text-gold"
                    >
                      {inv.invoiceNumber}
                    </Link>
                  </td>
                  <td role="cell" className="text-text/70">
                    {inv.billToName}
                  </td>
                  <td role="cell" className={STATUS_CLASS[inv.status]}>
                    {STATUS_LABEL[inv.status]}
                  </td>
                  <td role="cell" className="text-text/50">
                    {inv.issueDate ?? "—"}
                  </td>
                  <td role="cell" className="text-text/50">
                    {inv.dueDate ?? "—"}
                  </td>
                  <td role="cell" className="text-right font-mono text-text">
                    {formatCentsExact(inv.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
