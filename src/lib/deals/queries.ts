import { and, eq, or, desc, inArray, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedDealsVisibleTo } from "@/lib/demo/seed";
import { getCircleIdsForOrg } from "@/lib/circles/queries";
import type { DealKind, DealCategory, DealStatus } from "./constants";

export interface DealRow {
  id: number;
  orgId: number;
  kind: DealKind;
  category: DealCategory;
  subject: string;
  quantity: number;
  priceCents: number;
  currency: string;
  status: DealStatus;
  postedByLabel: string;
  visibilityCircleId: number | null;
  /** Slice-10: per-deal thread mode. Defaults to "private" via the DB. */
  threadMode: "private" | "group";
  createdAt: Date;
}

export interface DealFilters {
  status?: DealStatus;
  kind?: DealKind;
  category?: DealCategory;
}

const COLUMNS = {
  id: deals.id,
  orgId: deals.orgId,
  kind: deals.kind,
  category: deals.category,
  subject: deals.subject,
  quantity: deals.quantity,
  priceCents: deals.priceCents,
  currency: deals.currency,
  status: deals.status,
  postedByLabel: deals.postedByLabel,
  visibilityCircleId: deals.visibilityCircleId,
  threadMode: deals.threadMode,
  createdAt: deals.createdAt,
} as const;

/** Build the visibility OR clause for slice 4. When the viewer is in zero
 *  circles, returns the bare slice-3 clause `eq(deals.orgId, orgId)` —
 *  byte-identical to slice-3 behavior, no `or(...)`, no `inArray([])`. */
function visibilityClause(orgId: number, circleIds: number[]): SQL {
  if (circleIds.length === 0) {
    return eq(deals.orgId, orgId);
  }
  // Non-null assertion: or(...) with two truthy SQL fragments cannot return
  // undefined; Drizzle's overload only widens to undefined when given 0 args.
  return or(
    eq(deals.orgId, orgId),
    inArray(deals.visibilityCircleId, circleIds),
  )!;
}

export async function getActiveDeals(
  db: Db,
  orgId: number,
  limit: number = 5,
): Promise<DealRow[]> {
  if (isDemoMode()) {
    return getSeedDealsVisibleTo(orgId).filter((d) => d.status === "Open").slice(0, limit);
  }
  const circleIds = await getCircleIdsForOrg(db, orgId);
  const rows = await db
    .select(COLUMNS)
    .from(deals)
    .where(and(visibilityClause(orgId, circleIds), eq(deals.status, "Open")))
    .orderBy(desc(deals.createdAt))
    .limit(limit);
  return rows as DealRow[];
}

export async function getAllDeals(
  db: Db,
  orgId: number,
  filters: DealFilters = {},
): Promise<DealRow[]> {
  if (isDemoMode()) return getSeedDealsVisibleTo(orgId);
  const circleIds = await getCircleIdsForOrg(db, orgId);
  const clauses: SQL[] = [visibilityClause(orgId, circleIds)];
  if (filters.status) clauses.push(eq(deals.status, filters.status));
  if (filters.kind) clauses.push(eq(deals.kind, filters.kind));
  if (filters.category) clauses.push(eq(deals.category, filters.category));
  const rows = await db
    .select(COLUMNS)
    .from(deals)
    .where(and(...clauses))
    .orderBy(desc(deals.createdAt));
  return rows as DealRow[];
}
