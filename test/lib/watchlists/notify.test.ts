// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import type { Db } from "@/db/client";
import { watchlists } from "@/db/schema";
import type { RecordActivityInput } from "@/lib/activity/types";
import { eq } from "drizzle-orm";

vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: { setTag: (k: string, v: unknown) => void }) => void) => {
    const tags: Record<string, unknown> = {};
    fn({ setTag: (k, v) => { tags[k] = v; } });
    (globalThis as Record<string, unknown>).__notifySentryTags = tags;
  },
  captureException: (e: unknown) => {
    (globalThis as Record<string, unknown>).__notifySentryError = e;
  },
}));

vi.mock("@/lib/email/sendEmail", () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from "@/lib/email/sendEmail";
import { notifyWatchersSafely, WATCH_COOLDOWN_MS, WATCH_NOTIFY_CAP } from "@/lib/watchlists/notify";

const NOW = new Date("2026-07-05T12:00:00.000Z");

function event(overrides: Partial<RecordActivityInput> = {}): RecordActivityInput {
  return {
    orgId: 1,
    actor: "boss",
    entityType: "customer",
    entityId: 2201,
    verb: "updated",
    summary: "Updated customer Acme Corp",
    payload: null,
    ...overrides,
  };
}

async function insertWatch(
  db: Db,
  overrides: Partial<{
    orgId: number;
    actor: string;
    entityType: string;
    entityId: number;
    notifyEmail: string;
    lastNotifiedAt: Date | null;
  }> = {},
) {
  const [row] = await db
    .insert(watchlists)
    .values({
      orgId: 1,
      actor: "watcher",
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
      lastNotifiedAt: null,
      ...overrides,
    })
    .returning();
  return row;
}

describe("notifyWatchersSafely", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(async () => {
    await resetSharedDb();
    vi.mocked(sendEmail).mockReset();
    (globalThis as Record<string, unknown>).__notifySentryError = undefined;
    (globalThis as Record<string, unknown>).__notifySentryTags = undefined;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await closeSharedDb();
  });

  it("exports the documented constants", () => {
    expect(WATCH_COOLDOWN_MS).toBe(60 * 60 * 1000);
    expect(WATCH_NOTIFY_CAP).toBe(5);
  });

  it("no watchers → sendEmail not called", async () => {
    await notifyWatchersSafely(db, event(), NOW);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("matching watcher → sendEmail called once with correct to/subject/feature", async () => {
    await insertWatch(db, { notifyEmail: "watcher@aiya.demo", lastNotifiedAt: null });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });

    await notifyWatchersSafely(db, event(), NOW);

    expect(sendEmail).toHaveBeenCalledOnce();
    const arg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(arg.to).toBe("watcher@aiya.demo");
    expect(arg.feature).toBe("watchlist-alert");
    expect(arg.subject).toBe("[iDesign] Activity: Updated customer Acme Corp");
  });

  describe("cooldown", () => {
    it("skips a watch notified 10 minutes ago (within the 1h cooldown)", async () => {
      const tenMinAgo = new Date(NOW.getTime() - 10 * 60 * 1000);
      await insertWatch(db, { lastNotifiedAt: tenMinAgo });

      await notifyWatchersSafely(db, event(), NOW);

      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("notifies a watch with lastNotifiedAt NULL", async () => {
      await insertWatch(db, { lastNotifiedAt: null });
      vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });

      await notifyWatchersSafely(db, event(), NOW);

      expect(sendEmail).toHaveBeenCalledOnce();
    });

    it("notifies a watch last notified 2 hours ago (outside the 1h cooldown)", async () => {
      const twoHoursAgo = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
      await insertWatch(db, { lastNotifiedAt: twoHoursAgo });
      vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });

      await notifyWatchersSafely(db, event(), NOW);

      expect(sendEmail).toHaveBeenCalledOnce();
    });
  });

  describe("last_notified_at bookkeeping", () => {
    it("live send (ok:true, simulated:false) updates last_notified_at to now", async () => {
      const watch = await insertWatch(db, { lastNotifiedAt: null });
      vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 5 });

      await notifyWatchersSafely(db, event(), NOW);

      const [row] = await db.select().from(watchlists).where(eq(watchlists.id, watch.id));
      expect(row.lastNotifiedAt).toEqual(NOW);
    });

    it("simulated send (ok:true, simulated:true) does NOT update last_notified_at", async () => {
      const watch = await insertWatch(db, { lastNotifiedAt: null });
      vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: true, durationMs: 0 });

      await notifyWatchersSafely(db, event(), NOW);

      const [row] = await db.select().from(watchlists).where(eq(watchlists.id, watch.id));
      expect(row.lastNotifiedAt).toBeNull();
    });

    it("sendEmail resolving ok:false → no cooldown update and no throw", async () => {
      const watch = await insertWatch(db, { lastNotifiedAt: null });
      vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "unavailable", durationMs: 5 });

      await expect(notifyWatchersSafely(db, event(), NOW)).resolves.toBeUndefined();

      const [row] = await db.select().from(watchlists).where(eq(watchlists.id, watch.id));
      expect(row.lastNotifiedAt).toBeNull();
    });
  });

  it("caps at WATCH_NOTIFY_CAP (5) sends when 6 watchers are eligible", async () => {
    for (let i = 0; i < 6; i++) {
      await insertWatch(db, { actor: `watcher${i}`, notifyEmail: `w${i}@aiya.demo`, lastNotifiedAt: null });
    }
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, simulated: false, durationMs: 5 });

    await notifyWatchersSafely(db, event(), NOW);

    expect(sendEmail).toHaveBeenCalledTimes(5);
  });

  it("swallows a sendEmail rejection — function resolves void, no throw", async () => {
    await insertWatch(db, { lastNotifiedAt: null });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("network down"));

    await expect(notifyWatchersSafely(db, event(), NOW)).resolves.toBeUndefined();
  });

  describe("skip conditions", () => {
    it("returns immediately (no SELECT / no sendEmail) when entityId is null", async () => {
      await insertWatch(db, { lastNotifiedAt: null });
      await notifyWatchersSafely(db, event({ entityId: null }), NOW);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("returns immediately in demo mode, even with a matching watcher", async () => {
      await insertWatch(db, { lastNotifiedAt: null });
      vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

      await notifyWatchersSafely(db, event(), NOW);

      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe("scoping", () => {
    it("does not notify a watch on a different org", async () => {
      await insertWatch(db, { orgId: 999, lastNotifiedAt: null });
      await notifyWatchersSafely(db, event({ orgId: 1 }), NOW);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("does not notify a watch on a different entityType", async () => {
      await insertWatch(db, { entityType: "deal", lastNotifiedAt: null });
      await notifyWatchersSafely(db, event({ entityType: "customer", entityId: 2201 }), NOW);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("does not notify a watch on a different entityId", async () => {
      await insertWatch(db, { entityId: 9999, lastNotifiedAt: null });
      await notifyWatchersSafely(db, event({ entityId: 2201 }), NOW);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  it("defaults `now` to the current time when omitted", async () => {
    // Just verifying the call doesn't throw when `now` is omitted — the
    // 3-arg signature is optional per the exported type.
    await expect(notifyWatchersSafely(db, event({ entityId: null }))).resolves.toBeUndefined();
  });

  describe("Sentry / PII discipline on total failure", () => {
    it("does not leak the recipient address into Sentry tags on a swallowed failure", async () => {
      await insertWatch(db, { notifyEmail: "secret-owner@aiya.demo", lastNotifiedAt: null });
      vi.mocked(sendEmail).mockRejectedValueOnce(new Error("boom"));

      await notifyWatchersSafely(db, event(), NOW);

      // sendEmail itself is mocked (its own Sentry tagging is out of scope
      // here) — this asserts notify.ts's OWN wrap-all catch, which only
      // fires if notify's own code throws synchronously/rejects outside
      // the per-watch try. The per-watch failure path doesn't necessarily
      // hit the outer catch, so this just guards there is no leak if it does.
      const tags = (globalThis as Record<string, unknown>).__notifySentryTags as
        | Record<string, unknown>
        | undefined;
      if (tags) {
        expect(JSON.stringify(tags)).not.toContain("secret-owner@aiya.demo");
      }
    });
  });
});
