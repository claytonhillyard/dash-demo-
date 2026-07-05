import type { RecordActivityInput } from "@/lib/activity/types";

const SUBJECT_PREFIX = "[iDesign] Activity: ";
const SUBJECT_MAX_LEN = 200;
const ELLIPSIS = "...";

/** Path an alert email links back to, per spec §5's entity map. Only the
 *  entity types with a real detail page get one; everything else falls back
 *  to the org-wide activity feed. */
function entityPath(event: RecordActivityInput): string {
  if (event.entityType === "customer") {
    return `/customers/${event.entityId}/edit`;
  }
  if (event.entityType === "deal") {
    return "/deals";
  }
  return "/activity";
}

/**
 * Pure builder for a watch-alert email's subject + body. No I/O, no clock
 * reads beyond the `now` parameter (currently unused in the rendered text,
 * but threaded through so a future template can add a timestamp without
 * changing the call site). Deterministic: same event + now → same output.
 *
 * Subject is capped at 200 chars total (mirrors sendEmail's own subject
 * limit) — a pathologically long summary is truncated with an ellipsis
 * rather than silently rejected by sendEmail's Zod boundary.
 */
export function buildAlertEmail(
  event: RecordActivityInput,
  _now: Date,
): { subject: string; text: string } {
  const rawSubject = `${SUBJECT_PREFIX}${event.summary}`;
  const subject =
    rawSubject.length <= SUBJECT_MAX_LEN
      ? rawSubject
      : rawSubject.slice(0, SUBJECT_MAX_LEN - ELLIPSIS.length) + ELLIPSIS;

  const text = [
    event.summary,
    `by ${event.actor ?? "system"}`,
    entityPath(event),
  ].join("\n");

  return { subject, text };
}
