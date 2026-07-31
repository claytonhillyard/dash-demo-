import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { safePanel } from "./safePanel";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getInventorySummary, getSharedInventoryForOrg, zeroCounts, type InventorySummary } from "@/db/inventory";
import { getDiamondSummary, type DiamondSummary } from "@/db/diamonds";
import { getOrgActivity } from "@/db/activityEvents";
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
import { getReceivablesRows, getTrailingProfitMonths } from "@/db/runway";
import { computeReceivablesAging, computeRunway, daysBetweenUtc, type ReceivableRow } from "@/lib/runway/compute";

export const dynamic = "force-dynamic";

// C-7 hardening pass: genuine empty/zero shapes for safePanel's fallback
// when the corresponding reader throws. Built from each reader's own return
// type (InventorySummary / DiamondSummary) rather than guessed, and reuses
// src/db/inventory.ts's own `zeroCounts()` so the inventory shape can never
// drift from the reader's real empty case. Module-level (not per-request)
// since both are plain constants with no db/orgId dependency.
// Object.freeze so these shared module-level fallbacks can't have their
// top-level fields reassigned across requests by a future consumer (review
// nit — safe today, footgun tomorrow). RSC consumers only read/.map these.
const EMPTY_INVENTORY_SUMMARY = Object.freeze({
  counts: zeroCounts(),
  total: 0,
  updatedAt: null,
}) as InventorySummary;
const EMPTY_DIAMOND_SUMMARY = Object.freeze({
  naturalIndex: null,
  labIndex: null,
  points: [],
  updatedAt: null,
}) as DiamondSummary;

export default async function Home() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [
    invSummary, dia, activeDeals, circleNamesById, viewerCircleIdList, websiteTrend, sharedInventory,
    activityEvents, receivablesRows, trailingProfitCents,
  ] =
    // C-7 hardening pass: every fetch below is an independent dashboard
    // panel with no cross-dependency on one another (the SECOND Promise.all
    // further down, for per-deal data, is different — see the note above
    // its `dealIds` line). Each is wrapped in safePanel so one reader
    // throwing degrades ONLY that panel to its genuine empty/zero shape
    // (Sentry-captured, never silent) instead of failing the entire
    // dashboard render.
    await Promise.all([
      safePanel("inventorySummary", getInventorySummary(db, orgId), EMPTY_INVENTORY_SUMMARY),
      safePanel("diamondSummary", getDiamondSummary(db, orgId), EMPTY_DIAMOND_SUMMARY),
      safePanel("activeDeals", getActiveDeals(db, orgId, 5), []),
      safePanel("circleNames", getCircleNamesForOrg(db, orgId), new Map<number, string>()),
      safePanel("circleIds", getCircleIdsForOrg(db, orgId), []),
      safePanel("websiteSnapshotTrend", getWebsiteSnapshotTrend(db, orgId, 8), []),
      safePanel("sharedInventory", getSharedInventoryForOrg(db, orgId, 5), []),
      safePanel("orgActivity", getOrgActivity(db, orgId, { limit: 10 }), []),
      // Slice 33: receivables aging + trailing profit for the cash-runway
      // panel. computeReceivablesAging([], ...) and computeRunway({
      // trailingProfitCents: [], ...}) both have an explicit empty-input
      // base case (src/lib/runway/compute.ts), so a degraded fetch here
      // still renders a coherent zero-balance / insufficient-history panel
      // rather than 500ing.
      safePanel("receivablesRows", getReceivablesRows(db, orgId), []),
      safePanel("trailingProfitMonths", getTrailingProfitMonths(db, 6), []),
    ]);

  // Slice 10 + 16: per-deal fetches. Parallelized via Promise.all so the 4
  // per-id queries run concurrently rather than sequentially. `unreadByDealId`
  // is already batched in a single SQL call, so it stays as-is.
  //
  // C-7 hardening pass: the four per-DEAL fetches are left un-wrapped —
  // `activeDeals` degrading to [] makes `dealIds` [] too, so they map over
  // nothing (and getUnreadCountsForOrg returns `new Map()` before touching
  // the db when dealIds.length === 0). A genuinely mid-flight per-deal
  // failure (activeDeals resolves, but one of its four per-id reads throws)
  // is NOT degraded by this slice — documented residual. `getTodaysBidsForOwner`
  // is the exception: it's DEAL-INDEPENDENT (runs unconditionally, no
  // dealIds short-circuit), so it IS a standalone 500 vector — wrapped with
  // safePanel like the first block (review finding).
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
    safePanel("todaysBids", getTodaysBidsForOwner(db, orgId), []),
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
  const activity = { events: activityEvents };
  // Slice 33: cash-runway panel. `todayUtc` is read once per render (not
  // per row) so every receivable in this response is judged against the
  // exact same "today", matching computeReceivablesAging's contract.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const aging = computeReceivablesAging(receivablesRows, todayUtc);
  const runwayResult = computeRunway({
    trailingProfitCents,
    receivablesTotalCents: aging.totalCents,
  });
  // Top 5 oldest (== most overdue — receivablesRows is already oldest-first)
  // decorated with daysOverdue, computed via the SAME refDate-selection rule
  // computeReceivablesAging uses (dueDate ?? issueDate; both null -> not
  // overdue) but reusing its exported daysBetweenUtc for the actual
  // arithmetic rather than duplicating that too.
  const topOldest = receivablesRows.slice(0, 5).map((row) => ({
    ...row,
    daysOverdue: daysOverdueFor(row, todayUtc),
  }));
  const runway = { aging, runway: runwayResult, topOldest };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} deals={deals} website={website} providerStatus={providerStatus} todaysBids={todaysBidsView} tradenetInventory={tradenetInventory} activity={activity} runway={runway} />
      </Shell>
    </QuotesProvider>
  );
}

/** Mirrors computeReceivablesAging's refDate rule (dueDate ?? issueDate; both
 *  null -> 0 days overdue, i.e. "current") for a single row, using the
 *  exported daysBetweenUtc for the arithmetic. Kept in sync with
 *  src/lib/runway/compute.ts by design — if that rule ever changes, this
 *  must change with it. */
function daysOverdueFor(row: ReceivableRow, todayUtc: string): number {
  const refDate = row.dueDate ?? row.issueDate;
  return refDate === null ? 0 : daysBetweenUtc(refDate, todayUtc);
}
