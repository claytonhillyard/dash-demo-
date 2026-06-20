import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getCustomers } from "@/db/customers";
import { CustomersTable } from "@/components/customers/CustomersTable";

export const dynamic = "force-dynamic";

function pickQuery(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0]?.trim() || undefined;
  const v = raw?.trim();
  return v ? v : undefined;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = pickQuery(params.q);

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const customers = await getCustomers(db, orgId, { search: q });

  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          Customers
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href="/customers/new"
            className="rounded bg-gold px-3 py-1.5 text-xs uppercase tracking-wider text-black"
          >
            New customer
          </Link>
          <Link
            href="/"
            className="text-sm text-text/50 hover:text-text"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      <CustomersTable customers={customers} searchQuery={q} />
    </main>
  );
}
