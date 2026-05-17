"use client";
import { useSettings } from "@/store/settings";
import { Panel } from "@/components/Panel";

export function SettingsPanel() {
  const { settings, set } = useSettings();
  return (
    <Panel title="Theme & Display" state="ready">
      <label className="flex items-center justify-between py-1 text-sm">
        AMOLED
        <input type="checkbox" checked={settings.amoled}
          onChange={(e) => set("amoled", e.target.checked)} />
      </label>
      <label className="flex items-center justify-between py-1 text-sm">
        Reduce motion
        <input type="checkbox" checked={settings.reduceMotion}
          onChange={(e) => set("reduceMotion", e.target.checked)} />
      </label>
      <label className="flex items-center justify-between py-1 text-sm">
        Density
        <select value={settings.density}
          onChange={(e) => set("density", e.target.value as "compact" | "comfortable")}>
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <label className="flex items-center justify-between py-1 text-sm">
        Refresh (s)
        <input type="number" min={5} value={settings.refreshSeconds}
          onChange={(e) => set("refreshSeconds", Number(e.target.value))} />
      </label>
    </Panel>
  );
}
