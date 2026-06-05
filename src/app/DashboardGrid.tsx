"use client";
import { useCallback, useMemo } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, rectSortingStrategy,
} from "@dnd-kit/sortable";
import { KpiTicker } from "@/components/market/KpiTicker";
import type { PanelSize, InventoryView, DiamondView, DealView, WebsiteOverviewView, ProviderStatusView, TodaysBidsView } from "@/lib/layout/types";
import { getPanel, getEffectiveLayout } from "@/lib/layout/registry";
import { useSettings } from "@/store/settings";
import { SortablePanel } from "@/components/dashboard/SortablePanel";
import { LayoutEditBar } from "@/components/dashboard/LayoutEditBar";

// Re-export the view types so callers that previously imported them from
// DashboardGrid (e.g. page.tsx) keep working without an extra import path.
export type { InventoryView, DiamondView, DealView, WebsiteOverviewView, ProviderStatusView, TodaysBidsView } from "@/lib/layout/types";

const NEXT_SIZE: Record<PanelSize, PanelSize> = { 1: 2, 2: 4, 4: 1 };

export function DashboardGrid({
  inventory, diamond, deals, website, providerStatus, todaysBids,
}: {
  inventory?: InventoryView;
  diamond?: DiamondView;
  deals?: DealView;
  website?: WebsiteOverviewView;
  providerStatus?: ProviderStatusView;
  todaysBids?: TodaysBidsView;
}) {
  const editMode = useSettings((s) => s.editMode);
  const persisted = useSettings((s) => s.dashboardLayout);
  const reorderLayout = useSettings((s) => s.reorderLayout);
  const setPanelSize = useSettings((s) => s.setPanelSize);
  const togglePanelHidden = useSettings((s) => s.togglePanelHidden);

  const layout = useMemo(() => getEffectiveLayout(persisted), [persisted]);
  const visible = useMemo(() => layout.filter((i) => !i.hidden), [layout]);
  // Memoize so panel children don't reconcile on every store change.
  const ctx = useMemo(
    () => ({ inventory, diamond, deals, website, providerStatus, todaysBids }),
    [inventory, diamond, deals, website, providerStatus, todaysBids],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorderLayout(String(active.id), String(over.id));
  }, [reorderLayout]);

  // Render the grid (same JSX in both modes). In edit mode we wrap it in
  // dnd-kit context so the spec's "zero drag-machinery cost outside edit mode"
  // promise is real — no sensors, no collision detector, no SortableContext
  // when the user isn't customizing.
  const grid = (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
      {visible.map((item) => {
        const panel = getPanel(item.id);
        if (!panel) return null;
        return (
          <SortablePanel
            key={item.id}
            id={item.id}
            size={item.size}
            editMode={editMode}
            onCycleSize={() => setPanelSize(item.id, NEXT_SIZE[item.size])}
            onToggleHidden={() => togglePanelHidden(item.id)}
          >
            {panel.render(ctx)}
          </SortablePanel>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="dashboard-root">
      <KpiTicker diamond={diamond?.kpis} />
      <LayoutEditBar />
      {editMode ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((i) => i.id)} strategy={rectSortingStrategy}>
            {grid}
          </SortableContext>
        </DndContext>
      ) : grid}
    </div>
  );
}
