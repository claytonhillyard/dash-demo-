import type { SharedInventoryRow } from "@/db/inventory";
import { Panel } from "@/components/Panel";
import { timeAgo } from "@/lib/company/format";

export function TradeNetInventoryPanel({ items }: { items: SharedInventoryRow[] }) {
  if (items.length === 0) {
    return (
      <Panel title="TradeNet Inventory" state="ready">
        <p className="text-sm text-text/40">No partner inventory shared with you yet.</p>
      </Panel>
    );
  }
  return (
    <Panel title="TradeNet Inventory" state="ready">
      <ul className="divide-y divide-text/10 text-sm">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 py-2">
            <span className="text-[10px] uppercase tracking-wider text-text/40">{it.category}</span>
            <span className="flex-1 truncate text-text/80" title={it.name}>{it.name}</span>
            <span className="text-text/60">×{it.quantity}</span>
            <span className="text-[10px] text-text/40" title={`Posted by ${it.ownerOrgLabel}`}>
              {it.ownerOrgLabel}
            </span>
            <span className="text-[10px] text-text/40">{timeAgo(it.updatedAt)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
