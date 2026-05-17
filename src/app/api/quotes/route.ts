import { NextResponse } from "next/server";
import { getQuoteCache } from "@/lib/market/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const cache = getQuoteCache();
  if (cache.snapshot().length === 0) await cache.refresh();
  return NextResponse.json({ quotes: cache.snapshot() });
}
