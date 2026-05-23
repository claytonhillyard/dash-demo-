"use client";

import { useState } from "react";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";
import { formatCents } from "@/lib/company/format";

export interface TxnRow {
  id: number;
  occurredOn: string;
  amountCents: number;
  memo: string | null;
}

export function RevenueTxnAdmin({
  rows,
  addAction,
  deleteAction,
}: {
  rows: TxnRow[];
  addAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  const [occurredOn, setOccurredOn] = useState("");
  const [amountDollars, setAmountDollars] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const res = await addAction({
      occurredOn,
      amountCents: Math.round(Number(amountDollars || 0) * 100),
      memo: memo || undefined,
    });
    setPending(false);
    if (res.ok) {
      setOk(true);
      setOccurredOn("");
      setAmountDollars("");
      setMemo("");
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">
        Itemized transactions
        <span className="text-text/40 ml-2 text-xs normal-case">
          (any month with transactions ignores its manual bucket)
        </span>
      </h2>
      <form onSubmit={submit} className="mb-4 grid grid-cols-3 gap-2 text-sm">
        <label className="flex flex-col">
          Date
          <input
            aria-label="occurred on"
            type="date"
            className="bg-bg p-2"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Amount ($)
          <input
            aria-label="txn amount"
            type="number"
            className="bg-bg p-2"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Memo
          <input aria-label="memo" className="bg-bg p-2" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <div className="col-span-3 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Add transaction
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="text-text/40 text-sm">No transactions yet.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <span className="text-text/60">{t.occurredOn}</span>
              <span>{formatCents(t.amountCents)}</span>
              <span className="text-text/40">{t.memo ?? ""}</span>
              <button
                className="text-bad"
                onClick={() => deleteAction(t.id)}
                aria-label={`delete transaction ${t.id}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
