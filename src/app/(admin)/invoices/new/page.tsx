import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getCustomers } from "@/db/customers";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const customers = await getCustomers(db, orgId, { limit: 200 });

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          New invoice
        </h1>
        <Link href="/invoices" className="text-sm text-text/50 hover:text-text">
          Back to invoices
        </Link>
      </header>
      <InvoiceForm
        mode="create"
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
      />
    </main>
  );
}
