// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "alice", orgId: 999 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers, circleInvitations } from "@/db/schema";
import { acceptInvitation, __setTestDb } from "@/lib/circles/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

// TODO(slice-4c review): plan's helper used `tok-${Math.random().toString(36).slice(2)}`
// which is ~13-14 chars and fails Zod's min(16) on tokenInput. Pad with UUID
// suffix so the wire token clears the schema while preserving the
// "static test token" semantics.
//
// Helper: create an invite. AIYA (org 1, slug "aiya") owns the circle and
// invites the fixture org (999, slug "fixture").
async function makePendingInvite(): Promise<{ circleId: number; token: string }> {
  const [c] = await db.insert(circles)
    .values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 })
    .returning();
  const token = `tok-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  await db.insert(circleInvitations).values({
    circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
    token, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { circleId: c.id, token };
}

describe("acceptInvitation — happy path", () => {
  it("inserts membership + flips invite to accepted", async () => {
    const { circleId, token } = await makePendingInvite();
    const res = await acceptInvitation({ token });
    expect(res).toEqual({ ok: true });

    const members = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, 999)));
    expect(members).toHaveLength(1);

    const [inv] = await db.select().from(circleInvitations).where(eq(circleInvitations.token, token));
    expect(inv.status).toBe("accepted");
    expect(inv.respondedAt).not.toBeNull();
  });
});

describe("acceptInvitation — slug cross-check (THE security gate)", () => {
  it("rejects when session.orgId's slug does not match invite.to_org_slug", async () => {
    const [c] = await db.insert(circles)
      .values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 })
      .returning();
    const token = `tok-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    // Invite addressed to "partner" (org 888 in fixture), but session is org 999 (slug "fixture").
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "partner",
      token, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await acceptInvitation({ token });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    // No membership row.
    expect(await db.select().from(circleMembers)).toHaveLength(0);
    // Invite stays pending.
    const [inv] = await db.select().from(circleInvitations).where(eq(circleInvitations.token, token));
    expect(inv.status).toBe("pending");
  });
});

describe("acceptInvitation — expiry / already-responded / nonexistent", () => {
  it("rejects an expired invite (uniform Forbidden)", async () => {
    const [c] = await db.insert(circles)
      .values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 })
      .returning();
    const token = `tok-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
      token, expiresAt: new Date(Date.now() - 60 * 1000), // 1 min ago
    });
    const res = await acceptInvitation({ token });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(circleMembers)).toHaveLength(0);
  });

  it("rejects an already-accepted invite (second accept)", async () => {
    const { token } = await makePendingInvite();
    expect((await acceptInvitation({ token })).ok).toBe(true);
    const second = await acceptInvitation({ token });
    expect(second).toEqual({ ok: false, error: "Forbidden" });
  });

  it("rejects a nonexistent token (uniform Forbidden, no FK error)", async () => {
    const res = await acceptInvitation({ token: "00000000-0000-0000-0000-000000000000" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});

describe("acceptInvitation — concurrent-accept race resolution (load-bearing)", () => {
  it("two simultaneous accepts on the same token: exactly one succeeds, exactly one row", async () => {
    const { circleId, token } = await makePendingInvite();
    const [a, b] = await Promise.all([
      acceptInvitation({ token }),
      acceptInvitation({ token }),
    ]);
    // Exactly one ok=true.
    const successes = [a, b].filter((r) => r.ok === true);
    const failures = [a, b].filter((r) => r.ok === false);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ ok: false, error: "Forbidden" });
    // Exactly one membership row.
    const members = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, 999)));
    expect(members).toHaveLength(1);
  });
});

describe("acceptInvitation — demo guard", () => {
  it("short-circuits in demo mode without reading the DB", async () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      // Token is padded ≥ Zod tokenInput.min(16) so this test stays
      // unambiguously about the demo guard. The shorter "demo-token"
      // we used originally relied on the demo check firing BEFORE Zod
      // validation in runWithUser — a guard-ordering assumption that
      // would silently flip this test from "demo no-op" to "Zod
      // rejection" if reordered. (Slice-4c review finding #3.)
      const res = await acceptInvitation({ token: "demo-token-pad-to-16+" });
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    } finally {
      process.env.NEXT_PUBLIC_DEMO_MODE = prev;
    }
  });
});
