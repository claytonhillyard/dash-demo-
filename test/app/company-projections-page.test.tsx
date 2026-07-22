// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

// No existing test file covered /company/projections before this slice (grepped
// test/ for "projections" — only test/middleware.test.ts's matcher assertion
// turned up). Demo RSC harness per test/app/customers-import-page.test.tsx:
// renderToString + demo env + mocked ensureDbReady. ProjectionsAdmin (the
// page's existing client child, src/components/company/ProjectionsAdmin.tsx)
// calls useRouter() unconditionally, so that mock is required here too, same
// reason customer-edit-activity.test.tsx / invoice-import-page.test.tsx mock
// it for their own client children.
//
// The page's own db read is a plain drizzle `.select().from().orderBy()
// .limit()` (no demo branch — projection_assumptions is a normal multi-
// tenant-free settings table), so the fake `ensureDbReady` result needs to
// support that chain shape (a bare `{}` would throw "db.select is not a
// function"); resolving `.limit()` to `[]` gives `initial = null`, exactly
// like a fresh org with no saved projection yet.
afterEach(() => vi.unstubAllEnvs());

type EmptyChain = {
  from: () => EmptyChain;
  orderBy: () => EmptyChain;
  limit: () => Promise<never[]>;
};
function emptySelectChain(): EmptyChain {
  const chain: EmptyChain = {
    from: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve([]),
  };
  return chain;
}

vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({ select: () => emptySelectChain() }) as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ProjectionsPage from "@/app/(admin)/company/projections/page";

describe("/company/projections RSC — investor update card (slice 41-3)", () => {
  it("shows the Investor update card with its copy and a download link to the PDF route", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await ProjectionsPage());

    expect(html).toContain("Investor update");
    expect(html).toContain("One-page PDF: key metrics plus an AI-written narrative.");
    expect(html).toContain('href="/company/investor-update/pdf"');
    expect(html).toContain("Download PDF");
  });

  it("shows the muted AI-generated / simulated-without-a-key note", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await ProjectionsPage());

    expect(html).toContain("Narrative is AI-generated");
    expect(html).toContain("simulated without an AI key");
  });
});
