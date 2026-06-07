import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getInventorySummary, getSharedInventoryForOrg } from "@/db/inventory";
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
  getBidsForDeal,
  getDealBidModeForOwner,
  getTodaysBidsForOwner,
  type BidView,
} from "@/db/bids";
import {
  postDealMessage,
  setDealThreadMode,
  deleteDealMessage,
  markDealThreadRead,
  postBid,
  acceptBid,
  rejectBid,
  withdrawBid,
  setDealBidMode,
} from "@/lib/deals/actions";
import { updatedAgo } from "@/lib/company/format";
import { getProviderStatus } from "@/lib/market/health";
import { isDemoMode } from "@/lib/demo/mode";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [invSummary, dia, activeDeals, circleNamesById, viewerCircleIdList, websiteTrend, sharedInventory] =
    await Promise.all([
      getInventorySummary(db, orgId),
      getDiamondSummary(db, orgId),
      getActiveDeals(db, orgId, 5),
      getCircleNamesForOrg(db, orgId),
      getCircleIdsForOrg(db, orgId),
      getWebsiteSnapshotTrend(db, orgId, 8),
      getSharedInventoryForOrg(db, orgId, 5),
    ]);

  // Slice 10 + 16: per-deal fetches. Parallelized via Promise.all so the 4
  // per-id queries run concurrently rather than sequentially. `unreadByDealId`
  // is already batched in a single SQL call, so it stays as-is.
  const dealIds = activeDeals.map((d) => d.id);
  const [
    unreadByDealId,
    threadsResults,
    threadModeResults,
    bidsResults,
    bidModeResults,
    todaysBids,
  ] = await Promise.all([
    getUnreadCountsForOrg(db, orgId, dealIds),
    Promise.all(dealIds.map((id) => getDealMessages(db, orgId, id))),
    Promise.all(dealIds.map((id) => getDealThreadModeForOwner(db, orgId, id))),
    Promise.all(dealIds.map((id) => getBidsForDeal(db, orgId, id))),
    Promise.all(dealIds.map((id) => getDealBidModeForOwner(db, orgId, id))),
    getTodaysBidsForOwner(db, orgId),
  ]);
  const threadsByDealId = new Map<number, DealMessageView[]>();
  dealIds.forEach((id, i) => threadsByDealId.set(id, threadsResults[i]));
  const threadModeByDealId = new Map<number, "private" | "group">();
  dealIds.forEach((id, i) => {
    const m = threadModeResults[i];
    if (m) threadModeByDealId.set(id, m);
  });
  const bidsByDealId = new Map<number, BidView[]>();
  dealIds.forEach((id, i) => bidsByDealId.set(id, bidsResults[i]));
  const bidModeByDealId = new Map<number, "single" | "history">();
  dealIds.forEach((id, i) => {
    const m = bidModeResults[i];
    if (m) bidModeByDealId.set(id, m);
  });
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
    // Slice 16: bids
    bidsByDealId,
    bidModeByDealId,
    bidActions: {
      postBid,
      acceptBid,
      rejectBid,
      withdrawBid,
      setBidMode: setDealBidMode,
    },
  };
  const website = {
    latest: websiteTrend[0] ?? null,
    previous: websiteTrend[1] ?? null,
    trend: websiteTrend.map((r) => ({ weekStart: r.weekStart, visitors: r.visitors })),
    updatedLabel: updatedAgo(websiteTrend[0]?.updatedAt ?? null),
  };
  const providerStatus = {
    rows: getProviderStatus(),
    demo: isDemoMode(),
  };
  const todaysBidsView = {
    bids: todaysBids,
    actions: { acceptBid, rejectBid },
  };
  const tradenetInventory = { items: sharedInventory };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} deals={deals} website={website} providerStatus={providerStatus} todaysBids={todaysBidsView} tradenetInventory={tradenetInventory} />
      </Shell>
    </QuotesProvider>
  );
}
