// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import type { Db } from "@/db/client";
import { activityEvents, customerHealthSnapshots } from "@/db/schema";

// Mock the Sentry SDK BEFORE importing capture.ts so vi.mock hoists correctly
// (same convention as recordActivitySafely.test.ts / notify.test.ts).
vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: { setTag: (k: string, v: unknown) => void }) => void) => {
    const tags: Record<string, unknown> = {};
    fn({ setTag: (k, v) => { tags[k] = v; } });
    (globalThis as Record<string, unknown>).__sentinelSentryTags = tags;
  },
  captureException: (e: unknown) => {
    (globalThis as Record<string, unknown>).__sentinelSentryError = e;
  },
}));

// Partial-mock: defaults to calling straight through to the REAL
// recordActivitySafely (so the drop-emits-a-real-row tests can read actual
// activity_events rows), while letting the one "swallow" test below override
// it with a single rejected call to prove capture.ts's own try/catch never
// lets a downstream throw escape. Every other test in this file never
// touches the override queue, so it always sees real behavior.
vi.mock("@/lib/activity/recordActivitySafely", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/activity/recordActivitySafely")>();
  return { recordActivitySafely: vi.fn(actual.recordActivitySafely) };
});

import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import {
  captureHealthSnapshots,
  toUtcDay,
  bandRank,
  type ScoredCustomerHealth,
} from "@/lib/sentinel/capture";

const NOW = new Date("2026-07-03T12:00:00Z");
const YESTERDAY = new Date("2026-07-02T12:00:00Z");
const ORG_ID = 1;
const CUSTOMER_ID = 2201;

function scoredCustomer(
  overrides: Partial<ScoredCustomerHealth> = {},
): ScoredCustomerHealth {
  return {
    customerId: CUSTOMER_ID,
    name: "Priya Mehta",
    score: 61,
    band: "watch",
    components: { recency: 26, frequency: 22, breadth: 13 },
    ...overrides,
  };
}

describe("toUtcDay", () => {
  it("returns the UTC YYYY-MM-DD for a given instant", () => {
    expect(toUtcDay(new Date("2026-07-03T00:00:00Z"))).toBe("2026-07-03");
    expect(toUtcDay(new Date("2026-07-03T23:59:59.999Z"))).toBe("2026-07-03");
  });
});

describe("bandRank", () => {
  it("ranks at_risk < watch < healthy", () => {
    expect(bandRank("at_risk")).toBe(0);
    expect(bandRank("watch")).toBe(1);
    expect(bandRank("healthy")).toBe(2);
    expect(bandRank("at_risk")).toBeLessThan(bandRank("watch"));
    expect(bandRank("watch")).toBeLessThan(bandRank("healthy"));
  });
});

describe("captureHealthSnapshots", () => {
  let db: Db;

  beforeAll(async () => {
    db = await getSharedDb();
  });

  beforeEach(async () => {
    await resetSharedDb();
    vi.mocked(recordActivitySafely).mockClear();
    (globalThis as Record<string, unknown>).__sentinelSentryError = undefined;
    (globalThis as Record<string, unknown>).__sentinelSentryTags = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await closeSharedDb();
  });

  async function getSnapshotRows(customerId = CUSTOMER_ID) {
    return db
      .select()
      .from(customerHealthSnapshots)
      .where(
        and(
          eq(customerHealthSnapshots.orgId, ORG_ID),
          eq(customerHealthSnapshots.customerId, customerId),
        ),
      );
  }

  async function getAllEvents() {
    return db.select().from(activityEvents);
  }

  async function seedYesterday(
    overrides: Partial<{
      customerId: number;
      score: number;
      band: "healthy" | "watch" | "at_risk";
      components: { recency: number; frequency: number; breadth: number };
    }> = {},
  ) {
    await db.insert(customerHealthSnapshots).values({
      orgId: ORG_ID,
      customerId: CUSTOMER_ID,
      score: 74,
      band: "healthy",
      components: { recency: 35, frequency: 26, breadth: 13 },
      capturedOn: toUtcDay(YESTERDAY),
      ...overrides,
    });
  }

  it("first-of-day: inserts a snapshot row with the correct capturedOn, no event", async () => {
    await captureHealthSnapshots(db, ORG_ID, [scoredCustomer()], NOW);

    const rows = await getSnapshotRows();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.capturedOn).toBe("2026-07-03");
    expect(row!.score).toBe(61);
    expect(row!.band).toBe("watch");
    expect(row!.components).toEqual({ recency: 26, frequency: 22, breadth: 13 });

    expect(await getAllEvents()).toHaveLength(0);
  });

  it("same-day second call updates score/band/components, no second row, no event", async () => {
    await captureHealthSnapshots(db, ORG_ID, [scoredCustomer({ score: 61, band: "watch" })], NOW);
    await captureHealthSnapshots(
      db,
      ORG_ID,
      [
        scoredCustomer({
          score: 66,
          band: "watch",
          components: { recency: 28, frequency: 24, breadth: 14 },
        }),
      ],
      NOW,
    );

    const rows = await getSnapshotRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(66);
    expect(rows[0]!.components).toEqual({ recency: 28, frequency: 24, breadth: 14 });

    expect(await getAllEvents()).toHaveLength(0);
  });

  it("healthy -> watch drop emits exactly one activity_events row (verb/actor/payload)", async () => {
    await seedYesterday({ band: "healthy", score: 74 });

    await captureHealthSnapshots(db, ORG_ID, [scoredCustomer({ score: 61, band: "watch" })], NOW);

    const events = await getAllEvents();
    expect(events).toHaveLength(1);
    const [ev] = events;
    expect(ev!.verb).toBe("health_dropped");
    expect(ev!.actor).toBeNull();
    expect(ev!.entityType).toBe("customer");
    expect(ev!.entityId).toBe(CUSTOMER_ID);
    expect(ev!.summary).toBe("Health dropped: Priya Mehta healthy → watch");
    expect(ev!.payload).toEqual({
      prevBand: "healthy",
      band: "watch",
      prevScore: 74,
      score: 61,
    });

    // Both yesterday's seeded row and today's new row should exist.
    expect(await getSnapshotRows()).toHaveLength(2);
    expect(recordActivitySafely).toHaveBeenCalledOnce();
  });

  it("watch -> healthy improvement emits nothing", async () => {
    await seedYesterday({ band: "watch", score: 55 });

    await captureHealthSnapshots(db, ORG_ID, [scoredCustomer({ score: 80, band: "healthy" })], NOW);

    expect(await getAllEvents()).toHaveLength(0);
  });

  it("steady band emits nothing", async () => {
    await seedYesterday({ band: "watch", score: 55 });

    await captureHealthSnapshots(db, ORG_ID, [scoredCustomer({ score: 58, band: "watch" })], NOW);

    expect(await getAllEvents()).toHaveLength(0);
  });

  it("DISTINCT ON picks the MOST RECENT of several historical rows, not insertion order", async () => {
    // Insert three historical days out of chronological order, to rule out
    // pglite quietly falling back to insertion order instead of honoring
    // `ORDER BY customer_id, captured_on DESC`. If the 3-day-ago row (watch)
    // were picked instead of yesterday's (healthy), this would wrongly look
    // like a steady watch->watch instead of a real healthy->watch drop.
    const threeDaysAgo = new Date("2026-06-30T12:00:00Z");
    const twoDaysAgo = new Date("2026-07-01T12:00:00Z");
    await seedYesterday({ band: "healthy", score: 74 }); // capturedOn = 2026-07-02 (yesterday), inserted FIRST
    await db.insert(customerHealthSnapshots).values({
      orgId: ORG_ID,
      customerId: CUSTOMER_ID,
      score: 30,
      band: "at_risk",
      components: { recency: 5, frequency: 5, breadth: 5 },
      capturedOn: toUtcDay(threeDaysAgo),
    });
    await db.insert(customerHealthSnapshots).values({
      orgId: ORG_ID,
      customerId: CUSTOMER_ID,
      score: 45,
      band: "watch",
      components: { recency: 10, frequency: 10, breadth: 10 },
      capturedOn: toUtcDay(twoDaysAgo),
    });

    await captureHealthSnapshots(db, ORG_ID, [scoredCustomer({ score: 61, band: "watch" })], NOW);

    // Prior compared against must be yesterday's "healthy" (the true
    // latest), so this is a genuine drop -> exactly one event.
    const events = await getAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ prevBand: "healthy", prevScore: 74 });
    expect(await getSnapshotRows()).toHaveLength(4); // 3 historical + today
  });

  it("first-ever snapshot emits nothing (no prior row to compare against)", async () => {
    await captureHealthSnapshots(db, ORG_ID, [scoredCustomer({ score: 20, band: "at_risk" })], NOW);

    expect(await getAllEvents()).toHaveLength(0);
    expect(await getSnapshotRows()).toHaveLength(1);
  });

  it("multi-customer batch: one dropping + one steady -> exactly one event", async () => {
    const OTHER_ID = 2204;
    await seedYesterday({ band: "healthy", score: 74 }); // CUSTOMER_ID
    await db.insert(customerHealthSnapshots).values({
      orgId: ORG_ID,
      customerId: OTHER_ID,
      score: 58,
      band: "watch",
      components: { recency: 24, frequency: 21, breadth: 13 },
      capturedOn: toUtcDay(YESTERDAY),
    });

    await captureHealthSnapshots(
      db,
      ORG_ID,
      [
        scoredCustomer({ score: 61, band: "watch" }), // healthy -> watch: drop
        {
          customerId: OTHER_ID,
          name: "Yuki Tanaka",
          score: 60,
          band: "watch",
          components: { recency: 25, frequency: 22, breadth: 13 },
        }, // watch -> watch: steady
      ],
      NOW,
    );

    const events = await getAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.entityId).toBe(CUSTOMER_ID);
    expect(events[0]!.verb).toBe("health_dropped");
  });

  it("demo mode: skips entirely, writes zero rows", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    await captureHealthSnapshots(db, ORG_ID, [scoredCustomer()], NOW);

    expect(await getSnapshotRows()).toHaveLength(0);
    expect(await getAllEvents()).toHaveLength(0);
  });

  it("build phase: skips entirely, writes zero rows", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    await captureHealthSnapshots(db, ORG_ID, [scoredCustomer()], NOW);

    expect(await getSnapshotRows()).toHaveLength(0);
    expect(await getAllEvents()).toHaveLength(0);
  });

  it("empty scored array is a no-op", async () => {
    await expect(captureHealthSnapshots(db, ORG_ID, [], NOW)).resolves.toBeUndefined();
    expect(await getSnapshotRows()).toHaveLength(0);
  });

  it("swallows a broken SELECT (bad db double) and resolves void without throwing", async () => {
    const brokenDb = {
      execute: vi.fn().mockRejectedValue(new Error("select boom")),
    } as unknown as Db;

    await expect(
      captureHealthSnapshots(brokenDb, ORG_ID, [scoredCustomer()], NOW),
    ).resolves.toBeUndefined();
  });

  it("swallows an error thrown deep in the chain (recordActivitySafely) on the drop path", async () => {
    await seedYesterday({ band: "healthy", score: 74 });
    vi.mocked(recordActivitySafely).mockRejectedValueOnce(new Error("chain boom"));

    await expect(
      captureHealthSnapshots(db, ORG_ID, [scoredCustomer({ score: 61, band: "watch" })], NOW),
    ).resolves.toBeUndefined();

    // The INSERT happens before recordActivitySafely is invoked, so today's
    // snapshot row is still written even though the downstream call rejected.
    expect(await getSnapshotRows()).toHaveLength(2);
  });
});
