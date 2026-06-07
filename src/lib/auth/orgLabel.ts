import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orgs } from "@/db/schema";

/** Resolve the human-readable label for an org, used for denormalized
 *  *_org_label snapshot columns (deal_messages, bids, inventory_bids).
 *  Falls back to a deterministic placeholder if the org has no name set.
 *
 *  Slice 18 lifted this from src/lib/deals/actions.ts (slice 16) so the
 *  inventory action layer can share it without importing across
 *  subsystem boundaries. Behavior is byte-identical to slice 16.
 *
 *  TODO(slice-18 review): The plan's code block used the fallback
 *  `Org #${orgId}` (with hash), but the existing slice-16 helper uses
 *  `Org ${orgId}` (no hash). Kept the existing string to preserve
 *  byte-identical behavior — slice-10 + slice-16 tests depend on it. */
export async function resolveOrgLabel(d: Db, orgId: number): Promise<string> {
  const [row] = await d
    .select({ name: orgs.name })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  return row?.name ?? `Org ${orgId}`;
}
