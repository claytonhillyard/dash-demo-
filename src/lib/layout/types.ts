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

/** Server-read context the page passes into each panel's render. */
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
}

export interface PanelEntry {
  id: string;
  title: string;
  defaultSize: PanelSize;
  render: (ctx: PanelCtx) => ReactNode;
}
