import { getDb } from "@/db/client";
import { profitMonths } from "@/db/schema";
import { desc } from "drizzle-orm";
import { MonthAmountAdmin, type MonthRow } from "@/components/company/MonthAmountAdmin";
import { saveProfitMonth } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function ProfitPage() {
  const rows = (await getDb()
    .select({
      year: profitMonths.year,
      month: profitMonths.month,
      amountCents: profitMonths.amountCents,
    })
    .from(profitMonths)
    .orderBy(desc(profitMonths.year), desc(profitMonths.month))) as MonthRow[];

  return <MonthAmountAdmin title="Profit (monthly)" rows={rows} saveAction={saveProfitMonth} />;
}
