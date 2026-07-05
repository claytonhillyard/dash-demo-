// @vitest-environment node
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import {
  getSharedDb,
  resetSharedDb,
  closeSharedDb,
} from "../../helpers/shared-db";
import { watchlists, activityEvents } from "@/db/schema";
import {
  watchEntity,
  unwatchEntity,
  __setTestDb,
} from "@/lib/watchlists/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { revalidatePath } from "next/cache";
import { and, eq, desc } from "drizzle-orm";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

// ---------------------------------------------------------------------------
// watchEntity
// ---------------------------------------------------------------------------

describe("watchEntity — happy path", () => {
  it("inserts a watch row and emits a 'watched' audit event without leaking the email", async () => {
    const res = await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    expect(res).toEqual({ ok: true });

    const rows = await db.select().from(watchlists);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
    expect(rows[0].actor).toBe("boss");
    expect(rows[0].entityType).toBe("customer");
    expect(rows[0].entityId).toBe(2201);
    expect(rows[0].notifyEmail).toBe("owner@aiya.demo");
    expect(rows[0].lastNotifiedAt).toBeNull();

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.entityType, "watchlist"))
      .orderBy(desc(activityEvents.id));
    expect(actRow).toMatchObject({
      orgId: 1,
      actor: "boss",
      entityType: "watchlist",
      entityId: rows[0].id,
      verb: "watched",
    });
    expect(actRow.summary).toBe("Watching customer #2201");
    // PII discipline: the notify email must not appear in summary or payload.
    expect(actRow.summary).not.toContain("@");
    expect(JSON.stringify(actRow.payload)).not.toContain("@");
    expect(actRow.payload).toMatchObject({
      watchedEntityType: "customer",
      watchedEntityId: 2201,
    });
  });

  it("revalidates /watchlists and /customers on success", async () => {
    await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/watchlists");
    expect(calls).toContain("/customers");
  });
});

describe("watchEntity — re-watch (upsert)", () => {
  it("updates the notify email in place instead of erroring on the unique key", async () => {
    const first = await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "first@aiya.demo",
    });
    expect(first).toEqual({ ok: true });

    const second = await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "second@aiya.demo",
    });
    expect(second).toEqual({ ok: true });

    const rows = await db.select().from(watchlists);
    expect(rows).toHaveLength(1);
    expect(rows[0].notifyEmail).toBe("second@aiya.demo");

    // Both watches should have emitted a "watched" audit event (2 total).
    const actRows = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.verb, "watched"));
    expect(actRows.length).toBe(2);
  });
});

describe("watchEntity — cross-org isolation", () => {
  it("ignores a wire-spoofed orgId and lands the row in the session org", async () => {
    const raw: Record<string, unknown> = {
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
      orgId: 999,
      org_id: 999,
    };
    const res = await watchEntity(raw);
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(watchlists);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
  });
});

describe("watchEntity — validation", () => {
  it("rejects an invalid email with a typed Zod error and writes nothing", async () => {
    const res = await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "not-an-email",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/email/i);
    expect(await db.select().from(watchlists)).toHaveLength(0);
  });

  it("rejects an unwhitelisted entityType", async () => {
    const res = await watchEntity({
      entityType: "not_a_real_entity",
      entityId: 1,
      notifyEmail: "owner@aiya.demo",
    });
    expect(res.ok).toBe(false);
    expect(await db.select().from(watchlists)).toHaveLength(0);
  });

  it("rejects a non-positive entityId", async () => {
    const res = await watchEntity({
      entityType: "customer",
      entityId: -1,
      notifyEmail: "owner@aiya.demo",
    });
    expect(res.ok).toBe(false);
    expect(await db.select().from(watchlists)).toHaveLength(0);
  });

  it("rejects missing entityId", async () => {
    const res = await watchEntity({
      entityType: "customer",
      notifyEmail: "owner@aiya.demo",
    });
    expect(res.ok).toBe(false);
    expect(await db.select().from(watchlists)).toHaveLength(0);
  });
});

describe("watchEntity — auth", () => {
  it("returns Unauthorized when there is no session (no insert)", async () => {
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select().from(watchlists)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// unwatchEntity
// ---------------------------------------------------------------------------

describe("unwatchEntity — happy path", () => {
  it("deletes the row and emits an 'unwatched' audit event", async () => {
    await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    const res = await unwatchEntity({ entityType: "customer", entityId: 2201 });
    expect(res).toEqual({ ok: true });

    const rows = await db.select().from(watchlists);
    expect(rows).toHaveLength(0);

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.verb, "unwatched"))
      .orderBy(desc(activityEvents.id));
    expect(actRow).toBeDefined();
    expect(actRow.orgId).toBe(1);
    expect(actRow.actor).toBe("boss");
    expect(actRow.entityType).toBe("watchlist");
    expect(JSON.stringify(actRow.payload)).not.toContain("@");
    expect(actRow.summary).not.toContain("@");
  });

  it("revalidates /watchlists and /customers on success", async () => {
    await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    vi.mocked(revalidatePath).mockClear();
    await unwatchEntity({ entityType: "customer", entityId: 2201 });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/watchlists");
    expect(calls).toContain("/customers");
  });
});

describe("unwatchEntity — idempotent no-op", () => {
  it("returns ok:true on a no-op delete and emits NO new audit event", async () => {
    const before = await db.select().from(activityEvents);
    const res = await unwatchEntity({ entityType: "customer", entityId: 2201 });
    expect(res).toEqual({ ok: true });
    const after = await db.select().from(activityEvents);
    expect(after.length).toBe(before.length);
    expect(
      after.filter((r) => r.verb === "unwatched"),
    ).toHaveLength(0);
  });
});

describe("unwatchEntity — cross-org isolation", () => {
  it("does not delete a watch belonging to a different org (idempotent no-op)", async () => {
    // Seed a row directly for a different org so it bypasses watchEntity's
    // session-scoped org write.
    await db.insert(watchlists).values({
      orgId: 999,
      actor: "boss",
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    const res = await unwatchEntity({ entityType: "customer", entityId: 2201 });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(watchlists);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(999);
  });
});

describe("unwatchEntity — validation", () => {
  it("rejects missing entityType", async () => {
    const res = await unwatchEntity({ entityId: 2201 });
    expect(res.ok).toBe(false);
  });

  it("rejects a non-integer entityId", async () => {
    const res = await unwatchEntity({ entityType: "customer", entityId: 1.5 });
    expect(res.ok).toBe(false);
  });
});

describe("unwatchEntity — auth", () => {
  it("returns Unauthorized when there is no session (no delete)", async () => {
    await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await unwatchEntity({ entityType: "customer", entityId: 2201 });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select().from(watchlists)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// demo mode
// ---------------------------------------------------------------------------

describe("demo writes disabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("watchEntity returns the disabled error and writes nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(await db.select().from(watchlists)).toHaveLength(0);
  });

  it("unwatchEntity returns the disabled error and writes nothing", async () => {
    await watchEntity({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await unwatchEntity({ entityType: "customer", entityId: 2201 });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(await db.select().from(watchlists)).toHaveLength(1);
  });
});

// Activity emission best-effort guarantee is covered by
// test/lib/activity/recordActivitySafely.test.ts — that wrapper swallows
// all errors, so action handlers can `await` it safely.
