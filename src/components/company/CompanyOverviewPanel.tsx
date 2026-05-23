import Link from "next/link";
import { Panel } from "@/components/Panel";
import { formatCents } from "@/lib/company/format";
import type { DashboardKpis } from "@/db/dashboard";

function Kpi({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <div className="text-text/50 text-xs uppercase tracking-wider">{label}</div>
      <div data-testid={testId} className="font-display text-lg text-text">
        {value}
      </div>
    </div>
  );
}

export function CompanyOverviewPanel({
  kpis,
  hasAnyData,
  updatedLabel,
}: {
  kpis: DashboardKpis;
  hasAnyData: boolean;
  updatedLabel: string | null;
}) {
  if (!hasAnyData) {
    return (
      <Panel title="Company Overview" state="ready">
        <p className="text-text/40 text-sm">
          No company data yet.{" "}
          <Link href="/company/revenue" className="text-gold underline">
            Add your first numbers
          </Link>
          .
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Company Overview" state="ready">
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Revenue MTD" value={formatCents(kpis.revenueCents)} />
        <Kpi label="Net Profit MTD" value={formatCents(kpis.profitCents)} />
        <Kpi label="Operating Margin" testId="kpi-margin" value={kpis.marginPct === null ? "—" : `${kpis.marginPct}%`} />
        <Kpi label="Clients (active/total)" value={`${kpis.activeClients}/${kpis.totalClients}`} />
        <Kpi label="Employees" value={String(kpis.employees)} />
      </div>
      {updatedLabel && <p className="text-text/40 mt-3 text-xs">{updatedLabel}</p>}
    </Panel>
  );
}
