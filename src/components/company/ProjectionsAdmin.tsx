"use client";

import { useState } from "react";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";

export interface ProjectionInitial {
  baseYear: number;
  baseRevenueCents: number;
  cagrPct: number;
  perYearOverrides: Record<string, number>;
}

export function ProjectionsAdmin({
  initial,
  saveAction,
}: {
  initial: ProjectionInitial | null;
  saveAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const [baseYear, setBaseYear] = useState(String(initial?.baseYear ?? new Date().getUTCFullYear()));
  const [baseRevenueDollars, setBaseRevenueDollars] = useState(
    initial ? String(Math.round(initial.baseRevenueCents / 100)) : ""
  );
  const [cagrPct, setCagrPct] = useState(String(initial?.cagrPct ?? ""));
  const [overridesText, setOverridesText] = useState(
    initial ? JSON.stringify(initial.perYearOverrides) : "{}"
  );
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);

    let overrides: Record<string, number>;
    try {
      const parsed = JSON.parse(overridesText || "{}") as Record<string, number>;
      // overrides are entered as dollars per year; store as cents
      overrides = Object.fromEntries(
        Object.entries(parsed).map(([year, dollars]) => [year, Math.round(Number(dollars) * 100)])
      );
    } catch {
      setError('Per-year overrides must be JSON like {"2028": 200000}');
      return;
    }

    setPending(true);
    const res = await saveAction({
      baseYear: Number(baseYear),
      baseRevenueCents: Math.round(Number(baseRevenueDollars || 0) * 100),
      cagrPct: Math.round(Number(cagrPct || 0)),
      perYearOverrides: overrides,
    });
    setPending(false);
    if (res.ok) setOk(true);
    else setError(res.error);
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">Revenue Projection</h2>
      {!initial && (
        <p className="text-text/40 mb-3 text-sm">
          Set your first projection: a base year, base revenue, and an annual growth rate.
        </p>
      )}
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 text-sm">
        <label className="flex flex-col">
          Base year
          <input
            aria-label="base year"
            type="number"
            className="bg-bg p-2"
            value={baseYear}
            onChange={(e) => setBaseYear(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Base revenue ($)
          <input
            aria-label="base revenue"
            type="number"
            className="bg-bg p-2"
            value={baseRevenueDollars}
            onChange={(e) => setBaseRevenueDollars(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          CAGR (%)
          <input
            aria-label="cagr"
            type="number"
            className="bg-bg p-2"
            value={cagrPct}
            onChange={(e) => setCagrPct(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Per-year overrides ($, JSON)
          <input
            aria-label="overrides"
            className="bg-bg p-2"
            value={overridesText}
            onChange={(e) => setOverridesText(e.target.value)}
          />
        </label>
        <div className="col-span-2 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Save projection
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>
    </section>
  );
}
