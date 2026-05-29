import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getInventorySummary } from "@/db/inventory";
import { getDiamondSummary } from "@/db/diamonds";
import { getActiveDeals } from "@/lib/deals/queries";
import { getCircleNamesForOrg } from "@/lib/circles/queries";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [invSummary, dia, activeDeals, circleNamesById] = await Promise.all([
    getInventorySummary(db, orgId),
    getDiamondSummary(db, orgId),
    getActiveDeals(db, orgId, 5),
    getCircleNamesForOrg(db, orgId),
  ]);
  const inventory = {
    counts: invSummary.counts,
    total: invSummary.total,
    updatedLabel: updatedAgo(invSummary.updatedAt),
  };
  const diamond = {
    kpis: { naturalIndex: dia.naturalIndex, labIndex: dia.labIndex },
    rows: [
      ...(dia.naturalIndex ? [{ label: "Natural 1ct", cents: dia.naturalIndex.cents, change24hPct: dia.naturalIndex.change24hPct }] : []),
      ...(dia.labIndex ? [{ label: "Lab 1ct", cents: dia.labIndex.cents, change24hPct: dia.labIndex.change24hPct }] : []),
      ...dia.points.map((p) => ({ label: p.label, cents: p.cents, change24hPct: null })),
    ],
  };
  const deals = { deals: activeDeals, currentOrgId: orgId, circleNamesById };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} deals={deals} />
      </Shell>
    </QuotesProvider>
  );
}
