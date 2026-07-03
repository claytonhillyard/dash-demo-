# iDesign Command Center — Slice 32: AI Gateway integration — Design

**Date:** 2026-06-21
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 1's provider-seam philosophy (simulated fallback so demo/build/keyless environments never hard-fail), slice 11 Sentry conventions (withScope + tags, PII-free), slice 22 PII discipline.

**Unlocks:** slice 23 (image-to-listing), 35 (AI Command Layer), 36 (Customer Health Score), 37 (AI drafting), 41 (investor updates), 42 (negotiation coach), 46 (live translation), 50 (display designer).

---

## 1. Overview & Goals

A single server-side entry point for LLM calls, routed through the Vercel AI Gateway. The gateway supplies cross-provider failover, cost tracking, per-user attribution, and audit logging — so unlike the market-data layer, we do NOT build our own provider-chain router. What we keep from the house pattern is the **real-vs-simulated seam**: every call falls back to a deterministic simulated generator when in demo mode, during build, or when no key is configured.

**Goals:**

- New dependency `ai@^6` (Vercel AI SDK). Plain `"provider/model"` strings route through the gateway automatically; auth via `AI_GATEWAY_API_KEY` env (Netlify deploy — OIDC unavailable; key-based is the documented non-Vercel path).
- `src/lib/ai/` module: `types.ts` (feature tags, result union, error codes), `models.ts` (tier catalog), `simulated.ts` (deterministic fallback), `generateAiText.ts` (single entry point).
- Every call carries a mandatory `feature` tag → gateway cost-attribution tag `feature:<x>`, plus `app:idesign`, plus optional `user` label for per-user tracking.
- `durationMs` measured on every call (both paths) and returned in the result — the slice's latency-tracking deliverable.
- Failures mapped to a friendly error union; Sentry capture tagged `{ feature, model, statusCode, durationMs }` with **no prompt/response content ever** (PII discipline).
- `generateAiText` never throws — ok-union result like the codebase's `ActionResult`.

## 2. Non-goals (named homes)

- **Structured output (`generateObject`)** — slice 23 adds it on this seam.
- **Streaming (`streamText`)** — slice 35 adds it with the chat surface.
- **Image generation** — slice 50.
- **Vision input helpers** — slice 23 (its core need).
- **Any UI** (AI status panel, settings toggle) — nothing user-facing this slice; a ProviderStatusPanel entry can ride slice 35.
- **Programmatic budget guardrails / token pre-flight** — gateway dashboard budgets suffice until a real consumer exists.
- **Prompt template registry** — first consumers define their own prompts; a registry is premature.

## 3. Module contract

### 3.1 `src/lib/ai/types.ts`

```ts
export const AI_FEATURES = [
  "image-to-listing",  // slice 23
  "command-layer",     // slice 35
  "health-score",      // slice 36
  "drafting",          // slice 37
  "smoke-test",        // diagnostics / tests
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export type AiErrorCode = "rate_limited" | "budget_exceeded" | "unavailable" | "error";

export type AiTextRequest = {
  feature: AiFeature;          // mandatory — cost attribution
  prompt: string;
  system?: string;
  tier?: AiModelTier;          // default "fast"
  user?: string;               // e.g. `org:${orgId}` — per-user gateway tracking
  maxOutputTokens?: number;    // default 1024
};

export type AiTextResult =
  | {
      ok: true;
      text: string;
      model: string;           // resolved slug (or "simulated")
      simulated: boolean;
      durationMs: number;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { ok: false; error: AiErrorCode; durationMs: number };
```

### 3.2 `src/lib/ai/models.ts`

```ts
export const AI_MODELS = {
  fast: "anthropic/claude-haiku-4.5",
  balanced: "anthropic/claude-sonnet-4.6",
} as const;
export type AiModelTier = keyof typeof AI_MODELS;
```

Callers pick a tier, never a raw slug — model upgrades are a one-line change here. Slugs use dots for versions (gateway convention; verified against current gateway docs).

### 3.3 `src/lib/ai/simulated.ts`

`simulateAiText(req): { text, model: "simulated" }` — deterministic from the prompt (stable hash → canned-template pick), output prefixed `[simulated]`, echoes a trimmed prompt fragment. Fast, synchronous logic (wrapped async for signature parity). No randomness — tests assert exact output.

### 3.4 `src/lib/ai/generateAiText.ts`

Decision order, evaluated at call time (house convention — no module-load env reads):

1. `isDemoMode()` → simulated
2. `isBuildPhase()` → simulated
3. `!process.env.AI_GATEWAY_API_KEY` → simulated
4. else → real gateway call:

```ts
const result = await generateText({
  model: AI_MODELS[tier],
  system,
  prompt,
  maxOutputTokens,
  providerOptions: {
    gateway: {
      tags: [`feature:${feature}`, "app:idesign"],
      ...(user ? { user } : {}),
    },
  },
});
```

- The AI SDK reads `AI_GATEWAY_API_KEY` from env itself — no explicit key plumbing.
- `durationMs = Date.now() - started` on every exit path, simulated included.
- Error mapping duck-types the SDK error's `statusCode` (`429 → rate_limited`, `402 → budget_exceeded`, `503 → unavailable`, else `error`) rather than importing `APICallError.isInstance` — smaller mock surface for tests, no behavioral loss since only the status drives the branch.
- On failure: `Sentry.withScope` capture tagged `{ feature, model, statusCode, durationMs }`. The exception object is captured as-is (SDK errors don't embed the prompt), but no request field is ever added to tags/extras.
- `usage` mapped defensively from whatever the installed SDK returns (v6 token-count field names verified at implementation time against the package's types) into our stable `{ inputTokens, outputTokens }` shape; omitted if unavailable.

## 4. Configuration

- `AI_GATEWAY_API_KEY` — server-only (never `NEXT_PUBLIC`). Set in Netlify env + local `.env.local` when live calls are wanted. Absent → graceful simulated fallback everywhere.
- No other new env vars.

## 5. Test plan (`test/lib/ai/`) — all `ai`-mocked, zero network

- `simulated.test.ts` — determinism (same prompt → same output), `[simulated]` marker, prompt-fragment echo, distinct prompts → distinct outputs.
- `generateAiText.test.ts` —
  - Env truth table via `vi.stubEnv`: demo → simulated; build phase → simulated; no key → simulated; key present + not demo/build → real path (mocked `generateText` called once).
  - Tag composition: mocked `generateText` receives `tags: ["feature:smoke-test", "app:idesign"]` and `user` when provided, no `user` key when omitted.
  - Model tier resolution: default `fast` → haiku slug; explicit `balanced` → sonnet slug.
  - Error mapping: mocked rejection with `statusCode` 429/402/503/undefined → `rate_limited`/`budget_exceeded`/`unavailable`/`error`; result `ok: false`, never throws.
  - `durationMs` is a non-negative number on success, failure, and simulated paths.
  - Sentry: failure capture tagged with feature+model; **assert no tag/extra value contains the prompt string**.
  - Usage mapping: mocked SDK usage → `{ inputTokens, outputTokens }`.

## 6. Decisions

- **No custom provider-chain router.** Gateway-side `order`/`models` failover exists when we want it (not configured this slice — single-model-per-tier is enough until a consumer demands failover).
- **Duck-typed status mapping** over `APICallError.isInstance` — testability; revisit if we ever need `responseHeaders` (e.g. retry-after).
- **`user` supplied by callers** (`org:${orgId}` convention) — the lib stays free of session/auth imports.
- **Tier catalog now, `getAvailableModels()` later** — dynamic model discovery is dashboard tooling, not runtime behavior.
