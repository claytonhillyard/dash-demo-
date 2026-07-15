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
import { customerHealthSnapshots, watchlists } from "@/db/schema";

vi.mock("@/lib/email/sendEmail", () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from "@/lib/email/sendEmail";
import { captureHealthSnapshots, toUtcDay } from "@/lib/sentinel/capture";

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
});
