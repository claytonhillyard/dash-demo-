// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

// Scaffolding copied from test/app/activity-page.test.tsx / test/app/
// customer-edit-activity.test.tsx. The import page itself needs neither a db
// connection nor an org id (spec §6 / task 26-4: "NO db fetch needed — the
// wizard is self-contained"), but ImportWizard is a client component that
// calls useRouter() — that mock IS required, same reason
// customer-edit-activity.test.tsx mocks it for CustomerForm. The
// getCurrentOrgId/db/client mocks are harmless no-ops kept for scaffolding
// consistency with the rest of test/app/.
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ImportCustomersPage from "@/app/(admin)/customers/import/page";

describe("/customers/import RSC", () => {
  it("renders the page title", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await ImportCustomersPage());
    expect(html).toContain("Import customers");
  });

  it("renders the wizard's file input", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await ImportCustomersPage());
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".csv,text/csv"');
  });

  it("renders a back link to /customers", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await ImportCustomersPage());
    expect(html).toContain('href="/customers"');
  });

  it("also renders outside demo mode (no db/session touched at render time)", async () => {
    const html = renderToString(await ImportCustomersPage());
    expect(html).toContain("Import customers");
  });
});
