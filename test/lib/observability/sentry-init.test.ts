import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @sentry/nextjs so we can assert on .init.mock.calls.
vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((fn: (scope: { setTag: (k: string, v: unknown) => void }) => unknown) =>
    fn({ setTag: vi.fn() }),
  ),
  setTag: vi.fn(),
}));

// Stub the demo flag — we drive it via env in each test.
vi.mock("@/lib/demo/mode", () => ({
  isDemoMode: () => process.env.NEXT_PUBLIC_DEMO_MODE === "true",
}));

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  delete process.env.SENTRY_DSN;
});
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe("initSentry", () => {
  it("calls Sentry.init with enabled:false in demo mode (no DSN required)", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const { initSentry } = await import("@/lib/observability/sentry");
    const Sentry = await import("@sentry/nextjs");
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const cfg = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cfg.enabled).toBe(false);
  });

  it("calls Sentry.init with enabled:false when SENTRY_DSN is unset (non-demo)", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    // SENTRY_DSN deliberately unset.
    const { initSentry } = await import("@/lib/observability/sentry");
    const Sentry = await import("@sentry/nextjs");
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const cfg = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cfg.enabled).toBe(false);
    expect(cfg.dsn).toBeUndefined();
  });

  it("calls Sentry.init with enabled:true when DSN is set and not in demo", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const { initSentry } = await import("@/lib/observability/sentry");
    const Sentry = await import("@sentry/nextjs");
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const cfg = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cfg.enabled).toBe(true);
    expect(cfg.dsn).toBe("https://abc@o123.ingest.sentry.io/4567");
    expect(typeof cfg.beforeSend).toBe("function");
    expect(typeof cfg.beforeBreadcrumb).toBe("function");
    expect(cfg.tracesSampleRate).toBe(0);
  });

  it("is idempotent — calling twice does not throw and re-inits with same shape", async () => {
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const { initSentry } = await import("@/lib/observability/sentry");
    const Sentry = await import("@sentry/nextjs");
    initSentry();
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(2);
    const a = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const b = (Sentry.init as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(b.enabled).toBe(a.enabled);
    expect(b.dsn).toBe(a.dsn);
  });
});

describe("beforeSend (server scrubber)", () => {
  async function load() {
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const mod = await import("@/lib/observability/sentry");
    return mod.beforeSend;
  }

  it("strips orgId from event.extra", async () => {
    const beforeSend = await load();
    const out = beforeSend!(
      { extra: { orgId: 7, otherField: "x" } } as unknown as Parameters<NonNullable<typeof beforeSend>>[0],
      {} as never,
    );
    expect(out!.extra).toEqual({ otherField: "x" });
  });

  it("strips orgId from event.contexts[*]", async () => {
    const beforeSend = await load();
    const out = beforeSend!(
      { contexts: { request: { orgId: 7, url: "/foo" } } } as unknown as Parameters<NonNullable<typeof beforeSend>>[0],
      {} as never,
    );
    expect(out!.contexts!.request).toEqual({ url: "/foo" });
  });

  it("strips orgId from event.breadcrumbs[*].data", async () => {
    const beforeSend = await load();
    const out = beforeSend!(
      {
        breadcrumbs: [
          { data: { orgId: 7, query: "abc" }, message: "m" },
        ],
      } as unknown as Parameters<NonNullable<typeof beforeSend>>[0],
      {} as never,
    );
    expect(out!.breadcrumbs![0].data).toEqual({ query: "abc" });
  });

  it("leaves event.tags untouched (tags are intentionally allowed)", async () => {
    const beforeSend = await load();
    const out = beforeSend!(
      { tags: { orgId: 7, layer: "deals-action" } } as unknown as Parameters<NonNullable<typeof beforeSend>>[0],
      {} as never,
    );
    expect(out!.tags).toEqual({ orgId: 7, layer: "deals-action" });
  });
});

describe("beforeBreadcrumb (incoming-breadcrumb scrubber)", () => {
  async function load() {
    process.env.SENTRY_DSN = "https://abc@o123.ingest.sentry.io/4567";
    const mod = await import("@/lib/observability/sentry");
    return mod.beforeBreadcrumb;
  }

  it("strips orgId from breadcrumb.data before queue", async () => {
    const beforeBreadcrumb = await load();
    const out = beforeBreadcrumb!(
      { data: { orgId: 7, query: "abc" } } as unknown as Parameters<NonNullable<typeof beforeBreadcrumb>>[0],
      {} as never,
    );
    expect(out!.data).toEqual({ query: "abc" });
  });
});
