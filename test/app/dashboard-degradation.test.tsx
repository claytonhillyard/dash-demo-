import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";

afterEach(() => vi.unstubAllEnvs());

// Mocked once for the whole file: src/app/safePanel.ts (unit tests below)
// AND src/app/page.tsx (integration test below, which now calls into
// safePanel) both import @sentry/nextjs, so one mock covers both.
// vi.hoisted is required here: vi.mock factories are hoisted above normal
// top-level consts, so a plain `const captureException = vi.fn()` referenced
// inside the factory below would throw "Cannot access before initialization".
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

// Integration-test harness: same demo-mode RSC shape as
// test/app/dashboard-page.test.tsx (slice 33) — stub the auth/db seams and
// force getActiveDeals -> [] so none of the per-deal readers fire.
// getReceivablesRows is additionally forced to reject here, to prove the
// PAGE degrades instead of 500ing when one panel reader throws (not just
// the safePanel helper in isolation, covered separately below).
vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
vi.mock("@/lib/deals/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/deals/queries")>();
  return { ...actual, getActiveDeals: vi.fn(async () => []) };
});
vi.mock("@/db/runway", async (importActual) => {
  const actual = await importActual<typeof import("@/db/runway")>();
  return {
    ...actual,
    getReceivablesRows: vi.fn(async () => {
      throw new Error("receivables reader exploded");
    }),
  };
});

import { safePanel } from "@/app/safePanel";
import Home from "@/app/page";

beforeEach(() => {
  captureException.mockClear();
});

describe("safePanel", () => {
  it("passes the resolved value through untouched and never calls Sentry", async () => {
    const result = await safePanel("widget", Promise.resolve({ ok: true }), { ok: false });

    expect(result).toEqual({ ok: true });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns the fallback and Sentry-captures the error tagged with the panel label when the promise rejects", async () => {
    const boom = new Error("boom");

    const result = await safePanel("widget", Promise.reject(boom), { ok: false });

    expect(result).toEqual({ ok: false });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(boom, {
      tags: { area: "dashboard-panel", panel: "widget" },
    });
  });
});

describe("/ dashboard RSC — panel degradation (C-7)", () => {
  it("still renders the dashboard (and Sentry-captures the failure) when getReceivablesRows rejects", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    const html = renderToString(await Home());

    // The whole page rendered rather than throwing — the core degradation
    // claim. The cash/receivables panel shell is still present even though
    // its data degraded to the empty fallback.
    expect(html).toMatch(/Cash (&amp;|&) Receivables/);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { area: "dashboard-panel", panel: "receivablesRows" },
    });
  });
});
