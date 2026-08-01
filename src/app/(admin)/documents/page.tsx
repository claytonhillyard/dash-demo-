import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getDocuments, type DocumentType } from "@/db/documents";
import { relativeTime } from "@/lib/format/bids";
import { DocumentUploadForm } from "@/components/documents/DocumentUploadForm";
import { DocumentDeleteButton } from "@/components/documents/DocumentDeleteButton";

export const dynamic = "force-dynamic";

const DOC_TYPE_LABEL: Record<DocumentType, string> = {
  contract: "Contract",
  nda: "NDA",
  agreement: "Agreement",
  receipt: "Receipt",
  other: "Other",
};

/** KB/MB formatting for the vault list. No existing shared byte-size helper
 *  anywhere in src/lib (grepped the "/1024" division idiom before adding
 *  this) — stays a small local function rather than a new shared util for a
 *  single caller. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function DocTypeBadge({ docType }: { docType: DocumentType }) {
  return (
    <span className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80">
      {DOC_TYPE_LABEL[docType]}
    </span>
  );
}

/**
 * /documents — org-scoped document vault (slice 31-3, spec §9). RSC: fetches
 * the list server-side via getDocuments (which demo-branches to
 * DEMO_DOCUMENTS internally, src/db/documents.ts) and renders the table
 * directly; only the upload form and each row's delete control are client
 * components (DocumentUploadForm / DocumentDeleteButton), mirroring how the
 * invoices edit page embeds SendInvoicePanel/PaymentsPanel/
 * InvoiceStatusActions inside an otherwise server-rendered tree. Download is
 * a plain <a> straight to the streaming route
 * (src/app/(admin)/documents/[id]/file/route.ts) — no client component
 * needed, same as the invoice edit page's "Download PDF" header link (whose
 * exact className this reuses, per spec).
 *
 * No customer-link column: DocumentRow carries customerId, but v1 keeps this
 * list org-level only (spec §9/§11 decision — no customer picker either) —
 * a customer-scoped documents view is a later slice.
 */
export default async function DocumentsPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const docs = await getDocuments(db, orgId);

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl tracking-widest text-gold">Documents</h1>
          <p className="mt-1 text-sm text-text/50">
            Upload and manage contracts, NDAs, and other org documents.
          </p>
        </div>
        <Link href="/" className="text-sm text-text/50 hover:text-text">
          Back to dashboard
        </Link>
      </header>

      <div className="mb-4">
        <DocumentUploadForm />
      </div>

      {docs.length === 0 ? (
        <div className="surface-card rounded-xl p-8 text-center text-sm text-text/60">
          <p>No documents yet.</p>
        </div>
      ) : (
        <div className="surface-card overflow-x-auto rounded-xl p-3">
          <table role="table" className="w-full text-sm">
            <thead>
              <tr role="row" className="text-left text-[10px] uppercase tracking-wider text-text/40">
                <th role="columnheader" className="py-2">
                  Title
                </th>
                <th role="columnheader">Type</th>
                <th role="columnheader">Size</th>
                <th role="columnheader">Uploaded</th>
                <th role="columnheader" className="text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-text/10">
              {docs.map((doc) => (
                <tr role="row" key={doc.id} data-testid={`document-row-${doc.id}`}>
                  <td role="cell" className="py-2 text-text">
                    {doc.title}
                  </td>
                  <td role="cell">
                    <DocTypeBadge docType={doc.docType} />
                  </td>
                  <td role="cell" className="text-text/60">
                    {humanSize(doc.sizeBytes)}
                  </td>
                  <td role="cell" className="text-text/50">
                    {relativeTime(doc.createdAt)}
                  </td>
                  <td role="cell" className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <a
                        href={`/documents/${doc.id}/file`}
                        className="text-sm text-text/50 hover:text-text"
                      >
                        Download
                      </a>
                      <DocumentDeleteButton id={doc.id} title={doc.title} />
                    </div>
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
