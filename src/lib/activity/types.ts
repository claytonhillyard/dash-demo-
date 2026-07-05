import { z } from "zod";

/** Whitelist of entity types audit events can reference. Extend as new
 *  domains gain instrumentation (slice 25 adds "watchlist", slice 27
 *  adds "invoice", etc.). */
export const ACTIVITY_ENTITY_TYPES = [
  "customer",
  "deal",
  "inventory_item",
  "attachment",
  "circle",
  "bid",
  "org",
  "watchlist",
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/** Whitelist of verbs. Extend as new event kinds are introduced. */
export const ACTIVITY_VERBS = [
  // lifecycle
  "created",
  "updated",
  "deleted",
  "archived",
  "restored",
  // membership / social
  "invited",
  "joined",
  "left",
  "watched",
  "unwatched",
  // bid domain
  "bid_placed",
  "bid_accepted",
  "bid_rejected",
  "bid_withdrawn",
  // auxiliary
  "commented",
  "comment_deleted",
  "viewed",
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];

/** 4 KB cap on serialized payload — guard against pathological writers
 *  (e.g. dumping a full row diff) bloating the audit table. */
export const ACTIVITY_PAYLOAD_MAX_BYTES = 4096;
/** 240-char cap on summary — fits a one-line list-view rendering. */
export const ACTIVITY_SUMMARY_MAX_LEN = 240;

export const recordActivityInputSchema = z.object({
  orgId: z.number().int().positive(),
  // NULL = system event (seed, cron, import); empty string is rejected.
  actor: z.string().min(1).max(200).nullable(),
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: z.number().int().positive().nullable(),
  verb: z.enum(ACTIVITY_VERBS),
  summary: z.string().min(1).max(ACTIVITY_SUMMARY_MAX_LEN),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type RecordActivityInput = z.infer<typeof recordActivityInputSchema>;

/** Shape returned by readers — mirrors the row exactly. */
export type ActivityEvent = {
  id: number;
  orgId: number;
  actor: string | null;
  entityType: ActivityEntityType;
  entityId: number | null;
  verb: ActivityVerb;
  summary: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};
