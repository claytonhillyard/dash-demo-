import { MarketIntelligencePanel } from "@/components/market/MarketIntelligencePanel";
import { PriceTrendPanel } from "@/components/market/PriceTrendPanel";
import { UnitConverterPanel } from "@/components/converter/UnitConverterPanel";
import { ClockCalendar } from "@/components/dashboard/ClockCalendar";
import { BusinessPlaceholder } from "@/components/dashboard/BusinessPlaceholder";
import { InventoryOverviewPanel } from "@/components/dashboard/InventoryOverviewPanel";
import { DealRoomPanel } from "@/components/dashboard/DealRoomPanel";
import { WebsiteOverviewPanel } from "@/components/dashboard/WebsiteOverviewPanel";
import { ProviderStatusPanel } from "@/components/dashboard/ProviderStatusPanel";
import type { LayoutItem, PanelEntry, PanelSize } from "./types";

export const PANEL_REGISTRY: PanelEntry[] = [
  {
    id: "market-intelligence",
    title: "Market Intelligence",
    defaultSize: 1,
    render: (ctx) => <MarketIntelligencePanel diamondRows={ctx.diamond?.rows} />,
  },
  {
    id: "price-trend",
    title: "Price Trend Analytics",
    defaultSize: 2,
    render: () => <PriceTrendPanel />,
  },
  {
    id: "clock-calendar",
    title: "Calendar",
    defaultSize: 1,
    render: () => <ClockCalendar />,
  },
  {
    id: "ai-insights",
    title: "AI Insights",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="AI Insights" testid="panel-ai-insights" />,
  },
  {
    id: "todays-schedule",
    title: "Today's Schedule",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="Today's Schedule" testid="panel-todays-schedule" />,
  },
  {
    id: "inventory-overview",
    title: "Inventory Overview",
    defaultSize: 1,
    render: (ctx) =>
      ctx.inventory ? (
        <InventoryOverviewPanel
          counts={ctx.inventory.counts}
          total={ctx.inventory.total}
          updatedLabel={ctx.inventory.updatedLabel}
        />
      ) : (
        <BusinessPlaceholder title="Inventory Overview" testid="panel-inventory-overview" />
      ),
  },
  {
    // id "tradenet-exchange" reflects the original mockup-2 framing; title
    // "Deal Room" reflects the user-facing language. Both are stable.
    id: "tradenet-exchange",
    title: "Deal Room",
    defaultSize: 1,
    render: (ctx) =>
      ctx.deals
        ? <DealRoomPanel
            deals={ctx.deals.deals}
            currentOrgId={ctx.deals.currentOrgId}
            circleNamesById={ctx.deals.circleNamesById}
            viewerOrgId={ctx.deals.currentOrgId}
            viewerCircleIds={ctx.deals.viewerCircleIds}
            unreadByDealId={ctx.deals.unreadByDealId}
            threadsByDealId={ctx.deals.threadsByDealId}
            threadModeByDealId={ctx.deals.threadModeByDealId}
            actions={ctx.deals.actions}
          />
        : <BusinessPlaceholder title="Deal Room" testid="panel-tradenet-exchange" />,
  },
  {
    id: "website-overview",
    title: "Website Overview",
    defaultSize: 2,
    render: (ctx) =>
      ctx.website ? (
        <WebsiteOverviewPanel
          latest={ctx.website.latest}
          previous={ctx.website.previous}
          trend={ctx.website.trend}
          updatedLabel={ctx.website.updatedLabel}
        />
      ) : (
        <BusinessPlaceholder title="Website Overview" testid="panel-website-overview" />
      ),
  },
  {
    id: "provider-status",
    title: "Provider Status",
    defaultSize: 1,
    render: (ctx) =>
      ctx.providerStatus ? (
        <ProviderStatusPanel
          rows={ctx.providerStatus.rows}
          demo={ctx.providerStatus.demo}
        />
      ) : (
        <BusinessPlaceholder title="Provider Status" testid="panel-provider-status" />
      ),
  },
  {
    id: "orders-pipeline",
    title: "Orders & Pipeline",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="Orders & Pipeline" testid="panel-orders-pipeline" />,
  },
  {
    id: "portfolio-snapshot",
    title: "Portfolio Snapshot",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="Portfolio Snapshot" testid="panel-portfolio-snapshot" />,
  },
  {
    id: "unit-converter",
    title: "Unit Converter",
    defaultSize: 1,
    render: () => <UnitConverterPanel />,
  },
  {
    id: "crypto-wallet",
    title: "Crypto Wallet",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="Crypto Wallet" testid="panel-crypto-wallet" />,
  },
  {
    id: "financial-overview",
    title: "Financial Overview",
    defaultSize: 2,
    render: () => <BusinessPlaceholder title="Financial Overview" testid="panel-financial-overview" />,
  },
  {
    id: "social-inbox",
    title: "Social & Inbox",
    defaultSize: 2,
    render: () => <BusinessPlaceholder title="Social & Inbox" testid="panel-social-inbox" />,
  },
];

const REGISTRY_BY_ID = new Map(PANEL_REGISTRY.map((p) => [p.id, p]));

export function getPanel(id: string): PanelEntry | undefined {
  return REGISTRY_BY_ID.get(id);
}

export function defaultLayout(): LayoutItem[] {
  return PANEL_REGISTRY.map((p) => ({ id: p.id, size: p.defaultSize, hidden: false }));
}

export function getEffectiveLayout(persisted: LayoutItem[] | null): LayoutItem[] {
  if (!persisted) return defaultLayout();
  const seen = new Set<string>();
  const kept: LayoutItem[] = [];
  for (const it of persisted) {
    const reg = REGISTRY_BY_ID.get(it.id);
    if (!reg) continue;
    seen.add(it.id);
    kept.push({
      id: it.id,
      size: ([1, 2, 4].includes(it.size) ? it.size : reg.defaultSize) as PanelSize,
      hidden: !!it.hidden,
    });
  }
  for (const p of PANEL_REGISTRY) {
    if (!seen.has(p.id)) kept.push({ id: p.id, size: p.defaultSize, hidden: false });
  }
  return kept;
}
