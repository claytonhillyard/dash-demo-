import Link from "next/link";
import { Panel } from "@/components/Panel";
import { formatCents, timeAgo } from "@/lib/company/format";
import type { DealRow } from "@/lib/deals/queries";
import type { DealKind } from "@/lib/deals/constants";

// Fixed lookup so user input never reaches a className expression.
const KIND_CLASS: Record<DealKind, string> = {
  BUY: "text-ok",
  SELL: "text-gold",
};

export function DealRoomPanel({ deals }: { deals: DealRow[] }) {
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
      <ul className="divide-y divide-text/10 text-sm">
        {deals.map((d) => (
          <li key={d.id} className="flex items-center gap-2 py-2">
            <span className={`font-mono text-[10px] uppercase tracking-wider ${KIND_CLASS[d.kind]}`}>
              {d.kind}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-text/40">{d.category}</span>
            <span className="flex-1 truncate text-text/80" title={d.subject}>{d.subject}</span>
            <span className="font-mono text-text">{formatCents(d.priceCents)}</span>
            <span className="text-[10px] text-text/40">{timeAgo(d.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
