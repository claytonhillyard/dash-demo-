import Link from "next/link";
import { Panel } from "@/components/Panel";
import { formatCents, timeAgo } from "@/lib/company/format";
import { formatDealVisibility } from "@/lib/deals/format";
import type { DealRow } from "@/lib/deals/queries";
import type { DealKind } from "@/lib/deals/constants";

// Fixed lookup so user input never reaches a className expression.
const KIND_CLASS: Record<DealKind, string> = {
  BUY: "text-ok",
  SELL: "text-gold",
};

/** Builds the panel subtitle. Driven by the viewer's circle map so the
 *  affordance is data-driven, not hardcoded. */
function circlesSubtitle(circleNamesById: Map<number, string>): string | null {
  if (circleNamesById.size === 0) return null;
  if (circleNamesById.size === 1) {
    // Mockup wording: "AIYA Trusted Partners (2 partner orgs)" — but we don't
    // have the member count cheaply here, so we render the circle name only.
    // The richer "N partner orgs" affordance ships in slice 4c with the
    // /circles route, where member counts are already loaded.
    const [name] = circleNamesById.values();
    return `Connected via ${name}`;
  }
  return `Connected to ${circleNamesById.size} circles`;
}

export function DealRoomPanel({
  deals,
  currentOrgId,
  circleNamesById,
}: {
  deals: DealRow[];
  currentOrgId: number;
  circleNamesById: Map<number, string>;
}) {
  const subtitle = circlesSubtitle(circleNamesById);

  if (deals.length === 0) {
    return (
      <Panel
        title="Deal Room"
        state="ready"
        action={
          <Link href="/deals" className="text-[10px] uppercase tracking-widest text-text/40 hover:text-gold">
            View all
          </Link>
        }
      >
        <div className="py-6 text-center text-sm text-text/40">
          No open deals — post one from the Deal Room.
        </div>
        {subtitle && (
          <div className="border-t border-text/10 pt-2 text-center text-[10px] uppercase tracking-widest text-text/40">
            {subtitle}
          </div>
        )}
      </Panel>
    );
  }
  return (
    <Panel
      title="Deal Room"
      state="ready"
      action={
        <Link href="/deals" className="text-[10px] uppercase tracking-widest text-text/40 hover:text-gold">
          View all
        </Link>
      }
    >
      {subtitle && (
        <div className="mb-1 text-[10px] uppercase tracking-widest text-text/40" data-testid="deal-room-circle-subtitle">
          {subtitle}
        </div>
      )}
      <ul className="divide-y divide-text/10 text-sm">
        {deals.map((d) => {
          const vis = formatDealVisibility(d.visibilityCircleId, circleNamesById);
          const isForeign = d.orgId !== currentOrgId;
          const badgeTooltip =
            vis.kind === "circle"
              ? isForeign
                ? `Shared by ${d.postedByLabel} via ${vis.circleName}`
                : `Shared with ${vis.circleName}`
              : undefined;
          return (
            <li key={d.id} className="flex items-center gap-2 py-2">
              <span className={`font-mono text-[10px] uppercase tracking-wider ${KIND_CLASS[d.kind]}`}>
                {d.kind}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-text/40">{d.category}</span>
              <span className="flex-1 truncate text-text/80" title={d.subject}>{d.subject}</span>
              {vis.kind === "circle" && (
                <span
                  className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80"
                  title={badgeTooltip}
                  data-testid="deal-visibility-badge"
                >
                  {vis.circleName}
                </span>
              )}
              <span className="font-mono text-text">{formatCents(d.priceCents)}</span>
              <span className="text-[10px] text-text/40">{timeAgo(d.createdAt)}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
