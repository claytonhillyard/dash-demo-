// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "./shared-db";
import { orgs } from "@/db/schema";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

describe("shared-db org seed", () => {
  it("seeds AIYA (id=1), fixture (id=999), and partner (id=888) on reset", async () => {
    await resetSharedDb();
    const rows = await db.select({ id: orgs.id, slug: orgs.slug }).from(orgs);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([1, 888, 999]);
    expect(rows.find((r) => r.id === 888)?.slug).toBe("partner");
  });
});
