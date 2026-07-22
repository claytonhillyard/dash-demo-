"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormStatus } from "@/components/company/FormStatus";
import { previewInvoiceImport, commitInvoiceImport } from "@/lib/invoices/import/actions";
import type {
  InvoiceImportPreview,
  InvoiceImportCommitResult,
  InvoiceImportSampleEntry,
} from "@/lib/invoices/import/actions";

// Client-side mirror of the server's MAX_CSV_BYTES (src/lib/invoices/
// import/actions.ts) — same spec §5 precedent as src/components/customers/
// import/ImportWizard.tsx: reject oversize files before ever reading them or
// calling previewInvoiceImport.
const MAX_CSV_BYTES = 5 * 1024 * 1024;

type PreviewOk = Extract<InvoiceImportPreview, { ok: true }>;
type CommitOk = Extract<InvoiceImportCommitResult, { ok: true }>;

/**
 * WinJewel invoice-history CSV import wizard (client component). Spec §5
 * (docs/superpowers/specs/2026-07-20-winjewel-invoice-import-slice-30-design.md).
 *
 * Mirrors src/components/customers/import/ImportWizard.tsx (slice 26, THE
 * template) structure and state machine exactly: stateless-server /
 * stateful-client split (both previewInvoiceImport and commitInvoiceImport
 * re-parse csvText from scratch on every call, so THIS component is the only
 * place the parsed text lives between the preview and commit steps —
 * `csvText` is captured in state the moment a preview succeeds and handed
 * back verbatim to commitInvoiceImport, unchanged).
 *
 * Conceptual state machine (idle -> previewing -> previewed -> committing ->
 * done | error), implemented as plain derived state, same convention as the
 * template:
 *   - idle:       preview === null && result === null
 *   - previewing: preview === null && result === null && pending === true
 *   - previewed:  preview !== null && result === null
 *   - committing: preview !== null && result === null && pending === true
 *   - done:       result !== null (terminal — renders the summary banner)
 *   - error:      `error` layers on top of whichever state above is current.
 *                 A failed preview leaves you at idle (file input still
 *                 shown — pick another file); a failed commit leaves you at
 *                 previewed (retry the SAME parsed file without
 *                 re-uploading).
 *
 * Departs from the template in one rendering way: previewInvoiceImport
 * returns THREE independent sample arrays (sampleImportable/
 * sampleDuplicates/sampleSkipped — this import has three outcome classes,
 * not the template's plain valid/invalid split), so the preview panel renders
 * one small table per non-empty class instead of the template's single
 * merged table.
 *
 * `readFile` is injectable for the same jsdom reason as the template: jsdom
 * 25 (this repo's vitest environment) does not implement
 * `File.prototype.text()` — see test/app/invoice-import-page.test.tsx.
 * Production never passes the prop and gets the real `file.text()`.
 */
export function ImportWizard({
  readFile = (file: File) => file.text(),
}: {
  readFile?: (file: File) => Promise<string>;
}) {
  const router = useRouter();
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewOk | null>(null);
  const [result, setResult] = useState<CommitOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resetToIdle() {
    setCsvText(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear the input's value so re-selecting the SAME file after an error
    // still fires a change event (matches the template's convention).
    if (e.target) e.target.value = "";
    if (!file) return;

    setError(null);
    setResult(null);
    setPreview(null);
    setCsvText(null);

    if (file.size > MAX_CSV_BYTES) {
      setError("File is too large — the CSV import limit is 5 MB.");
      return;
    }

    startTransition(async () => {
      const text = await readFile(file);
      const res = await previewInvoiceImport({ csvText: text });
      if (res.ok) {
        setCsvText(text);
        setPreview(res);
      } else {
        setError(res.error);
      }
    });
  }

  function handleCommit() {
    if (!preview || csvText === null) return;
    setError(null);
    startTransition(async () => {
      const res = await commitInvoiceImport({ csvText });
      if (res.ok) {
        setResult(res);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (result) {
    return (
      <div className="surface-card rounded-xl p-4 text-sm">
        <p className="text-ok">
          {`Imported ${result.created} invoices (${result.payments} payment${result.payments === 1 ? "" : "s"}, ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"}, ${result.skipped} skipped)`}
        </p>
        <Link
          href="/invoices"
          className="mt-3 inline-block text-sm text-gold hover:underline"
        >
          Back to invoices
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!preview && (
        <div className="surface-card rounded-xl p-4 text-sm">
          <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
            WinJewel invoice history CSV
            <input
              aria-label="csv file"
              type="file"
              accept=".csv,text/csv"
              disabled={pending}
              onChange={handleFileChange}
              className="mt-2 text-sm text-text normal-case tracking-normal"
            />
          </label>
          <p className="mt-2 text-xs text-text/40">
            {pending ? "Reading & previewing…" : "Max 5 MB, up to 5000 rows."}
          </p>
        </div>
      )}

      <FormStatus error={error} />

      {preview && (
        <div className="surface-card flex flex-col gap-4 rounded-xl p-4 text-sm">
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <Stat testId="stat-totalRows" label="Total" value={preview.totalRows} />
            <Stat testId="stat-importable" label="Importable" value={preview.importable} />
            <Stat testId="stat-duplicates" label="Duplicates" value={preview.duplicates} />
            <Stat testId="stat-skipped" label="Skipped" value={preview.skipped} />
          </div>

          <SampleTable title="Importable" rows={preview.sampleImportable} />
          <SampleTable title="Duplicates" rows={preview.sampleDuplicates} />
          <SampleTable title="Skipped" rows={preview.sampleSkipped} />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCommit}
              disabled={pending || preview.importable === 0}
              className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
            >
              {pending
                ? "Committing…"
                : `Commit ${preview.importable} invoice${preview.importable === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={resetToIdle}
              disabled={pending}
              className="rounded border border-border px-3 py-2 text-xs uppercase tracking-wider text-text/70 hover:text-text disabled:opacity-50"
            >
              Start over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ testId, label, value }: { testId: string; label: string; value: number }) {
  return (
    <div data-testid={testId}>
      <div className="font-display text-xl text-gold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-text/40">{label}</div>
    </div>
  );
}

/** One sample table per outcome class (spec §5) — omitted entirely when its
 *  class is empty, so a clean file with zero duplicates/skips doesn't render
 *  two empty tables under the importable one. */
function SampleTable({ title, rows }: { title: string; rows: InvoiceImportSampleEntry[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[10px] uppercase tracking-wider text-text/40">{title}</p>
      <table role="table" className="w-full text-sm">
        <thead>
          <tr
            role="row"
            className="text-left text-[10px] uppercase tracking-wider text-text/40"
          >
            <th role="columnheader" className="py-2">
              Row
            </th>
            <th role="columnheader">Invoice #</th>
            <th role="columnheader">Customer</th>
            <th role="columnheader">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-text/10">
          {rows.map((row) => (
            <tr role="row" key={row.rowIndex}>
              <td role="cell" className="py-2 text-text/60">
                {row.rowIndex}
              </td>
              <td role="cell" className="text-text/85">
                {row.invoiceNumber ?? <span className="text-text/30">—</span>}
              </td>
              <td role="cell" className="text-text/60">
                {row.customerLabel ?? <span className="text-text/30">—</span>}
              </td>
              <td role="cell" className="text-rose-400">
                {row.reason ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
