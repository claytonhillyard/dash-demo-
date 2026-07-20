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
      items: [],
    });
    expect(result!.createdAt).toBeInstanceOf(Date);
    expect(result!.updatedAt).toBeInstanceOf(Date);
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
});
