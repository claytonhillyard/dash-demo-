import type { Db } from "./client";
import {
  getCurrentMonthRevenueCents,
  getCurrentMonthProfitCents,
  getCurrentOperatingMarginPct,
  getClientCounts,
  getEmployeeCount,
  getTrailingTwelveMonths,
  getProjection,
  type MonthPoint,
  type Projection,
} from "./queries";

export interface DashboardKpis {
  revenueCents: number;
  profitCents: number;
  marginPct: number | null;
  activeClients: number;
  totalClients: number;
  employees: number;
}

export interface CompanyDashboard {
  kpis: DashboardKpis;
  series: MonthPoint[];
  projection: Projection | null;
  hasAnyData: boolean;
}

export async function readCompanyDashboard(
  db: Db,
  year: number,
  month: number
): Promise<CompanyDashboard> {
  const [revenueCents, profitCents, marginPct, counts, employeeCount, series, projection] =
    await Promise.all([
      getCurrentMonthRevenueCents(db, year, month),
      getCurrentMonthProfitCents(db, year, month),
      getCurrentOperatingMarginPct(db, year, month),
      getClientCounts(db),
      getEmployeeCount(db),
      getTrailingTwelveMonths(db, year, month),
      getProjection(db),
    ]);

  const hasAnyData =
    revenueCents > 0 || profitCents > 0 || counts.total > 0 || employeeCount > 0 || projection !== null;

  return {
    kpis: {
      revenueCents,
      profitCents,
      marginPct,
      activeClients: counts.active,
      totalClients: counts.total,
      employees: employeeCount,
    },
    series,
    projection,
    hasAnyData,
  };
}
