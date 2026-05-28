import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultLayout, getEffectiveLayout } from "@/lib/layout/registry";
import type { LayoutItem, PanelSize } from "@/lib/layout/types";

export type Density = "compact" | "comfortable";
export interface Settings {
  amoled: boolean;
  reduceMotion: boolean;
  goldIntensity: number;
  uiScale: number;
  density: Density;
  refreshSeconds: number;
  hiddenPanels: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  amoled: false,
  reduceMotion: false,
  goldIntensity: 0.8,
  uiScale: 1,
  density: "comfortable",
  refreshSeconds: 15,
  hiddenPanels: [],
};

interface SettingsState {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;

  // Layout customization
  editMode: boolean;
  dashboardLayout: LayoutItem[] | null;
  setEditMode: (on: boolean) => void;
  reorderLayout: (fromId: string, toId: string) => void;
  setPanelSize: (id: string, size: PanelSize) => void;
  togglePanelHidden: (id: string) => void;
  resetLayout: () => void;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

// silence "unused" lint while keeping defaultLayout imported (still used by tests)
void defaultLayout;

export const useSettings = create<SettingsState>()(
  persist(
    (setState) => ({
      settings: { ...DEFAULT_SETTINGS },
      set: (key, value) =>
        setState((state) => {
          const next = { ...state.settings, [key]: value };
          if (key === "refreshSeconds") next.refreshSeconds = clamp(next.refreshSeconds, 5, 600);
          if (key === "uiScale") next.uiScale = clamp(next.uiScale, 0.8, 1.25);
          if (key === "goldIntensity") next.goldIntensity = clamp(next.goldIntensity, 0, 1);
          return { settings: next };
        }),

      editMode: false,
      dashboardLayout: null,
      setEditMode: (on) => setState({ editMode: on }),

      reorderLayout: (fromId, toId) =>
        setState((state) => {
          const base = getEffectiveLayout(state.dashboardLayout);
          const fromIdx = base.findIndex((i) => i.id === fromId);
          const toIdx = base.findIndex((i) => i.id === toId);
          if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return state;
          const next = [...base];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return { dashboardLayout: next };
        }),

      setPanelSize: (id, size) =>
        setState((state) => {
          const base = getEffectiveLayout(state.dashboardLayout);
          return { dashboardLayout: base.map((i) => (i.id === id ? { ...i, size } : i)) };
        }),

      togglePanelHidden: (id) =>
        setState((state) => {
          const base = getEffectiveLayout(state.dashboardLayout);
          return { dashboardLayout: base.map((i) => (i.id === id ? { ...i, hidden: !i.hidden } : i)) };
        }),

      resetLayout: () => setState({ dashboardLayout: null }),
    }),
    {
      name: "ccc-settings",
      // editMode is transient — don't persist it.
      partialize: (state) => ({
        settings: state.settings,
        dashboardLayout: state.dashboardLayout,
      }) as Partial<SettingsState>,
    }
  )
);
