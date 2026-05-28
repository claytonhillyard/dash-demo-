import { describe, it, expect } from "vitest";
import { PANEL_REGISTRY, getEffectiveLayout, defaultLayout } from "@/lib/layout/registry";

describe("panel registry + effective layout", () => {
  it("exports a registry of dashboard panels (id, title, defaultSize, render)", () => {
    expect(PANEL_REGISTRY.length).toBeGreaterThan(5);
    for (const p of PANEL_REGISTRY) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.title).toBe("string");
      expect([1, 2, 4]).toContain(p.defaultSize);
      expect(typeof p.render).toBe("function");
    }
  });

  it("default layout matches the registry in order, default size, none hidden", () => {
    const def = defaultLayout();
    expect(def.map((i) => i.id)).toEqual(PANEL_REGISTRY.map((p) => p.id));
    expect(def.every((i) => !i.hidden)).toBe(true);
  });

  it("getEffectiveLayout(null) returns the default", () => {
    expect(getEffectiveLayout(null)).toEqual(defaultLayout());
  });

  it("getEffectiveLayout reconciles: drops unknown ids, appends new registry panels at the end", () => {
    const partial = [
      { id: "price-trend", size: 4 as const, hidden: false },
      { id: "unknown-ghost", size: 1 as const, hidden: false },
    ];
    const eff = getEffectiveLayout(partial);
    expect(eff[0]).toEqual({ id: "price-trend", size: 4, hidden: false });
    expect(eff.find((i) => i.id === "unknown-ghost")).toBeUndefined();
    const ids = eff.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PANEL_REGISTRY) expect(ids).toContain(p.id);
  });
});
