// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(),
}));

import { getCurrentOrgId, DEMO_ORG_ID } from "@/lib/auth/getCurrentOrgId";
import { requireSession } from "@/lib/auth/requireSession";

const mockedRequire = requireSession as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllEnvs();
  mockedRequire.mockReset();
});

describe("getCurrentOrgId", () => {
  it("returns DEMO_ORG_ID (= 1) in demo mode without calling requireSession", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(await getCurrentOrgId()).toBe(DEMO_ORG_ID);
    expect(DEMO_ORG_ID).toBe(1);
    expect(mockedRequire).not.toHaveBeenCalled();
  });

  it("returns session.orgId outside demo mode", async () => {
    mockedRequire.mockResolvedValueOnce({ user: "boss", orgId: 7 });
    expect(await getCurrentOrgId()).toBe(7);
  });

  it("throws Unauthorized when requireSession() rejects (outside demo)", async () => {
    mockedRequire.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(getCurrentOrgId()).rejects.toThrow(/unauthorized/i);
  });

  it("demo guard takes precedence over auth", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    mockedRequire.mockRejectedValueOnce(new Error("Unauthorized"));
    // Even though requireSession would throw, demo short-circuit wins.
    expect(await getCurrentOrgId()).toBe(DEMO_ORG_ID);
    expect(mockedRequire).not.toHaveBeenCalled();
  });
});
