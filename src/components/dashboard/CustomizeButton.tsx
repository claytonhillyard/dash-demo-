"use client";
import { useSettings } from "@/store/settings";

export function CustomizeButton() {
  const editMode = useSettings((s) => s.editMode);
  const setEditMode = useSettings((s) => s.setEditMode);
  return (
    <button
      onClick={() => setEditMode(!editMode)}
      className={`rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-widest transition-colors ${
        editMode ? "bg-gold/20 text-gold border-gold/40" : "text-text/60 hover:text-gold hover:border-gold/40"
      }`}
      type="button"
      aria-label={editMode ? "Done customizing layout" : "Customize layout"}
    >
      {editMode ? "✓ Done" : "Customize"}
    </button>
  );
}
