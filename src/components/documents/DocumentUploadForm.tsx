"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { uploadDocument } from "@/lib/documents/actions";

// Mirrors the enum src/db/schema.ts's documents.doc_type carries, kept as a
// local literal union + label list rather than importing it from
// @/db/documents: this file must stay a client bundle with NO value import
// of server-only modules (the 37-F5/35a-3 client-bundle lesson) — only
// uploadDocument + React.
// Keep in sync with MAX_DOCUMENT_BYTES in src/lib/documents/actions.ts and
// next.config.mjs's serverActions.bodySizeLimit ("10mb") — a larger file
// rejects at the framework boundary before the action runs (review F1).
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type DocType = "contract" | "nda" | "agreement" | "receipt" | "other";
const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: "contract", label: "Contract" },
  { value: "nda", label: "NDA" },
  { value: "agreement", label: "Agreement" },
  { value: "receipt", label: "Receipt" },
  { value: "other", label: "Other" },
];

/**
 * /documents vault upload form (client component). Mirrors SendInvoicePanel/
 * PaymentsPanel's conventions (src/components/invoices/): a single
 * useTransition, an inline role="alert" error via FormStatus, and
 * router.refresh() on success. Plain div/button, no `<form>` element — the
 * house convention this tree follows everywhere except InvoiceForm
 * (confirmed against PaymentsPanel's explicit comment to that effect and the
 * customers/invoices ImportWizards, which use a bare file input with no
 * wrapping <form> either).
 *
 * Unlike the CSV import wizards (src/components/customers/import/
 * ImportWizard.tsx, src/components/invoices/import/ImportWizard.tsx), this
 * form never reads the File's contents client-side — it hands the raw File
 * straight to FormData — so the jsdom File.prototype.text() gap those
 * wizards work around with an injectable `readFile` prop doesn't apply here;
 * no such seam is needed.
 *
 * No customer picker in v1 (spec §9/§11 decision — customerId stays
 * schema/action-ready but unsurfaced in this form); the FormData built here
 * carries exactly `file`, `title`, `docType`, matching uploadDocument's
 * contract (src/lib/documents/actions.ts).
 */
export function DocumentUploadForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<DocType>("contract");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  function handleSubmit() {
    setError(null);
    setSuccess(false);

    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    // Client-side size pre-check: a file over the 10MB server-action body
    // limit rejects at the framework boundary BEFORE uploadDocument runs, and
    // that rejection would otherwise be swallowed by the transition — a silent
    // failure (review F1). Catch it here with a friendly message, and keep the
    // try/catch below as a backstop for any other thrown rejection.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File is too large — 10MB max");
      return;
    }

    const fd = new FormData();
    fd.set("file", file);
    fd.set("title", title);
    fd.set("docType", docType);

    startTransition(async () => {
      try {
        const res = await uploadDocument(fd);
        if (res.ok) {
          setTitle("");
          setDocType("contract");
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          setSuccess(true);
          router.refresh();
        } else {
          setError(res.error);
        }
      } catch {
        // A thrown rejection (e.g. the framework body-size limit) never reaches
        // the {ok,error} contract — surface something rather than silently
        // re-enabling the button.
        setError("Upload failed — the file may be too large. 10MB max.");
      }
    });
  }

  return (
    <div className="surface-card flex flex-col gap-3 rounded-xl p-4 text-sm">
      <h2 className="text-[10px] uppercase tracking-widest text-text/40">Upload document</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Title
          <input
            aria-label="document title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={pending}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Type
          <select
            aria-label="document type"
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocType)}
            disabled={pending}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          >
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          File
          <input
            ref={fileInputRef}
            aria-label="document file"
            type="file"
            accept=".pdf,image/*"
            disabled={pending}
            onChange={handleFileChange}
            className="mt-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
        >
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>
      {success ? <p className="text-ok text-sm">Document uploaded.</p> : null}
      <FormStatus error={error} />
    </div>
  );
}
