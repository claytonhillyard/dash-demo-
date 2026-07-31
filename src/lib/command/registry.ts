import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";
import { getReceivablesRows, getTrailingProfitMonths } from "@/db/runway";
import { computeReceivablesAging, computeRunway, daysBetweenUtc } from "@/lib/runway/compute";
import { formatRunwayVerdict } from "@/lib/investor/narrative";
import { getRecentRevenueMonths, getRecentProfitMonths } from "@/lib/investor/collect";
import { getOrgActivity, ACTIVITY_MAX_LIMIT } from "@/db/activityEvents";
import { relativeTime } from "@/lib/format/bids";
import { formatCentsExact } from "@/lib/company/format";
import { toUtcDay } from "@/lib/sentinel/capture";
import { getSnapshotTrend } from "@/lib/sentinel/trend";
import type { HealthBand } from "@/lib/customers/healthScore";

/**
 * Read-only AI command palette — command registry + executors (slice 35a-1,
 * spec §3 authoritative). The AI's ONLY job (src/lib/command/route.ts, slice
 * 35a-2) is mapping a free-text question to `{command, params}` from the
 * fixed catalog below — no business data ever enters a prompt. Every
 * executor here is a deterministic, org-scoped reader; numbers on screen
 * always come from these, never from the model.
 *
 * SERVER-ONLY: this module pulls in the full db graph (drizzle, every
 * reader). The client palette (src/components/command/CommandPalette.tsx,
 * task 35a-3) must NEVER import this file directly — it receives
 * `HELP_EXAMPLES` via page props (static strings, safe for the client
 * bundle) and live results via the `runCommand` server action. Structural
 * verification of that boundary is a task-35a-3 review probe.
 */

// ---------------------------------------------------------------------------
// Types — spec §3, verbatim.
// ---------------------------------------------------------------------------

export type CommandResult =
  | { kind: "stat"; label: string; value: string; detail?: string }
  | { kind: "table"; title: string; columns: string[]; rows: string[][]; links?: Array<string | null> } // links[i] = href for row i
  | { kind: "list"; title: string; items: Array<{ text: string; href?: string }> }
  | { kind: "help"; intro: string; examples: string[] };

export type CommandDef<P> = {
  id: CommandId;
  description: string; // one line — shown to the AI router AND in help
  examples: string[]; // 3-5 phrasings — power the rules matcher AND help
  params: z.ZodType<P>;
  run(db: Db, orgId: number, params: P): Promise<CommandResult>;
};

export type CommandId =
  | "overdue_invoices"
  | "receivables_summary"
  | "runway"
  | "at_risk_customers"
  | "customer_lookup"
  | "recent_activity"
  | "revenue_trend"
  | "unpaid_by_customer";

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/** Same convention every raw-`db.execute()` module in this codebase repeats
 *  locally (src/db/customers.ts, src/db/runway.ts, src/lib/investor/collect.ts,
 *  ...) rather than importing from one shared util. */
function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

function formatBandLabel(band: HealthBand): string {
  switch (band) {
    case "at_risk":
      return "At risk";
    case "watch":
      return "Watch";
    case "healthy":
      return "Healthy";
  }
}

// ===========================================================================
// overdue_invoices
// ===========================================================================

const overdueInvoicesParams = z.object({
  minDays: z.number().int().min(0).max(3650).optional().default(1),
});
type OverdueInvoicesParams = z.infer<typeof overdueInvoicesParams>;

const overdueInvoicesCommand: CommandDef<OverdueInvoicesParams> = {
  id: "overdue_invoices",
  description: "Lists overdue outstanding invoices, most overdue first.",
  examples: [
    "who owes me money",
    "which invoices are overdue",
    "show overdue invoices",
    "who's late on paying",
    "outstanding overdue invoices",
  ],
  params: overdueInvoicesParams,
  async run(db, orgId, params) {
    const rows = await getReceivablesRows(db, orgId);
    const todayUtc = toUtcDay(new Date());

    // getReceivablesRows is already oldest-first by COALESCE(due_date,
    // issue_date) — the earliest reference date is the MOST overdue one, so
    // filtering this sequence (without re-sorting) already yields
    // most-overdue-first, exactly what "who owes me money" wants at the top.
    const overdue = rows
      .map((row) => {
        const refDate = row.dueDate ?? row.issueDate;
        // No date to measure overdue-ness against -> treat as not overdue,
        // same no-evidence rationale computeReceivablesAging documents.
        const daysOverdue = refDate === null ? 0 : daysBetweenUtc(refDate, todayUtc);
        return { row, daysOverdue };
      })
      .filter(({ daysOverdue }) => daysOverdue >= params.minDays);

    return {
      kind: "table",
      title: params.minDays <= 1 ? "Overdue invoices" : `Overdue invoices (${params.minDays}+ days late)`,
      columns: ["Invoice", "Customer", "Balance", "Days overdue"],
      rows: overdue.map(({ row, daysOverdue }) => [
        row.invoiceNumber,
        row.billToName,
        formatCentsExact(row.balanceCents),
        String(daysOverdue),
      ]),
      links: overdue.map(({ row }) => `/invoices/${row.invoiceId}/edit`),
    };
  },
};

// ===========================================================================
// receivables_summary
// ===========================================================================

const receivablesSummaryParams = z.object({});
type ReceivablesSummaryParams = z.infer<typeof receivablesSummaryParams>;

const receivablesSummaryCommand: CommandDef<ReceivablesSummaryParams> = {
  id: "receivables_summary",
  description: "Total outstanding receivables with an aging breakdown.",
  examples: ["how much is outstanding", "what's my total receivables", "receivables summary", "how much am I owed"],
  params: receivablesSummaryParams,
  async run(db, orgId, _params) {
    const rows = await getReceivablesRows(db, orgId);
    const aging = computeReceivablesAging(rows, toUtcDay(new Date()));
    const detail =
      `Current ${formatCentsExact(aging.buckets.current.totalCents)} · ` +
      `1-30d ${formatCentsExact(aging.buckets.d1_30.totalCents)} · ` +
      `31-60d ${formatCentsExact(aging.buckets.d31_60.totalCents)} · ` +
      `61+d ${formatCentsExact(aging.buckets.d61_plus.totalCents)} — across ${aging.count} invoice(s)`;
    return {
      kind: "stat",
      label: "Outstanding receivables",
      value: formatCentsExact(aging.totalCents),
      detail,
    };
  },
};

// ===========================================================================
// runway
// ===========================================================================

const runwayParams = z.object({});
type RunwayParams = z.infer<typeof runwayParams>;

const RUNWAY_TRAILING_MONTHS = 6; // mirrors collectInvestorKpis's window (slice 41)

const runwayCommand: CommandDef<RunwayParams> = {
  id: "runway",
  description: "Cash runway based on trailing profit and outstanding receivables.",
  examples: ["how's my runway", "how's my cash", "what's my burn rate", "cash runway"],
  params: runwayParams,
  async run(db, orgId, _params) {
    const [rows, trailingProfitCents] = await Promise.all([
      getReceivablesRows(db, orgId),
      getTrailingProfitMonths(db, RUNWAY_TRAILING_MONTHS),
    ]);
    const aging = computeReceivablesAging(rows, toUtcDay(new Date()));
    const runway = computeRunway({ trailingProfitCents, receivablesTotalCents: aging.totalCents });
    return {
      kind: "stat",
      label: "Cash runway",
      value: formatRunwayVerdict(runway),
    };
  },
};

// ===========================================================================
// at_risk_customers
// ===========================================================================

const atRiskCustomersParams = z.object({
  band: z.enum(["at_risk", "watch"]).optional().default("at_risk"),
});
type AtRiskCustomersParams = z.infer<typeof atRiskCustomersParams>;

type BandCustomerRow = { customerId: number; name: string; capturedOn: string };

/**
 * Latest-snapshot-per-customer, filtered to one band (spec §3) — the
 * sentinel DISTINCT ON idiom (src/lib/sentinel/capture.ts's
 * captureHealthSnapshots / src/lib/investor/collect.ts's getHealthMix),
 * extended with a customers JOIN so the result carries a name + id for the
 * table's edit link. Org-scoped BOTH inside the snapshot subquery AND on
 * the customers JOIN — same defense-in-depth idiom getReceivablesRows uses
 * for its payments subquery.
 */
async function getCustomersByBand(db: Db, orgId: number, band: HealthBand): Promise<BandCustomerRow[]> {
  if (isDemoMode()) {
    const { DEMO_HEALTH_SNAPSHOTS, DEMO_CUSTOMERS } = await import("@/lib/demo/seed");
    const latestByCustomer = new Map<number, { band: HealthBand; capturedOn: string }>();
    for (const s of DEMO_HEALTH_SNAPSHOTS) {
      if (s.orgId !== orgId) continue;
      const prior = latestByCustomer.get(s.customerId);
      if (!prior || s.capturedOn > prior.capturedOn) {
        latestByCustomer.set(s.customerId, { band: s.band, capturedOn: s.capturedOn });
      }
    }
    const nameById = new Map(DEMO_CUSTOMERS.filter((c) => c.orgId === orgId).map((c) => [c.id, c.name]));
    const out: BandCustomerRow[] = [];
    for (const [customerId, v] of latestByCustomer) {
      if (v.band !== band) continue;
      const name = nameById.get(customerId);
      if (name === undefined) continue; // snapshot with no matching org customer row
      out.push({ customerId, name, capturedOn: v.capturedOn });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const res = await db.execute(sql`
    SELECT c.id AS customer_id, c.name AS name, latest.captured_on AS captured_on
    FROM (
      SELECT DISTINCT ON (customer_id) customer_id, band, captured_on
      FROM customer_health_snapshots
      WHERE org_id = ${orgId}
      ORDER BY customer_id, captured_on DESC
    ) latest
    JOIN customers c ON c.id = latest.customer_id AND c.org_id = ${orgId}
    WHERE latest.band = ${band}
    ORDER BY c.name ASC
  `);
  const rows = rowsOf<{ customer_id: number; name: string; captured_on: string }>(res);
  return rows.map((r) => ({ customerId: Number(r.customer_id), name: r.name, capturedOn: r.captured_on }));
}

const atRiskCustomersCommand: CommandDef<AtRiskCustomersParams> = {
  id: "at_risk_customers",
  description: "Customers whose latest health snapshot is at-risk or watch.",
  examples: ["show at-risk customers", "which customers are at risk", "who's cooling off", "watch-list customers"],
  params: atRiskCustomersParams,
  async run(db, orgId, params) {
    const rows = await getCustomersByBand(db, orgId, params.band);
    return {
      kind: "table",
      title: `Customers — ${formatBandLabel(params.band)}`,
      columns: ["Customer", "Band", "As of"],
      rows: rows.map((r) => [r.name, formatBandLabel(params.band), r.capturedOn]),
      links: rows.map((r) => `/customers/${r.customerId}/edit`),
    };
  },
};

// ===========================================================================
// customer_lookup
// ===========================================================================

const customerLookupParams = z.object({
  query: z.string().trim().min(1).max(100),
});
type CustomerLookupParams = z.infer<typeof customerLookupParams>;

type CustomerMatch = { id: number; name: string; businessName: string | null };

/**
 * Case-insensitive contains match on name/business_name ONLY (slice-30
 * resolution idiom's shape — batch-load, normalize case — adapted from
 * "exact ref/name" to "contains", per spec §3). The column list here is a
 * deliberate allowlist, not `SELECT *`: `customers.style_note` (slice 37's
 * private per-customer drafting note, F4 lineage) is NEVER selected in this
 * module, so a future column addition can't silently leak into a command
 * result the way `SELECT *` would risk.
 */
async function findCustomersByQuery(db: Db, orgId: number, query: string): Promise<CustomerMatch[]> {
  if (isDemoMode()) {
    const { DEMO_CUSTOMERS } = await import("@/lib/demo/seed");
    const needle = query.toLowerCase();
    return DEMO_CUSTOMERS.filter(
      (c) =>
        c.orgId === orgId &&
        (c.name.toLowerCase().includes(needle) || (c.businessName ?? "").toLowerCase().includes(needle)),
    )
      .map((c) => ({ id: c.id, name: c.name, businessName: c.businessName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const res = await db.execute(sql`
    SELECT id, name, business_name
    FROM customers
    WHERE org_id = ${orgId}
      AND (name ILIKE '%' || ${query} || '%' OR business_name ILIKE '%' || ${query} || '%')
    ORDER BY name ASC
  `);
  const rows = rowsOf<{ id: number; name: string; business_name: string | null }>(res);
  return rows.map((r) => ({ id: Number(r.id), name: r.name, businessName: r.business_name }));
}

type UnpaidByCustomerRow = { customerId: number; customerName: string; balanceCents: number };

/**
 * Outstanding balance grouped by customer, org-scoped INSIDE the payments
 * subquery AND OUTSIDE on both `customers`/`invoices` — the receivables JOIN
 * shape from `getReceivablesRows` (src/db/runway.ts), regrouped by customer
 * instead of returned per-invoice. This is the ONE new aggregate query the
 * registry adds (spec §3); shared by the `unpaid_by_customer` executor below
 * AND `customer_lookup`'s single-match balance line, so the two can never
 * disagree on what a customer owes.
 */
async function getUnpaidByCustomer(db: Db, orgId: number): Promise<UnpaidByCustomerRow[]> {
  if (isDemoMode()) {
    const { DEMO_INVOICES, DEMO_PAYMENTS, DEMO_CUSTOMERS } = await import("@/lib/demo/seed");
    const nameById = new Map(DEMO_CUSTOMERS.filter((c) => c.orgId === orgId).map((c) => [c.id, c.name]));
    const balanceByCustomer = new Map<number, number>();
    for (const inv of DEMO_INVOICES) {
      if (inv.orgId !== orgId || inv.status !== "issued") continue;
      const paid = DEMO_PAYMENTS.filter((p) => p.orgId === orgId && p.invoiceId === inv.id).reduce(
        (sum, p) => sum + p.amountCents,
        0,
      );
      const balance = inv.totalCents - paid;
      if (balance <= 0) continue;
      balanceByCustomer.set(inv.customerId, (balanceByCustomer.get(inv.customerId) ?? 0) + balance);
    }
    const out: UnpaidByCustomerRow[] = [];
    for (const [customerId, balanceCents] of balanceByCustomer) {
      const customerName = nameById.get(customerId);
      if (customerName === undefined) continue;
      out.push({ customerId, customerName, balanceCents });
    }
    return out.sort((a, b) => b.balanceCents - a.balanceCents);
  }

  const res = await db.execute(sql`
    SELECT c.id AS customer_id, c.name AS customer_name,
           COALESCE(SUM(i.total_cents - COALESCE(p.paid_cents, 0)), 0) AS balance_cents
    FROM customers c
    JOIN invoices i ON i.customer_id = c.id AND i.org_id = ${orgId}
    LEFT JOIN (
      SELECT invoice_id, SUM(amount_cents) AS paid_cents
      FROM payments
      WHERE org_id = ${orgId}
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    WHERE c.org_id = ${orgId}
      AND i.status = 'issued'
    GROUP BY c.id, c.name
    HAVING COALESCE(SUM(i.total_cents - COALESCE(p.paid_cents, 0)), 0) > 0
    ORDER BY balance_cents DESC
  `);
  const rows = rowsOf<{ customer_id: number; customer_name: string; balance_cents: string | number }>(res);
  // balance_cents is a bigint SUM aggregate — pglite/pg return it as a
  // string over the raw execute() path, same Number() coercion convention
  // as getReceivablesRows's paid_cents.
  return rows.map((r) => ({
    customerId: Number(r.customer_id),
    customerName: r.customer_name,
    balanceCents: Number(r.balance_cents),
  }));
}

type LastInvoice = { invoiceNumber: string; issueDate: string | null };

/** Most recent invoice (any status) for one customer, org-scoped. Small and
 *  single-purpose enough to write directly rather than composing it from a
 *  broader reader — `getReceivablesRows` only covers outstanding *issued*
 *  invoices, which would silently hide a customer's most recent invoice if
 *  it happened to be a draft or already fully paid. */
async function getLastInvoiceForCustomer(db: Db, orgId: number, customerId: number): Promise<LastInvoice | null> {
  if (isDemoMode()) {
    const { DEMO_INVOICES } = await import("@/lib/demo/seed");
    const rows = DEMO_INVOICES.filter((inv) => inv.orgId === orgId && inv.customerId === customerId)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const top = rows[0];
    return top ? { invoiceNumber: top.invoiceNumber, issueDate: top.issueDate } : null;
  }

  const res = await db.execute(sql`
    SELECT invoice_number, issue_date
    FROM invoices
    WHERE org_id = ${orgId} AND customer_id = ${customerId}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const [row] = rowsOf<{ invoice_number: string; issue_date: string | null }>(res);
  return row ? { invoiceNumber: row.invoice_number, issueDate: row.issue_date } : null;
}

const customerLookupCommand: CommandDef<CustomerLookupParams> = {
  id: "customer_lookup",
  description: "Looks up a customer by name or business and summarizes their account.",
  examples: [
    "what's the story with Tanaka",
    "look up Mehta Diamonds",
    "tell me about a customer",
    "customer lookup",
  ],
  params: customerLookupParams,
  async run(db, orgId, params) {
    const matches = await findCustomersByQuery(db, orgId, params.query);

    if (matches.length === 0) {
      return {
        kind: "list",
        title: `No matches for "${params.query}"`,
        items: [
          {
            text: `No customers found matching "${params.query}" — check the spelling, or try just part of the name.`,
          },
        ],
      };
    }

    if (matches.length >= 2) {
      return {
        kind: "table",
        title: `Customers matching "${params.query}"`,
        columns: ["Customer", "Business"],
        rows: matches.map((m) => [m.name, m.businessName ?? "—"]),
        links: matches.map((m) => `/customers/${m.id}/edit`),
      };
    }

    const match = matches[0]!;
    const [unpaid, lastInvoice, trend] = await Promise.all([
      getUnpaidByCustomer(db, orgId),
      getLastInvoiceForCustomer(db, orgId, match.id),
      getSnapshotTrend(db, orgId, match.id),
    ]);
    const balanceCents = unpaid.find((u) => u.customerId === match.id)?.balanceCents ?? 0;

    // customers.style_note (slice 37's private per-customer drafting note,
    // F4 lineage) is deliberately never read anywhere in this module — see
    // findCustomersByQuery's column allowlist above — so it structurally
    // cannot appear in this (or any) command result.
    return {
      kind: "list",
      title: match.businessName ? `${match.name} — ${match.businessName}` : match.name,
      items: [
        { text: match.name, href: `/customers/${match.id}/edit` },
        { text: `Outstanding balance: ${formatCentsExact(balanceCents)}` },
        {
          text: lastInvoice
            ? `Last invoice: ${lastInvoice.invoiceNumber} (${lastInvoice.issueDate ?? "no issue date"})`
            : "Last invoice: none on file",
        },
        { text: `Health: ${trend ? formatBandLabel(trend.current.band) : "no health data yet"}` },
      ],
    };
  },
};

// ===========================================================================
// recent_activity
// ===========================================================================

const recentActivityParams = z.object({
  days: z.number().int().min(1).max(90).optional().default(7),
});
type RecentActivityParams = z.infer<typeof recentActivityParams>;

const RECENT_ACTIVITY_CAP = 15;

const recentActivityCommand: CommandDef<RecentActivityParams> = {
  id: "recent_activity",
  description: "Recent activity across the org (customers, invoices, payments).",
  examples: ["what happened this week", "recent activity", "what's new", "show recent activity"],
  params: recentActivityParams,
  async run(db, orgId, params) {
    // getOrgActivity has no days-window concept of its own — fetch with
    // generous headroom (its own max limit) already newest-first, then
    // apply the days window + final cap here in JS.
    const events = await getOrgActivity(db, orgId, { limit: ACTIVITY_MAX_LIMIT });
    const cutoff = Date.now() - params.days * 86_400_000;
    const windowed = events.filter((e) => e.createdAt.getTime() >= cutoff).slice(0, RECENT_ACTIVITY_CAP);

    return {
      kind: "list",
      title: `Recent activity (last ${params.days} day${params.days === 1 ? "" : "s"})`,
      items: windowed.map((e) => ({ text: `${e.summary} — ${relativeTime(e.createdAt)}` })),
    };
  },
};

// ===========================================================================
// revenue_trend
// ===========================================================================

const revenueTrendParams = z.object({});
type RevenueTrendParams = z.infer<typeof revenueTrendParams>;

const REVENUE_TREND_MONTHS = 6; // mirrors collectInvestorKpis's REVENUE_PROFIT_MONTHS window

const revenueTrendCommand: CommandDef<RevenueTrendParams> = {
  id: "revenue_trend",
  description: "Monthly revenue and profit trend.",
  examples: ["how's revenue lately", "revenue trend", "show revenue by month", "how's revenue trending"],
  params: revenueTrendParams,
  // NOTE: unlike every other executor here, this one is NOT org-scoped —
  // `getRecentRevenueMonths`/`getRecentProfitMonths` read the LEGACY
  // single-tenant revenue_months/profit_months tables (slice-2 era, no
  // org_id column at all), exactly as src/lib/investor/collect.ts's
  // identical collectInvestorKpis reader does, for the identical reason
  // documented on both of those functions. `orgId` is accepted (unused) to
  // keep this executor's signature uniform with every other CommandDef.
  async run(db, _orgId, _params) {
    const [revenue, profit] = await Promise.all([
      getRecentRevenueMonths(db, REVENUE_TREND_MONTHS),
      getRecentProfitMonths(db, REVENUE_TREND_MONTHS),
    ]);

    const byYm = new Map<string, { revenueCents?: number; profitCents?: number }>();
    for (const r of revenue) byYm.set(r.ym, { ...byYm.get(r.ym), revenueCents: r.cents });
    for (const p of profit) byYm.set(p.ym, { ...byYm.get(p.ym), profitCents: p.cents });

    // Most-recent-first — both source arrays already are, but their month
    // sets can differ (a month with revenue but no profit entry, or vice
    // versa), so the merged key set is re-sorted rather than trusted.
    const yms = [...byYm.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    return {
      kind: "table",
      title: "Revenue & profit trend",
      columns: ["Month", "Revenue", "Profit"],
      rows: yms.map((ym) => {
        const v = byYm.get(ym)!;
        return [
          ym,
          v.revenueCents !== undefined ? formatCentsExact(v.revenueCents) : "—",
          v.profitCents !== undefined ? formatCentsExact(v.profitCents) : "—",
        ];
      }),
    };
  },
};

// ===========================================================================
// unpaid_by_customer
// ===========================================================================

const unpaidByCustomerParams = z.object({});
type UnpaidByCustomerParams = z.infer<typeof unpaidByCustomerParams>;

const unpaidByCustomerCommand: CommandDef<UnpaidByCustomerParams> = {
  id: "unpaid_by_customer",
  description: "Outstanding invoice balance grouped by customer.",
  examples: ["balances by customer", "who owes what", "unpaid by customer", "outstanding balance per customer"],
  params: unpaidByCustomerParams,
  async run(db, orgId, _params) {
    const rows = await getUnpaidByCustomer(db, orgId);
    return {
      kind: "table",
      title: "Outstanding balance by customer",
      columns: ["Customer", "Balance"],
      rows: rows.map((r) => [r.customerName, formatCentsExact(r.balanceCents)]),
      links: rows.map((r) => `/customers/${r.customerId}/edit`),
    };
  },
};

// ---------------------------------------------------------------------------
// Registry.
//
// Shape chosen: Record<CommandId, CommandDef<any>> keyed by id (not an
// array). Two reasons: (1) O(1) lookup by id, which is what the router
// (task 35a-2) needs on every call — `COMMANDS[routed.id]`, no `.find()`;
// (2) a Record whose key type is the CommandId union forces TypeScript to
// require all 8 entries at the literal below, catching a forgotten command
// at compile time. `Object.values(COMMANDS)` preserves the object's
// insertion order (guaranteed for string keys), which is what HELP_EXAMPLES
// below relies on to iterate in the same order as the spec §3 table.
//
// `CommandDef<any>` (not `<unknown>`): each command constant above is fully
// typed against its OWN params type at authoring time (e.g.
// `CommandDef<OverdueInvoicesParams>`), so `run`'s `params` argument is
// concretely typed everywhere it's actually written. `any` here is only the
// heterogeneous-collection boundary — the standard shape for a registry
// whose entries each close over a different generic instantiation.
// ---------------------------------------------------------------------------

export const COMMANDS: Record<CommandId, CommandDef<any>> = {
  overdue_invoices: overdueInvoicesCommand,
  receivables_summary: receivablesSummaryCommand,
  runway: runwayCommand,
  at_risk_customers: atRiskCustomersCommand,
  customer_lookup: customerLookupCommand,
  recent_activity: recentActivityCommand,
  revenue_trend: revenueTrendCommand,
  unpaid_by_customer: unpaidByCustomerCommand,
};

/** Every command's first example phrasing, in catalog order — exported
 *  standalone (not just embedded in HELP_RESULT) so the CLIENT palette can
 *  render help/empty-state chips via a page prop, without ever importing
 *  this module (which pulls in the whole db graph — see the file-level
 *  comment above). */
export const HELP_EXAMPLES: string[] = Object.values(COMMANDS).map((c) => c.examples[0]!);

export const HELP_RESULT: CommandResult = {
  kind: "help",
  intro: "Ask about your customers, invoices, or cash. Try one of these:",
  examples: HELP_EXAMPLES,
};
