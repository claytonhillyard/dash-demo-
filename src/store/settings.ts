import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Density = "compact" | "comfortable";
export interface Settings {
  amoled: boolean;
  reduceMotion: boolean;
  goldIntensity: number; // 0..1
  uiScale: number;       // 0.8..1.25
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
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

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
    }),
    { name: "ccc-settings" }
  )
);
