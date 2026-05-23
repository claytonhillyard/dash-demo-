"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { Panel } from "@/components/Panel";
import { formatCents } from "@/lib/company/format";
import type { Projection } from "@/db/queries";

export function RevenueProjectionsPanel({
  projection,
  updatedLabel,
}: {
  projection: Projection | null;
  updatedLabel: string | null;
}) {
  if (!projection) {
    return (
      <Panel title="Revenue Projections" state="ready">
        <p className="text-text/40 text-sm">
          Set a projection in Company Data, Projections to see the 5-year forecast.
        </p>
      </Panel>
    );
  }

  const data = projection.points.map((p) => ({
    year: String(p.year),
    dollars: Math.round(p.amountCents / 100),
    label: formatCents(p.amountCents),
  }));
  const end = projection.points[projection.points.length - 1];

  return (
    <Panel title="Revenue Projections" state="ready">
      <div className="text-text/70 mb-2 text-xs">
        {end.year}: <span className="text-gold">{formatCents(end.amountCents)}</span> projected
      </div>
      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="year" tick={{ fill: "rgb(180 190 200)", fontSize: 11 }} />
            <YAxis hide />
            <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}`} labelStyle={{ color: "#111" }} />
            <Bar dataKey="dollars" fill="hsl(41 78% 64%)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {updatedLabel && <p className="text-text/40 mt-2 text-xs">{updatedLabel}</p>}
    </Panel>
  );
}
