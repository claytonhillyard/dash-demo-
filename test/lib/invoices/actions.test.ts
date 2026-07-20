// @vitest-environment node
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn() }));

import type { Db } from "@/db/client";
import {
  getSharedDb,
  resetSharedDb,
  closeSharedDb,
} from "../../helpers/shared-db";
import { customers, invoices, invoiceItems, activityEvents } from "@/db/schema";
import {
  createInvoice,
  updateInvoice,
  issueInvoice,
  voidInvoice,
  sendInvoice,
  __setTestDb,
} from "@/lib/invoices/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { sendEmail } from "@/lib/email/sendEmail";
import { revalidatePath } from "next/cache";
import { formatCentsExact } from "@/lib/company/format";
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
// Fixtures
// ---------------------------------------------------------------------------

async function insertCustomer(
  overrides: Partial<{
    orgId: number;
    name: string;
    email: string | null;
    businessName: string | null;
    address: unknown;
  }> = {},
) {
  const [row] = await db
    .insert(customers)
    .values({
      orgId: overrides.orgId ?? 1,
      name: overrides.name ?? "Priya Mehta",
      email: "email" in overrides ? overrides.email : "priya@example.com",
      businessName:
        "businessName" in overrides ? overrides.businessName : "Mehta Diamonds",
      address: (overrides.address as never) ?? null,
    })
    .returning();
  return row;
}

function baseItems() {
  return [
    { description: "Round diamond, 1ct", quantity: 1, unitPriceCents: 500_000 },
    { description: "Platinum band", quantity: 2, unitPriceCents: 25_000 },
  ];
}

/** Inserts an invoice row directly (bypassing the action) for cross-org /
 *  FK-fixture setups where we deliberately want a row the action layer
 *  never created. */
async function insertRawInvoice(overrides: {
  orgId: number;
  customerId: number;
  invoiceNumber: string;
  status?: "draft" | "issued" | "void";
}) {
  const [row] = await db
    .insert(invoices)
    .values({
      orgId: overrides.orgId,
      customerId: overrides.customerId,
      invoiceNumber: overrides.invoiceNumber,
      status: overrides.status ?? "draft",
      billTo: { name: "Foreign" },
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// createInvoice
// ---------------------------------------------------------------------------

describe("createInvoice — happy path", () => {
  it("creates a draft invoice with a bill_to snapshot and server-computed totals", async () => {
    const customer = await insertCustomer();
    const res = await createInvoice({
      customerId: customer.id,
      items: baseItems(),
      taxRateBps: 825,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.id).toBeGreaterThan(0);

    const [row] = await db.select().from(invoices).where(eq(invoices.id, res.id));
    expect(row.orgId).toBe(1);
    expect(row.customerId).toBe(customer.id);
    expect(row.status).toBe("draft");
    expect(row.billTo).toMatchObject({
      name: "Priya Mehta",
      businessName: "Mehta Diamonds",
      email: "priya@example.com",
    });
    // subtotal = 500000*1 + 25000*2 = 550000; tax = round(550000*825/10000) = 45375
    expect(row.subtotalCents).toBe(550_000);
    expect(row.taxRateBps).toBe(825);
    expect(row.taxCents).toBe(45_375);
    expect(row.totalCents).toBe(595_375);
    expect(row.invoiceNumber).toMatch(/^INV-\d{4}-0001$/);
    expect(row.currency).toBe("USD");

    const items = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, res.id));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.position).sort()).toEqual([0, 1]);
    expect(items.find((i) => i.position === 0)?.lineTotalCents).toBe(500_000);
    expect(items.find((i) => i.position === 1)?.lineTotalCents).toBe(50_000);

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.entityType, "invoice"), eq(activityEvents.verb, "created")),
      );
    expect(actRow.actor).toBe("boss");
    expect(actRow.entityId).toBe(res.id);
    expect(actRow.summary).toBe(`Created invoice ${row.invoiceNumber} for Priya Mehta`);
    expect(actRow.payload).toMatchObject({ itemCount: 2, totalCents: 595_375 });
    expect(JSON.stringify(actRow)).not.toContain("priya@example.com");
  });

  it("omits null bill_to fields for a bare customer", async () => {
    const customer = await insertCustomer({ email: null, businessName: null });
    const res = await createInvoice({ customerId: customer.id, items: baseItems() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db.select().from(invoices).where(eq(invoices.id, res.id));
    expect(row.billTo).toEqual({ name: "Priya Mehta" });
  });

  it("defaults taxRateBps to 0 when omitted", async () => {
    const customer = await insertCustomer();
    const res = await createInvoice({ customerId: customer.id, items: baseItems() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db.select().from(invoices).where(eq(invoices.id, res.id));
    expect(row.taxRateBps).toBe(0);
    expect(row.taxCents).toBe(0);
    expect(row.totalCents).toBe(row.subtotalCents);
  });

  it("respects a supplied invoice number instead of auto-suggesting", async () => {
    const customer = await insertCustomer();
    const res = await createInvoice({
      customerId: customer.id,
      items: baseItems(),
      invoiceNumber: "INV-CUSTOM-0007",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db.select().from(invoices).where(eq(invoices.id, res.id));
    expect(row.invoiceNumber).toBe("INV-CUSTOM-0007");
  });

  it("auto-numbers sequentially across two creates with no number supplied", async () => {
    const customer = await insertCustomer();
    const res1 = await createInvoice({ customerId: customer.id, items: baseItems() });
    const res2 = await createInvoice({ customerId: customer.id, items: baseItems() });
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    if (!res1.ok || !res2.ok) return;
    const [row1] = await db.select().from(invoices).where(eq(invoices.id, res1.id));
    const [row2] = await db.select().from(invoices).where(eq(invoices.id, res2.id));
    expect(row1.invoiceNumber).toMatch(/-0001$/);
    expect(row2.invoiceNumber).toMatch(/-0002$/);
  });

  it("rejects a duplicate invoice number with a friendly error, no row inserted", async () => {
    const customer = await insertCustomer();
    const first = await createInvoice({
      customerId: customer.id,
      items: baseItems(),
      invoiceNumber: "INV-DUPE-0001",
    });
    expect(first.ok).toBe(true);
    const res = await createInvoice({
      customerId: customer.id,
      items: baseItems(),
      invoiceNumber: "INV-DUPE-0001",
    });
    expect(res).toEqual({ ok: false, error: "That invoice number is already in use" });
    const rows = await db.select().from(invoices);
    expect(rows).toHaveLength(1);
  });

  it("revalidates /invoices on success", async () => {
    const customer = await insertCustomer();
    await createInvoice({ customerId: customer.id, items: baseItems() });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/invoices");
  });
});

describe("createInvoice — authz", () => {
  it("forbids a customer belonging to a different org (no row inserted)", async () => {
    const customer = await insertCustomer({ orgId: 999 });
    const res = await createInvoice({ customerId: customer.id, items: baseItems() });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(invoices)).toHaveLength(0);
  });

  it("forbids a non-existent customer id", async () => {
    const res = await createInvoice({ customerId: 9_999_999, items: baseItems() });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("returns Unauthorized with no session", async () => {
    const customer = await insertCustomer();
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await createInvoice({ customerId: customer.id, items: baseItems() });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select().from(invoices)).toHaveLength(0);
  });
});

describe("createInvoice — validation", () => {
  it("rejects more than 50 items", async () => {
    const customer = await insertCustomer();
    const items = Array.from({ length: 51 }, (_, i) => ({
      description: `Item ${i}`,
      quantity: 1,
      unitPriceCents: 100,
    }));
    const res = await createInvoice({ customerId: customer.id, items });
    expect(res.ok).toBe(false);
    expect(await db.select().from(invoices)).toHaveLength(0);
  });

  it("rejects zero items", async () => {
    const customer = await insertCustomer();
    const res = await createInvoice({ customerId: customer.id, items: [] });
    expect(res.ok).toBe(false);
  });

  it("rejects a malformed dueDate", async () => {
    const customer = await insertCustomer();
    const res = await createInvoice({
      customerId: customer.id,
      items: baseItems(),
      dueDate: "07/18/2026",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a computed total that would overflow int4 (no row inserted)", async () => {
    // Each item is individually int4-safe, but 25 × $1,000,000 = 2.5e9 cents
    // exceeds the 2,147,483,647 column ceiling. Must fail at the Zod boundary
    // with a friendly message, NOT an opaque Postgres 22003 "Server error".
    const customer = await insertCustomer();
    const res = await createInvoice({
      customerId: customer.id,
      items: [{ description: "Wholesale lot", quantity: 25, unitPriceCents: 100_000_000 }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/too large/i);
    expect(await db.select().from(invoices)).toHaveLength(0);
  });

  it("accepts a large total just under the int4 ceiling", async () => {
    // 21 × $1,000,000 = 2,100,000,000 cents < 2,147,483,647 → must pass;
    // 22 × $1,000,000 = 2,200,000,000 > ceiling → the prior test's guard.
    const customer = await insertCustomer();
    const res = await createInvoice({
      customerId: customer.id,
      items: Array.from({ length: 21 }, (_, i) => ({
        description: `Lot ${i}`,
        quantity: 1,
        unitPriceCents: 100_000_000,
      })),
      taxRateBps: 0,
    });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateInvoice — the freeze/refresh pair (the heart of the truth table)
// ---------------------------------------------------------------------------

describe("updateInvoice — snapshot refresh vs. freeze at issue", () => {
  it("refreshes bill_to on a draft save, then freezes it once issued", async () => {
    const customer = await insertCustomer({ email: "old@example.com" });
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const invoiceId = created.id;

    // Customer's email changes after the invoice was created.
    await db
      .update(customers)
      .set({ email: "new@example.com" })
      .where(eq(customers.id, customer.id));

    // (a) update while still draft -> snapshot MOVES to the new email.
    const updateRes = await updateInvoice({
      id: invoiceId,
      customerId: customer.id,
      items: baseItems(),
      taxRateBps: 0,
    });
    expect(updateRes).toEqual({ ok: true });
    const [afterUpdate] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect((afterUpdate.billTo as { email?: string }).email).toBe("new@example.com");

    // Issue the invoice — freezes whatever is on it right now. Does NOT
    // re-read the customer.
    const issueRes = await issueInvoice({ id: invoiceId });
    expect(issueRes).toEqual({ ok: true });

    // Customer's email changes AGAIN, after issue.
    await db
      .update(customers)
      .set({ email: "newer@example.com" })
      .where(eq(customers.id, customer.id));

    // (b) re-fetch -> snapshot UNMOVED.
    const [afterIssue] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect((afterIssue.billTo as { email?: string }).email).toBe("new@example.com");
    expect(afterIssue.status).toBe("issued");
  });
});

describe("updateInvoice — happy path", () => {
  it("recomputes totals and replaces items wholesale (old ids gone, new positions 0..n)", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const oldItems = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, created.id));
    const oldIds = oldItems.map((i) => i.id).sort();
    expect(oldIds.length).toBe(2);

    const newItems = [
      { description: "Sapphire ring", quantity: 3, unitPriceCents: 10_000 },
      { description: "Cleaning kit", quantity: 1, unitPriceCents: 500 },
      { description: "Gift box", quantity: 1, unitPriceCents: 200 },
    ];
    const res = await updateInvoice({
      id: created.id,
      customerId: customer.id,
      items: newItems,
      taxRateBps: 0,
    });
    expect(res).toEqual({ ok: true });

    const [row] = await db.select().from(invoices).where(eq(invoices.id, created.id));
    const expectedSubtotal = 3 * 10_000 + 1 * 500 + 1 * 200;
    expect(row.subtotalCents).toBe(expectedSubtotal);
    expect(row.totalCents).toBe(expectedSubtotal);

    const nowItems = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, created.id));
    expect(nowItems).toHaveLength(3);
    const nowIds = nowItems.map((i) => i.id);
    for (const oldId of oldIds) expect(nowIds).not.toContain(oldId);
    expect(nowItems.map((i) => i.position).sort((a, b) => a - b)).toEqual([0, 1, 2]);

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.entityType, "invoice"), eq(activityEvents.verb, "updated")),
      );
    expect(actRow).toBeDefined();
    expect(actRow.actor).toBe("boss");
    expect(JSON.stringify(actRow)).not.toMatch(/@/);
  });

  it("respects a custom invoice number on update", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    const res = await updateInvoice({
      id: created.id,
      customerId: customer.id,
      items: baseItems(),
      taxRateBps: 0,
      invoiceNumber: "INV-RENUMBERED-0001",
    });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, created.id));
    expect(row.invoiceNumber).toBe("INV-RENUMBERED-0001");
  });

  it("revalidates /invoices and the edit page on success", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await updateInvoice({
      id: created.id,
      customerId: customer.id,
      items: baseItems(),
      taxRateBps: 0,
    });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/invoices");
    expect(calls).toContain(`/invoices/${created.id}/edit`);
  });
});

describe("updateInvoice — lifecycle + authz guards", () => {
  it("forbids updating an issued invoice", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await issueInvoice({ id: created.id });
    const res = await updateInvoice({
      id: created.id,
      customerId: customer.id,
      items: baseItems(),
      taxRateBps: 0,
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids updating a void invoice", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await voidInvoice({ id: created.id });
    const res = await updateInvoice({
      id: created.id,
      customerId: customer.id,
      items: baseItems(),
      taxRateBps: 0,
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids a cross-org invoice id", async () => {
    const foreignCustomer = await insertCustomer({ orgId: 999 });
    const foreignInvoice = await insertRawInvoice({
      orgId: 999,
      customerId: foreignCustomer.id,
      invoiceNumber: "INV-999-0001",
    });
    const res = await updateInvoice({
      id: foreignInvoice.id,
      customerId: foreignCustomer.id,
      items: baseItems(),
      taxRateBps: 0,
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids switching to a customer in a different org", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    const foreignCustomer = await insertCustomer({ orgId: 999, name: "Foreign" });
    const res = await updateInvoice({
      id: created.id,
      customerId: foreignCustomer.id,
      items: baseItems(),
      taxRateBps: 0,
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});

// ---------------------------------------------------------------------------
// issueInvoice
// ---------------------------------------------------------------------------

describe("issueInvoice", () => {
  it("stamps issue_date (UTC today) and flips status to issued", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    const res = await issueInvoice({ id: created.id });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, created.id));
    expect(row.status).toBe("issued");
    expect(row.issueDate).toBe(new Date().toISOString().slice(0, 10));

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.entityType, "invoice"), eq(activityEvents.verb, "issued")),
      );
    expect(actRow.summary).toBe(`Issued invoice ${row.invoiceNumber}`);
    expect(JSON.stringify(actRow)).not.toMatch(/@/);
  });

  it("forbids issuing an already-issued invoice", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await issueInvoice({ id: created.id });
    const res = await issueInvoice({ id: created.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids issuing a void invoice", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await voidInvoice({ id: created.id });
    const res = await issueInvoice({ id: created.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids a cross-org invoice id", async () => {
    const foreignCustomer = await insertCustomer({ orgId: 999 });
    const foreignInvoice = await insertRawInvoice({
      orgId: 999,
      customerId: foreignCustomer.id,
      invoiceNumber: "INV-999-0002",
    });
    const res = await issueInvoice({ id: foreignInvoice.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("revalidates /invoices and the edit page on success", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await issueInvoice({ id: created.id });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/invoices");
    expect(calls).toContain(`/invoices/${created.id}/edit`);
  });
});

// ---------------------------------------------------------------------------
// voidInvoice
// ---------------------------------------------------------------------------

describe("voidInvoice", () => {
  it("voids a draft invoice", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    const res = await voidInvoice({ id: created.id });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, created.id));
    expect(row.status).toBe("void");
  });

  it("voids an issued invoice, and records the voided verb", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await issueInvoice({ id: created.id });
    const res = await voidInvoice({ id: created.id });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, created.id));
    expect(row.status).toBe("void");

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.entityType, "invoice"), eq(activityEvents.verb, "voided")),
      );
    expect(actRow).toBeDefined();
    expect(actRow.summary).toBe(`Voided invoice ${row.invoiceNumber}`);
    expect(JSON.stringify(actRow)).not.toMatch(/@/);
  });

  it("forbids voiding an already-void invoice (terminal)", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await voidInvoice({ id: created.id });
    const res = await voidInvoice({ id: created.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids a cross-org invoice id", async () => {
    const foreignCustomer = await insertCustomer({ orgId: 999 });
    const foreignInvoice = await insertRawInvoice({
      orgId: 999,
      customerId: foreignCustomer.id,
      invoiceNumber: "INV-999-0003",
    });
    const res = await voidInvoice({ id: foreignInvoice.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("revalidates /invoices and the edit page on success", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await voidInvoice({ id: created.id });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/invoices");
    expect(calls).toContain(`/invoices/${created.id}/edit`);
  });
});

// ---------------------------------------------------------------------------
// sendInvoice
// ---------------------------------------------------------------------------

describe("sendInvoice", () => {
  async function createIssuedInvoice(
    customerOverrides: Parameters<typeof insertCustomer>[0] = {},
  ) {
    const customer = await insertCustomer(customerOverrides);
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) throw new Error("fixture: createInvoice failed");
    await issueInvoice({ id: created.id });
    return { customer, invoiceId: created.id };
  }

  it("sends to the bill_to email by default and stamps sent_at/sent_to on a real send", async () => {
    const { invoiceId } = await createIssuedInvoice({ email: "priya@example.com" });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });

    const res = await sendInvoice({ id: invoiceId });
    expect(res).toEqual({ ok: true });

    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.sentTo).toBe("priya@example.com");

    const callArg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(callArg.to).toBe("priya@example.com");
  });

  it("an explicit toEmail overrides bill_to.email as both the recipient and the stamped sent_to", async () => {
    const { invoiceId } = await createIssuedInvoice({ email: "priya@example.com" });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });

    const res = await sendInvoice({ id: invoiceId, toEmail: "override@example.com" });
    expect(res).toEqual({ ok: true });

    const callArg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(callArg.to).toBe("override@example.com");

    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(row.sentTo).toBe("override@example.com");
  });

  it("returns a friendly no-email message when neither toEmail nor bill_to.email exist, and never calls sendEmail", async () => {
    const { invoiceId } = await createIssuedInvoice({ email: null });

    const res = await sendInvoice({ id: invoiceId });
    expect(res).toEqual({
      ok: false,
      error: "No email on file for this customer — enter one to send",
    });
    expect(sendEmail).not.toHaveBeenCalled();

    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(row.sentAt).toBeNull();
  });

  it("returns the distinct 'issued only' message for a draft invoice, without calling sendEmail", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;

    const res = await sendInvoice({ id: created.id });
    expect(res).toEqual({ ok: false, error: "Only issued invoices can be sent" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns the distinct 'issued only' message for a void invoice", async () => {
    const customer = await insertCustomer();
    const created = await createInvoice({ customerId: customer.id, items: baseItems() });
    if (!created.ok) return;
    await voidInvoice({ id: created.id });

    const res = await sendInvoice({ id: created.id });
    expect(res).toEqual({ ok: false, error: "Only issued invoices can be sent" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not stamp sent_at/sent_to on a simulated send, but returns simulated:true and still records the audit event", async () => {
    const { invoiceId } = await createIssuedInvoice({ email: "priya@example.com" });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: true, durationMs: 5 });

    const res = await sendInvoice({ id: invoiceId });
    expect(res).toEqual({ ok: true, simulated: true });

    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(row.sentAt).toBeNull();
    expect(row.sentTo).toBeNull();

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.entityType, "invoice"), eq(activityEvents.verb, "sent")));
    expect(actRow).toBeDefined();
    expect(actRow.payload).toEqual({ simulated: true });
    expect(JSON.stringify(actRow)).not.toMatch(/@/);
  });

  it("maps every sendEmail seam failure code to a short friendly error and never stamps", async () => {
    const { invoiceId } = await createIssuedInvoice({ email: "priya@example.com" });
    const cases: Array<["rate_limited" | "unavailable" | "error", string]> = [
      ["rate_limited", "Email service is rate-limited — try again shortly"],
      ["unavailable", "Email service is temporarily unavailable — try again shortly"],
      ["error", "Couldn't send the email — try again"],
    ];
    for (const [code, message] of cases) {
      vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: code, durationMs: 5 });
      const res = await sendInvoice({ id: invoiceId });
      expect(res).toEqual({ ok: false, error: message });
    }

    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(row.sentAt).toBeNull();
  });

  it("re-sending updates sent_at and sent_to to the latest send", async () => {
    const { invoiceId } = await createIssuedInvoice({ email: "priya@example.com" });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });
    await sendInvoice({ id: invoiceId });
    const [first] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(first.sentTo).toBe("priya@example.com");

    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });
    await sendInvoice({ id: invoiceId, toEmail: "second@example.com" });
    const [second] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(second.sentTo).toBe("second@example.com");
    expect(second.sentAt!.getTime()).toBeGreaterThanOrEqual(first.sentAt!.getTime());
  });

  it("forbids sending a cross-org invoice id", async () => {
    const foreignCustomer = await insertCustomer({ orgId: 999 });
    const foreignInvoice = await insertRawInvoice({
      orgId: 999,
      customerId: foreignCustomer.id,
      invoiceNumber: "INV-999-0004",
    });
    const res = await sendInvoice({ id: foreignInvoice.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("records a 'sent' audit event on a real send, with the recipient email nowhere in the payload/summary", async () => {
    const { invoiceId } = await createIssuedInvoice({ email: "priya@example.com" });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });
    await sendInvoice({ id: invoiceId });

    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.entityType, "invoice"), eq(activityEvents.verb, "sent")));
    expect(actRow).toBeDefined();
    expect(actRow.actor).toBe("boss");
    expect(actRow.entityId).toBe(invoiceId);
    expect(actRow.summary).toBe(`Sent invoice ${row.invoiceNumber} to Priya Mehta`);
    expect(actRow.payload).toEqual({ simulated: false });
    expect(JSON.stringify(actRow)).not.toMatch(/@/);
  });

  it("truncates the audit summary for a very long customer name instead of dropping the event", async () => {
    // Review finding M4: an over-cap summary fails recordActivity's Zod and
    // recordActivitySafely swallows it — the send would leave no audit row.
    // 260 chars — "Sent invoice <number> to " (~30) + 260 comfortably tops the
    // 240 cap. Raw-inserted, so the customers Zod name cap doesn't apply here.
    const longName = "Alexandrina-Wilhelmina von Hohenzollern-Sigmaringen ".repeat(5).slice(0, 260);
    const { invoiceId } = await createIssuedInvoice({
      name: longName,
      email: "priya@example.com",
    });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });
    await sendInvoice({ id: invoiceId });

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.entityType, "invoice"), eq(activityEvents.verb, "sent")));
    expect(actRow).toBeDefined();
    expect(actRow.summary.length).toBeLessThanOrEqual(240);
    expect(actRow.summary.endsWith("…")).toBe(true);
    expect(actRow.summary).toContain("Sent invoice ");
  });

  it("revalidates /invoices and the edit page on a successful send", async () => {
    const { invoiceId } = await createIssuedInvoice({ email: "priya@example.com" });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });
    await sendInvoice({ id: invoiceId });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/invoices");
    expect(calls).toContain(`/invoices/${invoiceId}/edit`);
  });

  it("sends the rendered PDF as a base64 attachment named <number>.pdf, with the right subject/feature/contentType", async () => {
    const { invoiceId } = await createIssuedInvoice({ email: "priya@example.com" });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });
    await sendInvoice({ id: invoiceId });

    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    const callArg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(callArg.subject).toBe(`Invoice ${row.invoiceNumber} from AIYA Designs`);
    expect(callArg.feature).toBe("invoice");
    expect(callArg.text).toContain(row.invoiceNumber);
    expect(callArg.text).toContain(formatCentsExact(row.totalCents));
    expect(callArg.text).toContain("The invoice PDF is attached.");
    expect(callArg.attachments).toHaveLength(1);
    const attachment = callArg.attachments![0]!;
    expect(attachment.filename).toBe(`${row.invoiceNumber}.pdf`);
    expect(attachment.contentType).toBe("application/pdf");
    const pdfBytes = Buffer.from(attachment.content, "base64");
    expect(pdfBytes.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  });
});
