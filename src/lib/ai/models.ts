export const AI_MODELS = {
  fast: "anthropic/claude-haiku-4.5",
  balanced: "anthropic/claude-sonnet-4.6",
} as const;
export type AiModelTier = keyof typeof AI_MODELS;
