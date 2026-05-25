import { NextResponse } from "next/server";
import { fetchHistory, type Range } from "@/lib/market/history";

export const dynamic = "force-dynamic";

const RANGES: Range[] = ["1D", "7D", "1M", "3M", "1Y", "ALL"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") ?? "BTC";
  const rangeParam = searchParams.get("range") as Range | null;
  const range: Range = rangeParam && RANGES.includes(rangeParam) ? rangeParam : "1M";
  const series = await fetchHistory(symbol, range);
  return NextResponse.json(series);
}
