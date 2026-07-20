"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { invoices, payments } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import { firstZodError } from "@/lib/company/validation";
import { formatCentsExact } from "@/lib/company/format";
import { toUtcDay } from "@/lib/sentinel/capture";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import { safeErrShape, mapDbConstraintError } from "@/lib/actionErrors";
import { PAYMENT_METHODS } from "./types";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Test seam — see test/lib/payments/actions.test.ts. Production paths read
// the live Neon/pglite via getDb(). Identical pattern to
// src/lib/invoices/actions.ts / src/lib/customers/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

// ---------------------------------------------------------------------------
// Validation (spec §4) — kept file-local/unexported, same as
// src/lib/invoices/actions.ts's createInvoiceInput etc. Only the inferred
// *types* below are exported (erased at compile time, so they don't trip
// the "use server" export-must-be-async-function rule); PAYMENT_METHODS
// itself is a real runtime value and lives in ./types.ts instead.
// ---------------------------------------------------------------------------

const recordPaymentInput = z.object({
  invoiceId: z.number().int().positive(),
  amountCents: z.number().int().positive().max(2_147_483_647),
  method: z.enum(PAYMENT_METHODS),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  note: z.string().trim().max(500).optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentInput>;

const deletePaymentInput = z.object({ id: z.number().int().positive() });
export type DeletePaymentInput = z.infer<typeof deletePaymentInput>;

// ---------------------------------------------------------------------------
// Shared helpers — copied from src/lib/invoices/actions.ts verbatim (house
// convention: mirror the sibling file's scaffold rather than extract a
// shared module — that refactor is chip territory, not this slice).
// ---------------------------------------------------------------------------

/** Thrown inside a `run()` callback to surface a short, user-facing message
 *  that is neither an authz reject (`ForbiddenError` -> "Forbidden") nor an
 *  opaque, Sentry-captured failure ("Server error"). recordPayment's status
 *  guards (draft/void), its future-date guard, and its overpay guard all
 *  need their own distinct wording (spec §5.1's truth table) — same role
 *  this class plays in src/lib/invoices/actions.ts. Local to this file, not
 *  shared, on purpose.
 */
class FriendlyError extends Error {}

/**
 * Shared wrapper: demo guard, session re-assert + orgId resolve, validate,
 * run the callback, revalidate /invoices (+ extraRevalidate for the edit
 * page). Never throws to the UI — every failure is mapped to
 * { ok: false, error }. Copied from src/lib/invoices/actions.ts `run()`
 * (which itself copies src/lib/customers/actions.ts) — see that file for
 * the full rationale.
 *
 * Layered error mapping:
 *   ForbiddenError      → "Forbidden"   (deliberate authz reject inside fn)
 *   FriendlyError        → e.message    (status/date/overpay guards)
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
    if (e instanceof FriendlyError) {
      return { ok: false, error: e.message };
    }
    const friendly = mapDbConstraintError(e);
    if (friendly !== null) {
      return { ok: false, error: friendly };
    }
    const safe = safeErrShape(e);
    // Constant format string + structured extras — keeps the log format
    // free of caller-controlled substitution patterns (CWE-134).
    console.error("[payments action] error", { action: opts.action, ...safe });
    Sentry.captureException(new Error("payments action failed"), {
      tags: { layer: "payments-action", action: opts.action },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}

// ---------------------------------------------------------------------------
// recordPayment
// ---------------------------------------------------------------------------

/**
 * recordPayment — spec §5.1. Loads the invoice org-scoped with a lean select
 * (status/invoiceNumber/totalCents only — no need for getInvoiceById's full
 * InvoiceDetail here, which would also join items + payments for no reason).
 * Status must be `issued`: draft and void each get their own FriendlyError.
 * `receivedDate` must not be in the future — string comparison against
 * `toUtcDay(new Date())` works because both sides are "YYYY-MM-DD" (ISO
 * calendar dates sort lexicographically same as chronologically).
 *
 * The overpay guard re-reads `SUM(amount_cents)` INSIDE `db.transaction()`
 * rather than trusting any pre-transaction read — that's what closes the
 * check-then-insert race (pglite is single-writer; Neon is not — spec §5.1
 * step 4). The aggregate is a bigint in Postgres, so pglite/pg return it as
 * a string; `Number()` it, same as the `paid_cents: string | number`
 * pattern in src/db/invoices.ts's `getInvoices`.
 */
export async function recordPayment(raw: unknown): Promise<ActionResult> {
  return run(
    recordPaymentInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();

      const [invoice] = await d
        .select({
          id: invoices.id,
          status: invoices.status,
          invoiceNumber: invoices.invoiceNumber,
          totalCents: invoices.totalCents,
        })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.orgId, orgId)))
        .limit(1);
      if (!invoice) throw new ForbiddenError();

      if (invoice.status === "draft") {
        throw new FriendlyError("Payments can only be recorded on issued invoices");
      }
      if (invoice.status === "void") {
        throw new FriendlyError("This invoice is void — payments can't be recorded");
      }

      if (input.receivedDate > toUtcDay(new Date())) {
        throw new FriendlyError("Payment date can't be in the future");
      }

      await d.transaction(async (tx) => {
        const [row] = await tx
          .select({ paid: sql<string | number>`COALESCE(SUM(${payments.amountCents}), 0)` })
          .from(payments)
          .where(and(eq(payments.invoiceId, invoice.id), eq(payments.orgId, orgId)));
        const paidSoFar = Number(row?.paid ?? 0);
        const remaining = invoice.totalCents - paidSoFar;
        if (paidSoFar + input.amountCents > invoice.totalCents) {
          throw new FriendlyError(
            `Payment exceeds the remaining balance (${formatCentsExact(remaining)} left)`,
          );
        }
        await tx.insert(payments).values({
          orgId,
          invoiceId: invoice.id,
          amountCents: input.amountCents,
          method: input.method,
          receivedDate: input.receivedDate,
          note: input.note ?? null,
        });
      });

      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "invoice",
          entityId: invoice.id,
          verb: "payment_recorded",
          summary: `Recorded ${formatCentsExact(input.amountCents)} ${input.method} payment on ${invoice.invoiceNumber}`,
          payload: { amountCents: input.amountCents, method: input.method },
        },
        { action: "payments.record" },
      );
    },
    {
      action: "recordPayment",
      extraRevalidate: (input) => [`/invoices/${input.invoiceId}/edit`],
    },
  );
}

// ---------------------------------------------------------------------------
// deletePayment
// ---------------------------------------------------------------------------

/**
 * deletePayment — spec §5.2. Loads the payment org-scoped directly (payments
 * carry their own org_id — no join to invoices needed for the authz check).
 * Deletion is allowed at ANY invoice status, void included: this is the
 * cleanup path for a mistaken entry, and it must keep working after a void
 * (no status gate at all, unlike recordPayment).
 *
 * The audit summary needs the invoice number, which payments doesn't
 * denormalize onto itself — a second org-scoped lookup, with a `#${id}`
 * fallback for a missing invoice row. That fallback is effectively
 * unreachable in practice (the invoices<-payments FK is no-action, and
 * invoices are void-not-delete — nothing can remove the row a live payment
 * still references), but it's cheap defensive coding per spec §5.2 step 3.
 *
 * `extraRevalidate` only receives the parsed *input* (`{ id }` — the
 * paymentId, not the invoiceId), so the edit-page path can't be derived from
 * it directly the way every other action in this codebase does. Instead the
 * invoiceId discovered inside `fn` is captured in a closure variable that
 * `extraRevalidate` reads once `fn` has already run — same "closure set
 * inside fn, read by code that executes after fn resolves" shape
 * src/lib/invoices/actions.ts's `sendInvoice` uses for its `simulated` flag.
 */
export async function deletePayment(raw: unknown): Promise<ActionResult> {
  let invoiceId: number | null = null;
  return run(
    deletePaymentInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();

      const [payment] = await d
        .select({
          id: payments.id,
          invoiceId: payments.invoiceId,
          amountCents: payments.amountCents,
          method: payments.method,
        })
        .from(payments)
        .where(and(eq(payments.id, input.id), eq(payments.orgId, orgId)))
        .limit(1);
      if (!payment) throw new ForbiddenError();
      invoiceId = payment.invoiceId;

      await d.delete(payments).where(and(eq(payments.id, input.id), eq(payments.orgId, orgId)));

      const [invoice] = await d
        .select({ invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(and(eq(invoices.id, payment.invoiceId), eq(invoices.orgId, orgId)))
        .limit(1);
      const invoiceLabel = invoice?.invoiceNumber ?? `#${payment.invoiceId}`;

      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "invoice",
          entityId: payment.invoiceId,
          verb: "payment_deleted",
          summary: `Deleted ${formatCentsExact(payment.amountCents)} payment on ${invoiceLabel}`,
          payload: { amountCents: payment.amountCents, method: payment.method },
        },
        { action: "payments.delete" },
      );
    },
    {
      action: "deletePayment",
      extraRevalidate: () => (invoiceId !== null ? [`/invoices/${invoiceId}/edit`] : []),
    },
  );
}
