"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { sendInvoice } from "@/lib/invoices/actions";
import { relativeTime } from "@/lib/format/bids";

/**
 * Edit-page send panel — the page renders this only for `issued` invoices
 * (spec §6); this component doesn't re-check status itself. Mirrors
 * InvoiceStatusActions' useTransition + inline role="alert" error +
 * router.refresh() conventions (src/components/invoices/InvoiceStatusActions.tsx).
 *
 * The email input is prefilled from the frozen bill_to snapshot but stays
 * editable — a per-send override, never written back to the invoice itself.
 * An empty input is sent as `toEmail: undefined`, NEVER `""` — the action's
 * `z.email()` would reject an empty string — so sendInvoice falls back to
 * bill_to.email server-side.
 *
 * A real send re-renders the page via router.refresh() to pick up the
 * newly-stamped sent_at/sent_to from the server. A *simulated* send (no
 * RESEND_API_KEY configured) never stamps anything server-side (slice-25
 * precedent — no fake delivery record for an email that never left the
 * process), so there's nothing to refresh for; the UI just says so inline.
 */
export function SendInvoicePanel({
  id,
  billToEmail,
  sentAt,
  sentTo,
}: {
  id: number;
  billToEmail: string | null;
  sentAt: Date | null;
  sentTo: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(billToEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [pending, startTransition] = useTransition();

  function doSend() {
    setError(null);
    setSimulated(false);
    startTransition(async () => {
      const res = await sendInvoice({ id, toEmail: email.trim() || undefined });
      if (res.ok) {
        if (res.simulated) {
          setSimulated(true);
        } else {
          router.refresh();
        }
      } else {
        setError(res.error);
      }
    });
  }

  // `sentAt` crosses a Server Component -> Client Component prop boundary.
  // Coerce defensively the same way src/db/invoices.ts does at the db-row ->
  // object boundary, in case it ever arrives already-stringified.
  const sentAtDate: Date | null =
    sentAt == null ? null : sentAt instanceof Date ? sentAt : new Date(sentAt);

  return (
    <div className="surface-card flex flex-col gap-3 rounded-xl p-4 text-sm">
      <h2 className="text-[10px] uppercase tracking-widest text-text/40">Send invoice</h2>
      <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
        Recipient email
        <input
          aria-label="recipient email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={doSend}
          disabled={pending}
          className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {simulated ? (
        <p className="text-text/70 text-sm">
          Simulated — set RESEND_API_KEY for live sends
        </p>
      ) : null}
      <FormStatus error={error} />
      {sentAtDate ? (
        <p data-testid="invoice-sent-state" className="text-xs text-text/50">
          Last sent {relativeTime(sentAtDate)} to {sentTo}
        </p>
      ) : null}
    </div>
  );
}
