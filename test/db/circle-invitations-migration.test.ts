// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/client";
import { circles, circleInvitations } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

const fiveMinFromNow = () => new Date(Date.now() + 5 * 60 * 1000);

describe("circle_invitations migration", () => {
  it("creates the table empty", async () => {
    const t = await createTestDb();
    close = t.close;
    expect(await t.db.select().from(circleInvitations)).toEqual([]);
  });

  it("enforces unique tokens", async () => {
    const t = await createTestDb();
    close = t.close;
    // TODO(slice-4c review): plan code used `.returning({ id: circles.id })`,
    // but the Db union (Neon | PGlite) doesn't resolve the overloaded returning
    // signature, so we use the no-arg variant which returns all columns and
    // pull .id from there. Same runtime behavior; tsc-only fix.
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning();
    await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    });
    await expect(
      t.db.insert(circleInvitations).values({
        circleId: c.id, fromOrgId: 1, toOrgSlug: "beta",
        token: "tok-1", expiresAt: fiveMinFromNow(),
      })
    ).rejects.toThrow();
  });

  it("partial unique (circle_id, to_org_slug) WHERE status=pending: rejects duplicate pending", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning();
    await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    });
    await expect(
      t.db.insert(circleInvitations).values({
        circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
        token: "tok-2", expiresAt: fiveMinFromNow(),
      })
    ).rejects.toThrow();
  });

  it("partial unique allows re-invite after non-pending status", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning();
    // First invite, then flip to declined.
    const [first] = await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    }).returning();
    await t.db.execute(sql`
      UPDATE circle_invitations
      SET status = 'declined', responded_at = now()
      WHERE id = ${first.id}
    `);
    // Re-invite same circle+slug should succeed because the prior row is no
    // longer pending.
    await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-2", expiresAt: fiveMinFromNow(),
    });
    const rows = await t.db.select().from(circleInvitations);
    expect(rows).toHaveLength(2);
  });

  it("ON DELETE CASCADE on circle_id: deleting a circle wipes its invites", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning();
    await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    });
    await t.db.execute(sql`DELETE FROM circles WHERE id = ${c.id}`);
    expect(await t.db.select().from(circleInvitations)).toHaveLength(0);
  });

  it("rejects from_org_id with no matching orgs row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning();
    await expect(
      t.db.insert(circleInvitations).values({
        circleId: c.id, fromOrgId: 99999, toOrgSlug: "alpha",
        token: "tok-1", expiresAt: fiveMinFromNow(),
      })
    ).rejects.toThrow();
  });

  it("status defaults to 'pending'", async () => {
    const t = await createTestDb();
    close = t.close;
    const [c] = await t.db.insert(circles)
      .values({ name: "C", slug: "c", ownerOrgId: 1 })
      .returning();
    const [inv] = await t.db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    }).returning();
    expect(inv.status).toBe("pending");
  });
});
