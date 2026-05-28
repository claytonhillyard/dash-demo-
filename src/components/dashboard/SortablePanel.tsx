"use client";
import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PanelSize } from "@/lib/layout/types";

const COL_SPAN: Record<PanelSize, string> = {
  1: "xl:col-span-1",
  2: "xl:col-span-2",
  4: "xl:col-span-4",
};

export function SortablePanel({
  id, size, editMode, onCycleSize, onToggleHidden, children,
}: {
  id: string;
  size: PanelSize;
  editMode: boolean;
  onCycleSize: () => void;
  onToggleHidden: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !editMode });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${COL_SPAN[size]} relative ${editMode ? "ring-1 ring-gold/30 rounded-xl" : ""}`}
    >
      {editMode && (
        <div className="absolute -top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-border bg-surface-2/90 px-1.5 py-0.5 text-[10px] backdrop-blur">
          <button
            {...attributes}
            {...listeners}
            aria-label={`Move panel ${id}`}
            className="cursor-grab px-1 text-text/60 hover:text-gold active:cursor-grabbing"
            type="button"
          >
            ⠿
          </button>
          <button
            aria-label={`Cycle size ${id}`}
            onClick={onCycleSize}
            className="px-1 text-text/60 hover:text-gold"
            type="button"
          >
            ↔ {size}
          </button>
          <button
            aria-label={`Hide panel ${id}`}
            onClick={onToggleHidden}
            className="px-1 text-text/60 hover:text-bad"
            type="button"
          >
            ✕
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
