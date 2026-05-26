import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { getDb } from "@/db/client";
import { getInventorySummary } from "@/db/inventory";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const summary = await getInventorySummary(getDb());
  const inventory = {
    counts: summary.counts,
    total: summary.total,
    updatedLabel: updatedAgo(summary.updatedAt),
  };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} />
      </Shell>
    </QuotesProvider>
  );
}
