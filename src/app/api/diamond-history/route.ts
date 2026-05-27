import { NextResponse } from "next/server";
import { ensureDbReady, type Db } from "@/db/client";
import { getDiamondTrend } from "@/db/diamonds";

export const dynamic = "force-dynamic";

// test seam (mirrors the action __setTestDb pattern for route-level tests)
let testDb: Db | null = null;
export function __setHistoryTestDb(db: Db | null): void { testDb = db; }

export async function GET(_request: Request) {
  const db = testDb ?? (await ensureDbReady());
  const points = await getDiamondTrend(db, "natural_index");
  return NextResponse.json({ points, freshness: "delayed" as const });
}
