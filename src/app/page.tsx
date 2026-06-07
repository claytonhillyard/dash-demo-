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
  getAttachmentsForDeal,
  resolveSignedUrl,
  type DealAttachmentView,
} from "@/db/dealAttachments";
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
  uploadDealAttachment,
  deleteDealAttachment,
} from "@/lib/deals/actions";
import { DEMO_DEAL_ATTACHMENTS } from "@/lib/demo/seed";
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

  // Slice 17: per-deal attachment metadata + per-attachment signed URLs.
  // Demo mode short-circuits to the authored DEMO_DEAL_ATTACHMENTS constant
  // (with publicCdnUrl used directly as the renderable URL). Production
  // path parallelizes over deals; each deal parallelizes its signed-URL
  // fetches across its attachments.
  const attachmentsByDealId = new Map<number, DealAttachmentView[]>();
  const signedUrlsByDealId = new Map<number, Map<number, string>>();
  if (isDemoMode()) {
    for (const id of dealIds) {
      const demoForDeal: DealAttachmentView[] = DEMO_DEAL_ATTACHMENTS
        .filter((a) => a.dealId === id)
        .map((a) => ({
          id: a.id,
          dealId: a.dealId,
          uploadedByOrgId: a.uploadedByOrgId,
          kind: a.kind,
          storageKey: a.publicCdnUrl, // unused in demo; URL lives on signedUrlsByDealId
          mimeType: a.mimeType,
          sizeBytes: 0,
          altText: a.altText,
          createdAt: new Date(Date.now() - a.createdAtOffsetMinutes * 60_000),
        }));
      attachmentsByDealId.set(id, demoForDeal);
      const urls = new Map<number, string>();
      for (const a of demoForDeal) urls.set(a.id, a.storageKey);
      signedUrlsByDealId.set(id, urls);
    }
  } else {
    await Promise.all(
      dealIds.map(async (id) => {
        const atts = await getAttachmentsForDeal(db, orgId, id);
        attachmentsByDealId.set(id, atts);
        const urls = new Map<number, string>();
        await Promise.all(
          atts.map(async (a) => {
            urls.set(a.id, await resolveSignedUrl(db, orgId, id, a.id));
          }),
        );
        signedUrlsByDealId.set(id, urls);
      }),
    );
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
    // Slice 17: attachments
    attachmentsByDealId,
    signedUrlsByDealId,
    attachmentActions: {
      uploadAttachment: uploadDealAttachment,
      deleteAttachment: deleteDealAttachment,
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
