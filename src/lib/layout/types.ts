import type { ReactNode } from "react";
import type { DiamondKpis } from "@/components/market/KpiTicker";
import type { DiamondRow } from "@/components/market/MarketIntelligencePanel";
import type { InventoryCategory } from "@/lib/inventory/validation";
import type { DealRow } from "@/lib/deals/queries";

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

/** Server-read context the page passes into each panel's render. */
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
}

export interface PanelEntry {
  id: string;
  title: string;
  defaultSize: PanelSize;
  render: (ctx: PanelCtx) => ReactNode;
}
