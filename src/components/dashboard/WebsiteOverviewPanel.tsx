import Link from "next/link";
import { Panel } from "@/components/Panel";
import { Sparkline } from "@/components/market/Sparkline";
import type { WebsiteSnapshotRow } from "@/db/website";
import { formatSessionDuration, weekOverWeekDelta } from "@/lib/website/format";

const NUM = new Intl.NumberFormat("en-US");

interface DeltaInfo {
  sign: "up" | "down" | "flat";
  percent: number;
}

function DeltaLine({ delta }: { delta: DeltaInfo | null }) {
  if (!delta) {
    return <div className="text-[10px] text-text/40">—</div>;
  }
  const color =
    delta.sign === "up" ? "text-ok" : delta.sign === "down" ? "text-bad" : "text-text/40";
  const arrow = delta.sign === "up" ? "▲" : delta.sign === "down" ? "▼" : "—";
  return (
    <div className={`text-[10px] ${color}`}>
      {arrow} {delta.percent.toFixed(1)}%
    </div>
  );
}

function KpiTile({
  testid, label, value, delta,
}: {
  testid: string;
  label: string;
  value: string;
  delta: DeltaInfo | null;
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-lg border border-border bg-surface-2/40 px-3 py-2"
    >
      <div className="text-[10px] uppercase tracking-wider text-text/50">{label}</div>
      <div className="font-mono text-base text-gold">{value}</div>
      <DeltaLine delta={delta} />
    </div>
  );
}

export function WebsiteOverviewPanel({
  latest, previous, trend, updatedLabel,
}: {
  latest: WebsiteSnapshotRow | null;
  previous: WebsiteSnapshotRow | null;
  trend: Array<{ weekStart: string; visitors: number } | WebsiteSnapshotRow>;
  updatedLabel: string | null;
}) {
  if (latest === null) {
    return (
      <Panel title="Website Overview" state="ready">
        <div className="py-6 text-center text-sm text-text/40">
          No website snapshots yet — record your first week in the{" "}
          <Link href="/website" className="text-gold underline">Website</Link>{" "}
          section.
        </div>
      </Panel>
    );
  }

  const visitorsDelta = previous ? weekOverWeekDelta(latest.visitors, previous.visitors) : null;
  const pageViewsDelta = previous ? weekOverWeekDelta(latest.pageViews, previous.pageViews) : null;
  const avgSessionDelta = previous
    ? weekOverWeekDelta(latest.avgSessionDurationSeconds, previous.avgSessionDurationSeconds)
    : null;
  const bounceDelta = previous
    ? weekOverWeekDelta(latest.bounceRatePercent, previous.bounceRatePercent)
    : null;

  const sparklinePoints = trend
    .map((t) => t.visitors)
    .slice()
    .reverse(); // oldest-first for natural left-to-right time progression

  // Provenance is rendered ONLY in the footer below (with the · owner-entered
  // suffix that is the honesty contract). The Panel `action` slot is left
  // empty here — the previous slice-5 prerelease had both, which double-rendered
  // updatedLabel in the DOM. Single source of truth: the footer.
  return (
    <Panel
      title="Website Overview"
      state="ready"
    >
      <div className="grid grid-cols-2 gap-2">
        <KpiTile
          testid="website-kpi-visitors"
          label="Visitors"
          value={NUM.format(latest.visitors)}
          delta={visitorsDelta}
        />
        <KpiTile
          testid="website-kpi-pageviews"
          label="Page Views"
          value={NUM.format(latest.pageViews)}
          delta={pageViewsDelta}
        />
        <KpiTile
          testid="website-kpi-avgsession"
          label="Avg Session"
          value={formatSessionDuration(latest.avgSessionDurationSeconds)}
          delta={avgSessionDelta}
        />
        <KpiTile
          testid="website-kpi-bounce"
          label="Bounce Rate"
          value={`${latest.bounceRatePercent}%`}
          delta={bounceDelta}
        />
      </div>
      {sparklinePoints.length > 1 && (
        <div className="mt-2" data-testid="sparkline-wrap">
          <Sparkline points={sparklinePoints} />
        </div>
      )}
      {previous === null && (
        <div className="mt-2 text-center text-[10px] text-text/40">
          <Link href="/website" className="hover:text-gold">Add another week →</Link>
        </div>
      )}
      {updatedLabel && (
        <div className="mt-2 text-right text-[10px] text-text/40">
          {updatedLabel} · owner-entered
        </div>
      )}
    </Panel>
  );
}
