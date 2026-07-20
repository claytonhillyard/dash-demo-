"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { invoices, invoiceItems } from "@/db/schema";
import { getCustomerById, type CustomerView } from "@/db/customers";
import type { BillTo } from "@/db/invoices";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import { firstZodError } from "@/lib/company/validation";
import { toUtcDay } from "@/lib/sentinel/capture";
import { computeTotals, type TotalsLineItem } from "./totals";
import { suggestInvoiceNumber } from "./numbering";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import { safeErrShape, mapDbConstraintError } from "@/lib/actionErrors";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Test seam — see test/lib/invoices/actions.test.ts. Production paths read
// the live Neon/pglite via getDb(). Identical pattern to
// src/lib/customers/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

// ---------------------------------------------------------------------------
// Validation (spec §6 / §3.2)
// ---------------------------------------------------------------------------

const invoiceItemInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).max(10_000),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
});

// int4 (Postgres integer) max — the width of subtotal_cents / tax_cents /
// total_cents / line_total_cents. The per-item caps above are individually
// int4-safe, but nothing bounds quantity*unitPrice or the summed total, so a
// legitimate large invoice (e.g. 25 × $1,000,000) could overflow the column
// and surface as an opaque "Server error". Cap the COMPUTED total: since
// unitPrice ≥ 0 and quantity ≥ 1, every lineTotal and the subtotal are ≤ the
// total, so bounding the total bounds all four columns at once. (Slice 27
// review finding — the same assumption recurs in slice 30's history import.)
const MAX_MONEY_CENTS = 2_147_483_647;

/**
 * Attach the total-overflow guard to an invoice-input object schema. Applied
 * to both create + update variants AFTER any `.extend()` — Zod's refine
 * returns a ZodEffects, which is not `.extend()`-able, so the base object
 * must be extended first and refined last.
 */
// Return type is left to inference: Zod v4's classic API doesn't re-export a
// stable `ZodEffects` type name, and the refine doesn't change the parsed
// shape, so `z.infer` on the result still yields the base object's type.
function withTotalsCap<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((val, ctx) => {
    const v = val as { items: TotalsLineItem[]; taxRateBps?: number };
    const { totalCents } = computeTotals(v.items, v.taxRateBps ?? 0);
    if (totalCents > MAX_MONEY_CENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Invoice total is too large — reduce quantities or unit prices",
      });
    }
  });
}

const invoiceBaseInput = z.object({
  customerId: z.number().int().positive(),
  items: z.array(invoiceItemInput).min(1).max(50),
  taxRateBps: z.number().int().min(0).max(2500).default(0),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD").optional(),
  invoiceNumber: z.string().trim().min(1).max(50).optional(),
  notes: z.string().trim().min(1).max(2000).optional(),
  currency: z.string().trim().min(1).max(3).default("USD"),
});

const createInvoiceInput = withTotalsCap(invoiceBaseInput);
export type CreateInvoiceInput = z.infer<typeof createInvoiceInput>;

const updateInvoiceInput = withTotalsCap(
  invoiceBaseInput.extend({ id: z.number().int().positive() }),
);
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceInput>;

const issueInvoiceInput = z.object({ id: z.number().int().positive() });
export type IssueInvoiceInput = z.infer<typeof issueInvoiceInput>;

const voidInvoiceInput = z.object({ id: z.number().int().positive() });
export type VoidInvoiceInput = z.infer<typeof voidInvoiceInput>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** bill_to snapshot per spec §3.1: `{ name, businessName?, email?, address? }`
 *  — omit any field that's null/empty on the source customer row rather than
 *  storing explicit nulls in the jsonb. */
function buildBillTo(customer: CustomerView): BillTo {
  const billTo: BillTo = { name: customer.name };
  if (customer.businessName) billTo.businessName = customer.businessName;
  if (customer.email) billTo.email = customer.email;
  if (customer.address) billTo.address = customer.address;
  return billTo;
}

/**
 * Shared wrapper: demo guard, session re-assert + orgId resolve, validate,
 * run the callback, revalidate /invoices (+ extraRevalidate for the edit
 * page). Never throws to the UI — every failure is mapped to
 * { ok: false, error }. Copied from src/lib/customers/actions.ts `run()`.
 *
 * Not used by createInvoice — that one returns a custom `{ ok: true; id }`
 * shape (mirrors src/lib/customers/actions.ts `createCustomer`, which is
 * hand-rolled for the same reason).
 *
 * Layered error mapping:
 *   ForbiddenError      → "Forbidden"   (deliberate authz reject inside fn)
 *   constraint violation → mapDbConstraintError's friendly string
 *   anything else       → "Server error" (Sentry-captured, opaque to UI)
 */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number, actor: string) => Promise<void>,
  opts: { action: string; extraRevalidate?: (input: T) => string[] },
): Promise<ActionResult> {
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
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  try {
    await fn(parsed.data, orgId, actor);
    revalidatePath("/invoices");
    if (opts.extraRevalidate) {
      for (const p of opts.extraRevalidate(parsed.data)) revalidatePath(p);
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    const friendly = mapDbConstraintError(e);
    if (friendly !== null) {
      return { ok: false, error: friendly };
    }
    const safe = safeErrShape(e);
    // Constant format string + structured extras — keeps the log format
    // free of caller-controlled substitution patterns (CWE-134).
    console.error("[invoices action] error", { action: opts.action, ...safe });
    Sentry.captureException(new Error("invoices action failed"), {
      tags: { layer: "invoices-action", action: opts.action },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}

// ---------------------------------------------------------------------------
// createInvoice
// ---------------------------------------------------------------------------

/**
 * createInvoice — org_id is set from the session, never the wire. Verifies
 * the customer belongs to the caller's org FIRST (spec §6): a foreign or
 * missing customerId maps to the same Forbidden as every other cross-org
 * probe in this codebase. bill_to is snapshotted from that SELECT — the
 * first of many "refresh on save" writes (frozen only once issueInvoice
 * runs). Returns a custom `{ ok: true; id }` shape (mirrors
 * src/lib/customers/actions.ts `createCustomer`, not the bare `run()`).
 */
export async function createInvoice(
  raw: unknown,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
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
  const parsed = createInvoiceInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  const input = parsed.data;
  try {
    const d = db();

    const customer = await getCustomerById(d, orgId, input.customerId);
    if (!customer) throw new ForbiddenError();
    const billTo = buildBillTo(customer);

    let invoiceNumber = input.invoiceNumber;
    if (!invoiceNumber) {
      const existing = await d
        .select({ invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(eq(invoices.orgId, orgId));
      invoiceNumber = suggestInvoiceNumber(
        existing.map((r) => r.invoiceNumber),
        new Date().getUTCFullYear(),
      );
    }

    const totals = computeTotals(input.items, input.taxRateBps);

    let newId = 0;
    await d.transaction(async (tx) => {
      const [row] = await tx
        .insert(invoices)
        .values({
          orgId,
          customerId: input.customerId,
          invoiceNumber: invoiceNumber!,
          status: "draft",
          billTo,
          dueDate: input.dueDate ?? null,
          currency: input.currency,
          subtotalCents: totals.subtotalCents,
          taxRateBps: input.taxRateBps,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          notes: input.notes ?? null,
        })
        .returning();
      newId = row.id;
      await tx.insert(invoiceItems).values(
        input.items.map((item, index) => ({
          invoiceId: newId,
          position: index,
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: totals.lineTotals[index],
        })),
      );
    });

    await recordActivitySafely(
      d,
      {
        orgId,
        actor,
        entityType: "invoice",
        entityId: newId,
        verb: "created",
        summary: `Created invoice ${invoiceNumber} for ${billTo.name}`,
        payload: { itemCount: input.items.length, totalCents: totals.totalCents },
      },
      { action: "invoices.create" },
    );
    revalidatePath("/invoices");
    return { ok: true, id: newId };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    const friendly = mapDbConstraintError(e);
    if (friendly !== null) {
      return { ok: false, error: friendly };
    }
    const safe = safeErrShape(e);
    console.error("[invoices action] createInvoice error:", safe);
    Sentry.captureException(new Error("createInvoice failed"), {
      tags: { layer: "invoices-action", action: "createInvoice" },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}

// ---------------------------------------------------------------------------
// updateInvoice
// ---------------------------------------------------------------------------

/**
 * updateInvoice — draft-only (spec §6): issued/void invoices are immutable
 * via this path, enforced twice (a pre-check outside the transaction for a
 * fast/clean Forbidden, and again in the transaction's UPDATE ... WHERE for
 * defense-in-depth against a race). Every draft save REFRESHES the bill_to
 * snapshot from the customer's current row — this is what makes issue-time
 * freezing meaningful: the operator issues whatever the last save captured.
 * Items are replaced wholesale (DELETE + reinsert) in the same transaction
 * — ≤50 items makes diffing pointless (spec §9 decision).
 */
export async function updateInvoice(raw: unknown): Promise<ActionResult> {
  return run(
    updateInvoiceInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();

      const [existing] = await d
        .select({ status: invoices.status, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.orgId, orgId)))
        .limit(1);
      if (!existing) throw new ForbiddenError();
      if (existing.status !== "draft") throw new ForbiddenError();

      const customer = await getCustomerById(d, orgId, input.customerId);
      if (!customer) throw new ForbiddenError();
      const billTo = buildBillTo(customer);

      // Editable per spec §9, but omitting it on an update keeps the
      // existing number rather than re-triggering suggestion — only
      // createInvoice auto-suggests.
      const invoiceNumber = input.invoiceNumber ?? existing.invoiceNumber;
      const totals = computeTotals(input.items, input.taxRateBps);

      await d.transaction(async (tx) => {
        const res = await tx
          .update(invoices)
          .set({
            customerId: input.customerId,
            invoiceNumber,
            billTo,
            dueDate: input.dueDate ?? null,
            currency: input.currency,
            subtotalCents: totals.subtotalCents,
            taxRateBps: input.taxRateBps,
            taxCents: totals.taxCents,
            totalCents: totals.totalCents,
            notes: input.notes ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(invoices.id, input.id),
              eq(invoices.orgId, orgId),
              eq(invoices.status, "draft"),
            ),
          )
          .returning();
        if (res.length === 0) throw new ForbiddenError();

        await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
        await tx.insert(invoiceItems).values(
          input.items.map((item, index) => ({
            invoiceId: input.id,
            position: index,
            description: item.description,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents: totals.lineTotals[index],
          })),
        );
      });

      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "invoice",
          entityId: input.id,
          verb: "updated",
          summary: `Updated invoice ${invoiceNumber}`,
          payload: { itemCount: input.items.length, totalCents: totals.totalCents },
        },
        { action: "invoices.update" },
      );
    },
    {
      action: "updateInvoice",
      extraRevalidate: (input) => [`/invoices/${input.id}/edit`],
    },
  );
}

// ---------------------------------------------------------------------------
// issueInvoice
// ---------------------------------------------------------------------------

/**
 * issueInvoice — draft-only -> issued, stamping issue_date as today's UTC
 * calendar day (`toUtcDay`, reused from src/lib/sentinel/capture.ts rather
 * than re-implemented — it's already a general "UTC YYYY-MM-DD from a Date"
 * utility imported outside its original module, e.g. by the customers edit
 * page and sentinel/trend.ts). Deliberately does NOT re-read the customer:
 * the bill_to already on the row (last refreshed by the most recent draft
 * save) is what gets frozen — the operator issues what they last saw.
 * The status check lives entirely in the UPDATE's WHERE clause (single
 * atomic statement: cross-org, missing, and non-draft all collapse to zero
 * rows -> Forbidden), so there's no separate pre-check to race against.
 */
export async function issueInvoice(raw: unknown): Promise<ActionResult> {
  return run(
    issueInvoiceInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();
      const issueDate = toUtcDay(new Date());
      const res = await d
        .update(invoices)
        .set({ status: "issued", issueDate, updatedAt: new Date() })
        .where(
          and(
            eq(invoices.id, input.id),
            eq(invoices.orgId, orgId),
            eq(invoices.status, "draft"),
          ),
        )
        .returning();
      if (res.length === 0) throw new ForbiddenError();
      const row = res[0]!;
      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "invoice",
          entityId: input.id,
          verb: "issued",
          summary: `Issued invoice ${row.invoiceNumber}`,
          payload: { issueDate },
        },
        { action: "invoices.issue" },
      );
    },
    {
      action: "issueInvoice",
      extraRevalidate: (input) => [`/invoices/${input.id}/edit`],
    },
  );
}

// ---------------------------------------------------------------------------
// voidInvoice
// ---------------------------------------------------------------------------

/**
 * voidInvoice — draft OR issued -> void. Terminal: void is a dead end, not
 * a state to update or re-void (spec §1 — "nothing is ever deleted"; void
 * is the tombstone). Same single-atomic-UPDATE pattern as issueInvoice.
 */
export async function voidInvoice(raw: unknown): Promise<ActionResult> {
  return run(
    voidInvoiceInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();
      const res = await d
        .update(invoices)
        .set({ status: "void", updatedAt: new Date() })
        .where(
          and(
            eq(invoices.id, input.id),
            eq(invoices.orgId, orgId),
            inArray(invoices.status, ["draft", "issued"]),
          ),
        )
        .returning();
      if (res.length === 0) throw new ForbiddenError();
      const row = res[0]!;
      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "invoice",
          entityId: input.id,
          verb: "voided",
          summary: `Voided invoice ${row.invoiceNumber}`,
          payload: { invoiceNumber: row.invoiceNumber },
        },
        { action: "invoices.void" },
      );
    },
    {
      action: "voidInvoice",
      extraRevalidate: (input) => [`/invoices/${input.id}/edit`],
    },
  );
}
