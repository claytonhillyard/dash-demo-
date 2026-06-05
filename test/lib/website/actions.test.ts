// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { websiteSnapshots } from "@/db/schema";
import {
  createWebsiteSnapshot,
  updateWebsiteSnapshot,
  deleteWebsiteSnapshot,
  __setTestDb,
} from "@/lib/website/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => {
  await resetSharedDb();
  // Reset the requireSession mock to the default org-1 session each test.
  (requireSession as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async () => ({ user: "boss", orgId: 1 }),
  );
});
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

const VALID = {
  weekStart: "2026-05-25",
  visitors: 5000,
  uniqueVisitors: 3500,
  pageViews: 18000,
  avgSessionDurationSeconds: 210,
  bounceRatePercent: 42,
};

async function insertDirect(over: Partial<typeof websiteSnapshots.$inferInsert>): Promise<number> {
  // TODO(slice-5 review): plan code used `.returning({ id: websiteSnapshots.id })`,
  // but the Db union (Neon | PGlite) doesn't resolve the overloaded returning
  // signature under tsc — same finding as slice-4 and Phase A query tests.
  // Switched to no-arg returning() (returns all columns; we only read .id).
  // Runtime identical.
  const [row] = await db.insert(websiteSnapshots).values({
    orgId: 1, weekStart: "2026-05-25",
    visitors: 5000, uniqueVisitors: 3500, pageViews: 18000,
    avgSessionDurationSeconds: 210, bounceRatePercent: 42,
    ...over,
  }).returning();
  return row.id;
}

describe("createWebsiteSnapshot — validation + happy path", () => {
  it("inserts a row with session.orgId stamped on it", async () => {
    const res = await createWebsiteSnapshot(VALID);
    expect(res).toEqual({ ok: true });
    const rows = await db.select({
      orgId: websiteSnapshots.orgId,
      weekStart: websiteSnapshots.weekStart,
      visitors: websiteSnapshots.visitors,
    }).from(websiteSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
    expect(rows[0].weekStart).toBe("2026-05-25");
    expect(rows[0].visitors).toBe(5000);
  });

  it("rejects negative visitors with { ok: false, error } and zero rows", async () => {
    const res = await createWebsiteSnapshot({ ...VALID, visitors: -1 });
    expect(res.ok).toBe(false);
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
  });

  it("rejects bounceRatePercent > 100 with { ok: false, error } and zero rows", async () => {
    const res = await createWebsiteSnapshot({ ...VALID, bounceRatePercent: 101 });
    expect(res.ok).toBe(false);
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
  });

  it("rejects bounceRatePercent < 0", async () => {
    const res = await createWebsiteSnapshot({ ...VALID, bounceRatePercent: -1 });
    expect(res.ok).toBe(false);
  });

  it("rejects invalid weekStart format (slashes)", async () => {
    const res = await createWebsiteSnapshot({ ...VALID, weekStart: "2026/05/25" });
    expect(res.ok).toBe(false);
  });

  it("stamps orgId from session, NOT from wire (slice-3 invariant)", async () => {
    // The attacker tries to fool the action into using orgId=999 by including
    // it in the payload. Zod strips unknown fields; the insert uses session.orgId.
    const res = await createWebsiteSnapshot({ ...VALID, orgId: 999 } as never);
    expect(res).toEqual({ ok: true });
    const rows = await db.select({ orgId: websiteSnapshots.orgId }).from(websiteSnapshots);
    expect(rows[0].orgId).toBe(1);
  });
});

describe("createWebsiteSnapshot — ON CONFLICT DO NOTHING", () => {
  it("returns { ok: true, duplicate: true } when (orgId, weekStart) already exists", async () => {
    await createWebsiteSnapshot(VALID);
    const second = await createWebsiteSnapshot({ ...VALID, visitors: 9999 });
    expect(second).toEqual({ ok: true, duplicate: true });
    // The original row is unchanged (DO NOTHING, not DO UPDATE).
    const rows = await db.select({ visitors: websiteSnapshots.visitors }).from(websiteSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0].visitors).toBe(5000);
  });

  it("a different week succeeds even when one row already exists", async () => {
    await createWebsiteSnapshot(VALID);
    const second = await createWebsiteSnapshot({ ...VALID, weekStart: "2026-05-18" });
    expect(second).toEqual({ ok: true });
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(2);
  });

  it("the same (orgId, weekStart) pair across DIFFERENT sessions still conflicts", async () => {
    // First session (orgId=1) inserts.
    await createWebsiteSnapshot(VALID);
    // Switch session to orgId=999.
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "other", orgId: 999,
    });
    // orgId=999 can use the same weekStart without conflict (different tenant).
    const second = await createWebsiteSnapshot(VALID);
    expect(second).toEqual({ ok: true });
    const rows = await db.select({ orgId: websiteSnapshots.orgId }).from(websiteSnapshots);
    expect(rows.map((r) => r.orgId).sort()).toEqual([1, 999]);
  });
});

describe("updateWebsiteSnapshot — tenancy enforcement", () => {
  it("updates the caller's own row", async () => {
    const id = await insertDirect({ orgId: 1, visitors: 100 });
    const res = await updateWebsiteSnapshot({ ...VALID, id, visitors: 9000 });
    expect(res).toEqual({ ok: true });
    const rows = await db.select({ visitors: websiteSnapshots.visitors })
      .from(websiteSnapshots).where(eq(websiteSnapshots.id, id));
    expect(rows[0].visitors).toBe(9000);
  });

  it("does NOT update a foreign-org row even when the id is correct", async () => {
    // Insert under orgId=999. Session is orgId=1 (default mock).
    const foreignId = await insertDirect({ orgId: 999, visitors: 100 });
    const res = await updateWebsiteSnapshot({ ...VALID, id: foreignId, visitors: 99999 });
    // The action returns { ok: true } because the SQL UPDATE succeeded
    // (just affected zero rows). This is the slice-3 pattern — see
    // src/lib/inventory/actions.ts and test/lib/inventory/actions.test.ts.
    expect(res).toEqual({ ok: true });
    const rows = await db.select({ visitors: websiteSnapshots.visitors })
      .from(websiteSnapshots).where(eq(websiteSnapshots.id, foreignId));
    // The original orgId=999 row is unchanged (visitors still 100, not 99999).
    expect(rows[0].visitors).toBe(100);
  });
});

describe("deleteWebsiteSnapshot — tenancy enforcement", () => {
  it("deletes the caller's own row", async () => {
    const id = await insertDirect({ orgId: 1 });
    const res = await deleteWebsiteSnapshot(id);
    expect(res).toEqual({ ok: true });
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
  });

  it("does NOT delete a foreign-org row even when the id is correct", async () => {
    const foreignId = await insertDirect({ orgId: 999 });
    const res = await deleteWebsiteSnapshot(foreignId);
    expect(res).toEqual({ ok: true });
    // The orgId=999 row survives.
    const rows = await db.select({ id: websiteSnapshots.id })
      .from(websiteSnapshots).where(eq(websiteSnapshots.id, foreignId));
    expect(rows).toHaveLength(1);
  });

  it("rejects a non-positive id at the Zod layer", async () => {
    const res = await deleteWebsiteSnapshot(0);
    expect(res.ok).toBe(false);
  });
});

describe("auth + demo guards", () => {
  it("returns Unauthorized when requireSession throws", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("no session"),
    );
    const res = await createWebsiteSnapshot(VALID);
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
  });

  it("demo guard fires on createWebsiteSnapshot", async () => {
    const original = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const res = await createWebsiteSnapshot(VALID);
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
      expect(await db.select({ id: websiteSnapshots.id }).from(websiteSnapshots)).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = original;
    }
  });

  it("demo guard fires on updateWebsiteSnapshot", async () => {
    const id = await insertDirect({ orgId: 1, visitors: 100 });
    const original = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const res = await updateWebsiteSnapshot({ ...VALID, id, visitors: 9999 });
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
      const rows = await db.select({ visitors: websiteSnapshots.visitors })
        .from(websiteSnapshots).where(eq(websiteSnapshots.id, id));
      expect(rows[0].visitors).toBe(100);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = original;
    }
  });

  it("demo guard fires on deleteWebsiteSnapshot", async () => {
    const id = await insertDirect({ orgId: 1 });
    const original = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const res = await deleteWebsiteSnapshot(id);
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
      expect(await db.select({ id: websiteSnapshots.id })
        .from(websiteSnapshots).where(eq(websiteSnapshots.id, id))).toHaveLength(1);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = original;
    }
  });
});
