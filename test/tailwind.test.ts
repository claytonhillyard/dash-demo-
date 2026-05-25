import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
  it("defines category accent tokens used by AIYA charts", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("--accent-purple");
    expect(css).toContain("--accent-blue");
    expect(css).toContain("--accent-pink");
  });
});
