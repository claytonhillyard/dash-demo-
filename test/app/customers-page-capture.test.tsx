// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

// getCustomers / getCustomerActivityStats both short-circuit to demo seed
// data when isDemoMode() is true — stub the env var so the page exercises
// that path without touching the db. Same harness shape as
// test/app/watchlists-page.test.tsx.
//
// Slice 38-3 wires an unconditional `await captureHealthSnapshots(...)` call
// into this page's render (right after the score map). captureHealthSnapshots
// checks `isDemoMode()` as its very FIRST statement (src/lib/sentinel/
// capture.ts) — before it ever touches `db` — so calling it here is safe even
// though `ensureDbReady` below resolves a fake `{}` object instead of a real
// connection. The "demo mode skips entirely, writes zero rows" behavior
// itself is already unit-covered directly in test/lib/sentinel/capture.test.ts
// ("demo mode: skips entirely, writes zero rows"); this file only proves the
// customers LIST page still renders correctly now that it calls capture on
// every render.
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));

import CustomersPage from "@/app/(admin)/customers/page";

function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  return CustomersPage({ searchParams: Promise.resolve(searchParams) });
}

describe("/customers RSC (list page + Sentinel capture wiring)", () => {
  it("renders in demo mode without throwing, including a known demo customer name", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    const html = renderToString(await renderPage());

    expect(html).toContain("Priya Mehta");
  });

  it("renders the table (not the empty state) alongside the unconditional capture call", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    const html = renderToString(await renderPage());

    expect(html).not.toContain("No customers yet.");
  });

  // Slice 26-4: "Import CSV" link added to the header next to "New customer".
  it("renders an Import CSV link next to New customer in the header", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    const html = renderToString(await renderPage());

    expect(html).toContain('href="/customers/import"');
    expect(html).toContain("Import CSV");
    expect(html).toContain('href="/customers/new"');
    expect(html).toContain("New customer");
  });
});
