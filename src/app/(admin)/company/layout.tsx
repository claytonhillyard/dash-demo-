import type { ReactNode } from "react";
import Link from "next/link";

const TABS = [
  { href: "/company/clients", label: "Clients" },
  { href: "/company/revenue", label: "Revenue" },
  { href: "/company/profit", label: "Profit" },
  { href: "/company/employees", label: "Employees" },
  { href: "/company/projections", label: "Projections" },
];

export default function CompanyAdminLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-gold text-xl tracking-widest">Company Data</h1>
        <Link href="/" className="text-text/50 text-sm hover:text-text">
          Back to dashboard
        </Link>
      </header>
      <nav className="mb-4 flex gap-3 text-sm">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="text-text/60 hover:text-gold">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
