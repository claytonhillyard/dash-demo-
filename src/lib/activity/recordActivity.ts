import type { Db } from "@/db/client";
import { activityEvents } from "@/db/schema";
import {
  ACTIVITY_PAYLOAD_MAX_BYTES,
  recordActivityInputSchema,
  type RecordActivityInput,
} from "./types";

/**
 * Append a single audit row. Validates input at the boundary (Zod
 * whitelist + length + payload-size cap), then INSERTs. Returns void —
 * callers do not need the event id.
 *
 * Throws on any failure (validation OR DB). Action sites use
 * `recordActivitySafely` (this module's sibling) to swallow + tag.
 */
export async function recordActivity(
  db: Db,
  input: RecordActivityInput,
): Promise<void> {
  const parsed = recordActivityInputSchema.parse(input);
  if (parsed.payload !== undefined && parsed.payload !== null) {
    const size = Buffer.byteLength(JSON.stringify(parsed.payload), "utf8");
    if (size > ACTIVITY_PAYLOAD_MAX_BYTES) {
      throw new Error(
        `recordActivity: payload ${size} bytes exceeds ${ACTIVITY_PAYLOAD_MAX_BYTES}-byte cap`,
      );
    }
  }
  await db.insert(activityEvents).values({
    orgId: parsed.orgId,
    actor: parsed.actor,
    entityType: parsed.entityType,
    entityId: parsed.entityId,
    verb: parsed.verb,
    summary: parsed.summary,
    payload: parsed.payload ?? null,
  });
}
