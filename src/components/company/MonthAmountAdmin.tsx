"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";
import { formatCents } from "@/lib/company/format";

export interface MonthRow {
  year: number;
  month: number;
  amountCents: number;
}

export function MonthAmountAdmin({
  title,
  rows,
  saveAction,
}: {
  title: string;
  rows: MonthRow[];
  saveAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getUTCFullYear()));
  const [month, setMonth] = useState(String(now.getUTCMonth() + 1));
  const [amountDollars, setAmountDollars] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const res = await saveAction({
      year: Number(year),
      month: Number(month),
      amountCents: Math.round(Number(amountDollars || 0) * 100),
    });
    setPending(false);
    if (res.ok) {
      setOk(true);
      setAmountDollars("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">{title}</h2>
      <form onSubmit={submit} className="mb-4 grid grid-cols-3 gap-2 text-sm">
        <label className="flex flex-col">
          Year
          <input aria-label="year" type="number" className="bg-bg p-2" value={year} onChange={(e) => setYear(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Month
          <input
            aria-label="month"
            type="number"
            min={1}
            max={12}
            className="bg-bg p-2"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Amount ($)
          <input
            aria-label="amount"
            type="number"
            className="bg-bg p-2"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
          />
        </label>
        <div className="col-span-3 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Save month
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="text-text/40 text-sm">No months entered yet.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {rows.map((r) => (
            <li key={`${r.year}-${r.month}`} className="flex justify-between py-2">
              <span className="text-text/60">
                {r.year}-{String(r.month).padStart(2, "0")}
              </span>
              <span>{formatCents(r.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
