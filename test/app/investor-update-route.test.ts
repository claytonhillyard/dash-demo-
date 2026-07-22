// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";

// Demo-mode harness, same shape as test/app/invoice-pdf-route.test.ts, with
// one deliberate difference: `collectInvestorKpis` (src/lib/investor/
// collect.ts) is NOT fully demo-agnostic like `getInvoiceById` is — its own
// doc comments explain that `resolveOrgLabel` and the two legacy revenue/
// profit-month readers have NO demo branch (no org column / no PII to hide
// behind a synthetic dataset), so they touch `db` unconditionally even in
// demo mode. A bare `{}` (proven to throw "d.select is not a function" —
// see resolveOrgLabel, src/lib/auth/orgLabel.ts) isn't enough here. This
// minimal chainable stub mirrors exactly what the real ephemeral pglite the
// keyless demo deployment boots would return for those never-seeded legacy
// tables: `resolveOrgLabel` falls back to `Org ${orgId}` and the two month
// readers come back empty. Every OTHER reader collectInvestorKpis calls DOES
// demo-branch internally (getReceivablesRows, getTrailingProfitMonths, the
// month invoicing/collected/customer-total/health-mix readers) and never
// touches this object at all.
type EmptyChain = {
  from: () => EmptyChain;
  where: () => EmptyChain;
  orderBy: () => EmptyChain;
  limit: () => Promise<never[]>;
};
function emptySelectChain(): EmptyChain {
  const chain: EmptyChain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve([]),
  };
  return chain;
}

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => vi.clearAllMocks());

vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({ select: () => emptySelectChain() }) as never),
}));

// Mocked directly (rather than requireSession, contrast invoice-pdf-route.test.ts)
// so the 401 case below is a pure unit override — no session/JWT machinery
// needs to run for either branch.
vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));

// Wraps the real generateInvestorNarrative by default (so the demo-mode
// tests exercise the full real seam end-to-end, including the SIMULATED
// substitution) — only the narrative-failure test below overrides it with
// mockResolvedValueOnce. importActual keeps every other export (e.g.
// formatRunwayVerdict, which src/lib/investor/reportPdf.ts also imports from
// this same module) byte-identical to the real implementation.
vi.mock("@/lib/investor/narrative", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/investor/narrative")>();
  return { ...actual, generateInvestorNarrative: vi.fn(actual.generateInvestorNarrative) };
});

import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { generateInvestorNarrative } from "@/lib/investor/narrative";
import { GET } from "@/app/(admin)/company/investor-update/pdf/route";

function callRoute() {
  return GET();
}

function pdfMagicBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes.slice(0, 5)).toString("utf-8");
}

describe("GET /company/investor-update/pdf — demo mode", () => {
  it("serves a valid, correctly-headered PDF with the SIMULATED banner path exercised end-to-end", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="investor-update-\d{4}-\d{2}\.pdf"$/,
    );

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(pdfMagicBytes(bytes)).toBe("%PDF-");
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  it("sets Cache-Control: no-store", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("filenames with the current UTC year-month as investor-update-YYYY-MM.pdf", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    // Pin the ACTUAL current UTC month, not just the shape — a local-time
    // getMonth() regression would satisfy a \d{4}-\d{2} regex (review N4).
    const expectedYm = new Date().toISOString().slice(0, 7);
    expect(disposition).toContain(`investor-update-${expectedYm}.pdf`);
  });
});

describe("GET /company/investor-update/pdf — auth", () => {
  it("401s when getCurrentOrgId throws (no valid session)", async () => {
    vi.mocked(getCurrentOrgId).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await callRoute();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});

describe("GET /company/investor-update/pdf — narrative failure", () => {
  it("returns 503 JSON (never a broken PDF) when narrative generation fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    vi.mocked(generateInvestorNarrative).mockResolvedValueOnce({
      ok: false,
      error: "AI service is temporarily unavailable — try again shortly",
    });

    const res = await callRoute();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "AI service is temporarily unavailable — try again shortly" });
  });
});
