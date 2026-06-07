import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { isDemoMode } from "@/lib/demo/mode";

export type InventoryBidStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "auto_rejected";

export type InventoryBidView = {
  id: number;
  inventoryItemId: number;
  bidderOrgId: number;
  bidderOrgLabel: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  quantityRequested: number;
  status: InventoryBidStatus;
  decidedAt: Date | null;
  createdAt: Date;
};

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

/**
 * Slice 18: bids on a single inventory item visible to `viewerOrgId`,
 * ordered newest-first.
 *
 * Visibility is SQL-enforced (NEVER application-layer filtering):
 *   bidder_org_id = viewer OR inventory_items.org_id = viewer
 *
 * ⚠ VISIBILITY PREDICATE — INTENTIONALLY decoupled from
 *   inventory_items.visibility_circle_id. Circle members can see the
 *   ITEM (via slice 15) but NOT bids on it. Same posture as slice
 *   16's getBidsForDeal vs. deals.thread_mode.
 *
 * If you change the OR, update canBidOnItem in src/lib/inventory/actions.ts
 * at the same time.
 *
 * Demo mode short-circuits to [].
 */
export async function getInventoryBidsForItem(
  db: Db,
  viewerOrgId: number,
  inventoryItemId: number,
): Promise<InventoryBidView[]> {
  if (isDemoMode()) return [];
  const res = await db.execute(sql`
    SELECT ib.id, ib.inventory_item_id, ib.bidder_org_id, ib.bidder_org_label,
           ib.price_cents, ib.currency, ib.notes,
           ib.quantity_requested,
           ib.status, ib.decided_at, ib.created_at
    FROM inventory_bids ib
    JOIN inventory_items i ON i.id = ib.inventory_item_id
    WHERE ib.inventory_item_id = ${inventoryItemId}
      AND (ib.bidder_org_id = ${viewerOrgId} OR i.org_id = ${viewerOrgId})
    ORDER BY ib.created_at DESC
  `);
  const rows = rowsOf<{
    id: number;
    inventory_item_id: number;
    bidder_org_id: number;
    bidder_org_label: string;
    price_cents: number;
    currency: string;
    notes: string | null;
    quantity_requested: number;
    status: InventoryBidStatus;
    decided_at: Date | string | null;
    created_at: Date | string;
  }>(res);
  return rows.map((r) => ({
    id: r.id,
    inventoryItemId: r.inventory_item_id,
    bidderOrgId: r.bidder_org_id,
    bidderOrgLabel: r.bidder_org_label,
    priceCents: r.price_cents,
    currency: r.currency,
    notes: r.notes,
    quantityRequested: r.quantity_requested,
    status: r.status,
    decidedAt:
      r.decided_at === null
        ? null
        : r.decided_at instanceof Date
        ? r.decided_at
        : new Date(r.decided_at),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}
