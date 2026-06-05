import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Mock the web-vitals library so we can assert on the on* calls.
vi.mock("web-vitals", () => ({
  onLCP: vi.fn(),
  onINP: vi.fn(),
  onCLS: vi.fn(),
}));

// Mock the report helper so we can assert it gets the right pathname.
vi.mock("@/lib/observability/webVitals", () => ({
  reportWebVital: vi.fn(),
}));

// Mock demo mode — we drive it per test via the mock factory.
let mockIsDemoMode = false;
vi.mock("@/lib/demo/mode", () => ({
  isDemoMode: () => mockIsDemoMode,
}));

import { WebVitalsReporter } from "@/components/observability/WebVitalsReporter";
import * as webVitals from "web-vitals";
import { reportWebVital } from "@/lib/observability/webVitals";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDemoMode = false;
});

describe("WebVitalsReporter", () => {
  it("registers onLCP, onINP, and onCLS exactly once on mount (non-demo)", () => {
    render(<WebVitalsReporter />);
    expect(webVitals.onLCP).toHaveBeenCalledTimes(1);
    expect(webVitals.onINP).toHaveBeenCalledTimes(1);
    expect(webVitals.onCLS).toHaveBeenCalledTimes(1);
  });

  it("each on* registration receives a function callback", () => {
    render(<WebVitalsReporter />);
    const lcpCb = (webVitals.onLCP as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const inpCb = (webVitals.onINP as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const clsCb = (webVitals.onCLS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof lcpCb).toBe("function");
    expect(typeof inpCb).toBe("function");
    expect(typeof clsCb).toBe("function");
  });

  it("renders null (no DOM output)", () => {
    const { container } = render(<WebVitalsReporter />);
    expect(container.firstChild).toBeNull();
  });

  it("DEMO MODE: does NOT register any web-vitals observer", () => {
    mockIsDemoMode = true;
    render(<WebVitalsReporter />);
    expect(webVitals.onLCP).not.toHaveBeenCalled();
    expect(webVitals.onINP).not.toHaveBeenCalled();
    expect(webVitals.onCLS).not.toHaveBeenCalled();
  });

  it("DEMO MODE: still renders null (no JSX side effects)", () => {
    mockIsDemoMode = true;
    const { container } = render(<WebVitalsReporter />);
    expect(container.firstChild).toBeNull();
  });

  it("the registered callback invokes reportWebVital with the current pathname (read at report time)", () => {
    render(<WebVitalsReporter />);
    const lcpCb = (webVitals.onLCP as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // jsdom default location.pathname is "/blank" or "/" depending on config —
    // we don't pin a specific value, just assert it's forwarded.
    const fakeMetric = {
      name: "LCP" as const,
      value: 1800,
      rating: "good" as const,
      delta: 1800,
      id: "v3-1",
      entries: [],
      navigationType: "navigate" as const,
    };
    lcpCb(fakeMetric);
    expect(reportWebVital).toHaveBeenCalledTimes(1);
    expect(reportWebVital).toHaveBeenCalledWith(fakeMetric, window.location.pathname);
  });

  it("pathname is read at REPORT TIME, not registration time (soft-nav correctness)", () => {
    // 1. Mount the reporter while location.pathname is "/" (jsdom default).
    render(<WebVitalsReporter />);
    const lcpCb = (webVitals.onLCP as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // 2. Simulate a soft-nav by overwriting pathname.
    const originalPath = window.location.pathname;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, pathname: "/deals" },
    });

    // 3. Fire the metric — reportWebVital should see "/deals", not the old path.
    const fakeMetric = {
      name: "LCP" as const,
      value: 1800,
      rating: "good" as const,
      delta: 1800,
      id: "v3-1",
      entries: [],
      navigationType: "navigate" as const,
    };
    lcpCb(fakeMetric);
    expect(reportWebVital).toHaveBeenCalledWith(fakeMetric, "/deals");

    // 4. Restore.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, pathname: originalPath },
    });
  });
});
