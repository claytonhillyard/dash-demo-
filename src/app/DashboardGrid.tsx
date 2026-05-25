"use client";
import { KpiTicker } from "@/components/market/KpiTicker";
import { MarketIntelligencePanel } from "@/components/market/MarketIntelligencePanel";
import { PriceTrendPanel } from "@/components/market/PriceTrendPanel";
import { UnitConverterPanel } from "@/components/converter/UnitConverterPanel";
import { ClockCalendar } from "@/components/dashboard/ClockCalendar";
import { BusinessPlaceholder } from "@/components/dashboard/BusinessPlaceholder";

export function DashboardGrid() {
  return (
    <div className="space-y-3" data-testid="dashboard-root">
      <KpiTicker />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <div className="xl:col-span-1"><MarketIntelligencePanel /></div>
        <div className="xl:col-span-2"><PriceTrendPanel /></div>
        <div className="xl:col-span-1"><ClockCalendar /></div>

        <BusinessPlaceholder title="AI Insights" testid="panel-ai-insights" />
        <BusinessPlaceholder title="Today's Schedule" testid="panel-todays-schedule" />
        <BusinessPlaceholder title="Inventory Overview" testid="panel-inventory-overview" />
        <BusinessPlaceholder title="TradeNet Exchange" testid="panel-tradenet-exchange" />

        <BusinessPlaceholder title="Orders & Pipeline" testid="panel-orders-pipeline" />
        <BusinessPlaceholder title="Portfolio Snapshot" testid="panel-portfolio-snapshot" />
        <div className="xl:col-span-1"><UnitConverterPanel /></div>
        <BusinessPlaceholder title="Crypto Wallet" testid="panel-crypto-wallet" />

        <div className="xl:col-span-2"><BusinessPlaceholder title="Financial Overview" testid="panel-financial-overview" /></div>
        <div className="xl:col-span-2"><BusinessPlaceholder title="Social & Inbox" testid="panel-social-inbox" /></div>
      </div>
    </div>
  );
}
