import { Shell } from "@/components/dashboard/Shell";
import { Panel } from "@/components/Panel";

export default function Home() {
  return (
    <Shell>
      <div className="grid grid-cols-4 gap-3" data-testid="dashboard-root">
        <Panel title="Company Overview" state="unwired" />
        <Panel title="Revenue Projections" state="unwired" />
        <Panel title="Work Orders" state="unwired" />
        <Panel title="Client Satisfaction" state="unwired" />
      </div>
    </Shell>
  );
}
