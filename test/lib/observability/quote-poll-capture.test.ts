// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@/store/quotes", () => ({
  useQuotes: (selector: (s: { ingest: () => void }) => unknown) =>
    selector({ ingest: () => {} }),
}));
vi.mock("@/hooks/useSetting", () => ({
  useSetting: () => 15,
}));

import { useQuotesPoll } from "@/hooks/useQuotesPoll";

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

async function advanceTicks(n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      // Flush multiple microtask rounds to drain the async fetch chain
      // (fetch → ok check → json → ingest is 3+ awaits deep).
      for (let j = 0; j < 5; j++) await Promise.resolve();
    });
  }
}

describe("useQuotesPoll — threshold-5 Sentry capture", () => {
  it("does not capture on 4 consecutive failures", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    const Sentry = await import("@sentry/nextjs");
    renderHook(() => useQuotesPoll());
    // First tick fires immediately on mount. Then 3 more via the interval.
    await act(async () => { for (let j = 0; j < 5; j++) await Promise.resolve(); });
    await advanceTicks(3); // 1 immediate + 3 timer ticks = 4 failures total
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("captures exactly once on the 5th consecutive failure", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    const Sentry = await import("@sentry/nextjs");
    renderHook(() => useQuotesPoll());
    await act(async () => { for (let j = 0; j < 5; j++) await Promise.resolve(); });
    await advanceTicks(4); // 5 failures total
    // TODO(slice-11 review): plan used `waitFor`, but waitFor uses real timers
    // and we're in vi.useFakeTimers() mode — waitFor never sees the assertion
    // succeed because the microtask flush already happened inside advanceTicks.
    // Asserting synchronously after the explicit microtask drain is functionally
    // equivalent.
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toMatch(/5 consecutive/);
    expect(call[1].tags.layer).toBe("client-poll");
  });

  it("captures captureException when the fetch itself throws", async () => {
    global.fetch = vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    const Sentry = await import("@sentry/nextjs");
    renderHook(() => useQuotesPoll());
    await act(async () => { for (let j = 0; j < 5; j++) await Promise.resolve(); });
    await advanceTicks(4);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.layer).toBe("client-poll");
  });

  it("a single success between failures resets the counter (no capture at the 5th overall fail)", async () => {
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount += 1;
      // Fail, fail, fail, fail, SUCCEED, fail, fail = 7 total, but counter reset at 5
      if (callCount === 5) return { ok: true, status: 200, json: async () => ({ quotes: [] }) } as unknown as Response;
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const Sentry = await import("@sentry/nextjs");
    renderHook(() => useQuotesPoll());
    await act(async () => { for (let j = 0; j < 5; j++) await Promise.resolve(); });
    await advanceTicks(6); // 7 ticks total — only 2 consecutive failures at the end
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
