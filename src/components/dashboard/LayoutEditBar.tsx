"use client";
import { useSettings } from "@/store/settings";

export function LayoutEditBar() {
  const editMode = useSettings((s) => s.editMode);
  const resetLayout = useSettings((s) => s.resetLayout);
  if (!editMode) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border border-gold/30 bg-gold/5 px-3 py-1.5 text-xs text-text/70">
      <span><span className="text-gold">Customize layout</span> — drag to reorder · resize · hide</span>
      <button
        type="button"
        onClick={resetLayout}
        className="text-[11px] uppercase tracking-widest text-text/50 hover:text-gold"
      >
        Reset to default
      </button>
    </div>
  );
}
