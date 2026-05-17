import { useSettings, type Settings } from "@/store/settings";

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSettings((s) => s.settings[key]);
}
