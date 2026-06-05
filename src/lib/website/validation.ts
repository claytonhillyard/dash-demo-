// Owner-entered weekly website KPI snapshot validation.
//
// INVARIANTS:
// - No `orgId` field. The action wrapper stamps orgId from the session
//   (slice-3 invariant). PR-review grep:
//     grep -rn "orgId" src/lib/website/validation.ts → 0 matches.
// - `weekStart` accepts ANY valid YYYY-MM-DD date — the owner picks whatever
//   day matches their analytics provider's week boundary. The unique
//   constraint (org_id, week_start) in the DB enforces "one row per week
//   per org" treating that date as canonical. DO NOT add a Monday-only check.
//   See spec §2.3.
// - `uniqueVisitors <= visitors` is deliberately NOT enforced (spec §8.3) —
//   owner-entered ledgers commonly have edge cases (provider outages,
//   mid-week estimates). The form MAY show a soft warning, but the save
//   proceeds. DO NOT add a .refine() here.

import { z } from "zod";

const nonNegInt = z.number().int().min(0);

export const websiteSnapshotInput = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekStart must be YYYY-MM-DD"),
  visitors: nonNegInt,
  uniqueVisitors: nonNegInt,
  pageViews: nonNegInt,
  avgSessionDurationSeconds: nonNegInt,
  bounceRatePercent: z.number().int().min(0).max(100),
});
export type WebsiteSnapshotInput = z.infer<typeof websiteSnapshotInput>;

export const websiteSnapshotUpdateInput = websiteSnapshotInput.extend({
  id: z.number().int().positive(),
});
export type WebsiteSnapshotUpdateInput = z.infer<typeof websiteSnapshotUpdateInput>;

/** Reuse the shared single-message flattener from the company slice. */
export { firstZodError } from "@/lib/company/validation";
