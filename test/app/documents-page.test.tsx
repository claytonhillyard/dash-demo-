// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

// getDocuments short-circuits to DEMO_DOCUMENTS when isDemoMode() is true —
// stub the env var so this page test exercises that path without touching
// the db. Same harness shape as test/app/invoices-pages.test.tsx.
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
// DocumentUploadForm/DocumentDeleteButton are client components that call
// useRouter() — stub it the same way invoices-pages.test.tsx does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import DocumentsPage from "@/app/(admin)/documents/page";

function renderPage() {
  return DocumentsPage();
}

// DEMO_DOCUMENTS (src/lib/demo/seed.ts): 9601 "AIYA–Ginza Pearl NDA"
// (customer-linked), 9602 "Master Consignment Agreement" (org-level,
// application/pdf, 245_900 bytes), 9603 "2026 Insurance Certificate"
// (image/jpeg) — all org 1 (DEMO_AIYA_ORG_ID), matching the getCurrentOrgId
// mock above.
describe("/documents RSC vault page", () => {
  it("lists the seed documents with a title, docType badge, human size, and a download link", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage());

    expect(html).toContain("Master Consignment Agreement");
    expect(html).toContain("2026 Insurance Certificate");
    expect(html).toContain('href="/documents/9602/file"');
    // 9603's docType is "other" -> label "Other"; its title doesn't itself
    // contain that word, unlike 9601/9602 whose titles echo their own
    // docType label (NDA / Agreement) — a cleaner, unambiguous assertion
    // that the badge itself rendered.
    expect(html).toContain(">Other<");
    // 245_900 bytes -> 245900/1024 = 240.13... -> "240.1 KB".
    expect(html).toContain("240.1 KB");
  });

  it("renders the empty state for an org with no seeded documents", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    // Every DEMO_DOCUMENTS row is org 1 (DEMO_AIYA_ORG_ID) — pointing at a
    // different org exercises the true zero-rows branch.
    vi.mocked(getCurrentOrgId).mockResolvedValueOnce(999);
    const html = renderToString(await renderPage());
    expect(html).toContain("No documents yet");
  });

  it("renders the upload form", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderPage());
    expect(html).toContain("Upload document");
    expect(html).toContain('aria-label="document title"');
  });
});
