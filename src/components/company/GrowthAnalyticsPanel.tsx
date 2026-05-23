"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Panel } from "@/components/Panel";
import type { MonthPoint } from "@/db/queries";

export function GrowthAnalyticsPanel({
  series,
  updatedLabel,
}: {
  series: MonthPoint[];
  updatedLabel: string | null;
}) {
  const hasHistory = series.some((m) => m.revenueCents > 0 || m.profitCents > 0 || m.clientsAdded > 0);

  if (!hasHistory) {
    return (
      <Panel title="Company Growth Analytics" state="ready">
        <p className="text-text/40 text-sm">
          No monthly history yet. Enter revenue, profit, and clients to build the trend.
        </p>
      </Panel>
    );
  }

  const data = series.map((m) => ({
    label: `${String(m.year).slice(2)}-${String(m.month).padStart(2, "0")}`,
    revenue: Math.round(m.revenueCents / 100),
    profit: Math.round(m.profitCents / 100),
    clientsAdded: m.clientsAdded,
  }));

  return (
    <Panel title="Company Growth Analytics" state="ready">
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="label" tick={{ fill: "rgb(180 190 200)", fontSize: 10 }} />
            <YAxis hide />
            <Tooltip labelStyle={{ color: "#111" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(41 78% 64%)" dot={false} />
            <Line type="monotone" dataKey="profit" name="Profit" stroke="hsl(168 64% 52%)" dot={false} />
            <Line type="monotone" dataKey="clientsAdded" name="Clients added" stroke="hsl(210 20% 70%)" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {updatedLabel && <p className="text-text/40 mt-2 text-xs">{updatedLabel}</p>}
    </Panel>
  );
}
