import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getCustomerById } from "@/db/customers";
import { getEntityActivity } from "@/db/activityEvents";
import { CustomerForm } from "@/components/customers/CustomerForm";
import { ActivityList } from "@/components/activity/ActivityList";
import { updateCustomer, deleteCustomer } from "@/lib/customers/actions";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  // Owner-only fetch: null fires notFound() for both "doesn't exist" and
  // "exists in another org". By design — caller can't distinguish.
  if (!Number.isInteger(id) || id <= 0) notFound();

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const customer = await getCustomerById(db, orgId, id);
  if (!customer) notFound();
  const activity = await getEntityActivity(db, orgId, "customer", id, { limit: 20 });

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          Edit customer
        </h1>
        <Link
          href="/customers"
          className="text-sm text-text/50 hover:text-text"
        >
          Back to customers
        </Link>
      </header>
      <CustomerForm
        mode="edit"
        initial={customer}
        action={updateCustomer}
        deleteAction={deleteCustomer}
      />
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Activity</h2>
        <ActivityList compact events={activity} />
      </section>
    </main>
  );
}
