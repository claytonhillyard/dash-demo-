// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { getReceivablesRows, getTrailingProfitMonths } from "@/db/runway";

async function seedCustomer(db: Db, orgId: number, name: string): Promise<number> {
  const [row] = await db.insert(schema.customers).values({ orgId, name }).returning();
  return row!.id;
}

type InvoiceOverrides = Partial<typeof schema.invoices.$inferInsert> & {
  orgId: number;
  customerId: number;
};

async function seedInvoice(db: Db, overrides: InvoiceOverrides) {
  const [row] = await db
    .insert(schema.invoices)
    .values({
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Test Customer" },
      subtotalCents: 1000,
      taxCents: 0,
      totalCents: 1000,
      ...overrides,
    })
    .returning();
  return row!;
}

type PaymentOverrides = Partial<typeof schema.payments.$inferInsert> & {
  orgId: number;
  invoiceId: number;
  amountCents: number;
};

async function seedPayment(db: Db, overrides: PaymentOverrides) {
  const [row] = await db
    .insert(schema.payments)
    .values({
      method: "cash",
      receivedDate: "2026-07-01",
      ...overrides,
    })
    .returning();
  return row!;
}

describe("getReceivablesRows", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(async () => {
    await resetSharedDb();
  });
  afterAll(async () => {
    await closeSharedDb();
  });

  it("includes a partial-paid issued invoice with the exact outstanding balance", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Priya Mehta" },
      totalCents: 10_000,
      dueDate: "2026-08-01",
      issueDate: "2026-07-01",
    });
    await seedPayment(db, { orgId: 1, invoiceId: invoice.id, amountCents: 4_000 });

    const rows = await getReceivablesRows(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoiceId: invoice.id,
      invoiceNumber: "INV-2026-0001",
      billToName: "Priya Mehta",
      balanceCents: 6_000,
      dueDate: "2026-08-01",
      issueDate: "2026-07-01",
    });
  });

  it("excludes draft, void, and fully-paid issued invoices — only the partial-paid one comes back", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "draft",
      billTo: { name: "Draft Customer" },
      totalCents: 5_000,
    });
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0002",
      status: "void",
      billTo: { name: "Void Customer" },
      totalCents: 5_000,
    });
    const fullyPaid = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0003",
      status: "issued",
      billTo: { name: "Paid Customer" },
      totalCents: 5_000,
    });
    await seedPayment(db, { orgId: 1, invoiceId: fullyPaid.id, amountCents: 5_000 });
    const partial = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0004",
      status: "issued",
      billTo: { name: "Partial Customer" },
      totalCents: 5_000,
    });
    await seedPayment(db, { orgId: 1, invoiceId: partial.id, amountCents: 2_000 });

    const rows = await getReceivablesRows(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.invoiceNumber).toBe("INV-2026-0004");
    expect(rows[0]!.balanceCents).toBe(3_000);
  });

  it("an invoice under a different org (999) is invisible", async () => {
    const c1 = await seedCustomer(db, 1, "Org1 Customer");
    const c999 = await seedCustomer(db, 999, "Org999 Customer");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Org1 Customer" },
      totalCents: 5_000,
    });
    await seedInvoice(db, {
      orgId: 999,
      customerId: c999,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Org999 Customer" },
      totalCents: 5_000,
    });

    const rows = await getReceivablesRows(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.billToName).toBe("Org1 Customer");
  });

  it("a payment recorded under a different org never deflates this org's balance (adversarial fixture)", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Customer A" },
      totalCents: 10_000,
    });
    await seedPayment(db, { orgId: 1, invoiceId: invoice.id, amountCents: 500 });
    // Adversarial: a payment row whose own org_id (999) disagrees with the
    // invoice it points at (an org-1 invoice) — same trick as
    // test/db/invoices.test.ts's cross-org JOIN test. The org-scoped
    // subquery must key off payments.org_id, not the invoice's real owner,
    // so this must NOT count toward org 1's balance.
    await seedPayment(db, { orgId: 999, invoiceId: invoice.id, amountCents: 99_999 });

    const rows = await getReceivablesRows(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.balanceCents).toBe(9_500);
  });

  it("orders oldest-first by COALESCE(due_date, issue_date), with a null-dates row sorted last", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    // Inserted deliberately out of chronological order.
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0003", // no dates at all — must sort last
      status: "issued",
      billTo: { name: "No Dates" },
      totalCents: 1_000,
      dueDate: null,
      issueDate: null,
    });
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0002", // no due date; falls back to issueDate
      status: "issued",
      billTo: { name: "Issue Date Only" },
      totalCents: 1_000,
      dueDate: null,
      issueDate: "2026-02-01",
    });
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001", // earliest due date
      status: "issued",
      billTo: { name: "Has Due Date" },
      totalCents: 1_000,
      dueDate: "2026-01-10",
      issueDate: "2026-01-01",
    });

    const rows = await getReceivablesRows(db, 1);
    expect(rows.map((r) => r.invoiceNumber)).toEqual([
      "INV-2026-0001",
      "INV-2026-0002",
      "INV-2026-0003",
    ]);
  });
});

describe("getTrailingProfitMonths", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(async () => {
    await resetSharedDb();
  });
  afterAll(async () => {
    await closeSharedDb();
  });

  it("returns most-recent-first amounts across a year boundary", async () => {
    await db.insert(schema.profitMonths).values([
      { year: 2025, month: 12, amountCents: -100_00 },
      { year: 2026, month: 1, amountCents: -200_00 },
      { year: 2026, month: 2, amountCents: -300_00 },
    ]);

    const months = await getTrailingProfitMonths(db, 3);
    expect(months).toEqual([-300_00, -200_00, -100_00]);
  });

  it("honors the limit n", async () => {
    await db.insert(schema.profitMonths).values([
      { year: 2025, month: 11, amountCents: 1 },
      { year: 2025, month: 12, amountCents: 2 },
      { year: 2026, month: 1, amountCents: 3 },
      { year: 2026, month: 2, amountCents: 4 },
    ]);

    const months = await getTrailingProfitMonths(db, 2);
    expect(months).toEqual([4, 3]);
  });
});

describe("getReceivablesRows / getTrailingProfitMonths — demo mode", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  afterAll(async () => {
    await closeSharedDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getReceivablesRows returns exactly 9302's derived partial balance", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { DEMO_INVOICES, DEMO_PAYMENTS } = await import("@/lib/demo/seed");

    const rows = await getReceivablesRows(db, 1);

    expect(rows).toHaveLength(1);
    const inv9302 = DEMO_INVOICES.find((i) => i.id === 9302)!;
    const paid9302 = DEMO_PAYMENTS.filter((p) => p.invoiceId === 9302).reduce(
      (sum, p) => sum + p.amountCents,
      0,
    );
    expect(rows[0]!.invoiceId).toBe(9302);
    expect(rows[0]!.balanceCents).toBe(inv9302.totalCents - paid9302);
    expect(rows[0]!.balanceCents).toBeGreaterThan(0);
  });

  it("getTrailingProfitMonths returns a deterministic 6-month array with a negative average", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    const months = await getTrailingProfitMonths(db, 6);

    expect(months).toHaveLength(6);
    const avg = months.reduce((sum, cents) => sum + cents, 0) / months.length;
    expect(avg).toBeLessThan(0);
  });

  it("getTrailingProfitMonths honors n in demo mode too (slices the deterministic array)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    const months6 = await getTrailingProfitMonths(db, 6);
    const months3 = await getTrailingProfitMonths(db, 3);

    expect(months3).toHaveLength(3);
    expect(months3).toEqual(months6.slice(0, 3));
  });
});
