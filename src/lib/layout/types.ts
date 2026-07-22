import type { ReactNode } from "react";
import type { DiamondKpis } from "@/components/market/KpiTicker";
import type { DiamondRow } from "@/components/market/MarketIntelligencePanel";
import type { InventoryCategory } from "@/lib/inventory/validation";
import type { DealRow } from "@/lib/deals/queries";
import type { DealMessageView } from "@/db/dealMessages";
import type { BidView, TodaysBidView } from "@/db/bids";
import type { DealAttachmentView } from "@/db/dealAttachments";
import type {
  DealRoomPanelActions,
  DealRoomPanelBidActions,
  DealRoomPanelAttachmentActions,
} from "@/components/dashboard/DealRoomPanel";
import type { SharedInventoryRow } from "@/db/inventory";
import type { ActivityEvent } from "@/lib/activity/types";
import type { ReceivablesAging, RunwayResult } from "@/lib/runway/compute";
import type { TopOldestReceivable } from "@/components/dashboard/CashRunwayPanel";

export type PanelSize = 1 | 2 | 4;

export interface LayoutItem {
  id: string;
  size: PanelSize;
  hidden: boolean;
}

/** Server-read views the page passes down — defined here (not in DashboardGrid)
 *  so the layout types don't depend on the grid that consumes them. */
export interface InventoryView {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedLabel: string | null;
}

export interface DiamondView {
  kpis: DiamondKpis;
  rows: DiamondRow[];
}

export interface DealView {
  deals: DealRow[];
  /** The session's org id — used by DealRoomPanel to distinguish own-org
   *  from foreign-org rows when rendering the "Shared via" badge. */
  currentOrgId: number;
  /** Map from circle id → display name, built once per page render from
   *  getCircleNamesForOrg(orgId). Only contains circles the viewer is a
   *  member of, so it's safe to surface any value as a UI label. */
  circleNamesById: Map<number, string>;
  // --- Slice 10: reply threads ---
  /** Set of circle ids the viewer belongs to. Used by DealRoomPanel's
   *  canPost derivation to decide whether a non-owner may post on a
   *  group-mode deal. */
  viewerCircleIds?: ReadonlySet<number>;
  /** Per-deal unread message count for the viewer. */
  unreadByDealId?: Map<number, number>;
  /** Per-deal preloaded message list (already sorted ASC by createdAt). */
  threadsByDealId?: Map<number, DealMessageView[]>;
  /** Per-deal current thread mode — populated ONLY for deals the viewer
   *  owns (gates the owner mode-selector in the accordion). */
  threadModeByDealId?: Map<number, "private" | "group">;
  /** Server actions wired through from src/lib/deals/actions.ts. */
  actions?: DealRoomPanelActions;
  // --- Slice 16: bids ---
  /** Per-deal preloaded bids for the Bids tab inside DealThreadAccordion. */
  bidsByDealId?: Map<number, BidView[]>;
  /** Per-deal owner bid_mode (populated only for deals the viewer owns). */
  bidModeByDealId?: Map<number, "single" | "history">;
  /** Slice-16 bid action wiring. */
  bidActions?: DealRoomPanelBidActions;
  // --- Slice 17: attachments (photos + certs) ---
  /** Per-deal preloaded attachment metadata for the carousel. */
  attachmentsByDealId?: Map<number, DealAttachmentView[]>;
  /** Per-deal signed URLs keyed by attachment id (or demo public URLs). */
  signedUrlsByDealId?: Map<number, Map<number, string>>;
  /** Slice-17 attachment action wiring (owner upload/delete). */
  attachmentActions?: DealRoomPanelAttachmentActions;
}

export interface WebsiteOverviewView {
  /** Most-recent weekly snapshot; null when the org has no rows. */
  latest: import("@/db/website").WebsiteSnapshotRow | null;
  /** Snapshot before the latest (for week-over-week deltas); null when
   *  only a single row exists for the org. */
  previous: import("@/db/website").WebsiteSnapshotRow | null;
  /** Newest-first; max 8. Used by the panel's visitor sparkline. */
  trend: Array<{ weekStart: string; visitors: number }>;
  /** Owner-entered provenance label — "updated 2d ago" or similar.
   *  Null when no snapshot exists. */
  updatedLabel: string | null;
}

export interface ProviderStatusView {
  rows: import("@/lib/market/health").ProviderHealth[];
  demo: boolean;
}

export interface TodaysBidsView {
  bids: TodaysBidView[];
  actions: {
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
}

export interface TradeNetInventoryView {
  items: SharedInventoryRow[];
}

export interface ActivityView {
  events: ActivityEvent[];
}

export interface RunwayView {
  aging: ReceivablesAging;
  runway: RunwayResult;
  /** Up to 5 oldest outstanding receivables, most-overdue first, with
   *  daysOverdue precomputed server-side (slice 33). */
  topOldest: TopOldestReceivable[];
}

/** Server-read context the page passes into each panel's render. */
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
  providerStatus?: ProviderStatusView; // slice 11
  todaysBids?: TodaysBidsView; // slice 16
  tradenetInventory?: TradeNetInventoryView; // slice 15
  activity?: ActivityView; // slice 24c
  runway?: RunwayView; // slice 33
}

export interface PanelEntry {
  id: string;
  title: string;
  defaultSize: PanelSize;
  render: (ctx: PanelCtx) => ReactNode;
}
