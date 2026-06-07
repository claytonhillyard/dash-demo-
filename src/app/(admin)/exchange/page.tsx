import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getSharedInventoryForOrg } from "@/db/inventory";
import { getCircleNamesForOrg } from "@/lib/circles/queries";
import { TradeNetInventoryList } from "@/components/inventory/TradeNetInventoryList";

export const dynamic = "force-dynamic";

export default async function ExchangePage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [items, circleNamesById] = await Promise.all([
    getSharedInventoryForOrg(db, orgId, null),
    getCircleNamesForOrg(db, orgId),
  ]);
  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">TradeNet Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <TradeNetInventoryList items={items} circleNamesById={circleNamesById} />
    </main>
  );
}
