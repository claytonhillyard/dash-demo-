import { Panel } from "@/components/Panel";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";

const NUM = new Intl.NumberFormat("en-US");

export function InventoryOverviewPanel({
  counts, total, updatedLabel,
}: {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedLabel: string | null;
}) {
  if (total === 0) {
    return (
      <Panel title="Inventory Overview" state="ready">
        <div className="py-6 text-center text-sm text-text/40">
          No inventory yet — add items in the Inventory section.
        </div>
      </Panel>
    );
  }
  return (
    <Panel
      title="Inventory Overview"
      state="ready"
      action={updatedLabel ? <span className="text-[10px] text-text/40">{updatedLabel}</span> : undefined}
    >
      <div className="grid grid-cols-3 gap-2">
        {INVENTORY_CATEGORIES.map((c) => (
          <div
            key={c}
            data-testid={`inv-tile-${c}`}
            className="rounded-lg border border-border bg-surface-2/40 px-2 py-2 text-center"
          >
            <div className="font-mono text-base text-gold">{NUM.format(counts[c])}</div>
            <div className="text-[10px] uppercase tracking-wider text-text/50">{c}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right text-xs text-text/60">
        Total items: <span className="font-mono text-text">{NUM.format(total)}</span>
      </div>
    </Panel>
  );
}
