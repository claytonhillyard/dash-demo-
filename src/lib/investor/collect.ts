import { sql, desc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { revenueMonths, profitMonths } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { toUtcDay } from "@/lib/sentinel/capture";
import { resolveOrgLabel } from "@/lib/auth/orgLabel";
import { getReceivablesRows, getTrailingProfitMonths } from "@/db/runway";
import { computeReceivablesAging, computeRunway, type RunwayResult } from "@/lib/runway/compute";
import type { HealthBand } from "@/lib/customers/healthScore";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

/**
 * KPI snapshot for one org's investor update (spec §3, verbatim types below).
 *
 * Aggregates ONLY — no customer names, emails, or any per-customer detail.
 * This is type-level PII prevention: `src/lib/investor/narrative.ts` (slice
 * 41-2) builds its AI prompt from exactly this object, so whatever isn't
 * collected here structurally can't leak into the prompt.
 */
export type InvestorKpis = {
  periodLabel: string; // "July 2026" — from injected now, en-US month + year
  orgName: string;
  revenue: { months: Array<{ ym: string; cents: number }>; latestCents: number | null }; // up to 6, most-recent-first (legacy revenue_months)
  profit: { months: Array<{ ym: string; cents: number }>; latestCents: number | null }; // profit_months, same shape
  receivables: { totalCents: number; count: number; overdueCents: number }; // via getReceivablesRows + computeReceivablesAging (overdue = d1_30+d31_60+d61_plus)
  runway: RunwayResult; // computeRunway over trailing profits
  invoicing: { issuedCount: number; issuedCents: number; collectedCents: number }; // THIS calendar month (UTC), org-scoped
  customers: { total: number; healthMix: { healthy: number; watch: number; at_risk: number } | null }; // latest snapshot per customer; null when no snapshots
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** First date and one-past-last date (both "YYYY-MM-DD") for the UTC
 *  calendar month containing `now` — e.g. any July instant yields
 *  `{ start: "2026-07-01", nextStart: "2026-08-01" }`. `issue_date` /
 *  `received_date` are both `text` columns (house dates-as-text), so the
 *  month window is a plain string range (`>= start AND < nextStart`) rather
 *  than a date/timestamp comparison — mirrors `monthBounds` in
 *  src/db/queries.ts, reimplemented locally since that helper is private to
 *  the legacy company-queries module. */
function utcMonthWindow(now: Date): { start: string; nextStart: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1..12
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start: `${year}-${pad2(month)}-01`, nextStart: `${nextYear}-${pad2(nextMonth)}-01` };
}

// ---------------------------------------------------------------------------
// New org-scoped readers (slice 41). Each demo-branches internally, same
// idiom as getReceivablesRows/getCustomerActivityStats/getCustomers — the
// collector itself stays demo-agnostic (see collectInvestorKpis below).
// ---------------------------------------------------------------------------

/**
 * This-UTC-month issued-invoice count + total, org-scoped, filtered purely
 * by `issue_date` falling in `[monthStart, nextMonthStart)`. A draft's
 * `issue_date` is always NULL (comparing NULL with `>=` is never true in
 * SQL, so drafts are excluded with no extra predicate needed). A voided
 * invoice's `issue_date` is untouched by voiding, so it still counts here —
 * "issued this month" is a historical fact about what left the building,
 * not a snapshot of current status.
 *
 * `total_cents` is summed via a bigint `SUM(...)` (pglite/pg return that as
 * a string over the raw execute() path), hence the `Number()` coercion
 * below — same convention as `getReceivablesRows`. `count(*)::int` is safe
 * to cast directly (an org's monthly invoice count will never approach the
 * int4 ceiling) — same trick as `countAttachmentsByKind`
 * (src/db/dealAttachments.ts) and `getEmployeeCount` (src/db/queries.ts).
 */
async function getMonthlyInvoicing(
  db: Db,
  orgId: number,
  monthStart: string,
  nextMonthStart: string,
): Promise<{ issuedCount: number; issuedCents: number }> {
  if (isDemoMode()) {
    const { getSeedInvoicesForOrg } = await import("@/lib/demo/seed");
    const inRange = getSeedInvoicesForOrg(orgId, { limit: 10_000 }).filter(
      (inv) => inv.issueDate !== null && inv.issueDate >= monthStart && inv.issueDate < nextMonthStart,
    );
    return {
      issuedCount: inRange.length,
      issuedCents: inRange.reduce((sum, inv) => sum + inv.totalCents, 0),
    };
  }

  const res = await db.execute(sql`
    SELECT count(*)::int AS issued_count, COALESCE(SUM(total_cents), 0) AS issued_cents
    FROM invoices
    WHERE org_id = ${orgId}
      AND issue_date >= ${monthStart}
      AND issue_date < ${nextMonthStart}
  `);
  const [row] = rowsOf<{ issued_count: number; issued_cents: string | number }>(res);
  return {
    issuedCount: row?.issued_count ?? 0,
    issuedCents: Number(row?.issued_cents ?? 0),
  };
}

/**
 * This-UTC-month collected-payments sum, org-scoped, filtered by
 * `received_date` — same month-window/bigint-coercion rationale as
 * `getMonthlyInvoicing` above.
 */
async function getMonthlyCollected(
  db: Db,
  orgId: number,
  monthStart: string,
  nextMonthStart: string,
): Promise<number> {
  if (isDemoMode()) {
    const { DEMO_PAYMENTS } = await import("@/lib/demo/seed");
    return DEMO_PAYMENTS.filter(
      (p) => p.orgId === orgId && p.receivedDate >= monthStart && p.receivedDate < nextMonthStart,
    ).reduce((sum, p) => sum + p.amountCents, 0);
  }

  const res = await db.execute(sql`
    SELECT COALESCE(SUM(amount_cents), 0) AS collected_cents
    FROM payments
    WHERE org_id = ${orgId}
      AND received_date >= ${monthStart}
      AND received_date < ${nextMonthStart}
  `);
  const [row] = rowsOf<{ collected_cents: string | number }>(res);
  return Number(row?.collected_cents ?? 0);
}

/** Total customer count, org-scoped. `count(*)::int` cast is safe (see
 *  `getMonthlyInvoicing`'s comment above) — an org's customer count will
 *  never approach the int4 ceiling. */
async function getCustomerTotal(db: Db, orgId: number): Promise<number> {
  if (isDemoMode()) {
    const { getSeedCustomersForOrg } = await import("@/lib/demo/seed");
    return getSeedCustomersForOrg(orgId, { limit: 10_000 }).length;
  }

  const res = await db.execute(sql`SELECT count(*)::int AS total FROM customers WHERE org_id = ${orgId}`);
  const [row] = rowsOf<{ total: number }>(res);
  return row?.total ?? 0;
}

type HealthMix = { healthy: number; watch: number; at_risk: number };

/**
 * Latest-snapshot-per-customer band mix, org-scoped; null when the org has
 * no snapshot rows at all. Mirrors the greatest-n-per-group idiom Sentinel's
 * own capture step already uses (`SELECT DISTINCT ON (customer_id) ... ORDER
 * BY customer_id, captured_on DESC` — src/lib/sentinel/capture.ts), here
 * unfiltered by a specific customer-id list (every customer's latest row is
 * wanted, not a known subset), then grouped by band for the final counts.
 */
async function getHealthMix(db: Db, orgId: number): Promise<HealthMix | null> {
  if (isDemoMode()) {
    const { DEMO_HEALTH_SNAPSHOTS } = await import("@/lib/demo/seed");
    const latestByCustomer = new Map<number, { band: HealthBand; capturedOn: string }>();
    for (const s of DEMO_HEALTH_SNAPSHOTS) {
      if (s.orgId !== orgId) continue;
      const prior = latestByCustomer.get(s.customerId);
      if (!prior || s.capturedOn > prior.capturedOn) {
        latestByCustomer.set(s.customerId, { band: s.band, capturedOn: s.capturedOn });
      }
    }
    if (latestByCustomer.size === 0) return null;
    const mix: HealthMix = { healthy: 0, watch: 0, at_risk: 0 };
    for (const { band } of latestByCustomer.values()) mix[band] += 1;
    return mix;
  }

  const res = await db.execute(sql`
    SELECT band, count(*)::int AS n
    FROM (
      SELECT DISTINCT ON (customer_id) customer_id, band
      FROM customer_health_snapshots
      WHERE org_id = ${orgId}
      ORDER BY customer_id, captured_on DESC
    ) latest
    GROUP BY band
  `);
  const rows = rowsOf<{ band: string; n: number }>(res);
  if (rows.length === 0) return null;

  const mix: HealthMix = { healthy: 0, watch: 0, at_risk: 0 };
  for (const r of rows) {
    const band = r.band;
    if (band === "healthy" || band === "watch" || band === "at_risk") {
      mix[band] = r.n;
    }
  }
  return mix;
}

// ---------------------------------------------------------------------------
// Legacy single-tenant revenue/profit months (slice-2 era).
// ---------------------------------------------------------------------------

/**
 * Most-recent-first `{ ym, cents }` rows from the LEGACY single-tenant
 * `revenue_months` table (slice-2 era — predates multi-tenancy; the table
 * has NO org_id column). Read as-is, with NO org filter and NO demo branch:
 * there is no org column to filter by, and — unlike the multi-tenant tables
 * above — there is no per-customer PII here to hide behind a synthetic demo
 * dataset, so the real (possibly empty) table is read unconditionally. Same
 * rationale `getTrailingProfitMonths` (src/db/runway.ts) documents for the
 * sibling `profit_months` table; this legacy/multi-tenant mismatch is a
 * known cleanup-slice candidate (docs/ROADMAP.md "C-6") — out of scope
 * here. When the table is empty (including in the keyless demo deployment's
 * ephemeral pglite, which never receives this legacy data), the report's
 * KPI grid renders "—" for these rows (spec §5) rather than a synthesized
 * figure.
 *
 * `amount_cents` is a plain integer column (not a SUM aggregate), so
 * drizzle's query builder returns it as a JS number directly — no
 * `Number()` coercion needed, matching `getTrailingProfitMonths`'s comment.
 */
async function getRecentRevenueMonths(db: Db, n: number): Promise<Array<{ ym: string; cents: number }>> {
  const rows = await db
    .select({ year: revenueMonths.year, month: revenueMonths.month, amountCents: revenueMonths.amountCents })
    .from(revenueMonths)
    .orderBy(desc(revenueMonths.year), desc(revenueMonths.month))
    .limit(n);
  return rows.map((r) => ({ ym: `${r.year}-${pad2(r.month)}`, cents: r.amountCents }));
}

/** Profit-side twin of `getRecentRevenueMonths` above — same table shape,
 *  same legacy honesty rationale, `profit_months` instead of
 *  `revenue_months`. Kept as a separate tiny function rather than one
 *  generically parameterized over the table: the two drizzle table objects
 *  don't share a convenient common type for `.from()`/`.orderBy()`, and the
 *  duplication is only a few lines (same tradeoff `getCurrentMonthRevenueCents`
 *  / `getCurrentMonthProfitCents` make in src/db/queries.ts). */
async function getRecentProfitMonths(db: Db, n: number): Promise<Array<{ ym: string; cents: number }>> {
  const rows = await db
    .select({ year: profitMonths.year, month: profitMonths.month, amountCents: profitMonths.amountCents })
    .from(profitMonths)
    .orderBy(desc(profitMonths.year), desc(profitMonths.month))
    .limit(n);
  return rows.map((r) => ({ ym: `${r.year}-${pad2(r.month)}`, cents: r.amountCents }));
}

const REVENUE_PROFIT_MONTHS = 6;
const RUNWAY_TRAILING_MONTHS = 6;

/**
 * Assembles one org's investor-update KPI snapshot (spec §3). Read-only —
 * no writes, no migration, zero new deps. Reuses the slice-33 readers
 * (`getReceivablesRows` / `computeReceivablesAging` / `computeRunway` /
 * `getTrailingProfitMonths`) and `resolveOrgLabel` outright; every genuinely
 * new query above already demo-branches internally where it matters (the
 * multi-tenant ones), so there is no top-level `if (isDemoMode())` here —
 * the collector itself is demo-agnostic by construction.
 */
export async function collectInvestorKpis(db: Db, orgId: number, now: Date): Promise<InvestorKpis> {
  const periodLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
  const todayUtc = toUtcDay(now);
  const { start: monthStart, nextStart: nextMonthStart } = utcMonthWindow(now);

  const [
    orgName,
    receivableRows,
    trailingProfitCents,
    revenue,
    profit,
    monthlyInvoicing,
    collectedCents,
    customerTotal,
    healthMix,
  ] = await Promise.all([
    resolveOrgLabel(db, orgId),
    getReceivablesRows(db, orgId),
    getTrailingProfitMonths(db, RUNWAY_TRAILING_MONTHS),
    getRecentRevenueMonths(db, REVENUE_PROFIT_MONTHS),
    getRecentProfitMonths(db, REVENUE_PROFIT_MONTHS),
    getMonthlyInvoicing(db, orgId, monthStart, nextMonthStart),
    getMonthlyCollected(db, orgId, monthStart, nextMonthStart),
    getCustomerTotal(db, orgId),
    getHealthMix(db, orgId),
  ]);

  const aging = computeReceivablesAging(receivableRows, todayUtc);
  const overdueCents =
    aging.buckets.d1_30.totalCents + aging.buckets.d31_60.totalCents + aging.buckets.d61_plus.totalCents;
  const runway = computeRunway({ trailingProfitCents, receivablesTotalCents: aging.totalCents });

  return {
    periodLabel,
    orgName,
    revenue: { months: revenue, latestCents: revenue[0]?.cents ?? null },
    profit: { months: profit, latestCents: profit[0]?.cents ?? null },
    receivables: { totalCents: aging.totalCents, count: aging.count, overdueCents },
    runway,
    invoicing: {
      issuedCount: monthlyInvoicing.issuedCount,
      issuedCents: monthlyInvoicing.issuedCents,
      collectedCents,
    },
    customers: { total: customerTotal, healthMix },
  };
}
