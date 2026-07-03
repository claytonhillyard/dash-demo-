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
