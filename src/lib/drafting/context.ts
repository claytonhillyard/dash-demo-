import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";
import type { HealthBand } from "@/lib/customers/healthScore";
import { getEntityActivity } from "@/db/activityEvents";

/**
 * The grounding context handed to the AI drafting prompt (spec §4) — one
 * customer's relationship snapshot, structurally PII-limited: the display
 * name and business aggregates travel to the model, the customer's contact
 * details never do. `hasEmail` is the ONLY email-adjacent field — a plain
 * boolean gate for the Send button — the address itself is looked up again,
 * org-scoped, at send time (`sendDraft`, src/lib/drafting/actions.ts, not
 * here). This is the same structural discipline as `HealthInsightInput`
 * (src/lib/customers/healthInsight.ts, slice 36): rather than trust every
 * caller to remember not to pass an email through, the TYPE itself has no
 * field for one to occupy, so nothing built from this type can leak an
 * address into the prompt no matter how the prompt builder evolves.
 */
export type DraftingContext = {
  customerName: string;
  businessName: string | null;
  styleNote: string | null; // the per-customer memory
  hasEmail: boolean; // gate for the Send button — the address itself is NOT here
  healthBand: HealthBand | null; // latest snapshot, null if none
  outstandingBalanceCents: number; // issued invoices minus payments (slice-29 math)
  lastInvoice: { number: string; totalCents: number; status: string; issueDate: string | null } | null;
  lastPaymentDate: string | null; // most recent payments.received_date
  recentActivity: string[]; // last 5 audit summaries for this customer
};

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

type DraftingCustomerRow = {
  name: string;
  businessName: string | null;
  styleNote: string | null;
  hasEmail: boolean;
};

/**
 * Base customer fields (spec §4), org-scoped; null on missing/cross-org.
 * Selects `email` ONLY to derive the `hasEmail` boolean — the string itself
 * is discarded before returning (structural PII rule, see `DraftingContext`
 * above). Demo branch reuses `getSeedCustomerById` (src/lib/demo/seed.ts),
 * which already returns null for a missing/cross-org id, same contract as
 * the SQL path.
 */
async function getDraftingCustomerRow(
  db: Db,
  orgId: number,
  customerId: number,
): Promise<DraftingCustomerRow | null> {
  if (isDemoMode()) {
    const { getSeedCustomerById } = await import("@/lib/demo/seed");
    const row = getSeedCustomerById(orgId, customerId);
    if (!row) return null;
    return {
      name: row.name,
      businessName: row.businessName,
      // DEMO_CUSTOMERS rows carry no style_note field — saveCustomerStyleNote
      // is demo-guarded (src/lib/drafting/actions.ts), so no demo row could
      // ever have one set. Always null rather than undefined.
      styleNote: null,
      hasEmail: Boolean(row.email),
    };
  }

  const res = await db.execute(sql`
    SELECT name, business_name, email, style_note
    FROM customers
    WHERE id = ${customerId} AND org_id = ${orgId}
    LIMIT 1
  `);
  const [row] = rowsOf<{
    name: string;
    business_name: string | null;
    email: string | null;
    style_note: string | null;
  }>(res);
  if (!row) return null;
  return {
    name: row.name,
    businessName: row.business_name,
    styleNote: row.style_note,
    hasEmail: Boolean(row.email),
  };
}

/**
 * Outstanding balance for one customer — issued invoices minus payments
 * (spec §4), reusing the slice-29 grouped-subquery LEFT JOIN shape from
 * `getReceivablesRows` (src/db/runway.ts), aggregated to a single
 * customer-level total (SUM over every issued invoice) rather than that
 * reader's per-invoice list. The payments subquery is org-scoped INSIDE
 * itself — same defense-in-depth as the runway reader — so a payment row
 * whose own org_id disagrees with its invoice's real owner can never leak
 * into this customer's balance. `SUM(...)` is a bigint aggregate, returned
 * as a string over the raw execute() path (same as every other aggregate
 * reader in this codebase) — coerced via `Number()`.
 */
async function getOutstandingBalanceCents(
  db: Db,
  orgId: number,
  customerId: number,
): Promise<number> {
  if (isDemoMode()) {
    const { DEMO_INVOICES, getSeedPaymentsByInvoiceId } = await import("@/lib/demo/seed");
    const issued = DEMO_INVOICES.filter(
      (inv) => inv.orgId === orgId && inv.customerId === customerId && inv.status === "issued",
    );
    return issued.reduce((sum, inv) => {
      const paidCents = getSeedPaymentsByInvoiceId(orgId, inv.id).reduce(
        (s, p) => s + p.amountCents,
        0,
      );
      return sum + (inv.totalCents - paidCents);
    }, 0);
  }

  const res = await db.execute(sql`
    SELECT COALESCE(SUM(i.total_cents), 0) AS total_cents,
           COALESCE(SUM(pay.paid_cents), 0) AS paid_cents
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount_cents) AS paid_cents
      FROM payments
      WHERE org_id = ${orgId}
      GROUP BY invoice_id
    ) pay ON pay.invoice_id = i.id
    WHERE i.org_id = ${orgId} AND i.customer_id = ${customerId} AND i.status = 'issued'
  `);
  const [row] = rowsOf<{ total_cents: string | number; paid_cents: string | number }>(res);
  return Number(row?.total_cents ?? 0) - Number(row?.paid_cents ?? 0);
}

type LastInvoice = DraftingContext["lastInvoice"];

/** Latest issueDate first, id DESC tiebreak — house convention for "most
 *  recent" orderings with a nullable date (e.g. `getSeedPaymentsByInvoiceId`'s
 *  receivedDate DESC/id DESC in src/lib/demo/seed.ts). A null issueDate
 *  (draft invoice) sorts behind every dated invoice; between two nulls, the
 *  higher id (created later) wins. Used only by the demo branch below,
 *  which has no SQL `ORDER BY ... NULLS LAST` to lean on for its in-memory
 *  array. */
function compareLatestIssueDateIdDesc(
  a: { issueDate: string | null; id: number },
  b: { issueDate: string | null; id: number },
): number {
  if (a.issueDate === null && b.issueDate === null) return b.id - a.id;
  if (a.issueDate === null) return 1;
  if (b.issueDate === null) return -1;
  if (a.issueDate !== b.issueDate) return a.issueDate < b.issueDate ? 1 : -1;
  return b.id - a.id;
}

/** Last invoice for a customer (spec §4) — latest issueDate, id tiebreak,
 *  across every status (draft/issued/void alike): this is "what's the most
 *  recent invoice on file", not a receivables filter. */
async function getLastInvoiceForCustomer(
  db: Db,
  orgId: number,
  customerId: number,
): Promise<LastInvoice> {
  if (isDemoMode()) {
    const { DEMO_INVOICES } = await import("@/lib/demo/seed");
    const rows = DEMO_INVOICES.filter(
      (inv) => inv.orgId === orgId && inv.customerId === customerId,
    );
    const [top] = [...rows].sort(compareLatestIssueDateIdDesc);
    return top
      ? {
          number: top.invoiceNumber,
          totalCents: top.totalCents,
          status: top.status,
          issueDate: top.issueDate,
        }
      : null;
  }

  const res = await db.execute(sql`
    SELECT invoice_number, total_cents, status, issue_date
    FROM invoices
    WHERE org_id = ${orgId} AND customer_id = ${customerId}
    ORDER BY issue_date DESC NULLS LAST, id DESC
    LIMIT 1
  `);
  const [row] = rowsOf<{
    invoice_number: string;
    total_cents: number;
    status: string;
    issue_date: string | null;
  }>(res);
  return row
    ? {
        number: row.invoice_number,
        totalCents: Number(row.total_cents),
        status: row.status,
        issueDate: row.issue_date,
      }
    : null;
}

/** Most recent `payments.received_date` across this customer's invoices
 *  (spec §4) — payments join to invoices (no direct customer_id column on
 *  payments), org-scoped on BOTH sides of the join, same defense-in-depth
 *  as `getOutstandingBalanceCents` above. */
async function getLastPaymentDateForCustomer(
  db: Db,
  orgId: number,
  customerId: number,
): Promise<string | null> {
  if (isDemoMode()) {
    const { DEMO_INVOICES, getSeedPaymentsByInvoiceId } = await import("@/lib/demo/seed");
    const invoiceIds = DEMO_INVOICES.filter(
      (inv) => inv.orgId === orgId && inv.customerId === customerId,
    ).map((inv) => inv.id);
    let latest: string | null = null;
    for (const id of invoiceIds) {
      for (const p of getSeedPaymentsByInvoiceId(orgId, id)) {
        if (latest === null || p.receivedDate > latest) latest = p.receivedDate;
      }
    }
    return latest;
  }

  const res = await db.execute(sql`
    SELECT MAX(p.received_date) AS last_payment_date
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id AND i.org_id = ${orgId}
    WHERE p.org_id = ${orgId} AND i.customer_id = ${customerId}
  `);
  const [row] = rowsOf<{ last_payment_date: string | null }>(res);
  return row?.last_payment_date ?? null;
}

/**
 * Latest health-snapshot band for one customer (spec §4) — Sentinel's own
 * `DISTINCT ON (customer_id)` idiom (src/lib/sentinel/capture.ts), filtered
 * down to this one customer. With only one customer_id in scope, DISTINCT ON
 * collapses to a plain ORDER BY + LIMIT 1 — the unique index on
 * (org_id, customer_id, captured_on) already guarantees at most one row per
 * day, so there's no same-day tie to break.
 */
async function getLatestHealthBandForCustomer(
  db: Db,
  orgId: number,
  customerId: number,
): Promise<HealthBand | null> {
  if (isDemoMode()) {
    const { DEMO_HEALTH_SNAPSHOTS } = await import("@/lib/demo/seed");
    const rows = DEMO_HEALTH_SNAPSHOTS.filter(
      (s) => s.orgId === orgId && s.customerId === customerId,
    );
    if (rows.length === 0) return null;
    return rows.reduce((latest, s) => (s.capturedOn > latest.capturedOn ? s : latest)).band;
  }

  const res = await db.execute(sql`
    SELECT band
    FROM customer_health_snapshots
    WHERE org_id = ${orgId} AND customer_id = ${customerId}
    ORDER BY captured_on DESC
    LIMIT 1
  `);
  const [row] = rowsOf<{ band: string }>(res);
  return (row?.band as HealthBand | undefined) ?? null;
}

/**
 * Builds one customer's AI-drafting context (spec §4). Returns null when the
 * customer doesn't exist or belongs to a different org — checked FIRST
 * (before any of the four follow-up reads), so a cross-org customerId does
 * zero extra work and can never transiently touch another org's invoices,
 * payments, or snapshots.
 *
 * Every downstream reader ALSO carries its own `org_id` filter rather than
 * relying solely on the customerId having already been validated — the same
 * defense-in-depth convention as `getReceivablesRows`'s internally-org-scoped
 * payments subquery. A customerId is a global serial PK, so this is
 * belt-and-suspenders today, but it's the house convention for every
 * multi-table per-entity reader in this codebase.
 *
 * The four follow-up reads run concurrently (`Promise.all`) — none depends
 * on another's result, and each is independently org+customer scoped.
 *
 * Demo mode: every helper above demo-branches internally (mirroring
 * `getReceivablesRows`/`getHealthMix`'s per-function convention rather than
 * one outer switch), each reusing the relevant seed export
 * (`getSeedCustomerById`, `DEMO_INVOICES`, `getSeedPaymentsByInvoiceId`,
 * `DEMO_HEALTH_SNAPSHOTS`) filtered generically by `(orgId, customerId)` —
 * not hardcoded to any one seed id. Customer 2204 (Yuki Tanaka) happens to
 * be the only seed customer with invoices/payments/health snapshots, so it's
 * the one that renders a fully populated demo context end-to-end; any other
 * seed customer id still resolves name/businessName/hasEmail correctly, just
 * with the aggregate fields at their empty defaults (no matching rows).
 * `getEntityActivity` (src/db/activityEvents.ts) already demo-branches on
 * its own, so it's called unconditionally here for both modes.
 */
export async function buildDraftingContext(
  db: Db,
  orgId: number,
  customerId: number,
): Promise<DraftingContext | null> {
  const customer = await getDraftingCustomerRow(db, orgId, customerId);
  if (!customer) return null;

  const [outstandingBalanceCents, lastInvoice, lastPaymentDate, healthBand, activity] =
    await Promise.all([
      getOutstandingBalanceCents(db, orgId, customerId),
      getLastInvoiceForCustomer(db, orgId, customerId),
      getLastPaymentDateForCustomer(db, orgId, customerId),
      getLatestHealthBandForCustomer(db, orgId, customerId),
      // Summaries only (house rule, spec §4) — recordActivitySafely callers
      // never put contact details in a summary, so nothing here needs
      // re-scrubbing before it reaches the prompt.
      getEntityActivity(db, orgId, "customer", customerId, { limit: 5 }),
    ]);

  return {
    customerName: customer.name,
    businessName: customer.businessName,
    styleNote: customer.styleNote,
    hasEmail: customer.hasEmail,
    healthBand,
    outstandingBalanceCents,
    lastInvoice,
    lastPaymentDate,
    recentActivity: activity.map((e) => e.summary),
  };
}
