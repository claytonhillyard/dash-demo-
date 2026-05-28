"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { formatCents, timeAgo } from "@/lib/company/format";
import type { DealRow } from "@/lib/deals/queries";
import type { DealKind, DealStatus } from "@/lib/deals/constants";
import type { ActionResult } from "@/lib/deals/actions";

const KIND_CLASS: Record<DealKind, string> = {
  BUY: "text-ok",
  SELL: "text-gold",
};

const STATUS_CLASS: Record<DealStatus, string> = {
  Open: "text-ok",
  Filled: "text-text/60",
  Withdrawn: "text-bad",
};

export function DealList({
  deals, markFilledAction, withdrawAction,
}: {
  deals: DealRow[];
  markFilledAction: (id: number) => Promise<ActionResult>;
  withdrawAction: (id: number) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function withdraw(id: number) {
    if (!window.confirm("Withdraw this deal?")) return;
    setError(null);
    setPendingId(id);
    const res = await withdrawAction(id);
    setPendingId(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  async function markFilled(id: number) {
    if (!window.confirm("Mark this deal as filled?")) return;
    setError(null);
    setPendingId(id);
    const res = await markFilledAction(id);
    setPendingId(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  if (deals.length === 0) {
    return (
      <div className="surface-card rounded-xl p-6 text-center text-sm text-text/40">
        No deals match these filters.
      </div>
    );
  }

  return (
    <div className="surface-card rounded-xl p-3">
      <FormStatus error={error} />
      <table role="table" className="w-full text-sm">
        <thead>
          <tr role="row" className="text-left text-[10px] uppercase tracking-wider text-text/40">
            <th role="columnheader" className="py-2">Kind</th>
            <th role="columnheader">Category</th>
            <th role="columnheader">Subject</th>
            <th role="columnheader" className="text-right">Qty</th>
            <th role="columnheader" className="text-right">Price</th>
            <th role="columnheader">Status</th>
            <th role="columnheader">Posted by</th>
            <th role="columnheader">Age</th>
            <th role="columnheader" className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-text/10">
          {deals.map((d) => (
            <tr role="row" key={d.id}>
              <td role="cell" className={`py-2 font-mono text-xs ${KIND_CLASS[d.kind]}`}>{d.kind}</td>
              <td role="cell" className="text-text/60">{d.category}</td>
              <td role="cell" className="text-text/85">{d.subject}</td>
              <td role="cell" className="text-right text-text/70">{d.quantity}</td>
              <td role="cell" className="text-right font-mono text-text">{formatCents(d.priceCents)}</td>
              <td role="cell" className={STATUS_CLASS[d.status]}>{d.status}</td>
              <td role="cell" className="text-text/60">{d.postedByLabel}</td>
              <td role="cell" className="text-text/40">{timeAgo(d.createdAt)}</td>
              <td role="cell" className="text-right">
                {d.status === "Open" && (
                  <span className="inline-flex gap-2">
                    <button
                      type="button"
                      onClick={() => markFilled(d.id)}
                      disabled={pendingId === d.id}
                      aria-label={`Mark deal ${d.id} filled`}
                      className="text-[11px] uppercase tracking-wider text-ok hover:underline disabled:opacity-50"
                    >
                      Mark Filled
                    </button>
                    <button
                      type="button"
                      onClick={() => withdraw(d.id)}
                      disabled={pendingId === d.id}
                      aria-label={`Withdraw deal ${d.id}`}
                      className="text-[11px] uppercase tracking-wider text-bad hover:underline disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
