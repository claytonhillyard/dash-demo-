// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn() }));

import type { Db } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import * as schema from "@/db/schema";
import { formatCentsExact } from "@/lib/company/format";
import { toUtcDay } from "@/lib/sentinel/capture";
import { sendEmail } from "@/lib/email/sendEmail";
import { __setTestDb as setPaymentsTestDb } from "@/lib/payments/actions";
import { __setTestDb as setInvoicesTestDb } from "@/lib/invoices/actions";
import { __setTestDb as setDraftingTestDb } from "@/lib/drafting/actions";
import { WRITE_COMMANDS, WRITE_COMMAND_IDS } from "@/lib/command/writeRegistry";

/**
 * Write command registry tests (spec §4, §7 rows 1-2). Shared-db harness,
 * same as test/lib/command/registry.test.ts. `preview` takes `db` directly
 * (no test seam needed — spec §4's `WriteCommandDef.preview(db, orgId,
 * params)` signature), but `execute` delegates to the three "use server"
 * action modules, which each read their OWN module-local `db()` via their
 * own `__setTestDb` seam (identical pattern to test/lib/payments/actions.test.ts
 * / test/lib/invoices/actions.test.ts / test/lib/drafting/actions.test.ts) —
 * so all three are wired here, not just one.
 *
 * The load-bearing property this file exists to prove twice over: (1)
 * `preview` never mutates ANYTHING — every table's row count is identical
 * before and after any battery of preview calls; (2) `execute` is a true,
 * trust-the-delegate passthrough — it re-derives nothing, so a forged
 * cross-org id, demo mode, and a stale overpay are all caught by the
 * delegate itself, not by any logic in this file.
 */

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await setPaymentsTestDb(db);
  await setInvoicesTestDb(db);
  await setDraftingTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await setPaymentsTestDb(null);
  await setInvoicesTestDb(null);
  await setDraftingTestDb(null);
  await closeSharedDb();
});

// ---------------------------------------------------------------------------
// Fixtures — local to this file (house convention: mirror the sibling
// test's scaffold rather than import fixtures across test files).
// ---------------------------------------------------------------------------

async function insertCustomer(
  overrides: Partial<{ orgId: number; name: string; businessName: string | null }> = {},
) {
  const [row] = await db
    .insert(schema.customers)
    .values({
      orgId: overrides.orgId ?? 1,
      name: overrides.name ?? "Priya Mehta",
      businessName: overrides.businessName ?? null,
    })
    .returning();
  return row!;
}

let invoiceCounter = 0;

async function insertInvoice(overrides: {
  orgId?: number;
  customerId: number;
  invoiceNumber?: string;
  status?: "draft" | "issued" | "void";
  totalCents?: number;
  billToName?: string;
  billToEmail?: string | null;
}) {
  invoiceCounter += 1;
  const totalCents = overrides.totalCents ?? 100_000;
  const status = overrides.status ?? "issued";
  const billTo: { name: string; email?: string } = { name: overrides.billToName ?? "Test Customer" };
  if (overrides.billToEmail) billTo.email = overrides.billToEmail;
  const [row] = await db
    .insert(schema.invoices)
    .values({
      orgId: overrides.orgId ?? 1,
      customerId: overrides.customerId,
      invoiceNumber: overrides.invoiceNumber ?? `INV-TEST-${String(invoiceCounter).padStart(4, "0")}`,
      status,
      billTo,
      subtotalCents: totalCents,
      taxCents: 0,
      totalCents,
      issueDate: status === "draft" ? null : "2026-01-01",
    })
    .returning();
  return row!;
}

async function insertPayment(overrides: { orgId?: number; invoiceId: number; amountCents?: number }) {
  const [row] = await db
    .insert(schema.payments)
    .values({
      orgId: overrides.orgId ?? 1,
      invoiceId: overrides.invoiceId,
      amountCents: overrides.amountCents ?? 100,
      method: "cash",
      receivedDate: "2026-01-01",
    })
    .returning();
  return row!;
}

/** Every write-relevant table's row count — the read-only proof below
 *  compares this before/after a battery of preview calls. */
async function tableCounts() {
  const [customerRows, invoiceRows, paymentRows, activityRows] = await Promise.all([
    db.select().from(schema.customers),
    db.select().from(schema.invoices),
    db.select().from(schema.payments),
    db.select().from(schema.activityEvents),
  ]);
  return {
    customers: customerRows.length,
    invoices: invoiceRows.length,
    payments: paymentRows.length,
    activity: activityRows.length,
  };
}

// ---------------------------------------------------------------------------

describe("write registry — catalog shape", () => {
  it("WRITE_COMMAND_IDS and WRITE_COMMANDS agree on exactly the 3 spec ids", () => {
    expect([...WRITE_COMMAND_IDS].sort()).toEqual(["add_customer_note", "record_payment", "send_invoice"].sort());
    expect(Object.keys(WRITE_COMMANDS).sort()).toEqual([...WRITE_COMMAND_IDS].sort());
    for (const [key, cmd] of Object.entries(WRITE_COMMANDS)) {
      expect(cmd.id).toBe(key);
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(cmd.examples.length).toBeGreaterThan(0);
      expect(typeof cmd.preview).toBe("function");
      expect(typeof cmd.execute).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// add_customer_note — preview
// ---------------------------------------------------------------------------

describe("add_customer_note — preview", () => {
  it("1 match: exact resolvedParams + summary + details", async () => {
    const c = await insertCustomer({ name: "Yuki Tanaka", businessName: "Ginza Pearl House" });
    const preview = await WRITE_COMMANDS.add_customer_note.preview(db, 1, {
      customer: "tanaka", // case-insensitive contains, mirrors registry.ts's customer_lookup
      note: "Prefers concise emails",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("unreachable");
    expect(preview.resolvedParams).toEqual({ customerId: c.id, styleNote: "Prefers concise emails" });
    expect(preview.summary).toBe("Set the style note for Yuki Tanaka to: Prefers concise emails");
    expect(preview.details).toEqual([
      ["Customer", "Yuki Tanaka"],
      ["Note", "Prefers concise emails"],
    ]);
  });

  it("0 matches -> ok:false naming the query", async () => {
    const preview = await WRITE_COMMANDS.add_customer_note.preview(db, 1, { customer: "Nobody Here", note: "x" });
    expect(preview.ok).toBe(false);
    if (preview.ok) throw new Error("unreachable");
    expect(preview.error).toContain("No customer matches");
    expect(preview.error).toContain("Nobody Here");
    expect(await db.select().from(schema.customers)).toHaveLength(0);
  });

  it("2+ matches -> ok:false listing every candidate by name", async () => {
    await insertCustomer({ name: "Yuki Tanaka" });
    await insertCustomer({ name: "Yuki Yamamoto" });
    const preview = await WRITE_COMMANDS.add_customer_note.preview(db, 1, { customer: "Yuki", note: "x" });
    expect(preview.ok).toBe(false);
    if (preview.ok) throw new Error("unreachable");
    expect(preview.error).toContain("Yuki Tanaka");
    expect(preview.error).toContain("Yuki Yamamoto");
  });

  it("org-999 customer never resolves for org 1", async () => {
    await insertCustomer({ orgId: 999, name: "Foreign Tanaka" });
    const preview = await WRITE_COMMANDS.add_customer_note.preview(db, 1, { customer: "Tanaka", note: "x" });
    expect(preview.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// record_payment — preview
// ---------------------------------------------------------------------------

describe("record_payment — preview", () => {
  it("happy path: exact resolvedParams + balance-aware summary + warning", async () => {
    const c = await insertCustomer();
    const inv = await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0001", totalCents: 100_000 });
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, {
      invoice: "INV-2026-0001",
      amount: "$500",
      method: "cash",
      date: "2026-01-10",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("unreachable");
    expect(preview.resolvedParams).toEqual({
      invoiceId: inv.id,
      amountCents: 50_000,
      method: "cash",
      receivedDate: "2026-01-10",
    });
    expect(preview.summary).toContain(formatCentsExact(50_000)); // brings balance to $500 remaining
    expect(preview.summary).toContain("INV-2026-0001");
    expect(preview.warning).toBe("Records a payment against this invoice.");
  });

  it("defaults method to 'other' and date to today (UTC) when both are omitted", async () => {
    const c = await insertCustomer();
    const inv = await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0002", totalCents: 100_000 });
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-0002", amount: "100" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("unreachable");
    expect(preview.resolvedParams).toEqual({
      invoiceId: inv.id,
      amountCents: 10_000,
      method: "other",
      receivedDate: toUtcDay(new Date()),
    });
  });

  it("exact invoice-number match wins even when a fuzzy superstring also exists", async () => {
    const c = await insertCustomer();
    const exact = await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0001" });
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-00011" }); // contains the exact number too
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-0001", amount: "10" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("unreachable");
    expect(preview.resolvedParams).toMatchObject({ invoiceId: exact.id });
  });

  it("0 invoice matches -> ok:false", async () => {
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-NOPE-9999", amount: "10" });
    expect(preview.ok).toBe(false);
    expect(await db.select().from(schema.payments)).toHaveLength(0);
  });

  it("2+ fuzzy invoice matches -> ok:false listing every candidate number", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0010" });
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0011" });
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-001", amount: "10" });
    expect(preview.ok).toBe(false);
    if (preview.ok) throw new Error("unreachable");
    expect(preview.error).toContain("INV-2026-0010");
    expect(preview.error).toContain("INV-2026-0011");
  });

  it("a draft invoice -> the draft-specific message, mirroring recordPayment's own", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0003", status: "draft" });
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-0003", amount: "10" });
    expect(preview).toEqual({ ok: false, error: "Payments can only be recorded on issued invoices" });
  });

  it("a void invoice -> the void-specific message, mirroring recordPayment's own", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0004", status: "void" });
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-0004", amount: "10" });
    expect(preview).toEqual({ ok: false, error: "This invoice is void — payments can't be recorded" });
  });

  it("amount edges: unparseable, zero, and negative all -> ok:false", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0006" });

    const garbage = await WRITE_COMMANDS.record_payment.preview(db, 1, {
      invoice: "INV-2026-0006",
      amount: "not-a-number",
    });
    expect(garbage.ok).toBe(false);

    const zero = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-0006", amount: "0" });
    expect(zero.ok).toBe(false);
    if (zero.ok) throw new Error("unreachable");
    expect(zero.error).toContain("greater than zero");

    const negative = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-0006", amount: "-5" });
    expect(negative.ok).toBe(false);
  });

  it("an unknown payment method -> ok:false", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0008" });
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, {
      invoice: "INV-2026-0008",
      amount: "10",
      method: "bitcoin",
    });
    expect(preview.ok).toBe(false);
  });

  it("an unparseable date -> ok:false", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0009" });
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, {
      invoice: "INV-2026-0009",
      amount: "10",
      date: "not-a-date",
    });
    expect(preview.ok).toBe(false);
  });

  it("overpay is a friendly early stop; the exact remaining balance is still fine", async () => {
    const c = await insertCustomer();
    const inv = await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0012", totalCents: 100_000 });
    await insertPayment({ invoiceId: inv.id, amountCents: 60_000 }); // 40,000 remaining

    const over = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-0012", amount: "500" });
    expect(over).toEqual({
      ok: false,
      error: `Payment exceeds the remaining balance (${formatCentsExact(40_000)} left)`,
    });

    const exact = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-0012", amount: "400" });
    expect(exact.ok).toBe(true);
  });

  it("org-999 invoice never resolves for org 1", async () => {
    const c999 = await insertCustomer({ orgId: 999 });
    await insertInvoice({ orgId: 999, customerId: c999.id, invoiceNumber: "INV-2026-0099" });
    const preview = await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-0099", amount: "10" });
    expect(preview.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// send_invoice — preview
// ---------------------------------------------------------------------------

describe("send_invoice — preview", () => {
  it("happy path: resolvedParams {id} + summary naming the frozen bill_to email", async () => {
    const c = await insertCustomer();
    const inv = await insertInvoice({
      customerId: c.id,
      invoiceNumber: "INV-2026-0001",
      billToEmail: "priya@example.com",
    });
    const preview = await WRITE_COMMANDS.send_invoice.preview(db, 1, { invoice: "INV-2026-0001" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("unreachable");
    expect(preview.resolvedParams).toEqual({ id: inv.id });
    expect(preview.summary).toBe("Send invoice INV-2026-0001 to priya@example.com");
    expect(preview.warning).toBe("Sends an email to the customer.");
  });

  it("a draft invoice -> the issued-only message, mirroring sendInvoice's own", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0002", status: "draft" });
    const preview = await WRITE_COMMANDS.send_invoice.preview(db, 1, { invoice: "INV-2026-0002" });
    expect(preview).toEqual({ ok: false, error: "Only issued invoices can be sent" });
  });

  it("a void invoice -> the issued-only message", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0003", status: "void" });
    const preview = await WRITE_COMMANDS.send_invoice.preview(db, 1, { invoice: "INV-2026-0003" });
    expect(preview).toEqual({ ok: false, error: "Only issued invoices can be sent" });
  });

  it("no email on file for the customer -> ok:false", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0004" }); // no billToEmail
    const preview = await WRITE_COMMANDS.send_invoice.preview(db, 1, { invoice: "INV-2026-0004" });
    expect(preview.ok).toBe(false);
    if (preview.ok) throw new Error("unreachable");
    expect(preview.error).toContain("No email on file");
  });

  it("0 and 2+ invoice matches both -> ok:false", async () => {
    const none = await WRITE_COMMANDS.send_invoice.preview(db, 1, { invoice: "NOPE" });
    expect(none.ok).toBe(false);

    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0020" });
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-0021" });
    const many = await WRITE_COMMANDS.send_invoice.preview(db, 1, { invoice: "INV-2026-002" });
    expect(many.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// preview is read-only — the load-bearing property (spec §1/§3)
// ---------------------------------------------------------------------------

describe("preview is read-only", () => {
  it("every table's row count is unchanged after a battery of preview calls (happy + failing, all 3 commands)", async () => {
    const c = await insertCustomer({ name: "Priya Mehta" });
    const issued = await insertInvoice({
      customerId: c.id,
      invoiceNumber: "INV-2026-9000",
      totalCents: 100_000,
      billToEmail: "priya@example.com",
    });
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-9001", status: "draft" });
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-9002", status: "void" });
    await insertPayment({ invoiceId: issued.id, amountCents: 1_000 });

    const before = await tableCounts();

    await WRITE_COMMANDS.add_customer_note.preview(db, 1, { customer: "Priya", note: "hi" });
    await WRITE_COMMANDS.add_customer_note.preview(db, 1, { customer: "Nobody", note: "hi" });
    await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-9000", amount: "10" });
    await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-9001", amount: "10" });
    await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-9002", amount: "10" });
    await WRITE_COMMANDS.record_payment.preview(db, 1, { invoice: "INV-2026-9000", amount: "999999" }); // overpay
    await WRITE_COMMANDS.send_invoice.preview(db, 1, { invoice: "INV-2026-9000" });
    await WRITE_COMMANDS.send_invoice.preview(db, 1, { invoice: "INV-2026-9001" });
    await WRITE_COMMANDS.send_invoice.preview(db, 1, { invoice: "does-not-exist" });

    const after = await tableCounts();
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// execute — delegates to the real guarded action (shared-db, not mocked —
// the delegation proof spec §7 calls for).
// ---------------------------------------------------------------------------

describe("execute — delegates to the real guarded action", () => {
  it("add_customer_note.execute calls saveCustomerStyleNote for real: updates the row + audits", async () => {
    const c = await insertCustomer({ name: "Yuki Tanaka" });
    const res = await WRITE_COMMANDS.add_customer_note.execute({
      customerId: c.id,
      styleNote: "Prefers concise emails",
    });
    expect(res).toEqual({ ok: true });

    const [updated] = await db.select().from(schema.customers).where(eq(schema.customers.id, c.id));
    expect(updated!.styleNote).toBe("Prefers concise emails");

    const [audit] = await db
      .select()
      .from(schema.activityEvents)
      .where(and(eq(schema.activityEvents.entityType, "customer"), eq(schema.activityEvents.verb, "updated")));
    expect(audit).toBeDefined();
    expect(audit!.entityId).toBe(c.id);
  });

  it("record_payment.execute calls recordPayment for real: inserts a payment row + audits", async () => {
    const c = await insertCustomer();
    const inv = await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-EXEC-1", totalCents: 100_000 });
    const res = await WRITE_COMMANDS.record_payment.execute({
      invoiceId: inv.id,
      amountCents: 40_000,
      method: "card",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({ ok: true });

    const rows = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountCents: 40_000, method: "card", receivedDate: "2026-01-05" });

    const [audit] = await db
      .select()
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.verb, "payment_recorded"));
    expect(audit).toBeDefined();
  });

  it("send_invoice.execute calls sendInvoice for real: sends (mocked seam) + stamps + audits", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });
    const c = await insertCustomer();
    const inv = await insertInvoice({
      customerId: c.id,
      invoiceNumber: "INV-2026-EXEC-2",
      billToEmail: "priya@example.com",
    });
    const res = await WRITE_COMMANDS.send_invoice.execute({ id: inv.id });
    expect(res).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const [updated] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id));
    expect(updated!.sentTo).toBe("priya@example.com");

    const [audit] = await db.select().from(schema.activityEvents).where(eq(schema.activityEvents.verb, "sent"));
    expect(audit).toBeDefined();
  });
});

describe("execute — trust-in-delegate lock (forged cross-org resolvedParams)", () => {
  it("record_payment.execute returns Forbidden for a hand-forged org-999 invoice id", async () => {
    const c999 = await insertCustomer({ orgId: 999 });
    const foreign = await insertInvoice({ orgId: 999, customerId: c999.id, invoiceNumber: "INV-2026-F1" });
    const res = await WRITE_COMMANDS.record_payment.execute({
      invoiceId: foreign.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(schema.payments)).toHaveLength(0);
  });

  it("send_invoice.execute returns Forbidden for a hand-forged org-999 invoice id", async () => {
    const c999 = await insertCustomer({ orgId: 999 });
    const foreign = await insertInvoice({
      orgId: 999,
      customerId: c999.id,
      invoiceNumber: "INV-2026-F2",
      billToEmail: "x@example.com",
    });
    const res = await WRITE_COMMANDS.send_invoice.execute({ id: foreign.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("add_customer_note.execute returns Forbidden for a hand-forged org-999 customer id", async () => {
    const c999 = await insertCustomer({ orgId: 999 });
    const res = await WRITE_COMMANDS.add_customer_note.execute({ customerId: c999.id, styleNote: "x" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});

describe("execute — demo mode blocks every command with the delegate's own message (not a second one)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("record_payment.execute", async () => {
    const c = await insertCustomer();
    const inv = await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-D1" });
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await WRITE_COMMANDS.record_payment.execute({
      invoiceId: inv.id,
      amountCents: 1_000,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(await db.select().from(schema.payments)).toHaveLength(0);
  });

  it("send_invoice.execute", async () => {
    const c = await insertCustomer();
    const inv = await insertInvoice({
      customerId: c.id,
      invoiceNumber: "INV-2026-D2",
      billToEmail: "x@example.com",
    });
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await WRITE_COMMANDS.send_invoice.execute({ id: inv.id });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("add_customer_note.execute", async () => {
    const c = await insertCustomer();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await WRITE_COMMANDS.add_customer_note.execute({ customerId: c.id, styleNote: "x" });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
  });
});

describe("execute — recordPayment's transactional overpay guard is authoritative, not the preview's", () => {
  it("a hand-forged overpay resolvedParams at execute still gets recordPayment's own message", async () => {
    const c = await insertCustomer();
    const inv = await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-OP1", totalCents: 100_000 });
    const res = await WRITE_COMMANDS.record_payment.execute({
      invoiceId: inv.id,
      amountCents: 100_001,
      method: "cash",
      receivedDate: "2026-01-05",
    });
    expect(res).toEqual({
      ok: false,
      error: `Payment exceeds the remaining balance (${formatCentsExact(100_000)} left)`,
    });
    expect(await db.select().from(schema.payments)).toHaveLength(0);
  });
});
