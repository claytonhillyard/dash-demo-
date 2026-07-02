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
