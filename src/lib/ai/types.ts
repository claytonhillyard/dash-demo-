import type { AiModelTier } from "./models";

export const AI_FEATURES = [
  "image-to-listing", // slice 23
  "command-layer", // slice 35
  "health-score", // slice 36
  "drafting", // slice 37
  "smoke-test", // diagnostics / tests
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export type AiErrorCode = "rate_limited" | "budget_exceeded" | "unavailable" | "error";

export type AiTextRequest = {
  feature: AiFeature; // mandatory — cost attribution
  prompt: string;
  system?: string;
  tier?: AiModelTier; // default "fast"
  user?: string; // e.g. `org:${orgId}` — per-user gateway tracking
  maxOutputTokens?: number; // default 1024
};

export type AiTextResult =
  | {
      ok: true;
      text: string;
      model: string; // resolved slug (or "simulated")
      simulated: boolean;
      durationMs: number;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { ok: false; error: AiErrorCode; durationMs: number };
