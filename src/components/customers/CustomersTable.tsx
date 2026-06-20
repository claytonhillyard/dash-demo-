import Link from "next/link";
import type { CustomerView } from "@/db/customers";
import { timeAgo } from "@/lib/company/format";

/**
 * Server component — no client state. The search box is a `GET /customers?q=...`
 * form-submit, which lets the URL drive the SQL filter via the RSC page and
 * keeps the result shareable / back-buttonable for free.
 *
 * Each row is rendered as a link to `/customers/[id]/edit` (no per-row Delete;
 * the edit page owns the delete UI per the slice 22 brief). Empty cells render
 * as the design-token em-dash glyph, matching DealList / InventoryAdmin.
 */
export function CustomersTable({
  customers,
  searchQuery,
}: {
  customers: CustomerView[];
  searchQuery?: string;
}) {
  return (
    <div aria-label="customers table" className="flex flex-col gap-3">
      <form
        method="get"
        action="/customers"
        role="search"
        className="surface-card flex items-center gap-2 rounded-xl p-3"
      >
        <input
          name="q"
          type="search"
          aria-label="Search customers"
          placeholder="Search name, business, email, phone…"
          defaultValue={searchQuery ?? ""}
          className="flex-1 bg-bg p-2 text-sm"
        />
        <button
          type="submit"
          className="rounded border border-border bg-surface-2 px-3 py-2 text-xs uppercase tracking-wider text-text/70 hover:text-gold"
        >
          Search
        </button>
        {searchQuery ? (
          <Link
            href="/customers"
            className="text-[11px] uppercase tracking-wider text-text/40 hover:text-text"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {customers.length === 0 ? (
        <div className="surface-card rounded-xl p-8 text-center text-sm text-text/60">
          <p className="mb-2">No customers yet.</p>
          <Link
            href="/customers/new"
            className="text-gold hover:underline"
          >
            Add your first customer →
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
                  Name
                </th>
                <th role="columnheader">Business</th>
                <th role="columnheader">Email</th>
                <th role="columnheader">Phone</th>
                <th role="columnheader" className="text-right">
                  Last Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-text/10">
              {customers.map((c) => (
                <tr
                  role="row"
                  key={c.id}
                  data-testid={`customer-row-${c.id}`}
                  className="cursor-pointer hover:bg-surface-2/40"
                >
                  <td role="cell" className="py-2 text-text/85">
                    <Link
                      href={`/customers/${c.id}/edit`}
                      aria-label={`Edit customer ${c.name}`}
                      className="block w-full text-text hover:text-gold"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td role="cell" className="text-text/70">
                    {c.businessName ?? <span className="text-text/30">—</span>}
                  </td>
                  <td role="cell" className="text-text/60">
                    {c.email ?? <span className="text-text/30">—</span>}
                  </td>
                  <td role="cell" className="font-mono text-text/60">
                    {c.phone ?? <span className="text-text/30">—</span>}
                  </td>
                  <td role="cell" className="text-right text-text/40">
                    {timeAgo(c.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
