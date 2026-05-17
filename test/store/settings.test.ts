import { describe, it, expect, beforeEach } from "vitest";
import { useSettings, DEFAULT_SETTINGS } from "@/store/settings";

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
