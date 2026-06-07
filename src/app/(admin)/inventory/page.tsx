import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ensureDbReady } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { InventoryAdmin, type InventoryRow } from "@/components/inventory/InventoryAdmin";
import { createInventoryItem, updateInventoryItem, deleteInventoryItem } from "@/lib/inventory/actions";
import { getCirclesForOrg } from "@/lib/circles/queries";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  // Tenancy: this page was previously selecting ALL inventory rows across orgs
  // because it bypassed the centralized query module (which is what carries the
  // org filter). Filter explicitly here. Worth a follow-up lint rule banning
  // `.from(tenantedTable)` outside the per-table query module.
  const [rows, myCircles] = await Promise.all([
    db
      .select({
        id: inventoryItems.id,
        category: inventoryItems.category,
        name: inventoryItems.name,
        quantity: inventoryItems.quantity,
        status: inventoryItems.status,
        unitCostCents: inventoryItems.unitCostCents,
        retailPriceCents: inventoryItems.retailPriceCents,
        visibilityCircleId: inventoryItems.visibilityCircleId,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.orgId, orgId))
      .orderBy(desc(inventoryItems.updatedAt)),
    getCirclesForOrg(db, orgId),
  ]);
  const circleNamesById = new Map(myCircles.map((c) => [c.id, c.name]));

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <InventoryAdmin
        items={rows as InventoryRow[]}
        createAction={createInventoryItem}
        updateAction={updateInventoryItem}
        deleteAction={deleteInventoryItem}
        circles={myCircles.map((c) => ({ id: c.id, name: c.name }))}
        circleNamesById={circleNamesById}
      />
    </main>
  );
}
