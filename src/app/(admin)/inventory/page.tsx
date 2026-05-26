import Link from "next/link";
import { desc } from "drizzle-orm";
import { ensureDbReady } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { InventoryAdmin, type InventoryRow } from "@/components/inventory/InventoryAdmin";
import { createInventoryItem, deleteInventoryItem } from "@/lib/inventory/actions";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const db = await ensureDbReady();
  const rows = await db
    .select({
      id: inventoryItems.id,
      category: inventoryItems.category,
      name: inventoryItems.name,
      quantity: inventoryItems.quantity,
      status: inventoryItems.status,
      unitCostCents: inventoryItems.unitCostCents,
      retailPriceCents: inventoryItems.retailPriceCents,
    })
    .from(inventoryItems)
    .orderBy(desc(inventoryItems.updatedAt));

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <InventoryAdmin
        items={rows as InventoryRow[]}
        createAction={createInventoryItem}
        deleteAction={deleteInventoryItem}
      />
    </main>
  );
}
