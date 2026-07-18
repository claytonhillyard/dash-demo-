"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormStatus } from "@/components/company/FormStatus";
import { previewImport, commitImport } from "@/lib/customers/import/actions";
import type { ImportPreview, ImportCommitResult } from "@/lib/customers/import/actions";

// Client-side mirror of the server's MAX_CSV_BYTES (src/lib/customers/
// import/actions.ts) — spec §6: reject oversize files before ever reading
// them or calling previewImport.
const MAX_CSV_BYTES = 5 * 1024 * 1024;

type PreviewOk = Extract<ImportPreview, { ok: true }>;
type CommitOk = Extract<ImportCommitResult, { ok: true }>;

/**
 * WinJewel CSV import wizard (client component). Spec §6
 * (docs/superpowers/specs/2026-07-17-winjewel-csv-import-slice-26-design.md).
 *
 * Stateless-server / stateful-client split (spec §8 decision 2): both
 * previewImport and commitImport re-parse csvText from scratch on every
 * call, so THIS component is the only place the parsed text lives between
 * the preview and commit steps — `csvText` is captured in state the moment a
 * preview succeeds and handed back verbatim to commitImport, unchanged.
 *
 * Conceptual state machine (idle -> previewing -> previewed -> committing ->
 * done | error) is implemented as plain derived state rather than a literal
 * `step` enum, the same way CustomerForm/WatchToggle track {error, pending}
 * directly instead of a formal FSM:
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
 * `readFile` is injectable because jsdom 25 (this repo's vitest environment)
 * does not implement `File.prototype.text()` (empirically confirmed while
 * building this component: `typeof new File([...]).text === "undefined"`) —
 * see test/components/customers/import/ImportWizard.test.tsx. Production
 * never passes the prop and gets the real `file.text()`.
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
    // still fires a change event (matches DealAttachmentCarousel's convention).
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
      const res = await previewImport({ csvText: text });
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
      const res = await commitImport({ csvText });
      if (res.ok) {
        setResult(res);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (result) {
    const total = result.created + result.updated + result.skipped;
    return (
      <div className="surface-card rounded-xl p-4 text-sm">
        <p className="text-ok">
          {`Imported ${total} (${result.created} new, ${result.updated} updated, ${result.skipped} skipped)`}
        </p>
        <Link
          href="/customers"
          className="mt-3 inline-block text-sm text-gold hover:underline"
        >
          Back to customers
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!preview && (
        <div className="surface-card rounded-xl p-4 text-sm">
          <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
            WinJewel customer CSV
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
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
            <Stat testId="stat-totalRows" label="Total" value={preview.totalRows} />
            <Stat testId="stat-validCount" label="Valid" value={preview.validCount} />
            <Stat testId="stat-invalidCount" label="Invalid" value={preview.invalidCount} />
            <Stat testId="stat-wouldCreate" label="New" value={preview.wouldCreate} />
            <Stat testId="stat-wouldUpdate" label="Update" value={preview.wouldUpdate} />
          </div>

          <div className="overflow-x-auto">
            <table role="table" className="w-full text-sm">
              <thead>
                <tr
                  role="row"
                  className="text-left text-[10px] uppercase tracking-wider text-text/40"
                >
                  <th role="columnheader" className="py-2">
                    Row
                  </th>
                  <th role="columnheader">Name</th>
                  <th role="columnheader">External ref</th>
                  <th role="columnheader">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-text/10">
                {preview.sample.map((row) => (
                  <tr role="row" key={row.rowIndex} className={row.ok ? undefined : "bg-rose-400/5"}>
                    <td role="cell" className="py-2 text-text/60">
                      {row.rowIndex}
                    </td>
                    <td role="cell" className="text-text/85">
                      {row.name ?? <span className="text-text/30">—</span>}
                    </td>
                    <td role="cell" className="text-text/60">
                      {row.externalRef ?? <span className="text-text/30">—</span>}
                    </td>
                    <td role="cell" className="text-rose-400">
                      {row.errors?.join("; ") ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCommit}
              disabled={pending || preview.validCount === 0}
              className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
            >
              {pending
                ? "Committing…"
                : `Commit ${preview.validCount} customer${preview.validCount === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={resetToIdle}
              disabled={pending}
              className="rounded border border-border px-3 py-2 text-xs uppercase tracking-wider text-text/70 hover:text-text disabled:opacity-50"
            >
              Cancel
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
