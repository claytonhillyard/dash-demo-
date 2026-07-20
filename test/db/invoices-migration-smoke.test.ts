// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

describe("invoices migration (slice 27)", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  /** Seeds org 1 (idempotent) + one customer row, returns the customer id. */
  async function seedOrgAndCustomer(): Promise<number> {
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    const res = await db.execute(sql`
      INSERT INTO customers (org_id, name) VALUES (1, 'Priya Mehta') RETURNING id
    `);
    return (res as unknown as { rows: { id: number }[] }).rows[0].id;
  }

  it("creates the invoices table with the expected columns and nullability", async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'invoices'
       ORDER BY ordinal_position
    `);
    const byName = new Map(cols.rows.map((r) => [r.column_name as string, r]));
    expect(byName.get("id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("org_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("customer_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("invoice_number")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("status")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("bill_to")).toMatchObject({ data_type: "jsonb", is_nullable: "NO" });
    expect(byName.get("issue_date")).toMatchObject({ data_type: "text", is_nullable: "YES" });
    expect(byName.get("due_date")).toMatchObject({ data_type: "text", is_nullable: "YES" });
    expect(byName.get("currency")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("subtotal_cents")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("tax_rate_bps")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("tax_cents")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("total_cents")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("notes")).toMatchObject({ data_type: "text", is_nullable: "YES" });
    expect(byName.get("created_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
    expect(byName.get("updated_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
  });

  it("creates the invoice_items table with the expected columns and nullability", async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'invoice_items'
       ORDER BY ordinal_position
    `);
    const byName = new Map(cols.rows.map((r) => [r.column_name as string, r]));
    expect(byName.get("id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("invoice_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("position")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("description")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("quantity")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("unit_price_cents")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("line_total_cents")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
  });

  it("defaults: status='draft', currency='USD', tax_rate_bps=0 on invoices; quantity=1 on invoice_items", async () => {
    const customerId = await seedOrgAndCustomer();
    const invoiceRes = await db.execute(sql`
      INSERT INTO invoices (org_id, customer_id, invoice_number, bill_to, subtotal_cents, tax_cents, total_cents)
      VALUES (1, ${customerId}, 'INV-2026-0001', '{"name":"Priya Mehta"}'::jsonb, 1000, 0, 1000)
      RETURNING id, status, currency, tax_rate_bps
    `);
    const invoiceRow = (
      invoiceRes as unknown as {
        rows: { id: number; status: string; currency: string; tax_rate_bps: number }[];
      }
    ).rows[0];
    expect(invoiceRow.status).toBe("draft");
    expect(invoiceRow.currency).toBe("USD");
    expect(invoiceRow.tax_rate_bps).toBe(0);

    const itemRes = await db.execute(sql`
      INSERT INTO invoice_items (invoice_id, position, description, unit_price_cents, line_total_cents)
      VALUES (${invoiceRow.id}, 0, 'Solitaire ring', 250000, 250000)
      RETURNING quantity
    `);
    const itemRow = (itemRes as unknown as { rows: { quantity: number }[] }).rows[0];
    expect(itemRow.quantity).toBe(1);
  });

  it("indexes invoices_org_number_unique, invoices_org_status_created_idx, invoices_org_customer_idx, invoice_items_invoice_position_idx exist", async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename IN ('invoices', 'invoice_items')
    `);
    const names = idx.rows.map((r) => r.indexname as string);
    expect(names).toContain("invoices_org_number_unique");
    expect(names).toContain("invoices_org_status_created_idx");
    expect(names).toContain("invoices_org_customer_idx");
    expect(names).toContain("invoice_items_invoice_position_idx");
  });

  it("rejects a duplicate (org_id, invoice_number) insert (UNIQUE)", async () => {
    const customerId = await seedOrgAndCustomer();
    await db.execute(sql`
      INSERT INTO invoices (org_id, customer_id, invoice_number, bill_to, subtotal_cents, tax_cents, total_cents)
      VALUES (1, ${customerId}, 'INV-2026-0001', '{"name":"Priya Mehta"}'::jsonb, 1000, 0, 1000)
    `);
    await expect(
      db.execute(sql`
        INSERT INTO invoices (org_id, customer_id, invoice_number, bill_to, subtotal_cents, tax_cents, total_cents)
        VALUES (1, ${customerId}, 'INV-2026-0001', '{"name":"Priya Mehta"}'::jsonb, 2000, 0, 2000)
      `),
    ).rejects.toThrow();
  });

  it("allows the same invoice_number in a different org", async () => {
    const customerId = await seedOrgAndCustomer();
    await db.execute(sql`
      INSERT INTO invoices (org_id, customer_id, invoice_number, bill_to, subtotal_cents, tax_cents, total_cents)
      VALUES (1, ${customerId}, 'INV-2026-0001', '{"name":"Priya Mehta"}'::jsonb, 1000, 0, 1000)
    `);

    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (2, 'b', 'B') ON CONFLICT (id) DO NOTHING`);
    const c2Res = await db.execute(sql`
      INSERT INTO customers (org_id, name) VALUES (2, 'Jean-Marc Auclair') RETURNING id
    `);
    const c2Id = (c2Res as unknown as { rows: { id: number }[] }).rows[0].id;

    await expect(
      db.execute(sql`
        INSERT INTO invoices (org_id, customer_id, invoice_number, bill_to, subtotal_cents, tax_cents, total_cents)
        VALUES (2, ${c2Id}, 'INV-2026-0001', '{"name":"Jean-Marc Auclair"}'::jsonb, 3000, 0, 3000)
      `),
    ).resolves.toBeDefined();
  });

  it("blocks deleting a customer that has an invoice (FK no-action on invoices.customer_id)", async () => {
    const customerId = await seedOrgAndCustomer();
    await db.execute(sql`
      INSERT INTO invoices (org_id, customer_id, invoice_number, bill_to, subtotal_cents, tax_cents, total_cents)
      VALUES (1, ${customerId}, 'INV-2026-0001', '{"name":"Priya Mehta"}'::jsonb, 1000, 0, 1000)
    `);

    await expect(
      db.execute(sql`DELETE FROM customers WHERE id = ${customerId}`),
    ).rejects.toThrow();
  });

  it("cascades: deleting an invoice deletes its items (invoice_items.invoice_id ON DELETE CASCADE)", async () => {
    const customerId = await seedOrgAndCustomer();
    const invoiceRes = await db.execute(sql`
      INSERT INTO invoices (org_id, customer_id, invoice_number, bill_to, subtotal_cents, tax_cents, total_cents)
      VALUES (1, ${customerId}, 'INV-2026-0001', '{"name":"Priya Mehta"}'::jsonb, 1000, 0, 1000)
      RETURNING id
    `);
    const invoiceId = (invoiceRes as unknown as { rows: { id: number }[] }).rows[0].id;

    await db.execute(sql`
      INSERT INTO invoice_items (invoice_id, position, description, unit_price_cents, line_total_cents)
      VALUES (${invoiceId}, 0, 'Solitaire ring', 250000, 250000)
    `);

    const before = await db.execute(sql`SELECT id FROM invoice_items WHERE invoice_id = ${invoiceId}`);
    expect(before.rows).toHaveLength(1);

    await db.execute(sql`DELETE FROM invoices WHERE id = ${invoiceId}`);

    const after = await db.execute(sql`SELECT id FROM invoice_items WHERE invoice_id = ${invoiceId}`);
    expect(after.rows).toHaveLength(0);
  });

  it("bill_to jsonb round-trips through a drizzle insert/select", async () => {
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    const [customer] = await db
      .insert(schema.customers)
      .values({ orgId: 1, name: "Priya Mehta" })
      .returning();

    const billTo = {
      name: "Priya Mehta",
      businessName: "Mehta Diamonds Pvt Ltd",
      email: "priya@mehtadiamonds.example",
      address: { city: "Mumbai", country: "IN" },
    };

    await db.insert(schema.invoices).values({
      orgId: 1,
      customerId: customer.id,
      invoiceNumber: "INV-2026-0001",
      billTo,
      subtotalCents: 250000,
      taxCents: 0,
      totalCents: 250000,
    });

    const [row] = await db.select().from(schema.invoices);
    expect(row.billTo).toEqual(billTo);
  });
});
