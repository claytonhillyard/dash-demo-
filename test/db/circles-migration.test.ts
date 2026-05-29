// @vitest-environment node
// TODO(slice-4 review): plan code used `.returning({ id: circles.id })` /
// `.returning({ id: deals.id })`, but the Db union (Neon | PGlite) doesn't
// resolve the overloaded returning signature under tsc. Switched to no-arg
// returning() everywhere (returns all columns; we only read .id). Runtime
// behavior is identical.
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/client";
import { circles, circleMembers, deals } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("circles migration", () => {
  it("creates the circles + circle_members tables empty", async () => {
    const t = await createTestDb();
    close = t.close;
    expect(await t.db.select().from(circles)).toEqual([]);
    expect(await t.db.select().from(circleMembers)).toEqual([]);
  });

  it("enforces circles.slug uniqueness", async () => {
    const t = await createTestDb();
    close = t.close;
    await t.db.insert(circles).values({ name: "A", slug: "shared", ownerOrgId: 1 });
    await expect(
      t.db.insert(circles).values({ name: "B", slug: "shared", ownerOrgId: 1 })
    ).rejects.toThrow();
  });

  it("enforces circle_members (circle_id, org_id) uniqueness", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning();
    await t.db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    await expect(
      t.db.insert(circleMembers).values({ circleId: c.id, orgId: 1 })
    ).rejects.toThrow();
  });

  it("rejects a circle owner_org_id with no matching orgs row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    await expect(
      t.db.insert(circles).values({ name: "X", slug: "x", ownerOrgId: 99999 })
    ).rejects.toThrow();
  });

  it("rejects a circle_members.org_id with no matching orgs row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "Y", slug: "y", ownerOrgId: 1 })
      .returning();
    await expect(
      t.db.insert(circleMembers).values({ circleId: c.id, orgId: 99999 })
    ).rejects.toThrow();
  });

  it("rejects a deals.visibility_circle_id with no matching circles row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    await expect(
      t.db.execute(sql`
        INSERT INTO deals (org_id, kind, category, subject, quantity, price_cents,
          posted_by_label, visibility_circle_id)
        VALUES (1, 'SELL', 'Diamond', 'x', 1, 100, 'boss', 99999)
      `)
    ).rejects.toThrow();
  });

  it("ON DELETE SET NULL: deleting a circle nulls deals.visibility_circle_id without deleting the deal", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "Z", slug: "z", ownerOrgId: 1 })
      .returning();
    const [d] = await t.db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "shared",
      quantity: 1, priceCents: 100, postedByLabel: "boss",
      visibilityCircleId: c.id,
    }).returning();

    await t.db.execute(sql`DELETE FROM circles WHERE id = ${c.id}`);

    const rows = await t.db.select({
      id: deals.id, vis: deals.visibilityCircleId,
    }).from(deals);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(d.id);
    expect(rows[0].vis).toBeNull();
  });
});
