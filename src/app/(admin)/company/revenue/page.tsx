import { getDb } from "@/db/client";
import { revenueMonths, revenueTransactions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { MonthAmountAdmin, type MonthRow } from "@/components/company/MonthAmountAdmin";
import { RevenueTxnAdmin, type TxnRow } from "@/components/company/RevenueTxnAdmin";
import { saveRevenueMonth, addRevenueTransaction, deleteRevenueTransaction } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function RevenuePage() {
  const db = getDb();
  const months = (await db
    .select({
      year: revenueMonths.year,
      month: revenueMonths.month,
      amountCents: revenueMonths.amountCents,
    })
    .from(revenueMonths)
    .orderBy(desc(revenueMonths.year), desc(revenueMonths.month))) as MonthRow[];

  const txns = (await db
    .select({
      id: revenueTransactions.id,
      occurredOn: revenueTransactions.occurredOn,
      amountCents: revenueTransactions.amountCents,
      memo: revenueTransactions.memo,
    })
    .from(revenueTransactions)
    .orderBy(desc(revenueTransactions.occurredOn))) as TxnRow[];

  return (
    <div className="space-y-4">
      <MonthAmountAdmin title="Revenue (manual monthly bucket)" rows={months} saveAction={saveRevenueMonth} />
      <RevenueTxnAdmin rows={txns} addAction={addRevenueTransaction} deleteAction={deleteRevenueTransaction} />
    </div>
  );
}
