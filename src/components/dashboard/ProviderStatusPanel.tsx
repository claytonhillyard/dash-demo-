import { FreshnessDot } from "@/components/FreshnessDot";
import type { ProviderHealth } from "@/lib/market/health";

export type ProviderStatusPanelProps = {
  rows: ProviderHealth[];
  /** True when the host environment is in demo mode — renders the row footnote.
   *  Threaded as a prop (not read from isDemoMode() inside) so the component is
   *  trivially testable without env mocking. The page-level wiring reads
   *  isDemoMode() once and passes it through. */
  demo: boolean;
};

/** Minimal human-readable elapsed-time string. The Provider Status panel only
 *  ever shows "X seconds/minutes/hours ago" or "never" — so we inline a tiny
 *  helper rather than depending on the slice-2 timeAgo (which lives next to
 *  the deal-room-specific formatting). */
function relativeTimeAgo(epochMs: number): string {
  const ageSec = Math.floor((Date.now() - epochMs) / 1000);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

export function ProviderStatusPanel({ rows, demo }: ProviderStatusPanelProps) {
  return (
    <div data-testid="panel-provider-status" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-text/80">Provider Status</h3>
      <ul className="flex flex-col gap-1">
        {rows.map((p) => (
          <li
            key={p.id}
            title={p.lastErrorMessage ?? undefined}
            className="flex items-center gap-2 text-xs"
          >
            <FreshnessDot freshness={p.freshness} />
            <span className="flex-1 truncate">{p.display}</span>
            <span className="font-mono text-[10px] text-text/60">
              {p.lastOkAt ? relativeTimeAgo(p.lastOkAt) : "never"}
            </span>
          </li>
        ))}
      </ul>
      {demo && (
        <p className="text-[10px] text-text/50 italic">
          Demo mode — no live providers in use.
        </p>
      )}
    </div>
  );
}
