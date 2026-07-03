import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: { setTag: (k: string, v: unknown) => void }) => void) => {
    const tags: Record<string, unknown> = {};
    fn({ setTag: (k, v) => { tags[k] = v; } });
    (globalThis as Record<string, unknown>).__aiSentryTags = tags;
  },
  captureException: (e: unknown) => {
    (globalThis as Record<string, unknown>).__aiSentryError = e;
  },
}));

import { generateText } from "ai";
import { generateAiText } from "@/lib/ai/generateAiText";
import { AI_MODELS } from "@/lib/ai/models";

const OK_SDK_RESULT = {
  text: "live response",
  usage: { inputTokens: 10, outputTokens: 20 },
};

describe("generateAiText", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("NEXT_PHASE", "");
    (globalThis as Record<string, unknown>).__aiSentryError = undefined;
    (globalThis as Record<string, unknown>).__aiSentryTags = undefined;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("demo mode → simulated, SDK never called", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const r = await generateAiText({ feature: "smoke-test", prompt: "hello" });
    expect(r.ok && r.simulated).toBe(true);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("build phase → simulated, SDK never called", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const r = await generateAiText({ feature: "smoke-test", prompt: "hello" });
    expect(r.ok && r.simulated).toBe(true);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("missing key → simulated, SDK never called", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const r = await generateAiText({ feature: "smoke-test", prompt: "hello" });
    expect(r.ok && r.simulated).toBe(true);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("key present → real path with default fast tier + tags", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(OK_SDK_RESULT as never);
    const r = await generateAiText({ feature: "smoke-test", prompt: "hello", user: "org:1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.simulated).toBe(false);
      expect(r.text).toBe("live response");
      expect(r.model).toBe(AI_MODELS.fast);
      expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    }
    const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
    expect(call.model).toBe(AI_MODELS.fast);
    expect(call.providerOptions).toEqual({
      gateway: { tags: ["feature:smoke-test", "app:idesign"], user: "org:1" },
    });
  });

  it("omits user key from gateway options when not provided", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(OK_SDK_RESULT as never);
    await generateAiText({ feature: "smoke-test", prompt: "hello" });
    const call = vi.mocked(generateText).mock.calls[0]![0] as unknown as {
      providerOptions: { gateway: Record<string, unknown> };
    };
    expect("user" in call.providerOptions.gateway).toBe(false);
  });

  it("balanced tier resolves the sonnet slug", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(OK_SDK_RESULT as never);
    await generateAiText({ feature: "smoke-test", prompt: "hello", tier: "balanced" });
    const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
    expect(call.model).toBe(AI_MODELS.balanced);
  });

  it.each([
    [429, "rate_limited"],
    [402, "budget_exceeded"],
    [503, "unavailable"],
    [undefined, "error"],
  ])("statusCode %s maps to %s and never throws", async (statusCode, expected) => {
    const err = Object.assign(new Error("boom"), { statusCode });
    vi.mocked(generateText).mockRejectedValueOnce(err);
    const r = await generateAiText({ feature: "smoke-test", prompt: "secret-prompt-text" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(expected);
  });

  it("failure captures to Sentry with tags but never the prompt", async () => {
    const err = Object.assign(new Error("boom"), { statusCode: 429 });
    vi.mocked(generateText).mockRejectedValueOnce(err);
    await generateAiText({ feature: "smoke-test", prompt: "secret-prompt-text" });
    const tags = (globalThis as Record<string, unknown>).__aiSentryTags as Record<string, unknown>;
    expect(tags).toMatchObject({ feature: "smoke-test", model: AI_MODELS.fast, statusCode: 429 });
    expect(JSON.stringify(tags)).not.toContain("secret-prompt-text");
    expect((globalThis as Record<string, unknown>).__aiSentryError).toBe(err);
  });

  it("durationMs is a non-negative number on all paths", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const sim = await generateAiText({ feature: "smoke-test", prompt: "x" });
    expect(sim.durationMs).toBeGreaterThanOrEqual(0);

    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    vi.mocked(generateText).mockResolvedValueOnce(OK_SDK_RESULT as never);
    const ok = await generateAiText({ feature: "smoke-test", prompt: "x" });
    expect(ok.durationMs).toBeGreaterThanOrEqual(0);

    vi.mocked(generateText).mockRejectedValueOnce(new Error("boom"));
    const fail = await generateAiText({ feature: "smoke-test", prompt: "x" });
    expect(fail.durationMs).toBeGreaterThanOrEqual(0);
  });
});
