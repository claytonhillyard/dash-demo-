// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleInvitations } from "@/db/schema";
import { inviteOrgToCircle, acceptInvitation, __setTestDb } from "@/lib/circles/actions";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("token security", () => {
  it("inviteOrgToCircle generates a v4-shaped UUID token", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning();
    await inviteOrgToCircle({ circleId: c.id, toOrgSlug: "fixture" });
    const [inv] = await db.select().from(circleInvitations);
    expect(inv.token).toMatch(UUID_RE);
  });

  it("two consecutive invites produce different tokens", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning();
    await inviteOrgToCircle({ circleId: c.id, toOrgSlug: "a" });
    await inviteOrgToCircle({ circleId: c.id, toOrgSlug: "b" });
    const rows = await db.select({ token: circleInvitations.token }).from(circleInvitations);
    expect(new Set(rows.map((r) => r.token)).size).toBe(rows.length);
  });

  it("Forbidden rejection does NOT log the token to console.warn / console.error", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning();
    await inviteOrgToCircle({ circleId: c.id, toOrgSlug: "partner" });
    const [inv] = await db.select().from(circleInvitations);
    const secretToken = inv.token;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Wrong-slug session (default mock: org 1, slug "aiya") accepting a
      // token addressed to "partner" — must produce Forbidden + no token in logs.
      await acceptInvitation({ token: secretToken });
      const allWarns = warnSpy.mock.calls.flat().map((x) => String(x)).join("\n");
      const allErrors = errSpy.mock.calls.flat().map((x) => String(x)).join("\n");
      expect(allWarns).not.toContain(secretToken);
      expect(allErrors).not.toContain(secretToken);
    } finally {
      warnSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
