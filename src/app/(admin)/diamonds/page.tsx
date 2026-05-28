import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ensureDbReady } from "@/db/client";
import { diamondPricePoints } from "@/db/schema";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { DiamondAdmin, type PricePointRow } from "@/components/diamonds/DiamondAdmin";
import { importMatrix, savePricePoint, deletePricePoint } from "@/lib/diamonds/actions";

export const dynamic = "force-dynamic";

export default async function DiamondsPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const rows = await db
    .select({
      id: diamondPricePoints.id,
      label: diamondPricePoints.label,
      kind: diamondPricePoints.kind,
      pricePerCaratCents: diamondPricePoints.pricePerCaratCents,
    })
    .from(diamondPricePoints)
    .where(eq(diamondPricePoints.orgId, orgId))
    .orderBy(asc(diamondPricePoints.label));

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Diamond &amp; Gem Pricing</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <DiamondAdmin
        points={rows as PricePointRow[]}
        importAction={importMatrix}
        savePoint={savePricePoint}
        deletePoint={deletePricePoint}
      />
    </main>
  );
}
