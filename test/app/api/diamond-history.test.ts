// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createTestDb } from "@/db/client";
import { diamondIndexHistory } from "@/db/schema";
import { GET, __setHistoryTestDb } from "@/app/api/diamond-history/route";

let close: () => Promise<void>;
beforeEach(async () => {
  const t = await createTestDb();
  __setHistoryTestDb(t.db);
  close = t.close;
  await t.db.insert(diamondIndexHistory).values([
    { series: "natural_index", valueCents: 700000 },
    { series: "natural_index", valueCents: 720000 },
  ]);
});
afterEach(async () => { __setHistoryTestDb(null); await close(); });

describe("/api/diamond-history", () => {
  it("returns the natural index series", async () => {
    const res = await GET(new Request("http://localhost/api/diamond-history"));
    const body = await res.json();
    expect(body.points).toEqual([700000, 720000]);
  });
});
