import * as z from "zod";
import * as Sentry from "@sentry/nextjs";
import { isDemoMode } from "@/lib/demo/mode";
import { isBuildPhase } from "@/lib/market/buildPhase";
import { EMAIL_FEATURES } from "./types";
import type { EmailErrorCode, SendEmailInput, SendEmailResult } from "./types";

const emailAttachmentSchema = z.object({
  filename: z.string().trim().min(1).max(100),
  content: z.string().min(1).max(10_000_000), // base64, ~7MB of raw bytes
  contentType: z.string().min(1).max(100),
});

const sendEmailInputSchema = z.object({
  to: z.email().max(200),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(10_000),
  feature: z.enum(EMAIL_FEATURES),
  attachments: z.array(emailAttachmentSchema).max(3).optional(),
});

function mapStatus(status: number): EmailErrorCode {
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "error";
}

/**
 * Single entry point for outbound email. Resend-backed via plain fetch
 * (mirrors the market-provider pattern — no SDK dependency). Falls back to
 * a simulated no-op in demo mode, during build, or when no API key is
 * configured — the app never hard-fails for lack of a live provider.
 *
 * Never throws. PII discipline: recipient/subject/body never reach Sentry
 * tags/extras — only feature/statusCode/duration metadata.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const started = Date.now();

  if (isDemoMode() || isBuildPhase() || !process.env.RESEND_API_KEY) {
    return { ok: true, simulated: true, durationMs: Date.now() - started };
  }

  const parsed = sendEmailInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "error", durationMs: Date.now() - started };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "alerts@idesign.local",
        to: parsed.data.to,
        subject: parsed.data.subject,
        text: parsed.data.text,
        ...(parsed.data.attachments
          ? {
              attachments: parsed.data.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
              })),
            }
          : {}),
      }),
      cache: "no-store",
    });

    const durationMs = Date.now() - started;
    if (res.ok) {
      return { ok: true, simulated: false, durationMs };
    }

    const error = mapStatus(res.status);
    Sentry.withScope((scope) => {
      scope.setTag("feature", input.feature);
      scope.setTag("statusCode", res.status);
      scope.setTag("durationMs", durationMs);
      Sentry.captureException(new Error(`sendEmail failed with status ${res.status}`));
    });
    return { ok: false, error, durationMs };
  } catch (e) {
    const durationMs = Date.now() - started;
    Sentry.withScope((scope) => {
      scope.setTag("feature", input.feature);
      scope.setTag("durationMs", durationMs);
      Sentry.captureException(e);
    });
    return { ok: false, error: "error", durationMs };
  }
}
