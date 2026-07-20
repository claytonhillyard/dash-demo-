// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";

// Demo-mode short-circuit (getInvoiceById already serves DEMO_INVOICES without
// touching the db — same harness shape as test/app/invoices-pages.test.tsx):
// stub the env var, and mock ensureDbReady to a fake object so a real pglite
// never boots for these tests. requireSession is only exercised by the
// live-mode auth test below (getCurrentOrgId's demo branch short-circuits
// before ever calling it, so the mock is inert for the demo-mode tests).
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => vi.clearAllMocks());

vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import { requireSession } from "@/lib/auth/requireSession";
import { GET, sanitizePdfFilename } from "@/app/(admin)/invoices/[id]/pdf/route";

function callRoute(id: string) {
  return GET(new Request(`http://localhost/invoices/${id}/pdf`), {
    params: Promise.resolve({ id }),
  });
}

function pdfMagicBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.slice(0, 5)).toString("utf-8");
}

// DEMO_INVOICES (src/lib/demo/seed.ts): 9302 issued/INV-2026-0001,
// 9301 draft/INV-2026-0003 — both under org 1 (DEMO_AIYA_ORG_ID).
describe("GET /invoices/[id]/pdf — demo mode", () => {
  it("serves a valid, correctly-headered PDF for seed 9302 (issued)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute("9302");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="INV-2026-0001.pdf"',
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(pdfMagicBytes(bytes)).toBe("%PDF-");
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it("404s for an id that doesn't exist", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute("999999");
    expect(res.status).toBe(404);
  });

  it("renders the draft banner path for seed 9301 without error", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute("9301");
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(pdfMagicBytes(bytes)).toBe("%PDF-");
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it("404s for a non-numeric id", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute("abc");
    expect(res.status).toBe(404);
  });
});

describe("GET /invoices/[id]/pdf — auth", () => {
  it("401s when there is no valid session (live mode)", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await callRoute("9302");
    expect(res.status).toBe(401);
  });
});

describe("sanitizePdfFilename", () => {
  it("strips double quotes and CR/LF from an invoice number", () => {
    expect(sanitizePdfFilename('INV"2026\r\n-0001')).toBe("INV2026-0001");
  });

  it("leaves an ordinary invoice number untouched", () => {
    expect(sanitizePdfFilename("INV-2026-0001")).toBe("INV-2026-0001");
  });
});
