export const EMAIL_FEATURES = ["watchlist-alert", "invoice", "runway-alert", "sentinel", "smoke-test"] as const;
export type EmailFeature = (typeof EMAIL_FEATURES)[number];

export type EmailErrorCode = "rate_limited" | "unavailable" | "error";

/** A single email attachment. `content` is base64-encoded file bytes.
 *  `contentType` is kept in OUR type for future providers — Resend infers
 *  the MIME type from the filename, so it is NOT sent in the Resend body. */
export type EmailAttachment = {
  filename: string;
  content: string; // base64
  contentType: string;
};

export type SendEmailInput = {
  to: string;            // single recipient, Zod .email() validated
  subject: string;       // 1..200 chars
  text: string;          // plain-text body, 1..10_000 chars
  feature: EmailFeature; // mandatory attribution tag (Sentry + future headers)
  attachments?: EmailAttachment[]; // optional, max 3 — see sendEmail.ts for limits
};

export type SendEmailResult =
  | { ok: true; simulated: boolean; durationMs: number }
  | { ok: false; error: EmailErrorCode; durationMs: number };
