export const EMAIL_FEATURES = ["watchlist-alert", "invoice", "runway-alert", "sentinel", "smoke-test"] as const;
export type EmailFeature = (typeof EMAIL_FEATURES)[number];

export type EmailErrorCode = "rate_limited" | "unavailable" | "error";

export type SendEmailInput = {
  to: string;            // single recipient, Zod .email() validated
  subject: string;       // 1..200 chars
  text: string;          // plain-text body, 1..10_000 chars
  feature: EmailFeature; // mandatory attribution tag (Sentry + future headers)
};

export type SendEmailResult =
  | { ok: true; simulated: boolean; durationMs: number }
  | { ok: false; error: EmailErrorCode; durationMs: number };
