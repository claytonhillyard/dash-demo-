import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

// Unlike the other test/app/*.test.tsx pages (which stay on the Node-only
// environment override), this file renders the FULL dashboard grid, which
// pulls in the zustand-persisted settings store and dnd-kit's sortable
// sensors — both want real DOM globals (window/localStorage) available at
// import/setup time. So this file relies on the suite's default DOM-backed
// test environment instead. renderToString itself never fires effects
// (client-side fetches, chart mounts, drag-sensor setup) regardless of
// environment, so this stays just as fast/deterministic as its siblings —
// same harness shape as test/app/invoices-pages.test.tsx / activity-page.test.tsx
// otherwise (env-var demo mode + minimal mocks + renderToString).
afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
// getActiveDeals itself is demo-mode-safe, but several of the PER-DEAL
// readers page.tsx then calls (e.g. getDealThreadModeForOwner in
// src/db/dealMessages.ts) are deliberately NOT demo-gated — their own
// docblocks say so, because the real deployment's "demo mode" runs against
// an actually-seeded Postgres, not a fully mocked db. That's out of scope
// for this slice, so return zero demo deals here (spread the real module
// via importActual so nothing else this file exports is disturbed) — with
// no deal ids, none of those per-deal readers are ever called.
vi.mock("@/lib/deals/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/deals/queries")>();
  return { ...actual, getActiveDeals: vi.fn(async () => []) };
});

import Home from "@/app/page";
import { getReceivablesRows, getTrailingProfitMonths } from "@/db/runway";
import { computeReceivablesAging, computeRunway } from "@/lib/runway/compute";
import { formatCentsExact } from "@/lib/company/format";

describe("/ dashboard RSC — cash & receivables panel (slice 33-3)", () => {
  it("renders the panel with seed-derived receivables and burn figures", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    // Derive the expected figures from the SAME reader + compute pipeline
    // src/app/page.tsx uses (the `db` argument is unused on the demo-mode
    // short-circuit branch of both readers) rather than a hardcoded
    // literal, so this can't silently drift from the seed.
    const rows = await getReceivablesRows({} as never, 1);
    const todayUtc = new Date().toISOString().slice(0, 10);
    const aging = computeReceivablesAging(rows, todayUtc);
    const profitMonths = await getTrailingProfitMonths({} as never, 6);
    const runway = computeRunway({
      trailingProfitCents: profitMonths,
      receivablesTotalCents: aging.totalCents,
    });
    // Sanity: the demo trailing-profit trend is an authored net burn
    // (src/db/runway.ts's DEMO_MONTHLY_BURN_BASE_CENTS), so this must be
    // "burning", not "cash_positive" or "insufficient_history" — if it
    // isn't, the assertions below would be vacuous.
    expect(runway.kind).toBe("burning");

    const html = renderToString(await Home());

    expect(html).toMatch(/Cash (&amp;|&) Receivables/);
    expect(html).toContain(formatCentsExact(aging.totalCents));
    if (runway.kind === "burning") {
      expect(html).toContain(formatCentsExact(runway.avgMonthlyBurnCents));
    }
  });
});
