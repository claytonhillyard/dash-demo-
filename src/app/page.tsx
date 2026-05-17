import { Shell } from "@/components/dashboard/Shell";
import { Panel } from "@/components/Panel";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { MarketAnalysisPanel } from "@/components/market/MarketAnalysisPanel";

export default function Home() {
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <div className="grid grid-cols-4 gap-3" data-testid="dashboard-root">
          <div className="col-span-2"><MarketAnalysisPanel /></div>
          <Panel title="Company Overview" state="unwired" />
          <Panel title="Revenue Projections" state="unwired" />
          <Panel title="Work Orders" state="unwired" />
          <Panel title="Client Satisfaction" state="unwired" />
        </div>
      </Shell>
    </QuotesProvider>
  );
}
