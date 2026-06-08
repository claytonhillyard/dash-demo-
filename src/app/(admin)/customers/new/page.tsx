import Link from "next/link";
import { CustomerForm } from "@/components/customers/CustomerForm";
import { createCustomer } from "@/lib/customers/actions";

export const dynamic = "force-dynamic";

export default function NewCustomerPage() {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          New customer
        </h1>
        <Link
          href="/customers"
          className="text-sm text-text/50 hover:text-text"
        >
          Back to customers
        </Link>
      </header>
      <CustomerForm mode="create" action={createCustomer} />
    </main>
  );
}
