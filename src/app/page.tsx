import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getInventorySummary } from "@/db/inventory";
import { getDiamondSummary } from "@/db/diamonds";
import { getActiveDeals } from "@/lib/deals/queries";
import { getCircleNamesForOrg, getCircleIdsForOrg } from "@/lib/circles/queries";
import { getWebsiteSnapshotTrend } from "@/db/website";
import {
  getDealMessages,
  getUnreadCountsForOrg,
  getDealThreadModeForOwner,
  type DealMessageView,
} from "@/db/dealMessages";
import {
  postDealMessage,
  setDealThreadMode,
  deleteDealMessage,
  markDealThreadRead,
} from "@/lib/deals/actions";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [invSummary, dia, activeDeals, circleNamesById, viewerCircleIdList, websiteTrend] =
    await Promise.all([
      getInventorySummary(db, orgId),
      getDiamondSummary(db, orgId),
      getActiveDeals(db, orgId, 5),
      getCircleNamesForOrg(db, orgId),
      getCircleIdsForOrg(db, orgId),
      getWebsiteSnapshotTrend(db, orgId, 8),
    ]);

  // Slice 10: per-deal thread fetches. N+1 reads in the loop is acceptable for
  // ≤ 5 active deals (the panel cap); a future slice can consolidate into one
  // SQL pass if profiling demands it (see plan §C6 perf note).
  const dealIds = activeDeals.map((d) => d.id);
  const unreadByDealId = await getUnreadCountsForOrg(db, orgId, dealIds);
  const threadsByDealId = new Map<number, DealMessageView[]>();
  for (const id of dealIds) {
    threadsByDealId.set(id, await getDealMessages(db, orgId, id));
  }
  const threadModeByDealId = new Map<number, "private" | "group">();
  for (const id of dealIds) {
    const m = await getDealThreadModeForOwner(db, orgId, id);
    if (m) threadModeByDealId.set(id, m);
  }
  const viewerCircleIds: ReadonlySet<number> = new Set(viewerCircleIdList);
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
  const deals = {
    deals: activeDeals,
    currentOrgId: orgId,
    circleNamesById,
    viewerCircleIds,
    unreadByDealId,
    threadsByDealId,
    threadModeByDealId,
    actions: {
      postMessage: postDealMessage,
      setMode: setDealThreadMode,
      deleteMessage: deleteDealMessage,
      markRead: markDealThreadRead,
    },
  };
  const website = {
    latest: websiteTrend[0] ?? null,
    previous: websiteTrend[1] ?? null,
    trend: websiteTrend.map((r) => ({ weekStart: r.weekStart, visitors: r.visitors })),
    updatedLabel: updatedAgo(websiteTrend[0]?.updatedAt ?? null),
  };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} deals={deals} website={website} />
      </Shell>
    </QuotesProvider>
  );
}
