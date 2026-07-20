// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { customers, invoices, payments, activityEvents } from "@/db/schema";
import { recordPayment, deletePayment, __setTestDb } from "@/lib/payments/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { revalidatePath } from "next/cache";
import { formatCentsExact } from "@/lib/company/format";
import { toUtcDay } from "@/lib/sentinel/capture";
import { getInvoiceById } from "@/db/invoices";
import { and, eq } from "drizzle-orm";

let db: Db;

beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

// ---------------------------------------------------------------------------
// Fixtures — local copies, NOT imported from test/lib/invoices/actions.test.ts,
// so this file stays independent of the invoices action module (and its own
// mock surface — sendEmail, pdf rendering, etc.).
// ---------------------------------------------------------------------------

async function insertCustomer(overrides: Partial<{ orgId: number; name: string }> = {}) {
  const [row] = await db
    .insert(customers)
    .values({
      orgId: overrides.orgId ?? 1,
      name: overrides.name ?? "Priya Mehta",
    })
    .returning();
  return row;
}

let invoiceCounter = 0;

/** Inserts an invoice row directly — payments tests only care about
 *  orgId/status/totalCents/invoiceNumber, never line items, so this skips
 *  invoiceItems entirely (nothing FKs to them). Defaults to a $1,000.00
 *  issued invoice; override `status`/`totalCents` per test. */
async function createInvoice(
  overrides: Partial<{
    orgId: number;
    customerId: number;
    invoiceNumber: string;
    status: "draft" | "issued" | "void";
    totalCents: number;
  }> = {},
) {
  invoiceCounter += 1;
  const totalCents = overrides.totalCents ?? 100_000;
  const status = overrides.status ?? "issued";
  const [row] = await db
    .insert(invoices)
    .values({
      orgId: overrides.orgId ?? 1,
      customerId: overrides.customerId!,
      invoiceNumber:
        overrides.invoiceNumber ?? `INV-TEST-${String(invoiceCounter).padStart(4, "0")}`,
      status,
      billTo: { name: "Test Customer" },
      subtotalCents: totalCents,
      taxCents: 0,
      totalCents,
      issueDate: status === "draft" ? null : "2026-01-01",
    })
    .returning();
  return row;
}

/** Convenience: customer + issued invoice in one call — the common case for
 *  recordPayment tests. */
async function issuedInvoice(overrides: Partial<{ orgId: number; totalCents: number }> = {}) {
  const customer = await insertCustomer({ orgId: overrides.orgId });
  return createInvoice({
    orgId: overrides.orgId,
    customerId: customer.id,
    totalCents: overrides.totalCents,
    status: "issued",
  });
}

async function insertPayment(overrides: {
  orgId?: number;
  invoiceId: number;
  amountCents?: number;
  method?: string;
  receivedDate?: string;
  note?: string | null;
}) {
  const [row] = await db
    .insert(payments)
    .values({
      orgId: overrides.orgId ?? 1,
      invoiceId: overrides.invoiceId,
      amountCents: overrides.amountCents ?? 25_000,
      method: overrides.method ?? "cash",
      receivedDate: overrides.receivedDate ?? "2026-01-05",
      note: overrides.note ?? null,
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// recordPayment
// ---------------------------------------------------------------------------

describe("recordPayment — happy path", () => {
  it("inserts the payment and writes a payment_recorded audit row", async () => {
    const invoice = await issuedInvoice({ totalCents: 100_000 });
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 40_000,
      method: "card",
      receivedDate: "2026-01-05",
      note: "first deposit",
    });
    expect(res).toEqual({ ok: true });

    const rows = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: 1,
      invoiceId: invoice.id,
      amountCents: 40_000,
      method: "card",
      receivedDate: "2026-01-05",
      note: "first deposit",
    });

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.entityType, "invoice"),
          eq(activityEvents.verb, "payment_recorded"),
        ),
      );
    expect(actRow).toBeDefined();
    expect(actRow.actor).toBe("boss");
    expect(actRow.entityId).toBe(invoice.id);
    expect(actRow.summary).toBe(`Recorded $400.00 card payment on ${invoice.invoiceNumber}`);
    expect(actRow.payload).toEqual({ amountCents: 40_000, method: "card" });
  });

  it("revalidates /invoices and the edit page on success", async () => {
    const invoice = await issuedInvoice();
    await recordPayment({
      invoiceId: invoice.id,
      amountCents: 10_000,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/invoices");
    expect(calls).toContain(`/invoices/${invoice.id}/edit`);
  });
});

describe("recordPayment — status guards", () => {
  it("rejects a draft invoice with the draft-specific friendly message", async () => {
    const customer = await insertCustomer();
    const invoice = await createInvoice({ customerId: customer.id, status: "draft" });
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({
      ok: false,
      error: "Payments can only be recorded on issued invoices",
    });
    expect(await db.select().from(payments)).toHaveLength(0);
  });

  it("rejects a void invoice with the void-specific friendly message", async () => {
    const customer = await insertCustomer();
    const invoice = await createInvoice({ customerId: customer.id, status: "void" });
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({
      ok: false,
      error: "This invoice is void — payments can't be recorded",
    });
    expect(await db.select().from(payments)).toHaveLength(0);
  });
});

describe("recordPayment — overpay guard", () => {
  it("accepts a payment that exactly matches the remaining balance", async () => {
    const invoice = await issuedInvoice({ totalCents: 100_000 });
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 100_000,
      method: "wire",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({ ok: true });
  });

  it("rejects a payment one cent over the remaining balance, naming the exact remaining amount", async () => {
    const invoice = await issuedInvoice({ totalCents: 100_000 });
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 100_001,
      method: "wire",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({
      ok: false,
      error: `Payment exceeds the remaining balance (${formatCentsExact(100_000)} left)`,
    });
    expect(await db.select().from(payments)).toHaveLength(0);
    // The rolled-back insert must leave no audit trace either (review F8) —
    // audit fires only after the transaction commits.
    expect(
      await db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.verb, "payment_recorded")),
    ).toHaveLength(0);
  });

  it("allows a second payment that sums exactly to the total, then rejects any further payment", async () => {
    const invoice = await issuedInvoice({ totalCents: 100_000 });
    const first = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 60_000,
      method: "card",
      receivedDate: "2026-01-05",
    });
    expect(first).toEqual({ ok: true });
    const second = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 40_000,
      method: "check",
      receivedDate: "2026-01-06",
    });
    expect(second).toEqual({ ok: true });

    const third = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 1,
      method: "cash",
      receivedDate: "2026-01-07",
    });
    expect(third).toEqual({
      ok: false,
      error: `Payment exceeds the remaining balance (${formatCentsExact(0)} left)`,
    });
  });

  it("accepts a large payment near the int4 ceiling when the invoice total allows it", async () => {
    // Same fixture recipe as the slice-27 "accepts a large total just under
    // the int4 ceiling" test (test/lib/invoices/actions.test.ts): a total of
    // 21 x $1,000,000 = 2,100,000,000 cents, safely under the 2,147,483,647
    // int4 column ceiling.
    const invoice = await issuedInvoice({ totalCents: 2_100_000_000 });
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 2_100_000_000,
      method: "wire",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({ ok: true });
  });
});

describe("recordPayment — receivedDate validation", () => {
  it("rejects a future receivedDate", async () => {
    const invoice = await issuedInvoice();
    const tomorrow = toUtcDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: tomorrow,
    });
    expect(res).toEqual({ ok: false, error: "Payment date can't be in the future" });
  });

  it("accepts today (UTC) as the receivedDate", async () => {
    const invoice = await issuedInvoice();
    const today = toUtcDay(new Date());
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: today,
    });
    expect(res).toEqual({ ok: true });
  });

  it("accepts a past receivedDate", async () => {
    const invoice = await issuedInvoice();
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: "2020-01-01",
    });
    expect(res).toEqual({ ok: true });
  });

  it("rejects a malformed date string at the Zod boundary", async () => {
    const invoice = await issuedInvoice();
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: "01/05/2026",
    });
    expect(res.ok).toBe(false);
    expect(await db.select().from(payments)).toHaveLength(0);
  });
});

describe("recordPayment — amount validation", () => {
  it("rejects a zero amount at the Zod boundary", async () => {
    const invoice = await issuedInvoice();
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 0,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    // Friendly copy, not the raw Zod default (review F5). The "amountCents:"
    // prefix comes from the house firstZodError helper, same as every form.
    expect(res).toEqual({ ok: false, error: "amountCents: Enter a payment amount greater than zero" });
  });

  it("rejects a negative amount at the Zod boundary", async () => {
    const invoice = await issuedInvoice();
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: -500,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    expect(res.ok).toBe(false);
  });
});

describe("recordPayment — authz", () => {
  it("forbids a cross-org invoice id, writing no row", async () => {
    const foreignCustomer = await insertCustomer({ orgId: 999 });
    const foreignInvoice = await createInvoice({
      orgId: 999,
      customerId: foreignCustomer.id,
      status: "issued",
    });
    const res = await recordPayment({
      invoiceId: foreignInvoice.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(payments)).toHaveLength(0);
  });

  it("returns Unauthorized with no session", async () => {
    const invoice = await issuedInvoice();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select().from(payments)).toHaveLength(0);
  });
});

describe("recordPayment — demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("blocks writes and returns the disabled message", async () => {
    const invoice = await issuedInvoice();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await recordPayment({
      invoiceId: invoice.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(await db.select().from(payments)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deletePayment
// ---------------------------------------------------------------------------

describe("deletePayment — happy path", () => {
  it("deletes the row and writes a payment_deleted audit row", async () => {
    const invoice = await issuedInvoice({ totalCents: 100_000 });
    const payment = await insertPayment({
      invoiceId: invoice.id,
      amountCents: 40_000,
      method: "card",
    });

    const res = await deletePayment({ id: payment.id });
    expect(res).toEqual({ ok: true });

    expect(await db.select().from(payments).where(eq(payments.id, payment.id))).toHaveLength(0);

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.entityType, "invoice"), eq(activityEvents.verb, "payment_deleted")),
      );
    expect(actRow).toBeDefined();
    expect(actRow.actor).toBe("boss");
    expect(actRow.entityId).toBe(invoice.id);
    expect(actRow.summary).toBe(`Deleted $400.00 payment on ${invoice.invoiceNumber}`);
    expect(actRow.payload).toEqual({ amountCents: 40_000, method: "card" });
  });

  it("recomputes the invoice balance after delete", async () => {
    const invoice = await issuedInvoice({ totalCents: 100_000 });
    const first = await insertPayment({ invoiceId: invoice.id, amountCents: 40_000 });
    await insertPayment({ invoiceId: invoice.id, amountCents: 20_000 });

    const before = await getInvoiceById(db, 1, invoice.id);
    expect(before?.paidCents).toBe(60_000);
    expect(before?.balanceCents).toBe(40_000);

    const res = await deletePayment({ id: first.id });
    expect(res).toEqual({ ok: true });

    const after = await getInvoiceById(db, 1, invoice.id);
    expect(after?.paidCents).toBe(20_000);
    expect(after?.balanceCents).toBe(80_000);
  });

  it("revalidates /invoices and the edit page on success", async () => {
    const invoice = await issuedInvoice();
    const payment = await insertPayment({ invoiceId: invoice.id });
    await deletePayment({ id: payment.id });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/invoices");
    expect(calls).toContain(`/invoices/${invoice.id}/edit`);
  });
});

describe("deletePayment — concurrency", () => {
  it("two concurrent deletes of the same payment: exactly one succeeds, one audit row", async () => {
    // Review F1: the earlier SELECT-then-DELETE shape let both calls report
    // ok and double-log the audit; DELETE … RETURNING gives the row to
    // exactly one caller.
    const invoice = await issuedInvoice({ totalCents: 100_000 });
    const payment = await insertPayment({ invoiceId: invoice.id, amountCents: 40_000 });

    const [a, b] = await Promise.all([
      deletePayment({ id: payment.id }),
      deletePayment({ id: payment.id }),
    ]);

    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "Forbidden")).toHaveLength(1);
    expect(
      await db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.verb, "payment_deleted")),
    ).toHaveLength(1);
  });
});

describe("deletePayment — works regardless of invoice status", () => {
  it("deletes a payment on a voided invoice (cleanup path)", async () => {
    const invoice = await issuedInvoice({ totalCents: 100_000 });
    const payment = await insertPayment({ invoiceId: invoice.id, amountCents: 30_000 });
    await db.update(invoices).set({ status: "void" }).where(eq(invoices.id, invoice.id));

    const res = await deletePayment({ id: payment.id });
    expect(res).toEqual({ ok: true });
    expect(await db.select().from(payments).where(eq(payments.id, payment.id))).toHaveLength(0);
  });
});

describe("deletePayment — authz", () => {
  it("forbids a cross-org payment id, deleting nothing", async () => {
    const foreignCustomer = await insertCustomer({ orgId: 999 });
    const foreignInvoice = await createInvoice({
      orgId: 999,
      customerId: foreignCustomer.id,
      status: "issued",
    });
    const foreignPayment = await insertPayment({ orgId: 999, invoiceId: foreignInvoice.id });

    const res = await deletePayment({ id: foreignPayment.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(
      await db.select().from(payments).where(eq(payments.id, foreignPayment.id)),
    ).toHaveLength(1);
  });

  it("forbids a missing payment id", async () => {
    const res = await deletePayment({ id: 9_999_999 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("returns Unauthorized with no session", async () => {
    const invoice = await issuedInvoice();
    const payment = await insertPayment({ invoiceId: invoice.id });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await deletePayment({ id: payment.id });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select().from(payments).where(eq(payments.id, payment.id))).toHaveLength(1);
  });
});

describe("deletePayment — demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("blocks deletes and returns the disabled message", async () => {
    const invoice = await issuedInvoice();
    const payment = await insertPayment({ invoiceId: invoice.id });
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await deletePayment({ id: payment.id });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(await db.select().from(payments).where(eq(payments.id, payment.id))).toHaveLength(1);
  });
});
