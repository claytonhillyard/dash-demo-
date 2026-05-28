import { NextResponse } from "next/server";
import { ensureDbReady } from "@/db/client";
import { getDiamondTrend } from "@/db/diamonds";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";

export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const points = await getDiamondTrend(db, "natural_index", orgId);
  return NextResponse.json({ points, freshness: "delayed" as const });
}
