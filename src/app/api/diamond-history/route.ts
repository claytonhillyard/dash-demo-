import { NextResponse } from "next/server";
import { ensureDbReady } from "@/db/client";
import { getDiamondTrend } from "@/db/diamonds";

export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  const db = await ensureDbReady();
  const points = await getDiamondTrend(db, "natural_index");
  return NextResponse.json({ points, freshness: "delayed" as const });
}
