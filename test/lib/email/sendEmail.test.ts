import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: { setTag: (k: string, v: unknown) => void }) => void) => {
    const tags: Record<string, unknown> = {};
    fn({ setTag: (k, v) => { tags[k] = v; } });
    (globalThis as Record<string, unknown>).__emailSentryTags = tags;
  },
  captureException: (e: unknown) => {
    (globalThis as Record<string, unknown>).__emailSentryError = e;
  },
}));

import { sendEmail } from "@/lib/email/sendEmail";

const VALID_INPUT = {
  to: "watcher@example.com",
  subject: "Test subject",
  text: "Test body",
  feature: "watchlist-alert" as const,
};

function jsonResponse(status: number, ok: boolean) {
  return { ok, status } as Response;
}

describe("sendEmail", () => {
  const originalEmailFrom = process.env.EMAIL_FROM;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("NEXT_PHASE", "");
    // vi.stubEnv requires a string value, so an intentionally-*unset*
    // EMAIL_FROM (the default-fallback case) is modeled with a direct
    // delete/restore instead of stubEnv("EMAIL_FROM", "") — "" is not
    // nullish and would defeat the `??` fallback under test.
    delete process.env.EMAIL_FROM;
    (globalThis as Record<string, unknown>).__emailSentryError = undefined;
    (globalThis as Record<string, unknown>).__emailSentryTags = undefined;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalEmailFrom;
  });

  it("no key → simulated, fetch NOT called", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const r = await sendEmail(VALID_INPUT);
    expect(r.ok && r.simulated).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("demo mode → simulated, fetch NOT called", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const r = await sendEmail(VALID_INPUT);
    expect(r.ok && r.simulated).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("build phase → simulated, fetch NOT called", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const r = await sendEmail(VALID_INPUT);
    expect(r.ok && r.simulated).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("live 200 → ok/simulated:false, fetch called once with Bearer header + body fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, true));
    const r = await sendEmail(VALID_INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.simulated).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const initObj = init as RequestInit;
    expect(initObj.method).toBe("POST");
    expect(initObj.cache).toBe("no-store");
    const headers = initObj.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-resend-key");
    const body = JSON.parse(initObj.body as string);
    expect(body).toEqual({
      from: "alerts@idesign.local",
      to: VALID_INPUT.to,
      subject: VALID_INPUT.subject,
      text: VALID_INPUT.text,
    });
  });

  it("uses EMAIL_FROM env when set", async () => {
    vi.stubEnv("EMAIL_FROM", "no-reply@idesign.example");
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, true));
    await sendEmail(VALID_INPUT);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.from).toBe("no-reply@idesign.example");
  });

  it("429 → rate_limited", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(429, false));
    const r = await sendEmail(VALID_INPUT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("rate_limited");
  });

  it("500 → unavailable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, false));
    const r = await sendEmail(VALID_INPUT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unavailable");
  });

  it("503 → unavailable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(503, false));
    const r = await sendEmail(VALID_INPUT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unavailable");
  });

  it("other non-2xx (e.g. 400) → error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(400, false));
    const r = await sendEmail(VALID_INPUT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("error");
  });

  it("fetch rejects → error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    const r = await sendEmail(VALID_INPUT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("error");
  });

  it("invalid `to` (not an email) → error, fetch NOT called", async () => {
    const r = await sendEmail({ ...VALID_INPUT, to: "not-an-email" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalid subject (empty) → error, fetch NOT called", async () => {
    const r = await sendEmail({ ...VALID_INPUT, subject: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalid text (empty) → error, fetch NOT called", async () => {
    const r = await sendEmail({ ...VALID_INPUT, text: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalid feature (not in enum) → error, fetch NOT called", async () => {
    const r = await sendEmail({ ...VALID_INPUT, feature: "not-a-feature" as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Sentry tags on failure contain feature + statusCode, and JSON.stringify(tags) does NOT contain the recipient", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(429, false));
    await sendEmail(VALID_INPUT);
    const tags = (globalThis as Record<string, unknown>).__emailSentryTags as Record<string, unknown>;
    expect(tags).toMatchObject({ feature: "watchlist-alert", statusCode: 429 });
    expect(JSON.stringify(tags)).not.toContain(VALID_INPUT.to);
    expect(JSON.stringify(tags)).not.toContain(VALID_INPUT.subject);
    expect(JSON.stringify(tags)).not.toContain(VALID_INPUT.text);
  });

  it("Sentry tags include durationMs on failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, false));
    await sendEmail(VALID_INPUT);
    const tags = (globalThis as Record<string, unknown>).__emailSentryTags as Record<string, unknown>;
    expect(typeof tags?.durationMs).toBe("number");
  });

  it("Sentry captures on fetch rejection too (no recipient leak)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    await sendEmail(VALID_INPUT);
    const tags = (globalThis as Record<string, unknown>).__emailSentryTags as Record<string, unknown>;
    expect(tags).toMatchObject({ feature: "watchlist-alert" });
    expect(JSON.stringify(tags)).not.toContain(VALID_INPUT.to);
  });

  it("durationMs >= 0 on all paths and never throws", async () => {
    // simulated (demo)
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const sim = await sendEmail(VALID_INPUT);
    expect(sim.durationMs).toBeGreaterThanOrEqual(0);
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");

    // live ok
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, true));
    const ok = await sendEmail(VALID_INPUT);
    expect(ok.durationMs).toBeGreaterThanOrEqual(0);

    // live failure
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, false));
    const fail = await sendEmail(VALID_INPUT);
    expect(fail.durationMs).toBeGreaterThanOrEqual(0);

    // rejection
    vi.mocked(fetch).mockRejectedValueOnce(new Error("boom"));
    const rejected = await sendEmail(VALID_INPUT);
    expect(rejected.durationMs).toBeGreaterThanOrEqual(0);

    // zod invalid
    const invalid = await sendEmail({ ...VALID_INPUT, to: "nope" });
    expect(invalid.durationMs).toBeGreaterThanOrEqual(0);
  });
});
