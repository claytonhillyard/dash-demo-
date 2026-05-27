import { describe, it, expect, afterEach, vi } from "vitest";
import { isDemoMode } from "@/lib/demo/mode";

afterEach(() => vi.unstubAllEnvs());

describe("isDemoMode", () => {
  it("is false by default", () => {
    expect(isDemoMode()).toBe(false);
  });
  it("is true when NEXT_PUBLIC_DEMO_MODE === 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(isDemoMode()).toBe(true);
  });
  it("is false for any other value", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "1");
    expect(isDemoMode()).toBe(false);
  });
});
