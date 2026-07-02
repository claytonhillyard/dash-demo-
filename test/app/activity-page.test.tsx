// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

// getOrgActivity short-circuits to DEMO_ACTIVITY when isDemoMode() is true —
// stub the env var so the page exercises that path without touching the db.
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));

import ActivityPage from "@/app/(admin)/activity/page";

function renderPage(params: Record<string, string | string[] | undefined> = {}) {
  return ActivityPage({ searchParams: Promise.resolve(params) });
}

describe("/activity RSC", () => {
  it("default render shows demo activity in demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage());
    expect(html).toContain("Added Priya Mehta");
  });

  it("type=customer still shows customer rows", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage({ type: "customer" }));
    expect(html).toContain("Added Priya Mehta");
  });

  it("type=deal shows the empty state (DEMO_ACTIVITY is all customer events)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage({ type: "deal" }));
    expect(html).toContain("No activity yet.");
    expect(html).not.toContain("Added Priya Mehta");
  });

  it("before=9003 excludes ids >= 9003", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage({ before: "9003" }));
    // id 9003 ("Added Anita Sharma") and everything after it must be gone.
    expect(html).not.toContain("Added Anita Sharma");
    // ids 9001 and 9002 are < 9003 and must still be present.
    expect(html).toContain("Added Priya Mehta");
    expect(html).toContain("Added Jean-Marc Auclair");
  });

  it("an invalid type value renders as All", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage({ type: "bogus" }));
    expect(html).toContain("Added Priya Mehta");
  });
});
