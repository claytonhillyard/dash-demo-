import Link from "next/link";
import { ImportWizard } from "@/components/customers/import/ImportWizard";

// Same conventions as src/app/(admin)/customers/new/page.tsx: force-dynamic,
// no static optimization for an admin action page. Unlike /customers and
// /customers/new, this page needs NO db fetch and NO org id — the wizard is
// entirely self-contained (previewImport/commitImport resolve the session +
// org server-side, per call). Demo mode isn't special-cased here either: the
// actions' own run() guard returns `{ ok: false, error: "Demo mode — changes
// are disabled" }`, which the wizard already surfaces through its standard
// alert path.
export const dynamic = "force-dynamic";

export default function ImportCustomersPage() {
  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          Import customers
        </h1>
        <Link href="/customers" className="text-sm text-text/50 hover:text-text">
          Back to customers
        </Link>
      </header>
      <ImportWizard />
    </main>
  );
}
