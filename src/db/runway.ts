import { sql, desc } from "drizzle-orm";
import { type Db } from "@/db/client";
import { profitMonths } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import type { BillTo } from "@/db/invoices";
import type { ReceivableRow } from "@/lib/runway/compute";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

/**
 * Outstanding receivables for one org — issued invoices whose balance
 * (`totalCents - COALESCE(SUM(payments.amount_cents), 0)`) is > 0 (spec §5),
 * oldest first. Reuses the slice-29 grouped-subquery LEFT JOIN shape from
 * `getInvoices` (src/db/invoices.ts): the payments subquery is org-scoped
 * INSIDE itself (not just via the outer `i.org_id` filter), so a payment row
 * whose own org_id disagrees with its invoice's real owner can never
 * deflate this org's balances — see the adversarial-fixture test in
 * test/db/runway.test.ts (same trick as test/db/invoices.test.ts).
 * `SUM(amount_cents)` is a bigint aggregate — pglite/pg return it as a
 * string over the raw execute() path, hence the `Number()` coercion below
 * (same convention as getInvoices).
 *
 * Only the `ReceivableRow` fields are selected (not the full invoice row);
 * `billToName` comes from the frozen `bill_to` jsonb snapshot, same as
 * `getInvoices` — never a customers join.
 *
 * Ordering: oldest first by `COALESCE(due_date, issue_date)` ascending,
 * NULLS LAST, done in SQL — pglite is real Postgres under the hood, so the
 * standard `NULLS LAST` syntax works with no drizzle-specific quirk
 * (verified by the null-dates-row test in test/db/runway.test.ts).
 *
 * Demo branch derives from `getSeedInvoicesForOrg` (src/lib/demo/seed.ts),
 * which already folds `DEMO_PAYMENTS` sums into `paidCents` for each
 * invoice — filtered to `status: "issued"` then to `balanceCents > 0` and
 * sorted with the same oldest-first/nulls-last rule in JS (there's no SQL
 * to lean on for the in-memory seed array). 9302's partial balance is the
 * only demo receivable; 9301 (draft) and 9303 (void) never reach the
 * balance filter because the status filter already excludes them.
 */
export async function getReceivablesRows(db: Db, orgId: number): Promise<ReceivableRow[]> {
  if (isDemoMode()) {
    const { getSeedInvoicesForOrg } = await import("@/lib/demo/seed");
    const issued = getSeedInvoicesForOrg(orgId, { status: "issued" });
    return issued
      .map((inv) => ({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        billToName: inv.billToName,
        balanceCents: inv.totalCents - inv.paidCents,
        dueDate: inv.dueDate,
        issueDate: inv.issueDate,
      }))
      .filter((row) => row.balanceCents > 0)
      .sort(compareOldestFirstNullsLast);
  }

  const res = await db.execute(sql`
    SELECT i.id, i.invoice_number, i.bill_to, i.total_cents, i.due_date, i.issue_date,
           COALESCE(p.paid_cents, 0) AS paid_cents
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount_cents) AS paid_cents
      FROM payments
      WHERE org_id = ${orgId}
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    WHERE i.org_id = ${orgId}
      AND i.status = 'issued'
      AND i.total_cents - COALESCE(p.paid_cents, 0) > 0
    ORDER BY COALESCE(i.due_date, i.issue_date) ASC NULLS LAST, i.id ASC
  `);

  const rows = rowsOf<{
    id: number;
    invoice_number: string;
    bill_to: BillTo;
    total_cents: number;
    due_date: string | null;
    issue_date: string | null;
    paid_cents: string | number;
  }>(res);

  return rows.map((r) => ({
    invoiceId: Number(r.id),
    invoiceNumber: r.invoice_number,
    billToName: r.bill_to?.name ?? "",
    balanceCents: Number(r.total_cents) - Number(r.paid_cents),
    dueDate: r.due_date,
    issueDate: r.issue_date,
  }));
}

/** Oldest-first comparator mirroring the SQL reader's `ORDER BY
 *  COALESCE(due_date, issue_date) ASC NULLS LAST` — used only by the demo
 *  branch above, which has no SQL to lean on for its in-memory array.
 *  `dueDate ?? issueDate` are YYYY-MM-DD strings, so lexicographic
 *  comparison is chronological comparison; a row with BOTH null sorts
 *  last regardless of the other side. */
function compareOldestFirstNullsLast(a: ReceivableRow, b: ReceivableRow): number {
  const aKey = a.dueDate ?? a.issueDate;
  const bKey = b.dueDate ?? b.issueDate;
  if (aKey === null && bKey === null) return 0;
  if (aKey === null) return 1;
  if (bKey === null) return -1;
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

// --- Trailing profit (legacy single-tenant company table) ---

/**
 * Demo trailing-profit trend (spec §5) — 6 months of deterministic net
 * burn so the demo dashboard shows a live "burning" runway verdict
 * (`computeRunway` in src/lib/runway/compute.ts), never a wall-clock read
 * or `Math.random()`. Most-recent-first, matching this function's
 * real-branch contract.
 *
 * `DEMO_MONTHLY_BURN_VARIANCE_CENTS` deltas sum to exactly 0, so the
 * array's average is exactly `DEMO_MONTHLY_BURN_BASE_CENTS`
 * (-$8,500.00/mo) — locked by the demo-branch test in
 * test/db/runway.test.ts.
 */
const DEMO_MONTHLY_BURN_BASE_CENTS = -850_000; // -$8,500.00/mo baseline burn
const DEMO_MONTHLY_BURN_VARIANCE_CENTS = [-50_000, 30_000, -20_000, 40_000, -10_000, 10_000]; // sums to 0
const DEMO_TRAILING_PROFIT_CENTS: number[] = DEMO_MONTHLY_BURN_VARIANCE_CENTS.map(
  (delta) => DEMO_MONTHLY_BURN_BASE_CENTS + delta,
);

/**
 * Most-recent-first monthly profit figures from the LEGACY single-tenant
 * `profit_months` table (slice-2 era — predates multi-tenancy; the table
 * has NO org_id column, same as the /company/profit admin page that
 * manages it — src/app/(admin)/company/profit/page.tsx). Read as-is, with
 * NO org filter: there is no org column on this table to filter by, and
 * adding a phantom one would be wrong, not safer (spec §3, load-bearing —
 * the panel labels this figure "company profit trend" rather than
 * implying it's org-scoped). This legacy/multi-tenant mismatch is a known
 * cleanup-slice candidate (docs/ROADMAP.md §9 "Cleanup / refactor
 * slices") — out of scope here.
 *
 * `profit_months.amount_cents` is a plain integer column (not a SUM
 * aggregate), so drizzle's query builder returns it as a JS number
 * directly — no `Number()` coercion needed here (contrast
 * `getReceivablesRows`'s `paid_cents`, which IS a bigint SUM aggregate
 * coerced via `Number()`).
 */
export async function getTrailingProfitMonths(db: Db, n: number): Promise<number[]> {
  if (isDemoMode()) {
    return DEMO_TRAILING_PROFIT_CENTS.slice(0, n);
  }

  const rows = await db
    .select({ amountCents: profitMonths.amountCents })
    .from(profitMonths)
    .orderBy(desc(profitMonths.year), desc(profitMonths.month))
    .limit(n);

  return rows.map((r) => r.amountCents);
}
