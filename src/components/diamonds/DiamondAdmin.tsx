"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { formatCents } from "@/lib/company/format";
import { SHEETS, SHAPES, NAMED_POINT_KINDS } from "@/lib/diamonds/constants";

type Result = { ok: true } | { ok: false; error: string };
type ImportResult = { ok: true; imported: number } | { ok: false; error: string };

export interface PricePointRow {
  id: number;
  label: string;
  kind: string;
  pricePerCaratCents: number;
}

export function DiamondAdmin({
  points, importAction, savePoint, deletePoint,
}: {
  points: PricePointRow[];
  importAction: (raw: unknown) => Promise<ImportResult>;
  savePoint: (raw: unknown) => Promise<Result>;
  deletePoint: (id: number) => Promise<Result>;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<string>("natural");
  const [shape, setShape] = useState<string>("round");
  const [csv, setCsv] = useState("");
  const [impErr, setImpErr] = useState<string | null>(null);
  const [impOk, setImpOk] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<string>("fancy_diamond");
  const [ppDollars, setPpDollars] = useState("");
  const [pErr, setPErr] = useState<string | null>(null);

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setImpErr(null); setImpOk(null);
    const res = await importAction({ sheet, shape, csv });
    if (res.ok) { setImpOk(`Imported ${res.imported} cells.`); setCsv(""); router.refresh(); }
    else setImpErr(res.error);
  }

  async function addPoint(e: React.FormEvent) {
    e.preventDefault();
    setPErr(null);
    const res = await savePoint({ label, kind, pricePerCaratCents: Math.round(Number(ppDollars || 0) * 100) });
    if (res.ok) { setLabel(""); setPpDollars(""); router.refresh(); }
    else setPErr(res.error);
  }

  async function removePoint(id: number) {
    setPErr(null);
    const res = await deletePoint(id);
    if (res.ok) router.refresh();
    else setPErr(res.error);
  }

  return (
    <div className="space-y-4">
      <section className="surface-card rounded-xl p-4">
        <h2 className="mb-2 font-display tracking-wider text-gold">Import price sheet (CSV)</h2>
        <p className="mb-2 text-xs text-text/40">
          Header: <code>carat_band,color,clarity,price_per_carat</code> (price in $/ct). Replaces the
          selected sheet + shape.
        </p>
        <form onSubmit={runImport} className="space-y-2 text-sm">
          <div className="flex gap-2">
            <select aria-label="sheet" value={sheet} onChange={(e) => setSheet(e.target.value)} className="bg-bg p-2">
              {SHEETS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="shape" value={shape} onChange={(e) => setShape(e.target.value)} className="bg-bg p-2">
              {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <textarea aria-label="csv" value={csv} onChange={(e) => setCsv(e.target.value)}
            rows={6} className="w-full bg-bg p-2 font-mono text-xs" />
          <div className="flex items-center justify-between">
            <button type="submit" className="rounded bg-gold p-2 text-black">Import</button>
            <FormStatus error={impErr} />
            {impOk && <span className="text-ok text-sm">{impOk}</span>}
          </div>
        </form>
      </section>

      <section className="surface-card rounded-xl p-4">
        <h2 className="mb-2 font-display tracking-wider text-gold">Named price points (fancy + gems)</h2>
        <form onSubmit={addPoint} className="mb-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <input aria-label="label" placeholder="Pink Diamond 1ct" value={label}
            onChange={(e) => setLabel(e.target.value)} className="bg-bg p-2" />
          <select aria-label="point kind" value={kind} onChange={(e) => setKind(e.target.value)} className="bg-bg p-2">
            {NAMED_POINT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input aria-label="price per carat" type="number" placeholder="$/ct" value={ppDollars}
            onChange={(e) => setPpDollars(e.target.value)} className="bg-bg p-2" />
          <button type="submit" className="rounded bg-gold p-2 text-black">Add point</button>
        </form>
        <FormStatus error={pErr} />
        {points.length === 0 ? (
          <p className="text-sm text-text/40">No named points yet.</p>
        ) : (
          <ul className="divide-y divide-text/10 text-sm">
            {points.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span className="flex-1">{p.label}</span>
                <span className="text-text/50">{p.kind}</span>
                <span className="text-text/60">{formatCents(p.pricePerCaratCents)}/ct</span>
                <button className="text-bad" onClick={() => removePoint(p.id)}
                  aria-label={`delete ${p.label}`}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
