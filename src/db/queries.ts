import { and, eq, sql, gte, lte, desc } from "drizzle-orm";
import type { Db } from "./client";
import {
  revenueMonths,
  revenueTransactions,
  profitMonths,
  clients,
  employees,
  projectionAssumptions,
} from "./schema";
import {
  operatingMarginPct,
  resolveMonthRevenue,
  projectFiveYears,
  type ProjectionPoint,
} from "./metrics";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First date and one-past-last date (YYYY-MM-DD) for a given year/month. */
function monthBounds(year: number, month: number): { start: string; nextStart: string } {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start: `${year}-${pad2(month)}-01`, nextStart: `${nextYear}-${pad2(nextMonth)}-01` };
}

async function bucketCentsFor(db: Db, year: number, month: number): Promise<number | null> {
  const rows = await db
    .select({ amountCents: revenueMonths.amountCents })
    .from(revenueMonths)
    .where(and(eq(revenueMonths.year, year), eq(revenueMonths.month, month)));
  return rows.length ? rows[0].amountCents : null;
}

async function txnCentsFor(db: Db, year: number, month: number): Promise<number[]> {
  const { start, nextStart } = monthBounds(year, month);
  const endInclusive = addDays(nextStart, -1);
  const rows = await db
    .select({ amountCents: revenueTransactions.amountCents })
    .from(revenueTransactions)
    .where(
      and(
        gte(revenueTransactions.occurredOn, start),
        lte(revenueTransactions.occurredOn, endInclusive)
      )
    );
  return rows.map((r) => r.amountCents);
}

export async function getCurrentMonthRevenueCents(
  db: Db,
  year: number,
  month: number
): Promise<number> {
  const [bucket, txns] = await Promise.all([
    bucketCentsFor(db, year, month),
    txnCentsFor(db, year, month),
  ]);
  return resolveMonthRevenue(bucket, txns);
}

export async function getCurrentMonthProfitCents(
  db: Db,
  year: number,
  month: number
): Promise<number> {
  const rows = await db
    .select({ amountCents: profitMonths.amountCents })
    .from(profitMonths)
    .where(and(eq(profitMonths.year, year), eq(profitMonths.month, month)));
  return rows.length ? rows[0].amountCents : 0;
}

export async function getCurrentOperatingMarginPct(
  db: Db,
  year: number,
  month: number
): Promise<number | null> {
  const [revenue, profit] = await Promise.all([
    getCurrentMonthRevenueCents(db, year, month),
    getCurrentMonthProfitCents(db, year, month),
  ]);
  return operatingMarginPct(profit, revenue);
}

export async function getClientCounts(db: Db): Promise<{ active: number; total: number }> {
  const rows = await db.select({ status: clients.status }).from(clients);
  const active = rows.filter((r) => r.status === "active").length;
  return { active, total: rows.length };
}

export async function getEmployeeCount(db: Db): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(employees);
  return rows[0]?.count ?? 0;
}

export interface MonthPoint {
  year: number;
  month: number;
  revenueCents: number;
  profitCents: number;
  clientsAdded: number;
}

/** Trailing 12 months ending at (year, month) inclusive — oldest first. */
export async function getTrailingTwelveMonths(
  db: Db,
  year: number,
  month: number
): Promise<MonthPoint[]> {
  const months: { year: number; month: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const total = year * 12 + (month - 1) - i;
    months.push({ year: Math.floor(total / 12), month: (total % 12) + 1 });
  }
  return Promise.all(
    months.map(async ({ year: y, month: m }) => {
      const { start, nextStart } = monthBounds(y, m);
      const endInclusive = addDays(nextStart, -1);
      const [revenueCents, profitCents, addedRows] = await Promise.all([
        getCurrentMonthRevenueCents(db, y, m),
        getCurrentMonthProfitCents(db, y, m),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(clients)
          .where(and(gte(clients.acquiredOn, start), lte(clients.acquiredOn, endInclusive))),
      ]);
      return {
        year: y,
        month: m,
        revenueCents,
        profitCents,
        clientsAdded: addedRows[0]?.count ?? 0,
      };
    })
  );
}

export interface Projection {
  points: ProjectionPoint[];
  updatedAt: Date;
}

export async function getProjection(db: Db): Promise<Projection | null> {
  const rows = await db
    .select()
    .from(projectionAssumptions)
    .orderBy(desc(projectionAssumptions.updatedAt))
    .limit(1);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    points: projectFiveYears(r.baseYear, r.baseRevenueCents, r.cagrPct, r.perYearOverrides),
    updatedAt: r.updatedAt,
  };
}
