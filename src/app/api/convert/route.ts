import { NextResponse } from "next/server";
import { fetchCurrencyList, convertCurrency } from "@/lib/market/convert";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    const currencies = await fetchCurrencyList();
    return NextResponse.json({ currencies });
  }

  const amount = Number(searchParams.get("amount") ?? "1");
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 1;
  const conversion = await convertCurrency(from, to, safeAmount);
  return NextResponse.json(conversion);
}
