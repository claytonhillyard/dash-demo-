// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getWebsiteSnapshots,
  getLatestWebsiteSnapshot,
  getWebsiteSnapshotTrend,
} from "@/db/website";
import { DEMO_AIYA_ORG_ID, DEMO_PARTNER_ORG_IDS } from "@/lib/demo/seed";

// A broken Db sentinel — if the demo short-circuit isn't at the top of each
// read helper, dereferencing this would throw and the test would fail. The
// fact that the assertions pass with this object as the `db` argument proves
// the short-circuit fires BEFORE any property access on `db`.
const BROKEN_DB = new Proxy({} as never, {
  get() {
    throw new Error("db was accessed in demo mode — short-circuit broken");
  },
}) as never;

describe("website read helpers — demo-mode short-circuit", () => {
  const original = process.env.NEXT_PUBLIC_DEMO_MODE;
  beforeEach(() => { process.env.NEXT_PUBLIC_DEMO_MODE = "true"; });
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DEMO_MODE = original;
  });

  it("getWebsiteSnapshots returns AIYA seed without touching db", async () => {
    const rows = await getWebsiteSnapshots(BROKEN_DB, DEMO_AIYA_ORG_ID);
    expect(rows).toHaveLength(8);
  });

  it("getLatestWebsiteSnapshot returns AIYA's latest seed row without touching db", async () => {
    const latest = await getLatestWebsiteSnapshot(BROKEN_DB, DEMO_AIYA_ORG_ID);
    expect(latest).not.toBeNull();
    expect(latest?.orgId).toBe(DEMO_AIYA_ORG_ID);
  });

  it("getWebsiteSnapshotTrend returns AIYA seed slice without touching db", async () => {
    const rows = await getWebsiteSnapshotTrend(BROKEN_DB, DEMO_AIYA_ORG_ID, 4);
    expect(rows).toHaveLength(4);
  });

  it("getWebsiteSnapshots returns Mehta seed without touching db", async () => {
    const rows = await getWebsiteSnapshots(BROKEN_DB, DEMO_PARTNER_ORG_IDS.MEHTA);
    expect(rows).toHaveLength(2);
  });

  it("getWebsiteSnapshots returns [] for an unseeded org (e.g. fixture id 999)", async () => {
    const rows = await getWebsiteSnapshots(BROKEN_DB, 999);
    expect(rows).toEqual([]);
  });

  it("getLatestWebsiteSnapshot returns null for an unseeded org", async () => {
    expect(await getLatestWebsiteSnapshot(BROKEN_DB, 999)).toBeNull();
  });
});
