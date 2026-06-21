// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { recordActivity } from "@/lib/activity/recordActivity";
import { ACTIVITY_PAYLOAD_MAX_BYTES } from "@/lib/activity/types";

describe("recordActivity", () => {
  let db: Db;
  beforeAll(async () => { db = await getSharedDb(); });
  beforeEach(async () => { await resetSharedDb(); });
  afterAll(async () => { await closeSharedDb(); });

  it("inserts a valid event and returns void", async () => {
    const result = await recordActivity(db, {
      orgId: 1,
      actor: "user@example.com",
      entityType: "customer",
      entityId: 5,
      verb: "created",
      summary: "Added Priya Mehta",
    });
    expect(result).toBeUndefined();
    const [row] = await db.select().from(schema.activityEvents);
    expect(row).toMatchObject({
      orgId: 1,
      actor: "user@example.com",
      entityType: "customer",
      entityId: 5,
      verb: "created",
      summary: "Added Priya Mehta",
    });
  });

  it("accepts null actor (system event)", async () => {
    await recordActivity(db, {
      orgId: 1, actor: null, entityType: "org", entityId: null,
      verb: "created", summary: "Seed bootstrap",
    });
    const [row] = await db.select().from(schema.activityEvents);
    expect(row.actor).toBeNull();
    expect(row.entityId).toBeNull();
  });

  it("persists payload as parsed JSON", async () => {
    await recordActivity(db, {
      orgId: 1, actor: "u", entityType: "customer", entityId: 1,
      verb: "updated", summary: "x",
      payload: { changedFields: ["email"], previousEmail: "a@b.com" },
    });
    const [row] = await db.select().from(schema.activityEvents);
    expect(row.payload).toEqual({ changedFields: ["email"], previousEmail: "a@b.com" });
  });

  it("throws on invalid entityType", async () => {
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null,
        entityType: "not-a-real-type" as never,
        entityId: 1, verb: "created", summary: "x",
      }),
    ).rejects.toThrow();
  });

  it("throws on invalid verb", async () => {
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null, entityType: "customer", entityId: 1,
        verb: "exploded" as never, summary: "x",
      }),
    ).rejects.toThrow();
  });

  it("throws on summary longer than 240 chars", async () => {
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null, entityType: "customer", entityId: 1,
        verb: "created", summary: "x".repeat(241),
      }),
    ).rejects.toThrow();
  });

  it("throws on empty summary", async () => {
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null, entityType: "customer", entityId: 1,
        verb: "created", summary: "",
      }),
    ).rejects.toThrow();
  });

  it("throws on payload exceeding 4 KB serialized", async () => {
    const big = "y".repeat(ACTIVITY_PAYLOAD_MAX_BYTES);
    await expect(
      recordActivity(db, {
        orgId: 1, actor: null, entityType: "customer", entityId: 1,
        verb: "created", summary: "x",
        payload: { huge: big },
      }),
    ).rejects.toThrow(/payload/i);
  });

  it("throws when org_id violates FK (defense-in-depth)", async () => {
    await expect(
      recordActivity(db, {
        orgId: 99999, actor: null, entityType: "customer", entityId: 1,
        verb: "created", summary: "x",
      }),
    ).rejects.toThrow();
  });
});
