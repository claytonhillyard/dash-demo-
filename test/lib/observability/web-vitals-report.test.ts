import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Metric } from "web-vitals";

// Mock @sentry/nextjs so we can assert on .captureMessage.mock.calls.
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}));

import { reportWebVital } from "@/lib/observability/webVitals";
import * as Sentry from "@sentry/nextjs";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeMetric(over: Partial<Metric> = {}): Metric {
  return {
    name: "LCP",
    value: 1800,
    rating: "good",
    delta: 1800,
    id: "v3-1-test",
    entries: [],
    navigationType: "navigate",
    ...over,
  };
}

describe("reportWebVital — capture shape", () => {
  it("calls Sentry.captureMessage exactly once per invocation", () => {
    reportWebVital(makeMetric(), "/inventory");
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("uses level=info (vitals are events, not exceptions)", () => {
    reportWebVital(makeMetric(), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].level).toBe("info");
  });

  it("builds the message string from the metric name", () => {
    reportWebVital(makeMetric({ name: "LCP" }), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("web-vital LCP");
  });

  it("puts metric name, rating, and route in tags (the filterable axes)", () => {
    reportWebVital(
      makeMetric({ name: "LCP", rating: "good" }),
      "/inventory",
    );
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags).toEqual({
      metric: "LCP",
      rating: "good",
      route: "/inventory",
    });
  });

  it("puts value, delta, id, and navigationType in extras (not tags)", () => {
    reportWebVital(
      makeMetric({ value: 1800, delta: 1800, id: "v3-1-test", navigationType: "navigate" }),
      "/inventory",
    );
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].extra).toEqual({
      value: 1800,
      delta: 1800,
      id: "v3-1-test",
      navigationType: "navigate",
    });
  });

  it("does NOT forward metric.entries to Sentry (scrubber by omission)", () => {
    const entries = [{ name: "test-entry", entryType: "largest-contentful-paint" } as unknown as PerformanceEntry];
    reportWebVital(makeMetric({ entries }), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect("entries" in call[1].extra).toBe(false);
    expect(JSON.stringify(call[1])).not.toContain("largest-contentful-paint");
  });
});

describe("reportWebVital — rating passthrough", () => {
  it("passes rating='good' through verbatim", () => {
    reportWebVital(makeMetric({ name: "LCP", rating: "good" }), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.rating).toBe("good");
  });

  it("passes rating='needs-improvement' through verbatim (CLS example)", () => {
    reportWebVital(makeMetric({ name: "CLS", rating: "needs-improvement", value: 0.15 }), "/deals");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.rating).toBe("needs-improvement");
  });

  it("passes rating='poor' through verbatim (INP example)", () => {
    reportWebVital(makeMetric({ name: "INP", rating: "poor", value: 480 }), "/deals");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.rating).toBe("poor");
  });

  it("does NOT re-derive rating from value — uses metric.rating as source of truth", () => {
    // Construct a metric whose value/rating disagree (would never happen in real
    // web-vitals output, but guards against a future careless edit that recomputes).
    reportWebVital(
      makeMetric({ name: "LCP", value: 9999, rating: "good" }),
      "/inventory",
    );
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.rating).toBe("good");
  });
});

describe("reportWebVital — route passthrough", () => {
  it("uses the route argument verbatim in tags", () => {
    reportWebVital(makeMetric(), "/deals");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.route).toBe("/deals");
  });

  it("does not strip query strings or hashes provided by the caller (caller's responsibility)", () => {
    // Defensive: if a future caller does Window.location.pathname + search, we
    // honor it. Today the reporter passes pathname only — this test documents
    // the contract, not a current need.
    reportWebVital(makeMetric(), "/inventory?filter=foo");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].tags.route).toBe("/inventory?filter=foo");
  });
});

describe("reportWebVital — multi-tenant safety", () => {
  it("emits zero `orgId` keys anywhere on the event payload", () => {
    reportWebVital(makeMetric(), "/inventory");
    const call = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("orgId");
  });
});
