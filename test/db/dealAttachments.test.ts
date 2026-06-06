// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { deals, dealAttachments, circles, circleMembers } from "@/db/schema";
import { getAttachmentsForDeal, countAttachmentsByKind, resolveSignedUrl } from "@/db/dealAttachments";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

async function seedDeal(orgId: number, circleId: number | null = null) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
      visibilityCircleId: circleId,
    })
    .returning();
  return row.id;
}

async function ensureCircle(name: string, slug: string, ownerOrgId: number, members: number[]) {
  const [c] = await db.insert(circles).values({ name, slug, ownerOrgId }).returning();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId: c.id, orgId }).onConflictDoNothing();
  }
  return c.id;
}

describe("getAttachmentsForDeal — visibility truth table", () => {
  it("returns attachments to the deal owner", async () => {
    const dealId = await seedDeal(1);
    await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k1", mimeType: "image/jpeg", sizeBytes: 1024, altText: null,
    });
    const rows = await getAttachmentsForDeal(db, 1, dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("image");
  });

  it("returns attachments to an in-circle partner", async () => {
    const circleId = await ensureCircle("Trusted", "trusted-attach-1", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId);
    await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k2", mimeType: "image/png", sizeBytes: 2048, altText: "side view",
    });
    const rows = await getAttachmentsForDeal(db, 999, dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0].altText).toBe("side view");
  });

  it("hides attachments from an out-of-circle org", async () => {
    const circleId = await ensureCircle("Trusted", "trusted-attach-2", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId);
    await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k3", mimeType: "image/jpeg", sizeBytes: 1024, altText: null,
    });
    const rows = await getAttachmentsForDeal(db, 888, dealId);
    expect(rows).toEqual([]);
  });

  it("hides attachments on a private (no-circle) deal from non-owners", async () => {
    const dealId = await seedDeal(1);
    await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k4", mimeType: "image/jpeg", sizeBytes: 1024, altText: null,
    });
    expect(await getAttachmentsForDeal(db, 999, dealId)).toEqual([]);
  });

  it("orders by kind ASC, then created_at ASC", async () => {
    const dealId = await seedDeal(1);
    await db.insert(dealAttachments).values([
      { dealId, uploadedByOrgId: 1, kind: "image", storageKey: "i2",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null,
        createdAt: new Date(Date.now() - 1000) },
      { dealId, uploadedByOrgId: 1, kind: "cert", storageKey: "c1",
        mimeType: "application/pdf", sizeBytes: 1, altText: null,
        createdAt: new Date(Date.now() - 5000) },
      { dealId, uploadedByOrgId: 1, kind: "image", storageKey: "i1",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null,
        createdAt: new Date(Date.now() - 2000) },
    ]);
    const rows = await getAttachmentsForDeal(db, 1, dealId);
    expect(rows.map((r) => r.storageKey)).toEqual(["c1", "i1", "i2"]);
  });
});

describe("countAttachmentsByKind", () => {
  it("returns per-kind counts", async () => {
    const dealId = await seedDeal(1);
    await db.insert(dealAttachments).values([
      { dealId, uploadedByOrgId: 1, kind: "image", storageKey: "i1",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null },
      { dealId, uploadedByOrgId: 1, kind: "image", storageKey: "i2",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null },
      { dealId, uploadedByOrgId: 1, kind: "cert", storageKey: "c1",
        mimeType: "application/pdf", sizeBytes: 1, altText: null },
    ]);
    expect(await countAttachmentsByKind(db, dealId)).toEqual({ image: 2, cert: 1 });
  });

  it("returns zeros for a deal with no attachments", async () => {
    const dealId = await seedDeal(1);
    expect(await countAttachmentsByKind(db, dealId)).toEqual({ image: 0, cert: 0 });
  });
});

describe("resolveSignedUrl", () => {
  it("returns the signed URL from the store when caller can see the deal", async () => {
    const stub: BlobStore = {
      set: async () => {},
      delete: async () => {},
      getSignedUrl: async (key) => `https://stub/${key}?signed=1`,
    };
    __setTestBlobStore(stub);
    try {
      const dealId = await seedDeal(1);
      const [a] = await db.insert(dealAttachments).values({
        dealId, uploadedByOrgId: 1, kind: "image",
        storageKey: "org/1/deal/x/image/abc.jpg",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null,
      }).returning();
      const url = await resolveSignedUrl(db, 1, dealId, a.id);
      expect(url).toBe("https://stub/org/1/deal/x/image/abc.jpg?signed=1");
    } finally {
      __setTestBlobStore(null);
    }
  });

  it("throws when caller cannot see the deal", async () => {
    const stub: BlobStore = {
      set: async () => {},
      delete: async () => {},
      getSignedUrl: async () => "not-reached",
    };
    __setTestBlobStore(stub);
    try {
      const dealId = await seedDeal(1);
      const [a] = await db.insert(dealAttachments).values({
        dealId, uploadedByOrgId: 1, kind: "image",
        storageKey: "k", mimeType: "image/jpeg", sizeBytes: 1, altText: null,
      }).returning();
      await expect(resolveSignedUrl(db, 999, dealId, a.id)).rejects.toThrow();
    } finally {
      __setTestBlobStore(null);
    }
  });
});
