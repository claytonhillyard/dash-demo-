// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { getInvoices, getInvoiceById } from "@/db/invoices";

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

describe("getInvoices — list reader", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(async () => {
    await resetSharedDb();
    await db.execute(
      sql`INSERT INTO orgs (id, slug, name) VALUES (2, 'two', 'Two') ON CONFLICT (id) DO NOTHING`,
    );
  });
  afterAll(async () => {
    await closeSharedDb();
  });

  it("returns only invoices for the viewer's org (cross-org isolation)", async () => {
    const c1 = await seedCustomer(db, 1, "Org1 Customer");
    const c2 = await seedCustomer(db, 2, "Org2 Customer");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Org1 Customer" },
    });
    await seedInvoice(db, {
      orgId: 2,
      customerId: c2,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Org2 Customer" },
    });

    const rows = await getInvoices(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.billToName).toBe("Org1 Customer");
  });

  it("filters by status", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "draft",
      billTo: { name: "Customer A" },
    });
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0002",
      status: "issued",
      billTo: { name: "Customer A" },
    });
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0003",
      status: "void",
      billTo: { name: "Customer A" },
    });

    const draft = await getInvoices(db, 1, { status: "draft" });
    expect(draft).toHaveLength(1);
    expect(draft[0]!.status).toBe("draft");

    const issued = await getInvoices(db, 1, { status: "issued" });
    expect(issued).toHaveLength(1);
    expect(issued[0]!.status).toBe("issued");

    const all = await getInvoices(db, 1);
    expect(all).toHaveLength(3);
  });

  it("orders by created_at DESC (most recent first)", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "First" },
    });
    await new Promise((r) => setTimeout(r, 5));
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0002",
      billTo: { name: "Second" },
    });

    const rows = await getInvoices(db, 1);
    expect(rows.map((r) => r.billToName)).toEqual(["Second", "First"]);
  });

  it("extracts billToName from the bill_to jsonb snapshot (no customers join)", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Priya Mehta", businessName: "Mehta Diamonds Pvt Ltd" },
    });
    const rows = await getInvoices(db, 1);
    expect(rows[0]!.billToName).toBe("Priya Mehta");
  });

  it("returns createdAt coerced to a real Date instance", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Customer A" },
    });
    const rows = await getInvoices(db, 1);
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("list row includes sentAt/sentTo (null when never sent; populated after a send)", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Customer A" },
    });
    const sentAt = new Date("2026-07-10T12:00:00Z");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0002",
      status: "issued",
      billTo: { name: "Customer A" },
      sentAt,
      sentTo: "customer@example.com",
    });

    const rows = await getInvoices(db, 1);
    const unsent = rows.find((r) => r.invoiceNumber === "INV-2026-0001")!;
    const sent = rows.find((r) => r.invoiceNumber === "INV-2026-0002")!;
    expect(unsent.sentAt).toBeNull();
    expect(unsent.sentTo).toBeNull();
    expect(sent.sentAt).toBeInstanceOf(Date);
    expect(sent.sentAt?.toISOString()).toBe(sentAt.toISOString());
    expect(sent.sentTo).toBe("customer@example.com");
  });

  it("default limit is 50 — clamps to 200 maximum", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    for (let i = 0; i < 210; i++) {
      await seedInvoice(db, {
        orgId: 1,
        customerId: c1,
        invoiceNumber: `INV-2026-${String(i + 1).padStart(4, "0")}`,
        billTo: { name: "Customer A" },
      });
    }
    expect((await getInvoices(db, 1)).length).toBe(50);
    expect((await getInvoices(db, 1, { limit: 100 })).length).toBe(100);
    expect((await getInvoices(db, 1, { limit: 500 })).length).toBe(200);
  }, 45_000);

  // --- Slice 29: paidCents via LEFT JOIN grouped subquery ---

  it("paidCents is 0 for an invoice with no payments", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Customer A" },
    });
    const rows = await getInvoices(db, 1);
    expect(rows[0]!.paidCents).toBe(0);
  });

  it("paidCents reflects a single payment", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Customer A" },
      totalCents: 10_000,
    });
    await seedPayment(db, { orgId: 1, invoiceId: invoice.id, amountCents: 3000 });

    const rows = await getInvoices(db, 1);
    expect(rows[0]!.paidCents).toBe(3000);
  });

  it("paidCents sums 2 payments on the same invoice", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Customer A" },
      totalCents: 10_000,
    });
    await seedPayment(db, { orgId: 1, invoiceId: invoice.id, amountCents: 3000, method: "card" });
    await seedPayment(db, { orgId: 1, invoiceId: invoice.id, amountCents: 1500, method: "wire" });

    const rows = await getInvoices(db, 1);
    expect(rows[0]!.paidCents).toBe(4500);
  });

  it("a payment recorded under a different org never inflates this org's paidCents sum (cross-org isolation on the JOIN)", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Customer A" },
      totalCents: 10_000,
    });
    // Legitimate org-1 payment.
    await seedPayment(db, { orgId: 1, invoiceId: invoice.id, amountCents: 500 });
    // Adversarial: a payment row whose own org_id (999) disagrees with the
    // invoice it points at (an org-1 invoice) — simulates a data-integrity
    // anomaly, not something the action layer would ever produce itself.
    // The org-scoped subquery must key off payments.org_id, not the
    // invoice's real owner, so this must NOT count toward org 1's sum.
    await seedPayment(db, { orgId: 999, invoiceId: invoice.id, amountCents: 99_999 });

    const rows = await getInvoices(db, 1);
    expect(rows[0]!.paidCents).toBe(500);

    // getInvoiceById's payments list must show the same isolation.
    const detail = await getInvoiceById(db, 1, invoice.id);
    expect(detail!.paidCents).toBe(500);
    expect(detail!.payments).toHaveLength(1);
  });
});

describe("getInvoiceById — single-invoice reader", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(async () => {
    await resetSharedDb();
    await db.execute(
      sql`INSERT INTO orgs (id, slug, name) VALUES (2, 'two', 'Two') ON CONFLICT (id) DO NOTHING`,
    );
  });
  afterAll(async () => {
    await closeSharedDb();
  });

  it("orders items by position, even when inserted out of order", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Customer A" },
    });
    await db.insert(schema.invoiceItems).values([
      { invoiceId: invoice.id, position: 2, description: "Third item", unitPriceCents: 300, lineTotalCents: 300 },
      { invoiceId: invoice.id, position: 0, description: "First item", unitPriceCents: 100, lineTotalCents: 100 },
      { invoiceId: invoice.id, position: 1, description: "Second item", unitPriceCents: 200, lineTotalCents: 200 },
    ]);

    const result = await getInvoiceById(db, 1, invoice.id);
    expect(result).not.toBeNull();
    expect(result!.items.map((i) => i.description)).toEqual([
      "First item",
      "Second item",
      "Third item",
    ]);
    expect(result!.items.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("returns null for a cross-org id (exists, but in a different org)", async () => {
    const c2 = await seedCustomer(db, 2, "Org2 Customer");
    const invoice = await seedInvoice(db, {
      orgId: 2,
      customerId: c2,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Org2 Customer" },
    });

    const result = await getInvoiceById(db, 1, invoice.id);
    expect(result).toBeNull();
  });

  it("returns null for a missing id", async () => {
    const result = await getInvoiceById(db, 1, 999_999);
    expect(result).toBeNull();
  });

  it("returns the full invoice shape, including bill_to and numeric coercion", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const billTo = {
      name: "Priya Mehta",
      businessName: "Mehta Diamonds Pvt Ltd",
      email: "priya@example.com",
      address: { city: "Mumbai", country: "IN" },
    };
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0007",
      status: "issued",
      billTo,
      issueDate: "2026-06-01",
      dueDate: "2026-07-01",
      subtotalCents: 5000,
      taxRateBps: 800,
      taxCents: 400,
      totalCents: 5400,
      notes: "Test note",
    });

    const result = await getInvoiceById(db, 1, invoice.id);
    expect(result).toMatchObject({
      id: invoice.id,
      customerId: c1,
      invoiceNumber: "INV-2026-0007",
      status: "issued",
      billTo,
      issueDate: "2026-06-01",
      dueDate: "2026-07-01",
      currency: "USD",
      subtotalCents: 5000,
      taxRateBps: 800,
      taxCents: 400,
      totalCents: 5400,
      notes: "Test note",
      sentAt: null,
      sentTo: null,
      items: [],
    });
    expect(result!.createdAt).toBeInstanceOf(Date);
    expect(result!.updatedAt).toBeInstanceOf(Date);
  });

  it("returns sentAt/sentTo when a send has been recorded", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const sentAt = new Date("2026-07-15T09:30:00Z");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0009",
      status: "issued",
      billTo: { name: "Customer A" },
      sentAt,
      sentTo: "billing@example.com",
    });

    const result = await getInvoiceById(db, 1, invoice.id);
    expect(result!.sentAt).toBeInstanceOf(Date);
    expect(result!.sentAt?.toISOString()).toBe(sentAt.toISOString());
    expect(result!.sentTo).toBe("billing@example.com");
  });

  it("returns items: [] (not undefined) when an invoice has no items", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      billTo: { name: "Customer A" },
    });
    const result = await getInvoiceById(db, 1, invoice.id);
    expect(result!.items).toEqual([]);
  });

  // --- Slice 29: payments / paidCents / balanceCents ---

  it("an invoice with no payments returns payments: [], paidCents 0, and balanceCents === totalCents", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Customer A" },
      totalCents: 7500,
    });
    const result = await getInvoiceById(db, 1, invoice.id);
    expect(result!.payments).toEqual([]);
    expect(result!.paidCents).toBe(0);
    expect(result!.balanceCents).toBe(7500);
  });

  it("sums paidCents from payments and computes balanceCents = totalCents - paidCents", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Customer A" },
      totalCents: 10_000,
    });
    await seedPayment(db, {
      orgId: 1,
      invoiceId: invoice.id,
      amountCents: 3000,
      method: "card",
      receivedDate: "2026-07-05",
    });
    await seedPayment(db, {
      orgId: 1,
      invoiceId: invoice.id,
      amountCents: 1500,
      method: "wire",
      receivedDate: "2026-07-10",
    });

    const result = await getInvoiceById(db, 1, invoice.id);
    expect(result!.paidCents).toBe(4500);
    expect(result!.balanceCents).toBe(5500);
  });

  it("orders payments by receivedDate DESC, then id DESC as a tiebreak", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Customer A" },
      totalCents: 10_000,
    });
    const earliest = await seedPayment(db, {
      orgId: 1,
      invoiceId: invoice.id,
      amountCents: 100,
      receivedDate: "2026-07-01",
    });
    // Two payments on the SAME receivedDate, inserted in ascending id order
    // — id DESC must break the tie (the second insert sorts first).
    const sameDateFirst = await seedPayment(db, {
      orgId: 1,
      invoiceId: invoice.id,
      amountCents: 200,
      receivedDate: "2026-07-10",
    });
    const sameDateSecond = await seedPayment(db, {
      orgId: 1,
      invoiceId: invoice.id,
      amountCents: 300,
      receivedDate: "2026-07-10",
    });

    const result = await getInvoiceById(db, 1, invoice.id);
    expect(result!.payments.map((p) => p.id)).toEqual([
      sameDateSecond.id,
      sameDateFirst.id,
      earliest.id,
    ]);
  });

  it("coerces payment createdAt to a real Date instance", async () => {
    const c1 = await seedCustomer(db, 1, "Customer A");
    const invoice = await seedInvoice(db, {
      orgId: 1,
      customerId: c1,
      invoiceNumber: "INV-2026-0001",
      status: "issued",
      billTo: { name: "Customer A" },
    });
    await seedPayment(db, { orgId: 1, invoiceId: invoice.id, amountCents: 100 });

    const result = await getInvoiceById(db, 1, invoice.id);
    expect(result!.payments[0]!.createdAt).toBeInstanceOf(Date);
  });
});

describe("getInvoices / getInvoiceById — demo mode", () => {
  const ORIGINAL_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    vi.resetModules();
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = ORIGINAL_DEMO;
    vi.resetModules();
  });

  it("getInvoices returns the 3 demo seeds for org 1", async () => {
    const mod = await import("@/db/invoices");
    const db = await getSharedDb();
    const rows = await mod.getInvoices(db, 1);
    expect(rows).toHaveLength(3);
  });

  it("getInvoices filters demo rows by status", async () => {
    const mod = await import("@/db/invoices");
    const db = await getSharedDb();
    const draft = await mod.getInvoices(db, 1, { status: "draft" });
    expect(draft).toHaveLength(1);
    expect(draft[0]!.status).toBe("draft");
  });

  it("getInvoices returns [] for an unseeded org", async () => {
    const mod = await import("@/db/invoices");
    const db = await getSharedDb();
    expect(await mod.getInvoices(db, 999_999)).toEqual([]);
  });

  it("getInvoiceById(9302) returns the issued invoice with items", async () => {
    const mod = await import("@/db/invoices");
    const db = await getSharedDb();
    const result = await mod.getInvoiceById(db, 1, 9302);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("issued");
    expect(result!.items.length).toBeGreaterThan(0);
  });

  it("getInvoiceById cross-org lookup on a demo id returns null", async () => {
    const mod = await import("@/db/invoices");
    const db = await getSharedDb();
    expect(await mod.getInvoiceById(db, 999_999, 9302)).toBeNull();
  });

  it("getInvoiceById(9302) — the seeded sent example — has sentAt (Date) and sentTo populated", async () => {
    const mod = await import("@/db/invoices");
    const db = await getSharedDb();
    const result = await mod.getInvoiceById(db, 1, 9302);
    expect(result!.sentAt).toBeInstanceOf(Date);
    expect(result!.sentTo).toBe("y.tanaka@ginzapearl.jp");
  });

  it("getInvoiceById(9301) — never sent — has null sentAt/sentTo", async () => {
    const mod = await import("@/db/invoices");
    const db = await getSharedDb();
    const result = await mod.getInvoiceById(db, 1, 9301);
    expect(result!.sentAt).toBeNull();
    expect(result!.sentTo).toBeNull();
  });

  // --- Slice 29: demo payments ---

  it("getInvoices demo branch: paidCents for 9302 equals the sum of DEMO_PAYMENTS on it", async () => {
    const mod = await import("@/db/invoices");
    const { DEMO_PAYMENTS } = await import("@/lib/demo/seed");
    const db = await getSharedDb();
    const rows = await mod.getInvoices(db, 1);
    const row9302 = rows.find((r) => r.id === 9302)!;
    const expected = DEMO_PAYMENTS.filter((p) => p.invoiceId === 9302).reduce(
      (sum, p) => sum + p.amountCents,
      0,
    );
    expect(row9302.paidCents).toBe(expected);
    expect(row9302.paidCents).toBeGreaterThan(0);
  });

  it("getInvoiceById(9302) demo branch: payments/paidCents/balanceCents populated; 9301 and 9303 carry no payments", async () => {
    const mod = await import("@/db/invoices");
    const db = await getSharedDb();

    const result9302 = await mod.getInvoiceById(db, 1, 9302);
    expect(result9302!.payments.length).toBe(2);
    expect(result9302!.paidCents).toBeGreaterThan(0);
    expect(result9302!.balanceCents).toBe(result9302!.totalCents - result9302!.paidCents);
    // 9302 is the seeded "Partial" example — paid but not paid in full.
    expect(result9302!.balanceCents).toBeGreaterThan(0);

    const result9301 = await mod.getInvoiceById(db, 1, 9301);
    expect(result9301!.payments).toEqual([]);
    expect(result9301!.paidCents).toBe(0);
    expect(result9301!.balanceCents).toBe(result9301!.totalCents);

    const result9303 = await mod.getInvoiceById(db, 1, 9303);
    expect(result9303!.payments).toEqual([]);
    expect(result9303!.paidCents).toBe(0);
  });
});
