"use client";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Panel } from "@/components/Panel";
import { FreshnessDot } from "@/components/FreshnessDot";
import type { Freshness } from "@/lib/market/types";

const RANGES = ["1D", "7D", "1M", "3M", "1Y", "ALL"] as const;
type Range = (typeof RANGES)[number];

interface Series { points: number[]; freshness: Freshness }

async function load(symbol: string, range: Range): Promise<Series> {
  const res = await fetch(`/api/history?symbol=${symbol}&range=${range}`, { cache: "no-store" });
  if (!res.ok) return { points: [], freshness: "stale" };
  const data = (await res.json()) as Series;
  return { points: data.points ?? [], freshness: data.freshness };
}

export function PriceTrendPanel() {
  const [range, setRange] = useState<Range>("1M");
  const [gold, setGold] = useState<Series | null>(null);
  const [btc, setBtc] = useState<Series | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([load("XAU", range), load("BTC", range)]).then(([g, b]) => {
      if (cancelled) return;
      setGold(g);
      setBtc(b);
    });
    return () => { cancelled = true; };
  }, [range]);

  const loaded = gold != null && btc != null;
  const data = loaded
    ? gold!.points.map((g, i) => ({ i, gold: g, btc: btc!.points[i] ?? null }))
    : [];

  return (
    <Panel title="Price Trend Analytics" state="ready">
      <div className="mb-2 flex items-center gap-3 text-xs">
        {RANGES.map((r) => (
          <button key={r} onClick={() => setRange(r)} className={r === range ? "text-gold" : "text-text/50"}>
            {r}
          </button>
        ))}
        {loaded && (
          <span className="ml-auto flex items-center gap-1 text-text/50">
            Gold <FreshnessDot freshness={gold!.freshness} />
            BTC <FreshnessDot freshness={btc!.freshness} />
          </span>
        )}
      </div>
      {loaded && <span data-testid="trend-loaded" className="sr-only">loaded</span>}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="i" hide />
            <YAxis yAxisId="gold" hide domain={["auto", "auto"]} />
            <YAxis yAxisId="btc" orientation="right" hide domain={["auto", "auto"]} />
            <Tooltip />
            <Line yAxisId="gold" type="monotone" dataKey="gold" stroke="hsl(var(--gold))" dot={false} isAnimationActive={false} />
            <Line yAxisId="btc" type="monotone" dataKey="btc" stroke="hsl(var(--accent-blue))" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
