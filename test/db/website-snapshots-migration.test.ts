// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/client";
import { orgs, websiteSnapshots } from "@/db/schema";

// TODO(slice-5 review): The plan's cross-org test inserts orgId=999 against a
// fresh createTestDb(), but createTestDb's migration only seeds org id=1. We
// add a one-off org=999 insert inline so the cross-org FK test can succeed
// without diluting the "isolated migrated db" intent of createTestDb.

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("website_snapshots migration", () => {
  it("creates the website_snapshots table empty", async () => {
    const t = await createTestDb();
    close = t.close;
    expect(await t.db.select().from(websiteSnapshots)).toEqual([]);
  });

  it("enforces the (org_id, week_start) unique constraint", async () => {
    const t = await createTestDb();
    close = t.close;
    await t.db.insert(websiteSnapshots).values({
      orgId: 1, weekStart: "2026-05-25",
      visitors: 100, uniqueVisitors: 80, pageViews: 300,
      avgSessionDurationSeconds: 180, bounceRatePercent: 40,
    });
    await expect(
      t.db.insert(websiteSnapshots).values({
        orgId: 1, weekStart: "2026-05-25",
        visitors: 999, uniqueVisitors: 80, pageViews: 300,
        avgSessionDurationSeconds: 180, bounceRatePercent: 40,
      })
    ).rejects.toThrow();
  });

  it("allows the same week_start across different orgs", async () => {
    const t = await createTestDb();
    close = t.close;
    // Seed an additional org to satisfy the FK on org_id=999 (createTestDb
    // only auto-seeds org id=1 via the 0004 migration).
    await t.db.insert(orgs).values({ id: 999, name: "Fixture Org", slug: "fixture" });
    await t.db.insert(websiteSnapshots).values({
      orgId: 1, weekStart: "2026-05-25",
      visitors: 100, uniqueVisitors: 80, pageViews: 300,
      avgSessionDurationSeconds: 180, bounceRatePercent: 40,
    });
    await expect(
      t.db.insert(websiteSnapshots).values({
        orgId: 999, weekStart: "2026-05-25",
        visitors: 200, uniqueVisitors: 150, pageViews: 600,
        avgSessionDurationSeconds: 200, bounceRatePercent: 35,
      })
    ).resolves.not.toThrow();
  });

  it("rejects an org_id with no matching orgs row (FK)", async () => {
    const t = await createTestDb();
    close = t.close;
    await expect(
      t.db.execute(sql`
        INSERT INTO website_snapshots
          (org_id, week_start, visitors, unique_visitors, page_views,
           avg_session_duration_seconds, bounce_rate_percent)
        VALUES (99999, '2026-05-25', 100, 80, 300, 180, 40)
      `)
    ).rejects.toThrow();
  });

  it("week_start returns as a string in YYYY-MM-DD format", async () => {
    const t = await createTestDb();
    close = t.close;
    await t.db.insert(websiteSnapshots).values({
      orgId: 1, weekStart: "2026-05-25",
      visitors: 100, uniqueVisitors: 80, pageViews: 300,
      avgSessionDurationSeconds: 180, bounceRatePercent: 40,
    });
    const rows = await t.db.select({ ws: websiteSnapshots.weekStart }).from(websiteSnapshots);
    expect(rows[0].ws).toBe("2026-05-25");
    expect(typeof rows[0].ws).toBe("string");
  });
});
