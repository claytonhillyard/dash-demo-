"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { deleteDocument } from "@/lib/documents/actions";

/**
 * Per-row two-step delete control for the /documents vault list. The page
 * (src/app/(admin)/documents/page.tsx) is an RSC that embeds one instance of
 * this per row, mirroring how the invoices edit page embeds SendInvoicePanel/
 * PaymentsPanel/InvoiceStatusActions inside an otherwise server-rendered
 * tree. Unlike PaymentsPanel's shared `confirmDeleteId` (one panel handling
 * many rows), each row here IS its own component instance, so the confirm
 * flag is just local state — no cross-row bookkeeping needed.
 *
 * Two-step inline confirm (Delete -> Confirm/Cancel), the house pattern —
 * no window.confirm anywhere in this codebase's newer components.
 */
export function DocumentDeleteButton({ id, title }: { id: number; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteDocument({ id });
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={doDelete}
            disabled={pending}
            className="rounded border border-bad/40 px-2 py-1 text-[11px] uppercase tracking-wider text-bad hover:bg-bad/10 disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="text-[11px] uppercase tracking-wider text-text/50 hover:text-text disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          title={`Delete ${title}`}
          className="text-[11px] uppercase tracking-wider text-bad hover:underline"
        >
          Delete
        </button>
      )}
      <FormStatus error={error} />
    </div>
  );
}
