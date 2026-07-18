// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

// getInvoices/getInvoiceById/getCustomers all short-circuit to demo seed
// data when isDemoMode() is true — stub the env var so every page here
// exercises that path without touching the db. Same harness shape as
// test/app/activity-page.test.tsx / test/app/customer-edit-activity.test.tsx.
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
// InvoiceForm and InvoiceStatusActions are client components that call
// useRouter() — stub it the same way CustomerForm.test.tsx does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import InvoicesPage from "@/app/(admin)/invoices/page";
import NewInvoicePage from "@/app/(admin)/invoices/new/page";
import EditInvoicePage from "@/app/(admin)/invoices/[id]/edit/page";

function renderList(params: Record<string, string | string[] | undefined> = {}) {
  return InvoicesPage({ searchParams: Promise.resolve(params) });
}
function renderEdit(id: string) {
  return EditInvoicePage({ params: Promise.resolve({ id }) });
}

// DEMO_INVOICES (src/lib/demo/seed.ts): 9301 draft/INV-2026-0003/$13,483.80,
// 9302 issued/INV-2026-0001/$29,850.00, 9303 void/INV-2026-0002/$24,626.88 —
// all under org 1 (DEMO_AIYA_ORG_ID), matching the getCurrentOrgId mock above.
describe("/invoices RSC list", () => {
  it("renders the 3 demo seeds — numbers, formatted totals, and status texts", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderList());
    expect(html).toContain("INV-2026-0001");
    expect(html).toContain("INV-2026-0002");
    expect(html).toContain("INV-2026-0003");
    expect(html).toContain("$29,850.00");
    expect(html).toContain("$24,626.88");
    expect(html).toContain("$13,483.80");
    expect(html).toContain("Draft");
    expect(html).toContain("Issued");
    expect(html).toContain("Void");
  });

  it("?status=draft narrows the list to the single draft seed", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderList({ status: "draft" }));
    expect(html).toContain("INV-2026-0003");
    expect(html).not.toContain("INV-2026-0001");
    expect(html).not.toContain("INV-2026-0002");
  });

  it("an invalid status value falls back to All (all 3 seeds render)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderList({ status: "bogus" }));
    expect(html).toContain("INV-2026-0001");
    expect(html).toContain("INV-2026-0002");
    expect(html).toContain("INV-2026-0003");
  });

  it("renders the empty state + create link for an org with no seeded invoices", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    // Every DEMO_INVOICES row is org 1 (DEMO_AIYA_ORG_ID) — pointing at a
    // different org exercises the true zero-rows branch.
    vi.mocked(getCurrentOrgId).mockResolvedValueOnce(999);
    const html = renderToString(await renderList());
    expect(html).toContain("No invoices yet.");
    expect(html).toContain("Create your first invoice");
  });
});

describe("/invoices/new RSC", () => {
  it("renders the invoice form with the demo customers in the picker", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await NewInvoicePage());
    expect(html).toContain("Priya Mehta");
    expect(html).toContain("Create invoice");
  });
});

describe("/invoices/[id]/edit RSC", () => {
  it("draft invoice 9301 renders the InvoiceForm with Issue and Void actions", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderEdit("9301"));
    expect(html).toContain("Save changes");
    expect(html).toContain(">Issue<");
    expect(html).toContain(">Void<");
  });

  it("issued invoice 9302 renders read-only with a Void button and no form inputs", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderEdit("9302"));
    expect(html).not.toContain("<form");
    expect(html).toContain("Yuki Tanaka");
    expect(html).toContain("Fancy Yellow Round Diamond");
    expect(html).toContain("$29,850.00");
    expect(html).not.toContain(">Issue<");
    expect(html).toContain(">Void<");
  });

  it("void invoice 9303 renders the terminal note and no action buttons", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderEdit("9303"));
    expect(html).not.toContain("<form");
    expect(html).toContain("This invoice is void.");
    expect(html).toContain("Priya Mehta");
    expect(html).not.toContain("<button");
  });
});
