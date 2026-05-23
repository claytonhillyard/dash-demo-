import { Shell } from "@/components/dashboard/Shell";
import { Panel } from "@/components/Panel";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { MarketAnalysisPanel } from "@/components/market/MarketAnalysisPanel";
import { CompanyPanels } from "@/components/company/CompanyPanels";
import { getDb } from "@/db/client";
import { readCompanyDashboard } from "@/db/dashboard";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const data = await readCompanyDashboard(getDb(), year, month);
  // Per-panel provenance: KPI/series panels reflect their own company-table
  // writes; the projections panel reflects the projection's own timestamp.
  const companyUpdatedLabel = updatedAgo(data.companyUpdatedAt);
  const projectionUpdatedLabel = updatedAgo(data.projection?.updatedAt ?? null);

  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <div className="grid grid-cols-4 gap-3" data-testid="dashboard-root">
          <div className="col-span-2">
            <MarketAnalysisPanel />
          </div>
          <CompanyPanels
            data={data}
            companyUpdatedLabel={companyUpdatedLabel}
            projectionUpdatedLabel={projectionUpdatedLabel}
          />
          <Panel title="Work Orders" state="unwired" />
          <Panel title="Client Satisfaction" state="unwired" />
        </div>
      </Shell>
    </QuotesProvider>
  );
}
