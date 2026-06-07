import { and, eq, ne, or, sql, desc, inArray, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { inventoryItems, orgs } from "./schema";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";
import { isDemoMode } from "@/lib/demo/mode";
import {
  seedInventorySummary,
  getSeedSharedInventoryForOrg,
} from "@/lib/demo/seed";
import { getCircleIdsForOrg } from "@/lib/circles/queries";

export interface InventorySummary {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedAt: Date | null;
}

export interface SharedInventoryRow {
  id: number;
  orgId: number;
  ownerOrgLabel: string;
  category: InventoryCategory;
  name: string;
  quantity: number;
  status: "in_stock" | "reserved" | "sold";
  visibilityCircleId: number;
  bidMode: "single" | "history" | null; // slice 18
  updatedAt: Date;
}

function zeroCounts(): Record<InventoryCategory, number> {
  return Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c, 0])) as Record<
    InventoryCategory,
    number
  >;
}

export async function getInventorySummary(
  db: Db,
  orgId: number,
): Promise<InventorySummary> {
  if (isDemoMode()) return seedInventorySummary();
  const rows = await db
    .select({
      category: inventoryItems.category,
      qty: sql<number>`coalesce(sum(${inventoryItems.quantity}), 0)::int`,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.orgId, orgId), ne(inventoryItems.status, "sold")))
    .groupBy(inventoryItems.category);

  const counts = zeroCounts();
  for (const r of rows) {
    if (r.category in counts) counts[r.category as InventoryCategory] = r.qty;
  }
  const total = INVENTORY_CATEGORIES.reduce((sum, c) => sum + counts[c], 0);

  const latest = await db
    .select({ updatedAt: inventoryItems.updatedAt })
    .from(inventoryItems)
    .where(eq(inventoryItems.orgId, orgId))
    .orderBy(desc(inventoryItems.updatedAt))
    .limit(1);

  return { counts, total, updatedAt: latest[0]?.updatedAt ?? null };
}

// Slice 15 review finding: a previous draft kept an `inventoryVisibilityClause`
// helper for "parity with slice 4" but its zero-circles fallback returned
// `eq(orgId, currentOrg)` — semantically WRONG for `getSharedInventoryForOrg`
// (which is "what partners are offering", explicitly EXCLUDING own items).
// Removed to prevent future readers from accidentally re-wiring it back in
// without noticing the inverted semantics. A future "include own items"
// variant should build its own clause from first principles.

/** Slice 15: returns inventory items shared into a circle the viewer is in,
 *  EXCLUDING the viewer's own items. /exchange is "what partners are
 *  offering" — own items live on /inventory. Zero-circles short-circuits
 *  to [] without touching the DB. */
export async function getSharedInventoryForOrg(
  db: Db,
  orgId: number,
  limit: number | null = null,
): Promise<SharedInventoryRow[]> {
  if (isDemoMode()) {
    const rows = getSeedSharedInventoryForOrg(orgId);
    return limit != null ? rows.slice(0, limit) : rows;
  }
  const circleIds = await getCircleIdsForOrg(db, orgId);
  if (circleIds.length === 0) return [];
  const q = db
    .select({
      id: inventoryItems.id,
      orgId: inventoryItems.orgId,
      ownerOrgLabel: orgs.name,
      category: inventoryItems.category,
      name: inventoryItems.name,
      quantity: inventoryItems.quantity,
      status: inventoryItems.status,
      visibilityCircleId: inventoryItems.visibilityCircleId,
      bidMode: inventoryItems.bidMode,
      updatedAt: inventoryItems.updatedAt,
    })
    .from(inventoryItems)
    .innerJoin(orgs, eq(orgs.id, inventoryItems.orgId))
    .where(
      and(
        ne(inventoryItems.orgId, orgId),
        inArray(inventoryItems.visibilityCircleId, circleIds),
        ne(inventoryItems.status, "sold"),
      ),
    )
    .orderBy(desc(inventoryItems.updatedAt));
  const rows = limit != null ? await q.limit(limit) : await q;
  return rows as SharedInventoryRow[];
}
