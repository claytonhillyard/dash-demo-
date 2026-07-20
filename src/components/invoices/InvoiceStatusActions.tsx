"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { issueInvoice, voidInvoice } from "@/lib/invoices/actions";
import type { InvoiceStatus } from "@/db/invoices";

/**
 * Lifecycle action buttons for the /invoices/[id]/edit page — WatchToggle's
 * useTransition + inline role="alert" error + router.refresh() conventions
 * (src/components/watchlists/WatchToggle.tsx), not a form submit since
 * there's no field to collect.
 *
 * Issue is offered from `draft` only. Void is offered from `draft` OR
 * `issued` (voidInvoice's contract, src/lib/invoices/actions.ts — voiding a
 * draft you decide not to send is a valid path, not just voiding something
 * already issued). `void` is terminal: both conditions are false, so this
 * renders nothing.
 */
export function InvoiceStatusActions({
  id,
  status,
}: {
  id: number;
  status: InvoiceStatus;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function doIssue() {
    setError(null);
    startTransition(async () => {
      const res = await issueInvoice({ id });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function doVoid() {
    setError(null);
    startTransition(async () => {
      const res = await voidInvoice({ id });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (status === "void") return null;

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <button
            type="button"
            onClick={doIssue}
            disabled={pending}
            className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
          >
            {pending ? "Issuing…" : "Issue"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={doVoid}
          disabled={pending}
          className="rounded border border-bad/40 px-3 py-2 text-xs uppercase tracking-wider text-bad hover:bg-bad/10 disabled:opacity-50"
        >
          {pending ? "Voiding…" : "Void"}
        </button>
      </div>
      <FormStatus error={error} />
    </div>
  );
}
