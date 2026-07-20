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

  // Slice 28-4: Download PDF is a plain header link, present at every
  // status (draft included — proofreading a draft is legitimate, spec §8).
  it("the Download PDF link is present on both a draft and an issued edit page", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const draftHtml = renderToString(await renderEdit("9301"));
    const issuedHtml = renderToString(await renderEdit("9302"));
    expect(draftHtml).toContain('href="/invoices/9301/pdf"');
    expect(draftHtml).toContain("Download PDF");
    expect(issuedHtml).toContain('href="/invoices/9302/pdf"');
    expect(issuedHtml).toContain("Download PDF");
  });

  // SendInvoicePanel is issued-only (spec §6) — draft 9301 must not render it.
  it("the send panel renders for the issued invoice but not the draft", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const draftHtml = renderToString(await renderEdit("9301"));
    const issuedHtml = renderToString(await renderEdit("9302"));
    expect(issuedHtml).toContain("Send invoice");
    expect(draftHtml).not.toContain("Send invoice");
  });

  // Seed 9302 is the slice-28 "sent" example (src/lib/demo/seed.ts,
  // sentAt HOURS_AGO(2*24)/sentTo TANAKA_BILL_TO.email) — assert on the
  // "Last sent" line + recipient email, not a date string: seed dates are
  // wall-clock-relative (HOURS_AGO(...) off `new Date()`), so a hardcoded
  // date would be flaky. Note: the bill-to email already appears elsewhere
  // on this page (the read-only bill-to block), so "Last sent" is the part
  // that actually pins this down to the sent-state line, not a false
  // positive off the unrelated bill-to render.
  it("seed 9302's sent-state (recipient email) is visible on its edit page", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await renderEdit("9302"));
    expect(html).toContain("Last sent");
    expect(html).toContain("y.tanaka@ginzapearl.jp");
  });
});
