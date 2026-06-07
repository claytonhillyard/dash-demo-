import type { SharedInventoryRow } from "@/db/inventory";
import type { InventoryBidView } from "@/db/inventoryBids";
import { formatInventoryVisibility } from "@/lib/inventory/format";
import { timeAgo } from "@/lib/company/format";

export function TradeNetInventoryList({
  items, circleNamesById, viewerOrgId, bidsByItemId, onPlaceBid,
}: {
  items: SharedInventoryRow[];
  circleNamesById: Map<number, string>;
  viewerOrgId: number;
  bidsByItemId: Map<number, InventoryBidView[]>;
  onPlaceBid: (item: SharedInventoryRow) => void;
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
            {it.status === "sold" ? (
              <span
                aria-label="sold badge"
                className="rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300"
              >
                Sold
              </span>
            ) : (
              it.bidMode !== null && it.orgId !== viewerOrgId && (
                <button
                  type="button"
                  onClick={() => onPlaceBid(it)}
                  className="rounded border border-gold/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold/80 hover:bg-gold/10"
                >
                  Place Bid
                  {(() => {
                    const pending = (bidsByItemId.get(it.id) ?? []).filter((b) => b.status === "pending").length;
                    return pending > 0 ? ` · ${pending} pending` : "";
                  })()}
                </button>
              )
            )}
            <span className="text-[10px] text-text/40">{timeAgo(it.updatedAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}
