// @vitest-environment node
//
// Composition test (spec §7 / plan Task 38-2): proves the full 24 + 25 + 38
// stack fires end-to-end through the REAL chokepoint. Only the outermost
// email leaf (`sendEmail`) is mocked — `recordActivitySafely` and
// `notifyWatchersSafely` run for real, so a band drop captured here must
// travel: captureHealthSnapshots -> recordActivitySafely -> recordActivity
// (real activity_events row) -> notifyWatchersSafely (real watchlists
// SELECT) -> sendEmail (mocked leaf).
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import type { Db } from "@/db/client";
import { activityEvents, customerHealthSnapshots, watchlists } from "@/db/schema";

vi.mock("@/lib/email/sendEmail", () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from "@/lib/email/sendEmail";
import { captureHealthSnapshots, toUtcDay } from "@/lib/sentinel/capture";
import { getCustomerActivityStats } from "@/db/activityEvents";
import { computeHealthScore } from "@/lib/customers/healthScore";

const NOW = new Date("2026-07-03T12:00:00Z");
const YESTERDAY = new Date("2026-07-02T12:00:00Z");
const ORG_ID = 1;
const CUSTOMER_ID = 2201;

describe("captureHealthSnapshots composition (24 activity + 25 watchlists + 38 sentinel)", () => {
  let db: Db;

  beforeAll(async () => {
    db = await getSharedDb();
  });

  beforeEach(async () => {
    await resetSharedDb();
    vi.mocked(sendEmail).mockReset();
  });

  afterAll(async () => {
    await closeSharedDb();
  });

  it("a real band drop emails the watcher end-to-end through the real chokepoint", async () => {
    await db.insert(watchlists).values({
      orgId: ORG_ID,
      actor: "boss",
      entityType: "customer",
      entityId: CUSTOMER_ID,
      notifyEmail: "watcher@test.dev",
      lastNotifiedAt: null,
    });
    await db.insert(customerHealthSnapshots).values({
      orgId: ORG_ID,
      customerId: CUSTOMER_ID,
      score: 74,
      band: "healthy",
      components: { recency: 35, frequency: 26, breadth: 13 },
      capturedOn: toUtcDay(YESTERDAY),
    });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, simulated: false, durationMs: 1 });

    await captureHealthSnapshots(
      db,
      ORG_ID,
      [
        {
          customerId: CUSTOMER_ID,
          name: "Priya Mehta",
          score: 61,
          band: "watch",
          components: { recency: 26, frequency: 22, breadth: 13 },
        },
      ],
      NOW,
    );

    expect(sendEmail).toHaveBeenCalledOnce();
    const arg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(arg.to).toBe("watcher@test.dev");
    expect(arg.feature).toBe("watchlist-alert");
    expect(arg.subject).toContain("Health dropped");
  });

  // Final review Fix 1 (CRITICAL): Sentinel's own health_dropped alert is a
  // real activity_events row (actor: null, entityType: "customer") — feeding
  // it back through getCustomerActivityStats/computeHealthScore exactly as
  // the customers-list/edit pages do must NOT inflate the score it monitors.
  it("a health_dropped alert (actor null) does not feed back into the score it monitors", async () => {
    // Zero real engagement: no activity_events rows exist for this customer
    // before the alert fires. Far in the past so that, with zero events,
    // recency bottoms out at 0 regardless of clock skew across test runs.
    const CUSTOMER_CREATED_AT = new Date("2026-01-01T00:00:00Z");

    await db.insert(customerHealthSnapshots).values({
      orgId: ORG_ID,
      customerId: CUSTOMER_ID,
      score: 74,
      band: "healthy",
      components: { recency: 35, frequency: 26, breadth: 13 },
      capturedOn: toUtcDay(YESTERDAY),
    });

    // Exactly the getCustomerActivityStats -> computeHealthScore composition
    // the customers-list and edit pages run (src/app/(admin)/customers/page.tsx,
    // src/app/(admin)/customers/[id]/edit/page.tsx).
    async function scoreCustomerLikeThePagesDo() {
      const stats = await getCustomerActivityStats(db, ORG_ID, NOW);
      const s = stats.get(CUSTOMER_ID);
      return computeHealthScore(
        {
          lastActivityAt: s?.lastActivityAt ?? null,
          eventsLast30d: s?.eventsLast30d ?? 0,
          distinctVerbs30d: s?.distinctVerbs30d ?? 0,
          customerCreatedAt: CUSTOMER_CREATED_AT,
        },
        NOW,
      );
    }

    // Baseline, before the alert fires: zero engagement -> 0/at_risk.
    const baseline = await scoreCustomerLikeThePagesDo();
    expect(baseline.score).toBe(0);
    expect(baseline.band).toBe("at_risk");

    // Fire the Sentinel's own alert for real, through the actual chokepoint
    // (captureHealthSnapshots -> recordActivitySafely -> recordActivity) —
    // this produces the exact health_dropped row the reviewer flagged.
    await captureHealthSnapshots(
      db,
      ORG_ID,
      [
        {
          customerId: CUSTOMER_ID,
          name: "Priya Mehta",
          score: 61,
          band: "watch",
          components: { recency: 26, frequency: 22, breadth: 13 },
        },
      ],
      NOW,
    );

    // Sanity: the alert really landed, as a system event (actor null).
    const events = await db.select().from(activityEvents);
    expect(events).toHaveLength(1);
    expect(events[0]!.verb).toBe("health_dropped");
    expect(events[0]!.actor).toBeNull();

    // Re-run exactly what the pages run after the alert. Stats must show
    // ZERO events for this customer (the alert is the only row, and it's
    // system-authored) and the score/band must be unchanged from the
    // baseline — NOT inflated into "watch" by Sentinel's own alert.
    const stats = await getCustomerActivityStats(db, ORG_ID, NOW);
    expect(stats.has(CUSTOMER_ID)).toBe(false);

    const afterAlert = await scoreCustomerLikeThePagesDo();
    expect(afterAlert).toEqual(baseline);
    expect(afterAlert.score).toBe(0);
    expect(afterAlert.band).toBe("at_risk");
  });
});
