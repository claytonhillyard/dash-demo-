import type { SharedInventoryRow } from "@/db/inventory";
import { formatInventoryVisibility } from "@/lib/inventory/format";
import { timeAgo } from "@/lib/company/format";

export function TradeNetInventoryList({
  items, circleNamesById,
}: {
  items: SharedInventoryRow[];
  circleNamesById: Map<number, string>;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-text/40">No partner inventory shared with you yet.</p>
    );
  }
  return (
    <ul className="divide-y divide-text/10 text-sm">
      {items.map((it) => {
        const vis = formatInventoryVisibility(it.visibilityCircleId, circleNamesById);
        return (
          <li key={it.id} className="flex items-center gap-2 py-2">
            <span className="text-[10px] uppercase tracking-wider text-text/40">{it.category}</span>
            <span className="flex-1 truncate text-text/80" title={it.name}>{it.name}</span>
            <span className="text-text/60">×{it.quantity}</span>
            <span className="text-[10px] text-text/40">{it.ownerOrgLabel}</span>
            {vis.kind === "circle" && (
              <span
                className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80"
                title={`Shared via ${vis.circleName}`}
              >
                {vis.circleName}
              </span>
            )}
            <span className="text-[10px] text-text/40">{timeAgo(it.updatedAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}
