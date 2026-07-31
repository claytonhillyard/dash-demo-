import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";
import { getInvoices, getInvoiceById, type InvoiceStatus } from "@/db/invoices";
import { formatCentsExact } from "@/lib/company/format";
import { toUtcDay } from "@/lib/sentinel/capture";
import { parseMoneyToCents, normalizeDate } from "@/lib/invoices/import/winjewelInvoicePreset";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/payments/types";
import { recordPayment } from "@/lib/payments/actions";
import { sendInvoice } from "@/lib/invoices/actions";
import { saveCustomerStyleNote } from "@/lib/drafting/actions";

/**
 * Write command registry — the confirmed-write half of the AI command layer
 * (slice 35b-1, spec §4 verbatim). Structurally mirrors the read-only
 * registry (src/lib/command/registry.ts, slice 35a-1) but every command here
 * splits into two phases instead of one `run`:
 *
 *  - `preview` — READ-ONLY. Resolves free-text routeParams ("INV-2026-0001",
 *    "Tanaka", "$500") against the org's own data and returns either a
 *    concrete, human-readable preview of the write about to happen, or a
 *    friendly `ok:false` when the request can't be resolved unambiguously.
 *    Touches only readers (getInvoices/getInvoiceById, a hand-written
 *    customer search below) — nothing in this file ever calls `.insert()`,
 *    `.update()`, or `.delete()`. The dedicated read-only test
 *    (test/lib/command/writeRegistry.test.ts) asserts every table's row
 *    count is unchanged after a battery of preview calls, which is the
 *    actual enforcement of this invariant — the type signature alone
 *    doesn't stop a future edit from sneaking in a write.
 *  - `execute` — the ONLY mutation point, and it is a thin passthrough to
 *    the pre-existing guarded action (recordPayment / sendInvoice /
 *    saveCustomerStyleNote) that the normal UI already uses. It does NOT
 *    re-validate or re-derive anything: the delegate re-parses
 *    `resolvedParams` with its own Zod and re-runs its own session/org/demo/
 *    status/overpay checks from scratch. This is deliberate (spec §3.2): the
 *    delegate is the security boundary, not this file, so a hand-forged
 *    `resolvedParams` can never do more than the delegate itself already
 *    allows for the caller's own org.
 *
 * SERVER-ONLY, same discipline as registry.ts: this module pulls in the full
 * db graph AND all three "use server" action modules. The client palette
 * (task 35b-3) must never import this file as a value — only the
 * `WriteCommandId`/`WritePreview` TYPES (and registry.ts's own `CommandResult`,
 * extended with a `confirm` variant carrying these, per spec §3.1/task 35b-2)
 * may cross that boundary.
 */

// ---------------------------------------------------------------------------
// Types — spec §4, verbatim.
// ---------------------------------------------------------------------------

export const WRITE_COMMAND_IDS = ["record_payment", "add_customer_note", "send_invoice"] as const;
export type WriteCommandId = (typeof WRITE_COMMAND_IDS)[number];

/** Every delegate action in this codebase returns (at least) this shape —
 *  `sendInvoice`'s `{ok:true; simulated?:true}` is a structurally-compatible
 *  superset. Defined locally rather than imported from one of the three
 *  delegate modules, matching the house convention that every action module
 *  owns its own `ActionResult` alias (payments/invoices/drafting each define
 *  their own identical copy rather than sharing one). */
export type ActionResult = { ok: true } | { ok: false; error: string };

export type WritePreview =
  | { ok: true; resolvedParams: unknown; summary: string; details: Array<[string, string]>; warning?: string }
  | { ok: false; error: string };

export type WriteCommandDef<RouteParams> = {
  id: WriteCommandId;
  description: string;
  examples: string[];
  routeParams: z.ZodType<RouteParams>; // what the ROUTER extracts (loose, free-text-ish)
  preview(db: Db, orgId: number, params: RouteParams): Promise<WritePreview>; // read-only
  execute(resolvedParams: unknown): Promise<ActionResult>; // delegates to the guarded action
};

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/** Same convention every raw-`db.execute()` module in this codebase repeats
 *  locally (src/db/customers.ts, src/lib/command/registry.ts, ...) rather
 *  than importing from one shared util. */
function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

// getInvoices' own MAX_LIMIT (src/db/invoices.ts) isn't exported — this
// module duplicates the number rather than exporting a private constant
// across a file boundary for one call site. Generous enough that invoice
// resolution sees every invoice in any realistic org.
const INVOICE_LOOKUP_LIMIT = 200;

type CustomerMatch = { id: number; name: string; businessName: string | null };

/**
 * Case-insensitive contains match on name/business_name — the same idiom as
 * registry.ts's private `findCustomersByQuery` (slice 35a-1), copied rather
 * than imported: that function is unexported (module-local to registry.ts),
 * and this codebase's established convention is to mirror a sibling
 * module's scaffold rather than force a shared export across an unrelated
 * boundary for one reuse (see e.g. payments/actions.ts's `run()`, copied
 * from invoices/actions.ts with the same rationale documented there).
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

type InvoiceResolution =
  | { ok: true; invoiceId: number; invoiceNumber: string; status: InvoiceStatus }
  | { ok: false; error: string };

/**
 * Invoice resolution shared by `record_payment` and `send_invoice` (spec
 * §4): exact `invoice_number` match (case-insensitive) first, falling back
 * to a fuzzy contains ONLY when there's no exact hit — so a number that's a
 * substring of a different, unrelated invoice's number (e.g. "INV-2026-0001"
 * inside "INV-2026-00011") never turns an exact, unambiguous reference into
 * a false "multiple matches" error. Built on `getInvoices` (src/db/
 * invoices.ts), which is already org-scoped and demo-aware, rather than a
 * hand-written query — this is the one new list read this module needs, and
 * reusing the existing reader means invoice resolution can never disagree
 * with what `/invoices` itself shows.
 */
async function resolveInvoice(db: Db, orgId: number, query: string): Promise<InvoiceResolution> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return { ok: false, error: "No invoice number given — try the invoice number, e.g. INV-2026-0001" };
  }

  const all = await getInvoices(db, orgId, { limit: INVOICE_LOOKUP_LIMIT });
  const needle = trimmed.toLowerCase();
  const exact = all.filter((inv) => inv.invoiceNumber.toLowerCase() === needle);
  const pool = exact.length > 0 ? exact : all.filter((inv) => inv.invoiceNumber.toLowerCase().includes(needle));

  if (pool.length === 0) {
    return {
      ok: false,
      error: `Couldn't find an invoice matching "${trimmed}" — try the invoice number, e.g. INV-2026-0001`,
    };
  }
  if (pool.length >= 2) {
    const candidates = pool.map((inv) => inv.invoiceNumber).join(", ");
    return { ok: false, error: `Multiple invoices match "${trimmed}": ${candidates} — try the full invoice number` };
  }

  const match = pool[0]!;
  return { ok: true, invoiceId: match.id, invoiceNumber: match.invoiceNumber, status: match.status };
}

// ===========================================================================
// add_customer_note
// ===========================================================================

const addCustomerNoteRouteParams = z.object({
  customer: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1).max(2000),
});
type AddCustomerNoteRouteParams = z.infer<typeof addCustomerNoteRouteParams>;

/**
 * add_customer_note — resolves the customer by name/business contains (spec
 * §4 table); 0/2+ matches are a friendly `ok:false`, never a thrown error.
 * `resolvedParams` deliberately carries the note text through UNCHANGED —
 * `saveCustomerStyleNote`'s own Zod (`styleNote: max(300)`) is the
 * authoritative cap, re-checked at execute time; duplicating that cap here
 * would be exactly the business-logic duplication spec §4 rules out.
 */
async function addCustomerNotePreview(
  db: Db,
  orgId: number,
  params: AddCustomerNoteRouteParams,
): Promise<WritePreview> {
  const query = params.customer.trim();
  const matches = await findCustomersByQuery(db, orgId, query);

  if (matches.length === 0) {
    return { ok: false, error: `No customer matches "${query}" — try the full name or business name` };
  }
  if (matches.length >= 2) {
    const candidates = matches.map((m) => m.name).join(", ");
    return { ok: false, error: `Multiple customers match "${query}": ${candidates} — be more specific` };
  }

  const match = matches[0]!;
  return {
    ok: true,
    resolvedParams: { customerId: match.id, styleNote: params.note },
    summary: `Set the style note for ${match.name} to: ${params.note}`,
    details: [
      ["Customer", match.name],
      ["Note", params.note],
    ],
  };
}

const addCustomerNoteCommand: WriteCommandDef<AddCustomerNoteRouteParams> = {
  id: "add_customer_note",
  description: "Sets a customer's private drafting style note.",
  examples: [
    "note that Tanaka prefers concise emails",
    "remember Mehta Diamonds likes formal language",
    "set a style note for Priya: always mention the warranty",
  ],
  routeParams: addCustomerNoteRouteParams,
  preview: addCustomerNotePreview,
  execute: (resolvedParams) => saveCustomerStyleNote(resolvedParams),
};

// ===========================================================================
// record_payment
// ===========================================================================

const recordPaymentRouteParams = z.object({
  invoice: z.string().trim().min(1).max(100),
  amount: z.string().trim().min(1).max(50),
  method: z.string().trim().min(1).max(20).optional(),
  date: z.string().trim().min(1).max(20).optional(),
});
type RecordPaymentRouteParams = z.infer<typeof recordPaymentRouteParams>;

/**
 * record_payment — the highest-stakes of the 3 (spec §4 table): resolves the
 * invoice (issued-only — draft/void get the SAME distinct messages
 * `recordPayment` itself throws, src/lib/payments/actions.ts, so the preview
 * never promises something execute would then contradict), parses the
 * amount (`parseMoneyToCents`, reused from the slice-30 import preset) and
 * rejects <= 0 separately (that parser accepts exactly `0` as a valid
 * amount — it has no opinion on positivity, only shape), validates the
 * method against the live `PAYMENT_METHODS` enum, defaults/normalizes the
 * date (`normalizeDate`, same import), and finally reads the invoice's
 * current balance for a COURTESY overpay pre-check.
 *
 * That overpay check is explicitly NOT the security guard — recordPayment's
 * own `db.transaction()` re-reads the paid-so-far sum and is the actual
 * authority (see that function's doc comment for the pglite-vs-neon-http
 * honesty note on race scope). This one exists purely so the confirm card
 * can say "brings the balance to $X" and short-circuit the common case where
 * the number is already stale-obviously-wrong, without pretending to close
 * a race this file has no transaction to close.
 */
async function recordPaymentPreview(db: Db, orgId: number, params: RecordPaymentRouteParams): Promise<WritePreview> {
  const resolved = await resolveInvoice(db, orgId, params.invoice);
  if (!resolved.ok) return resolved;

  if (resolved.status === "draft") {
    return { ok: false, error: "Payments can only be recorded on issued invoices" };
  }
  if (resolved.status === "void") {
    return { ok: false, error: "This invoice is void — payments can't be recorded" };
  }

  const parsedAmount = parseMoneyToCents(params.amount);
  if (!parsedAmount.ok) {
    return { ok: false, error: `Couldn't parse the payment amount "${params.amount}" (${parsedAmount.reason})` };
  }
  if (parsedAmount.cents <= 0) {
    return { ok: false, error: "Enter a payment amount greater than zero" };
  }
  const amountCents = parsedAmount.cents;

  const rawMethod = (params.method ?? "other").trim().toLowerCase();
  if (!(PAYMENT_METHODS as readonly string[]).includes(rawMethod)) {
    return {
      ok: false,
      error: `Unknown payment method "${params.method}" — use one of: ${PAYMENT_METHODS.join(", ")}`,
    };
  }
  const method = rawMethod as PaymentMethod;

  let receivedDate: string;
  if (params.date === undefined) {
    receivedDate = toUtcDay(new Date());
  } else {
    const normalized = normalizeDate(params.date);
    if (normalized === null) {
      return { ok: false, error: `Couldn't parse the payment date "${params.date}"` };
    }
    receivedDate = normalized;
  }

  // Re-fetches by id rather than trusting `resolveInvoice`'s list-query row:
  // that reader doesn't carry balanceCents, and (defense in depth, same
  // spirit as deletePayment's own "effectively unreachable" fallback,
  // src/lib/payments/actions.ts) a concurrent void between the two reads
  // would otherwise slip a status-passed-but-stale invoice through to a
  // balance read against data that's already moved on.
  const invoice = await getInvoiceById(db, orgId, resolved.invoiceId);
  if (!invoice) {
    return {
      ok: false,
      error: `Couldn't find an invoice matching "${params.invoice}" — try the invoice number, e.g. INV-2026-0001`,
    };
  }

  const newBalance = invoice.balanceCents - amountCents;
  if (newBalance < 0) {
    return {
      ok: false,
      error: `Payment exceeds the remaining balance (${formatCentsExact(invoice.balanceCents)} left)`,
    };
  }

  return {
    ok: true,
    resolvedParams: { invoiceId: resolved.invoiceId, amountCents, method, receivedDate },
    summary:
      `Record a ${formatCentsExact(amountCents)} ${method} payment on ${resolved.invoiceNumber} — ` +
      `brings the balance to ${formatCentsExact(newBalance)}.`,
    details: [
      ["Invoice", resolved.invoiceNumber],
      ["Amount", formatCentsExact(amountCents)],
      ["Method", method],
      ["Date", receivedDate],
      ["Balance after", formatCentsExact(newBalance)],
    ],
    warning: "Records a payment against this invoice.",
  };
}

const recordPaymentCommand: WriteCommandDef<RecordPaymentRouteParams> = {
  id: "record_payment",
  description: "Records a payment against an issued invoice.",
  examples: [
    "record a $500 cash payment on INV-2026-0001",
    "log a payment of 250 on INV-2026-0002",
    "paid $1,000 via wire on INV-2026-0003",
  ],
  routeParams: recordPaymentRouteParams,
  preview: recordPaymentPreview,
  execute: (resolvedParams) => recordPayment(resolvedParams),
};

// ===========================================================================
// send_invoice
// ===========================================================================

const sendInvoiceRouteParams = z.object({
  invoice: z.string().trim().min(1).max(100),
});
type SendInvoiceRouteParams = z.infer<typeof sendInvoiceRouteParams>;

/**
 * send_invoice — resolves the invoice (issued-only, same resolver as
 * record_payment) and reads the frozen `bill_to.email` purely to SHOW the
 * recipient in the confirm card. `resolvedParams` is `{id}` only — no
 * `toEmail` — so `sendInvoice` itself re-resolves the recipient fresh at
 * execute time from whatever `bill_to` looks like then (spec §4 table);
 * carrying a possibly-stale email through `resolvedParams` would be the
 * exact kind of duplicated derivation this file avoids elsewhere.
 */
async function sendInvoicePreview(db: Db, orgId: number, params: SendInvoiceRouteParams): Promise<WritePreview> {
  const resolved = await resolveInvoice(db, orgId, params.invoice);
  if (!resolved.ok) return resolved;

  if (resolved.status !== "issued") {
    return { ok: false, error: "Only issued invoices can be sent" };
  }

  const invoice = await getInvoiceById(db, orgId, resolved.invoiceId);
  if (!invoice) {
    return {
      ok: false,
      error: `Couldn't find an invoice matching "${params.invoice}" — try the invoice number, e.g. INV-2026-0001`,
    };
  }

  const email = invoice.billTo.email;
  if (!email) {
    return { ok: false, error: "No email on file for this customer — enter one to send" };
  }

  return {
    ok: true,
    resolvedParams: { id: resolved.invoiceId },
    summary: `Send invoice ${resolved.invoiceNumber} to ${email}`,
    details: [
      ["Invoice", resolved.invoiceNumber],
      ["Recipient", email],
    ],
    warning: "Sends an email to the customer.",
  };
}

const sendInvoiceCommand: WriteCommandDef<SendInvoiceRouteParams> = {
  id: "send_invoice",
  description: "Emails an issued invoice to its customer.",
  examples: ["send invoice INV-2026-0001", "email INV-2026-0002 to the customer", "send INV-2026-0003"],
  routeParams: sendInvoiceRouteParams,
  preview: sendInvoicePreview,
  execute: (resolvedParams) => sendInvoice(resolvedParams),
};

// ---------------------------------------------------------------------------
// Registry — same `Record<Id, Def<any>>` shape/rationale as registry.ts's
// `COMMANDS` (slice 35a-1): O(1) id lookup for the router, and keying the
// Record's type by the `WriteCommandId` union forces every id to have an
// entry at compile time.
// ---------------------------------------------------------------------------

export const WRITE_COMMANDS: Record<WriteCommandId, WriteCommandDef<any>> = {
  add_customer_note: addCustomerNoteCommand,
  record_payment: recordPaymentCommand,
  send_invoice: sendInvoiceCommand,
};
