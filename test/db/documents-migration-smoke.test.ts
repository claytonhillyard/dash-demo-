// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

describe("documents migration (slice 31)", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  async function seedOrg(): Promise<void> {
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
  }

  async function seedOrgAndCustomer(): Promise<number> {
    await seedOrg();
    const res = await db.execute(sql`
      INSERT INTO customers (org_id, name) VALUES (1, 'Yuki Tanaka') RETURNING id
    `);
    return (res as unknown as { rows: { id: number }[] }).rows[0].id;
  }

  it("creates the documents table with the expected columns and nullability", async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'documents'
       ORDER BY ordinal_position
    `);
    const byName = new Map(cols.rows.map((r) => [r.column_name as string, r]));
    expect(byName.get("id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("org_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("customer_id")).toMatchObject({ data_type: "integer", is_nullable: "YES" });
    expect(byName.get("title")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("doc_type")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("storage_key")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("mime_type")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("size_bytes")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("uploaded_by_label")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("created_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
  });

  it("indexes documents_org_created_idx exists", async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'documents'
    `);
    const names = idx.rows.map((r) => r.indexname as string);
    expect(names).toContain("documents_org_created_idx");
  });

  it("rejects a documents.org_id with no matching orgs row (FK)", async () => {
    await expect(
      db.execute(sql`
        INSERT INTO documents (org_id, title, doc_type, storage_key, mime_type, size_bytes, uploaded_by_label)
        VALUES (99999, 'x', 'other', 'k', 'application/pdf', 1, 'boss')
      `),
    ).rejects.toThrow();
  });

  it("customer_id is nullable, ON DELETE SET NULL: deleting the customer nulls the link without deleting the document", async () => {
    const customerId = await seedOrgAndCustomer();
    const res = await db.execute(sql`
      INSERT INTO documents (org_id, customer_id, title, doc_type, storage_key, mime_type, size_bytes, uploaded_by_label)
      VALUES (1, ${customerId}, 'AIYA-Ginza Pearl NDA', 'nda', 'org/1/documents/abc.pdf', 'application/pdf', 12345, 'boss')
      RETURNING id
    `);
    const docId = (res as unknown as { rows: { id: number }[] }).rows[0].id;

    await db.execute(sql`DELETE FROM customers WHERE id = ${customerId}`);

    const rows = await db.execute(sql`SELECT id, customer_id FROM documents WHERE id = ${docId}`);
    const row = (rows as unknown as { rows: { id: number; customer_id: number | null }[] }).rows[0];
    expect(row).toBeDefined();
    expect(row.customer_id).toBeNull();
  });

  it("createdAt defaults to now() when omitted on insert", async () => {
    await seedOrg();
    const res = await db.execute(sql`
      INSERT INTO documents (org_id, title, doc_type, storage_key, mime_type, size_bytes, uploaded_by_label)
      VALUES (1, 'x', 'other', 'k', 'application/pdf', 1, 'boss')
      RETURNING created_at
    `);
    const row = (res as unknown as { rows: { created_at: Date | string }[] }).rows[0];
    expect(row.created_at).toBeTruthy();
  });
});
