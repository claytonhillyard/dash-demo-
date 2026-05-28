import { describe, it, expect, beforeEach } from "vitest";
import { useSettings, DEFAULT_SETTINGS } from "@/store/settings";
import { defaultLayout } from "@/lib/layout/registry";

describe("settings store", () => {
  beforeEach(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS } }));

  it("has sane defaults", () => {
    const s = useSettings.getState().settings;
    expect(s.density).toBe("comfortable");
    expect(s.refreshSeconds).toBe(15);
    expect(s.amoled).toBe(false);
    expect(s.reduceMotion).toBe(false);
  });

  it("updates a single key without touching others", () => {
    useSettings.getState().set("amoled", true);
    const s = useSettings.getState().settings;
    expect(s.amoled).toBe(true);
    expect(s.density).toBe("comfortable");
  });

  it("clamps refreshSeconds to >= 5", () => {
    useSettings.getState().set("refreshSeconds", 1);
    expect(useSettings.getState().settings.refreshSeconds).toBe(5);
  });
});

describe("settings store — layout", () => {
  beforeEach(() => useSettings.setState({
    settings: { ...DEFAULT_SETTINGS },
    editMode: false,
    dashboardLayout: null,
  } as never));

  it("editMode is false by default and can be toggled", () => {
    expect(useSettings.getState().editMode).toBe(false);
    useSettings.getState().setEditMode(true);
    expect(useSettings.getState().editMode).toBe(true);
  });

  it("reorderLayout moves an item; first call materializes the default", () => {
    const def = defaultLayout();
    expect(useSettings.getState().dashboardLayout).toBeNull();
    useSettings.getState().reorderLayout(def[0].id, def[2].id);
    const layout = useSettings.getState().dashboardLayout!;
    expect(layout[2].id).toBe(def[0].id);
    expect(layout[0].id).toBe(def[1].id);
  });

  it("setPanelSize updates a panel's size", () => {
    useSettings.getState().setPanelSize("price-trend", 4);
    const layout = useSettings.getState().dashboardLayout!;
    expect(layout.find((i) => i.id === "price-trend")!.size).toBe(4);
  });

  it("togglePanelHidden flips the hidden flag", () => {
    useSettings.getState().togglePanelHidden("ai-insights");
    expect(useSettings.getState().dashboardLayout!.find((i) => i.id === "ai-insights")!.hidden).toBe(true);
    useSettings.getState().togglePanelHidden("ai-insights");
    expect(useSettings.getState().dashboardLayout!.find((i) => i.id === "ai-insights")!.hidden).toBe(false);
  });

  it("resetLayout clears to null (= use default)", () => {
    useSettings.getState().setPanelSize("price-trend", 4);
    useSettings.getState().resetLayout();
    expect(useSettings.getState().dashboardLayout).toBeNull();
  });
});
