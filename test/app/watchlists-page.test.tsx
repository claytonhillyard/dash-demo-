// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

// getWatchlistsForActor short-circuits to DEMO_WATCHLISTS when isDemoMode()
// is true — stub the env var so the page exercises that path without
// touching the db. Same harness shape as test/app/activity-page.test.tsx.
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
// UnwatchButton (rendered per row) is a client component that calls
// useRouter() — stub it the same way CustomerForm.test.tsx does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import WatchlistsPage from "@/app/(admin)/watchlists/page";

function renderPage() {
  return WatchlistsPage();
}

describe("/watchlists RSC", () => {
  it("renders both seeded watches with their notify emails, and no empty state", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage());
    expect(html).toContain("owner@aiya.demo");
    expect(html).not.toContain("No watches yet.");
  });

  it("links the customer entities to their edit pages", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage());
    expect(html).toContain("/customers/2201/edit");
    expect(html).toContain("/customers/2204/edit");
  });

  it("renders an Unwatch control per row", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage());
    const matches = html.match(/Unwatch/g) ?? [];
    expect(matches.length).toBe(2);
  });
});
