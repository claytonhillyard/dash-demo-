import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { ensureDbReady } from "@/db/client";
import { getInventorySummary } from "@/db/inventory";
import { getDiamondSummary } from "@/db/diamonds";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await ensureDbReady();
  const [invSummary, dia] = await Promise.all([getInventorySummary(db), getDiamondSummary(db)]);
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
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} />
      </Shell>
    </QuotesProvider>
  );
}
