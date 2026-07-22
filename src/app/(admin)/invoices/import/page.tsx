import Link from "next/link";
import { ImportWizard } from "@/components/invoices/import/ImportWizard";

// Same conventions as src/app/(admin)/customers/import/page.tsx (THE
// template): force-dynamic, no static optimization for an admin action page.
// This page needs NO db fetch and NO org id — the wizard is entirely
// self-contained (previewInvoiceImport/commitInvoiceImport resolve the
// session + org server-side, per call). Demo mode isn't special-cased here
// either: the actions' own guard returns `{ ok: false, error: "Demo mode —
// changes are disabled" }`, which the wizard already surfaces through its
// standard alert path.
export const dynamic = "force-dynamic";

export default function ImportInvoicesPage() {
  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          Import invoice history
        </h1>
        <Link href="/invoices" className="text-sm text-text/50 hover:text-text">
          Back to invoices
        </Link>
      </header>
      <ImportWizard />
    </main>
  );
}
