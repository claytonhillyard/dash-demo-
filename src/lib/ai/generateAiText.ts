import { generateText } from "ai";
import * as Sentry from "@sentry/nextjs";
import { isDemoMode } from "@/lib/demo/mode";
import { isBuildPhase } from "@/lib/market/buildPhase";
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
