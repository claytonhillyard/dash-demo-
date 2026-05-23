"use client";

import { CompanyOverviewPanel } from "./CompanyOverviewPanel";
import { RevenueProjectionsPanel } from "./RevenueProjectionsPanel";
import { GrowthAnalyticsPanel } from "./GrowthAnalyticsPanel";
import type { CompanyDashboard } from "@/db/dashboard";

export function CompanyPanels({
  data,
  companyUpdatedLabel,
  projectionUpdatedLabel,
}: {
  data: CompanyDashboard;
  companyUpdatedLabel: string | null;
  projectionUpdatedLabel: string | null;
}) {
  return (
    <>
      <CompanyOverviewPanel kpis={data.kpis} hasAnyData={data.hasAnyData} updatedLabel={companyUpdatedLabel} />
      <RevenueProjectionsPanel projection={data.projection} updatedLabel={projectionUpdatedLabel} />
      <div className="col-span-2">
        <GrowthAnalyticsPanel series={data.series} updatedLabel={companyUpdatedLabel} />
      </div>
    </>
  );
}
