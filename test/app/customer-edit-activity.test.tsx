// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

// getCustomerById + getEntityActivity both short-circuit to demo seed data
// when isDemoMode() is true — stub the env var so the page exercises that
// path without touching the db.
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
// CustomerForm (rendered by the edit page) is a client component that calls
// useRouter() — stub it the same way test/components/customers/CustomerForm.test.tsx does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import EditCustomerPage from "@/app/(admin)/customers/[id]/edit/page";

function renderPage(id: string) {
  return EditCustomerPage({ params: Promise.resolve({ id }) });
}

describe("customer edit page — Activity section", () => {
  it("renders the Activity heading and both demo events for customer 2201", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage("2201"));
    expect(html).toContain("Activity");
    expect(html).toContain("Added Priya Mehta");
    expect(html).toContain("Updated Priya Mehta");
  });

  it("still renders the customer form (sanity check)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage("2201"));
    expect(html).toContain("Priya Mehta");
  });
});

// Slice 36-4: Health card. Demo mode routes getCustomerActivityStats through
// its in-memory DEMO_ACTIVITY branch and generateAiText through its demo
// short-circuit (isDemoMode() is checked before any gateway/env-key logic —
// see src/lib/ai/generateAiText.ts — so no AI mocking is needed here).
describe("customer edit page — Health card", () => {
  it("renders the Health heading and a numeric score for customer 2201", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage("2201"));
    expect(html).toContain("Health");
    // Extract the Health section (anchored on its own <h2>, through the next
    // closing </section>) and assert a 1-3 digit score renders inside it,
    // rather than asserting an exact value — the demo seed's activity
    // timestamps are relative to render time (HOURS_AGO helpers), so the
    // exact score can drift slightly with clock skew across test runs.
    const healthSectionMatch = html.match(/<h2[^>]*>Health<\/h2>[\s\S]*?<\/section>/);
    expect(healthSectionMatch).not.toBeNull();
    expect(healthSectionMatch![0]).toMatch(/\b\d{1,3}\b/);
  });

  it("renders a simulated AI insight paragraph in demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage("2201"));
    expect(html).toContain("[simulated]");
  });
});

// Slice 25-5: WatchToggle, fed by getWatchForEntity. Customer 2201 is watched
// in DEMO_WATCHLISTS (by "owner@aiya.demo") — the page must resolve that same
// actor string in demo mode so the toggle's initial state matches the seed.
describe("customer edit page — WatchToggle", () => {
  it("renders the Watching state for customer 2201 (seeded watch)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage("2201"));
    expect(html).toContain("Watching");
  });

  it("renders the unwatched state (email input + Watch button) for customer 2202 (no seeded watch)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage("2202"));
    expect(html).toContain("you@example.com");
    expect(html).not.toContain(">Watching<");
  });
});
