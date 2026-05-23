"use client";

import { CompanyOverviewPanel } from "./CompanyOverviewPanel";
import { RevenueProjectionsPanel } from "./RevenueProjectionsPanel";
import { GrowthAnalyticsPanel } from "./GrowthAnalyticsPanel";
import type { CompanyDashboard } from "@/db/dashboard";

export function CompanyPanels({
  data,
  updatedLabel,
}: {
  data: CompanyDashboard;
  updatedLabel: string | null;
}) {
  return (
    <>
      <CompanyOverviewPanel kpis={data.kpis} hasAnyData={data.hasAnyData} updatedLabel={updatedLabel} />
      <RevenueProjectionsPanel projection={data.projection} updatedLabel={updatedLabel} />
      <div className="col-span-2">
        <GrowthAnalyticsPanel series={data.series} updatedLabel={updatedLabel} />
      </div>
    </>
  );
}
