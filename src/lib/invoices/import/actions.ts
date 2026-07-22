"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { customers, invoices, invoiceItems, payments } from "@/db/schema";
import type { CustomerAddress } from "@/db/customers";
import type { BillTo } from "@/db/invoices";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import { firstZodError } from "@/lib/company/validation";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import { safeErrShape, mapDbConstraintError, pgErrorFields } from "@/lib/actionErrors";
import { parseCsv, type CsvParseResult } from "@/lib/csv/parse";
import {
  matchInvoiceHeaders,
  mapInvoiceRow,
  type ImportInvoice,
  type InvoiceHeaderMap,
  type InvoiceImportRowResult,
} from "./winjewelInvoicePreset";

/**
 * previewInvoiceImport / commitInvoiceImport — the WinJewel invoice-history
 * CSV import server actions. Spec §4
 * (docs/superpowers/specs/2026-07-20-winjewel-invoice-import-slice-30-design.md).
 *
 * Mirrors src/lib/customers/import/actions.ts (slice 26, THE template) in
 * shape: stateless two-action flow (csvText is re-parsed/re-mapped/
 * re-resolved from scratch on every call, including commit — spec §4.2's
 * "server state may have changed since preview" precedent), the same
 * `__setTestDb` seam, demo guard FIRST, requireSession, and a 5MB
 * `Buffer.byteLength` Zod refine on csvText.
 *
 * Departs from the template in one structural way: this import has to
 * resolve each row's customer (by external_ref, falling back to name) AND
 * detect duplicate invoice numbers (both against the db and within the file
 * itself) before it knows whether a row is importable — the customers
 * import only ever had one axis (external_ref) to dedupe on. That resolve
 * step needs one customer read + one invoice-number read per call, so the
 * pure csv-parse/header-match/row-map stage (`buildRowOutcomes`) is kept
 * separate from the db-touching resolution stage (`buildInvoiceImportPlan`)
 * — the former is trivially unit-testable without a database, the latter is
 * what both actions share for their one (identical) resolution pass.
 *
 * Direct inserts inside one transaction (spec §9 decision), not
 * createInvoice/recordPayment calls — historical import must bypass the
 * issued-only/current-date guards those actions rightly enforce elsewhere.
 */

// Test seam — see test/lib/invoices/import/actions.test.ts. Production paths
// read the live Neon/pglite via getDb(). Independent module-local binding —
// every "use server" module owns its own seam (same convention as
// src/lib/customers/import/actions.ts, src/lib/invoices/actions.ts, etc).
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
// "first-5 samples per class" (spec §4.1) — importable/duplicate/skipped
// each get their own 5-row preview slice, unlike the customers-import
// template's single 20-row merged sample (this import has three outcome
// classes to show, not two).
const SAMPLE_SIZE = 5;

const importInput = z.object({
  // Byte-accurate cap: z.string().max() counts UTF-16 code units, which lets
  // a CJK-heavy file pass a "5MB" check well past the real UTF-8 byte size
  // (see src/lib/customers/import/actions.ts's identical refine for the full
  // rationale — same multibyte lesson, same fix here).
  csvText: z
    .string()
    .min(1)
    .max(MAX_CSV_BYTES) // fast UTF-16 upper screen (bytes >= code units)
    .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_CSV_BYTES, {
      message: "CSV is too large (5MB max)",
    }),
});

export type InvoiceImportSampleEntry = {
  rowIndex: number;
  invoiceNumber?: string;
  customerLabel?: string | null;
  reason?: string;
};

export type InvoiceImportPreview =
  | {
      ok: true;
      totalRows: number;
      importable: number;
      duplicates: number;
      skipped: number;
      sampleImportable: InvoiceImportSampleEntry[];
      sampleDuplicates: InvoiceImportSampleEntry[];
      sampleSkipped: InvoiceImportSampleEntry[];
    }
  | { ok: false; error: string };

export type InvoiceImportCommitResult =
  | { ok: true; created: number; payments: number; duplicates: number; skipped: number }
  | { ok: false; error: string };

/** Lean customer projection loaded once per action call — everything both
 *  the resolution pass (id/externalRef/name) and the commit-time bill_to
 *  snapshot (name/businessName/email/address) need, so one query serves
 *  both call sites instead of two differently-shaped ones. */
type CustomerLite = {
  id: number;
  name: string;
  businessName: string | null;
  email: string | null;
  address: CustomerAddress | null;
  externalRef: string | null;
};

type ClassifiedRow =
  | { rowIndex: number; kind: "importable"; invoice: ImportInvoice; customerId: number }
  | { rowIndex: number; kind: "duplicate"; invoice: ImportInvoice }
  | { rowIndex: number; kind: "skipped"; reason: string; invoice?: ImportInvoice };

type InvoiceImportPlan = {
  totalRows: number;
  classified: ClassifiedRow[];
  customersById: Map<number, CustomerLite>;
};

/**
 * Pure parse -> header-match -> row-map stage. No db, no session — safe to
 * unit test directly and shared by both actions via buildInvoiceImportPlan.
 */
function buildRowOutcomes(
  csvText: string,
):
  | {
      ok: true;
      totalRows: number;
      outcomes: Array<{ rowIndex: number; result: InvoiceImportRowResult }>;
    }
  | { ok: false; error: string } {
  let parsed: CsvParseResult;
  try {
    parsed = parseCsv(csvText);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not parse CSV",
    };
  }

  const { headers, rows } = parsed;
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `CSV has too many rows (max ${MAX_ROWS})` };
  }

  const matched = matchInvoiceHeaders(headers);
  if (!matched.ok) {
    return {
      ok: false,
      error: `CSV is missing required column(s): ${matched.missing.join(", ")}`,
    };
  }
  const map: InvoiceHeaderMap = matched.map;

  const outcomes = rows.map((row, i) => ({
    rowIndex: i + 1,
    result: mapInvoiceRow(map, row, i + 1),
  }));

  return { ok: true, totalRows: rows.length, outcomes };
}

/**
 * ONE batch load of every customer in the org (spec §4.1 — no chunked
 * IN-list needed: unlike the customers-import UPSERT this is a single plain
 * read with no bound-parameter-count concern, and resolution needs the
 * WHOLE org roster anyway since a row can match by name, not just by the
 * handful of refs actually present in the file). Builds both lookup
 * directions the resolve step needs (`byRef` exact, `byName`
 * case/trim-normalized, collecting every co-matching row so 2+ hits can be
 * detected) plus `byId` for commit's bill_to snapshot.
 */
async function loadOrgCustomers(
  database: Db,
  orgId: number,
): Promise<{
  byRef: Map<string, CustomerLite>;
  byName: Map<string, CustomerLite[]>;
  byId: Map<number, CustomerLite>;
}> {
  const rows = await database
    .select({
      id: customers.id,
      name: customers.name,
      businessName: customers.businessName,
      email: customers.email,
      address: customers.address,
      externalRef: customers.externalRef,
    })
    .from(customers)
    .where(eq(customers.orgId, orgId));

  const byRef = new Map<string, CustomerLite>();
  const byName = new Map<string, CustomerLite[]>();
  const byId = new Map<number, CustomerLite>();

  for (const r of rows) {
    const c: CustomerLite = {
      id: r.id,
      name: r.name,
      businessName: r.businessName,
      email: r.email,
      address: r.address as CustomerAddress | null,
      externalRef: r.externalRef,
    };
    byId.set(c.id, c);
    if (c.externalRef !== null) byRef.set(c.externalRef, c);
    const key = c.name.trim().toLowerCase();
    const bucket = byName.get(key);
    if (bucket) bucket.push(c);
    else byName.set(key, [c]);
  }

  return { byRef, byName, byId };
}

/** ONE batch load of every invoice number already on record for the org
 *  (spec §4.1) — feeds the vs-db half of duplicate marking. Commit re-derives
 *  this fresh on every call (server state may have changed since preview)
 *  and additionally relies on the `invoices_org_number_unique` constraint
 *  itself as the real backstop via `.onConflictDoNothing()`. */
async function loadExistingInvoiceNumbers(database: Db, orgId: number): Promise<Set<string>> {
  const rows = await database
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(eq(invoices.orgId, orgId));
  return new Set(rows.map((r) => r.invoiceNumber));
}

/**
 * Resolves one mapped row's customer (spec §4.1): externalRef === customerRef
 * exact, case-sensitive match first (refs are ids, not display text — no
 * trimming/casing leniency). Only when that doesn't resolve does a trimmed,
 * case-insensitive name match run. 0 name hits -> "customer not found"; 2+ ->
 * "ambiguous". A row whose ref fails to match AND has no customerName at all
 * (fixture row 9) falls straight through to "customer not found" since the
 * name branch never finds anything to look up.
 */
function resolveCustomerForRow(
  invoice: ImportInvoice,
  byRef: Map<string, CustomerLite>,
  byName: Map<string, CustomerLite[]>,
): { ok: true; customerId: number } | { ok: false; reason: string } {
  if (invoice.customerRef !== null) {
    const match = byRef.get(invoice.customerRef);
    if (match) return { ok: true, customerId: match.id };
  }
  if (invoice.customerName !== null) {
    const key = invoice.customerName.trim().toLowerCase();
    const matches = byName.get(key) ?? [];
    if (matches.length === 1) return { ok: true, customerId: matches[0].id };
    if (matches.length >= 2) return { ok: false, reason: "ambiguous customer name" };
  }
  return { ok: false, reason: "customer not found — import customers first" };
}

/**
 * The one (identical) resolution pass shared by preview + commit (spec
 * §4.2's "re-parse + re-map + re-resolve" precedent — every call re-derives
 * this fresh rather than trusting anything computed by an earlier preview
 * call). Order matches spec §4.1 exactly: map every row -> resolve customer
 * per ok row -> mark duplicates (vs-db union in-file, tracked while
 * iterating in file order so the FIRST occurrence of a number wins and
 * every later repeat — including one that only collides with an earlier row
 * in the SAME file, never the db — is the one flagged duplicate).
 */
async function buildInvoiceImportPlan(
  database: Db,
  orgId: number,
  csvText: string,
): Promise<{ ok: true; plan: InvoiceImportPlan } | { ok: false; error: string }> {
  const built = buildRowOutcomes(csvText);
  if (!built.ok) return built;

  const [{ byRef, byName, byId }, existingNumbers] = await Promise.all([
    loadOrgCustomers(database, orgId),
    loadExistingInvoiceNumbers(database, orgId),
  ]);

  const seenInFile = new Set<string>();
  const classified: ClassifiedRow[] = [];
  // Historical import means historical dates — a future issue date is
  // almost certainly an export typo, and it would flow into the payment's
  // receivedDate as a date recordPayment itself rejects (review finding).
  const todayUtc = new Date().toISOString().slice(0, 10);

  for (const { rowIndex, result } of built.outcomes) {
    if (!result.ok) {
      classified.push({ rowIndex, kind: "skipped", reason: result.reason });
      continue;
    }
    const invoice = result.value;

    if (invoice.issueDate > todayUtc) {
      classified.push({ rowIndex, kind: "skipped", reason: "issue date is in the future", invoice });
      continue;
    }

    const resolution = resolveCustomerForRow(invoice, byRef, byName);
    if (!resolution.ok) {
      classified.push({ rowIndex, kind: "skipped", reason: resolution.reason, invoice });
      continue;
    }

    if (existingNumbers.has(invoice.invoiceNumber) || seenInFile.has(invoice.invoiceNumber)) {
      classified.push({ rowIndex, kind: "duplicate", invoice });
      continue;
    }
    seenInFile.add(invoice.invoiceNumber);
    classified.push({
      rowIndex,
      kind: "importable",
      invoice,
      customerId: resolution.customerId,
    });
  }

  return { ok: true, plan: { totalRows: built.totalRows, classified, customersById: byId } };
}

/** Builds previewInvoiceImport's counts + capped samples from a plan. Pure. */
function summarizePlan(plan: InvoiceImportPlan): InvoiceImportPreview {
  let importable = 0;
  let duplicates = 0;
  let skipped = 0;
  const sampleImportable: InvoiceImportSampleEntry[] = [];
  const sampleDuplicates: InvoiceImportSampleEntry[] = [];
  const sampleSkipped: InvoiceImportSampleEntry[] = [];

  for (const row of plan.classified) {
    if (row.kind === "importable") {
      importable++;
      if (sampleImportable.length < SAMPLE_SIZE) {
        sampleImportable.push({
          rowIndex: row.rowIndex,
          invoiceNumber: row.invoice.invoiceNumber,
          customerLabel: row.invoice.customerName ?? row.invoice.customerRef,
        });
      }
    } else if (row.kind === "duplicate") {
      duplicates++;
      if (sampleDuplicates.length < SAMPLE_SIZE) {
        sampleDuplicates.push({
          rowIndex: row.rowIndex,
          invoiceNumber: row.invoice.invoiceNumber,
          customerLabel: row.invoice.customerName ?? row.invoice.customerRef,
          reason: "duplicate invoice number",
        });
      }
    } else {
      skipped++;
      if (sampleSkipped.length < SAMPLE_SIZE) {
        sampleSkipped.push({
          rowIndex: row.rowIndex,
          invoiceNumber: row.invoice?.invoiceNumber,
          customerLabel: row.invoice
            ? (row.invoice.customerName ?? row.invoice.customerRef)
            : undefined,
          reason: row.reason,
        });
      }
    }
  }

  return {
    ok: true,
    totalRows: plan.totalRows,
    importable,
    duplicates,
    skipped,
    sampleImportable,
    sampleDuplicates,
    sampleSkipped,
  };
}

/** bill_to snapshot per spec §8 decision: the matched customer's CURRENT
 *  name/businessName/email/address (the historical export carries no
 *  snapshot of its own — that data doesn't exist pre-import). Mirrors
 *  src/lib/invoices/actions.ts's `buildBillTo` exactly (that helper isn't
 *  exported, so it's duplicated here — the same split
 *  src/lib/payments/actions.ts already made for its own copy of that file's
 *  `run()`/`FriendlyError` scaffold). */
function buildBillToFromCustomer(c: CustomerLite): BillTo {
  const billTo: BillTo = { name: c.name };
  if (c.businessName) billTo.businessName = c.businessName;
  if (c.email) billTo.email = c.email;
  if (c.address) billTo.address = c.address;
  return billTo;
}

/** Shared catch-block error mapping — mirrors
 *  src/lib/customers/import/actions.ts's `mapActionError` exactly
 *  (ForbiddenError -> "Forbidden", unique-constraint -> friendly message,
 *  everything else -> logged + Sentry-captured, opaque "Server error"). */
function mapActionError(e: unknown, action: string): { ok: false; error: string } {
  if (e instanceof ForbiddenError) {
    return { ok: false, error: "Forbidden" };
  }
  // mapDbConstraintError's 23503 message assumes the DELETE direction
  // ("Cannot delete a customer that has invoices"); this import hits the
  // same FK from the INSERT direction when a matched customer is deleted
  // between preview and commit — pre-empt with an actionable message
  // (review finding, slice 30).
  const pg = pgErrorFields(e);
  if (pg.code === "23503" && pg.constraint === "invoices_customer_id_customers_id_fk") {
    return { ok: false, error: "A matched customer was deleted during import — run preview again" };
  }
  const friendly = mapDbConstraintError(e);
  if (friendly !== null) {
    return { ok: false, error: friendly };
  }
  const safe = safeErrShape(e);
  // Constant format string + structured extras — keeps the log format free
  // of caller-controlled substitution patterns (CWE-134), same discipline
  // as src/lib/customers/import/actions.ts.
  console.error("[invoices import action] error", { action, ...safe });
  Sentry.captureException(new Error("invoices import action failed"), {
    tags: { layer: "invoices-import-action", action },
    extra: safe,
  });
  return { ok: false, error: "Server error" };
}

/**
 * previewInvoiceImport — parses + maps + resolves the CSV against the
 * caller's org and computes the importable/duplicate/skipped split. Writes
 * NOTHING; safe to call repeatedly (e.g. re-preview after editing the source
 * file, or after importing customers to fix up unresolved rows).
 */
export async function previewInvoiceImport(raw: unknown): Promise<InvoiceImportPreview> {
  if (isDemoMode()) {
    return { ok: false, error: "Demo mode — changes are disabled" };
  }
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = importInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }

  try {
    const built = await buildInvoiceImportPlan(db(), orgId, parsed.data.csvText);
    if (!built.ok) return { ok: false, error: built.error };
    return summarizePlan(built.plan);
  } catch (e) {
    return mapActionError(e, "previewInvoiceImport");
  }
}

/**
 * commitInvoiceImport — re-parses/re-maps/re-resolves the same csvText
 * (stateless, spec §4.2) inside ONE transaction. Per importable row: insert
 * the invoice via `.onConflictDoNothing()` targeting the
 * `invoices_org_number_unique` index explicitly (the customers-import
 * template's idiom — an explicit target over letting "no target" catch ANY
 * conflict) — an empty `.returning()` means something else landed that
 * number first (a genuine race, or a row misclassified importable a moment
 * ago), so it's counted as a duplicate and nothing else is inserted for it.
 * A successful insert gets its one summary line item, then (paidCents > 0)
 * its payment. Exactly one audit event fires after the transaction commits,
 * never per-row.
 */
export async function commitInvoiceImport(raw: unknown): Promise<InvoiceImportCommitResult> {
  if (isDemoMode()) {
    return { ok: false, error: "Demo mode — changes are disabled" };
  }
  let orgId: number;
  let actor: string;
  try {
    const session = await requireSession();
    orgId = session.orgId;
    actor = session.user;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = importInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }

  try {
    const database = db();
    const built = await buildInvoiceImportPlan(database, orgId, parsed.data.csvText);
    if (!built.ok) return { ok: false, error: built.error };
    const { plan } = built;

    let created = 0;
    let duplicates = 0;
    let skipped = 0;
    let paymentsCount = 0;

    await database.transaction(async (tx) => {
      for (const row of plan.classified) {
        if (row.kind === "skipped") {
          skipped++;
          continue;
        }
        if (row.kind === "duplicate") {
          duplicates++;
          continue;
        }

        const invoice = row.invoice;
        // Guaranteed present: row.customerId came from plan.customersById's
        // own keys moments ago, in the same single-call plan.
        const customer = plan.customersById.get(row.customerId)!;
        const billTo = buildBillToFromCustomer(customer);

        const [inserted] = await tx
          .insert(invoices)
          .values({
            orgId,
            customerId: row.customerId,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            billTo,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            currency: "USD",
            subtotalCents: invoice.totalCents,
            taxRateBps: 0,
            taxCents: 0,
            totalCents: invoice.totalCents,
          })
          .onConflictDoNothing({ target: [invoices.orgId, invoices.invoiceNumber] })
          // Zero-arg returning() (RETURNING *) — the Db union type only
          // surfaces the parameterless overload (same constraint documented
          // on src/lib/payments/actions.ts's deletePayment).
          .returning();

        if (!inserted) {
          // Raced with something else landing this number between the
          // pre-check read and this transaction — idempotent re-runs must
          // never double-insert, so count it honestly as a duplicate
          // instead of silently dropping it.
          duplicates++;
          continue;
        }
        created++;

        await tx.insert(invoiceItems).values({
          invoiceId: inserted.id,
          position: 0,
          description: "Imported from WinJewel — historical invoice",
          quantity: 1,
          unitPriceCents: invoice.totalCents,
          lineTotalCents: invoice.totalCents,
        });

        if (invoice.paidCents > 0) {
          await tx.insert(payments).values({
            orgId,
            invoiceId: inserted.id,
            amountCents: invoice.paidCents,
            method: "other",
            receivedDate: invoice.issueDate,
            note: "Imported from WinJewel",
          });
          paymentsCount++;
        }
      }
    });

    // ONE summary event per commit — entityType "org", never per-row (would
    // spam the feed and fire the watcher chokepoint N times). Payload is
    // counts only; no names/emails in the audit trail.
    await recordActivitySafely(
      database,
      {
        orgId,
        actor,
        entityType: "org",
        entityId: orgId,
        verb: "imported",
        summary: `Imported ${created} invoices from WinJewel (${paymentsCount} payments, ${duplicates} duplicates, ${skipped} skipped)`,
        payload: { created, payments: paymentsCount, duplicates, skipped },
      },
      { action: "invoices.import" },
    );

    revalidatePath("/invoices");
    return { ok: true, created, payments: paymentsCount, duplicates, skipped };
  } catch (e) {
    return mapActionError(e, "commitInvoiceImport");
  }
}
