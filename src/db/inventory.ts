import { and, eq, ne, sql, desc } from "drizzle-orm";
import type { Db } from "./client";
import { inventoryItems } from "./schema";
import { AIYA_ORG_ID } from "./org";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";

export interface InventorySummary {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedAt: Date | null;
}

function zeroCounts(): Record<InventoryCategory, number> {
  return Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c, 0])) as Record<
    InventoryCategory,
    number
  >;
}

export async function getInventorySummary(
  db: Db,
  orgId: number = AIYA_ORG_ID
): Promise<InventorySummary> {
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
