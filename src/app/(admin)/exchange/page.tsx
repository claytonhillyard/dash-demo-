import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getSharedInventoryForOrg } from "@/db/inventory";
import { getInventoryBidsForItem, type InventoryBidView } from "@/db/inventoryBids";
import { getCircleNamesForOrg } from "@/lib/circles/queries";
import { TradeNetInventoryListIsland } from "@/components/inventory/TradeNetInventoryListIsland";

export const dynamic = "force-dynamic";

export default async function ExchangePage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [items, circleNamesById] = await Promise.all([
    getSharedInventoryForOrg(db, orgId, null),
    getCircleNamesForOrg(db, orgId),
  ]);
  // Pre-fetch bids per biddable item (bid_mode !== null). Parallel — cheap.
  const biddable = items.filter((it) => it.bidMode !== null);
  const perItemBids = await Promise.all(
    biddable.map(async (it) => [it.id, await getInventoryBidsForItem(db, orgId, it.id)] as const),
  );
  const bidsByItemId = new Map<number, InventoryBidView[]>(perItemBids);
  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">TradeNet Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <TradeNetInventoryListIsland
        items={items}
        circleNamesById={circleNamesById}
        viewerOrgId={orgId}
        bidsByItemId={bidsByItemId}
      />
    </main>
  );
}
