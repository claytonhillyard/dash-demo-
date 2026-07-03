# Slice 32 — AI Gateway Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `src/lib/ai/` — a single gateway-routed LLM entry point with a deterministic simulated fallback, mandatory feature tags, latency measurement, and PII-free Sentry failure capture.

**Architecture:** Two-branch seam (real gateway vs simulated), not a provider-chain router — the gateway itself owns cross-provider failover. `generateAiText` never throws; returns an ok-union.

**Tech Stack:** `ai@^6` (new dep), existing `isDemoMode` (`src/lib/demo/mode.ts`) + `isBuildPhase` (find via `grep -rn "isBuildPhase" src/lib/`), Sentry `withScope` convention, Vitest with `vi.mock("ai")` + `vi.stubEnv`.

**Spec (authoritative contracts):** `docs/superpowers/specs/2026-06-21-ai-gateway-slice-32-design.md` — §3 has the exact type shapes; read it before coding.

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-32-ai-gateway`

---

## Task 32-1 — Dependency + types + models + simulated

**Files:**
- Modify: `package.json` (+ lockfile) via `npm install ai@^6 --save`
- Create: `src/lib/ai/types.ts` (spec §3.1 verbatim)
- Create: `src/lib/ai/models.ts` (spec §3.2 verbatim — note `AiModelTier` lives here; `types.ts` imports it, adjust the import direction so there is no cycle: put `AiModelTier` in `models.ts` and import it into `types.ts`)
- Create: `src/lib/ai/simulated.ts`
- Create: `test/lib/ai/simulated.test.ts`

- [ ] **Step 1:** `npm install ai@^6 --save` — then `npm ls ai; echo "EXIT=$?"` to confirm resolution. Paste the resolved version.
- [ ] **Step 2:** Write `types.ts` + `models.ts` from spec §3.1/§3.2 exactly.
- [ ] **Step 3: Failing tests first** — `test/lib/ai/simulated.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { simulateAiText } from "@/lib/ai/simulated";

describe("simulateAiText", () => {
  it("is deterministic: same prompt → identical output", async () => {
    const a = await simulateAiText({ feature: "smoke-test", prompt: "Summarize Q3 revenue" });
    const b = await simulateAiText({ feature: "smoke-test", prompt: "Summarize Q3 revenue" });
    expect(a.text).toBe(b.text);
  });

  it("marks output as simulated and echoes a prompt fragment", async () => {
    const r = await simulateAiText({ feature: "smoke-test", prompt: "Summarize Q3 revenue" });
    expect(r.text.startsWith("[simulated]")).toBe(true);
    expect(r.text).toContain("Summarize Q3 revenue".slice(0, 24));
    expect(r.model).toBe("simulated");
  });

  it("distinct prompts → distinct outputs", async () => {
    const a = await simulateAiText({ feature: "smoke-test", prompt: "alpha" });
    const b = await simulateAiText({ feature: "smoke-test", prompt: "beta" });
    expect(a.text).not.toBe(b.text);
  });
});
```

- [ ] **Step 4: Implement `simulated.ts`:**

```ts
import type { AiTextRequest } from "./types";

/** Stable 32-bit FNV-1a — deterministic template pick, no randomness. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const TEMPLATES = [
  "Here is a concise take on: %P%. (Key points would follow from a live model.)",
  "Analysis of %P%: the simulated provider returns stable placeholder copy.",
  "Draft response for %P% — replace with live output once AI_GATEWAY_API_KEY is set.",
] as const;

/**
 * Deterministic fallback generation for demo mode, build phase, missing
 * key, and tests. Same role as the market layer's simulatedProvider: the
 * app never hard-fails for lack of a live provider.
 */
export async function simulateAiText(
  req: Pick<AiTextRequest, "feature" | "prompt" | "system">,
): Promise<{ text: string; model: "simulated" }> {
  const fragment = req.prompt.slice(0, 80);
  const template = TEMPLATES[hash(req.prompt) % TEMPLATES.length]!;
  return {
    text: `[simulated] ${template.replace("%P%", fragment)}`,
    model: "simulated",
  };
}
```

- [ ] **Step 5:** Run the test → 3 pass. `npx tsc --noEmit; echo "EXIT=$?"` → 0.
- [ ] **Step 6:** Commit: `feat(ai): types + model tiers + simulated provider (slice 32-1)` — include `package.json` + lockfile.

---

## Task 32-2 — generateAiText + full test suite

**Files:**
- Create: `src/lib/ai/generateAiText.ts`
- Create: `test/lib/ai/generateAiText.test.ts`

- [ ] **Step 1:** Locate `isBuildPhase`: `grep -rn "export function isBuildPhase\|export const isBuildPhase" src/lib/` — note its module path for the import.

- [ ] **Step 2: Failing tests first.** `test/lib/ai/generateAiText.test.ts` — mock BOTH `ai` and `@sentry/nextjs` BEFORE importing the module under test:

```ts
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
    const call = vi.mocked(generateText).mock.calls[0]![0] as {
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
```

CAVEAT: if `isBuildPhase()` reads an env var (likely `NEXT_PHASE`), add one more truth-table test stubbing it → simulated. Check its implementation and mirror however `test/lib/market/buildPhase.test.ts` toggles it.

- [ ] **Step 3: Implement `generateAiText.ts`:**

```ts
import { generateText } from "ai";
import * as Sentry from "@sentry/nextjs";
import { isDemoMode } from "@/lib/demo/mode";
// import { isBuildPhase } from "<path found in Step 1>";
import { AI_MODELS } from "./models";
import { simulateAiText } from "./simulated";
import type { AiErrorCode, AiTextRequest, AiTextResult } from "./types";

function mapStatus(statusCode: number | undefined): AiErrorCode {
  switch (statusCode) {
    case 429: return "rate_limited";
    case 402: return "budget_exceeded";
    case 503: return "unavailable";
    default:  return "error";
  }
}

/**
 * Single entry point for LLM calls. Routes through the Vercel AI Gateway
 * (plain "provider/model" strings; the SDK reads AI_GATEWAY_API_KEY from
 * env). Falls back to the deterministic simulated generator in demo mode,
 * during build, or when no key is configured — the app never hard-fails
 * for lack of a live provider.
 *
 * Never throws. PII discipline: neither prompt nor response ever reaches
 * Sentry tags/extras — only feature/model/status/duration metadata.
 */
export async function generateAiText(req: AiTextRequest): Promise<AiTextResult> {
  const started = Date.now();
  const tier = req.tier ?? "fast";
  const model = AI_MODELS[tier];

  if (isDemoMode() || isBuildPhase() || !process.env.AI_GATEWAY_API_KEY) {
    const sim = await simulateAiText(req);
    return {
      ok: true,
      text: sim.text,
      model: sim.model,
      simulated: true,
      durationMs: Date.now() - started,
    };
  }

  try {
    const result = await generateText({
      model,
      system: req.system,
      prompt: req.prompt,
      maxOutputTokens: req.maxOutputTokens ?? 1024,
      providerOptions: {
        gateway: {
          tags: [`feature:${req.feature}`, "app:idesign"],
          ...(req.user ? { user: req.user } : {}),
        },
      },
    });
    const usage =
      result.usage &&
      typeof result.usage.inputTokens === "number" &&
      typeof result.usage.outputTokens === "number"
        ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
        : undefined;
    return {
      ok: true,
      text: result.text,
      model,
      simulated: false,
      durationMs: Date.now() - started,
      ...(usage ? { usage } : {}),
    };
  } catch (e) {
    // Duck-typed status read — avoids importing APICallError so tests can
    // mock the `ai` package with a plain object. Only the status drives
    // the mapping; revisit if retry-after headers are ever needed.
    const statusCode = (e as { statusCode?: number })?.statusCode;
    const durationMs = Date.now() - started;
    Sentry.withScope((scope) => {
      scope.setTag("feature", req.feature);
      scope.setTag("model", model);
      if (statusCode !== undefined) scope.setTag("statusCode", statusCode);
      scope.setTag("durationMs", durationMs);
      Sentry.captureException(e);
    });
    return { ok: false, error: mapStatus(statusCode), durationMs };
  }
}
```

IMPLEMENTATION CHECKS (do these, report findings):
- Verify the installed `ai@6` `generateText` signature: does it accept `maxOutputTokens` (v6 name) or `maxTokens` (v5)? Check `node_modules/ai/dist/index.d.ts` types and use the v6-correct name; adjust spec/test accordingly if it differs.
- Verify the v6 `usage` field names (`inputTokens`/`outputTokens` vs older `promptTokens`/`completionTokens`) against the installed types and adapt the defensive mapping so OUR result shape stays `{ inputTokens, outputTokens }`.
- Verify `providerOptions.gateway` typing compiles against the installed SDK; if the SDK's types demand a different shape for gateway options, adapt while keeping tags + user semantics.

- [ ] **Step 4:** Run tests → all pass. `npx tsc --noEmit; echo "EXIT=$?"` → 0.
- [ ] **Step 5:** Grep guard: `grep -rn "AI_GATEWAY_API_KEY" src/ | grep -v "src/lib/ai/"` → must be empty (key referenced only inside the module). `grep -rn "NEXT_PUBLIC_AI" src/` → must be empty.
- [ ] **Step 6:** Commit: `feat(ai): generateAiText gateway entry point (slice 32-2)`

---

## Final verification (controller)

- Full suite detached (`/tmp/slice32-final.log` + `.done` pattern) → expect baseline 1121 + ~14 new ≈ 1135, VITEST_EXIT=0.
- `npx tsc --noEmit` → 0.
- Final review (spec-compliance + quality) → merge `--no-ff` → push → ROADMAP `shipped:` + HANDOFF.

## Done condition

- `ai@^6` installed; `src/lib/ai/{types,models,simulated,generateAiText}.ts` present
- All new tests green; full suite green; tsc clean
- `AI_GATEWAY_API_KEY` referenced nowhere outside `src/lib/ai/`
- ROADMAP §9 row 32 → `shipped: <sha>`
