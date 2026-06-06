// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { createCircle, __setTestDb } from "@/lib/circles/actions";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

describe("createCircle", () => {
  it("creates a circle owned by the session's org and auto-joins as member", async () => {
    const res = await createCircle({ name: "Test Circle", slug: "test-circle" });
    expect(res).toEqual({ ok: true });
    const cs = await db.select().from(circles);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ name: "Test Circle", slug: "test-circle", ownerOrgId: 1 });
    const members = await db.select().from(circleMembers).where(eq(circleMembers.circleId, cs[0].id));
    expect(members).toHaveLength(1);
    expect(members[0].orgId).toBe(1);
  });

  it("rejects an invalid slug at Zod", async () => {
    const res = await createCircle({ name: "x", slug: "BAD SLUG" });
    expect(res.ok).toBe(false);
  });

  it("rejects a duplicate slug with Database error (slice-4 circles_slug_uniq)", async () => {
    await createCircle({ name: "First", slug: "shared" });
    const res = await createCircle({ name: "Second", slug: "shared" });
    expect(res).toEqual({ ok: false, error: "Database error" });
  });

  it("never trusts ownerOrgId from the wire", async () => {
    const res = await createCircle({ name: "x", slug: "x", ownerOrgId: 999 } as never);
    expect(res).toEqual({ ok: true });
    const [c] = await db.select().from(circles);
    expect(c.ownerOrgId).toBe(1);
  });
});
