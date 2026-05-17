import { describe, it, expect } from "vitest";
import config from "../tailwind.config";

describe("tailwind tokens", () => {
  it("exposes nocturnal palette", () => {
    const colors = config.theme?.extend?.colors as Record<string, unknown>;
    expect(colors).toHaveProperty("gold");
    expect(colors).toHaveProperty("teal");
    expect(colors).toHaveProperty("surface");
  });
  it("scans src for classes", () => {
    expect(config.content).toContain("./src/**/*.{ts,tsx}");
  });
});
