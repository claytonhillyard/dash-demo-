// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import { uploadDealAttachment, __setTestDb } from "@/lib/deals/actions";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

let db: Db;
let storeWrites: string[] = [];
let storeDeletes: string[] = [];

const stub: BlobStore = {
  set: async (k) => { storeWrites.push(k); },
  delete: async (k) => { storeDeletes.push(k); },
  getSignedUrl: async (k) => `https://stub/${k}`,
};

beforeAll(async () => {
  db = await getSharedDb();
  __setTestBlobStore(stub);
});
beforeEach(async () => {
  vi.clearAllMocks();
  storeWrites = []; storeDeletes = [];
  await resetSharedDb();
});
afterAll(async () => {
  __setTestBlobStore(null);
  await closeSharedDb();
});

function jpegFD(dealId: number): FormData {
  const fd = new FormData();
  fd.set("dealId", String(dealId));
  fd.set("kind", "image");
  fd.set("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0,0,0,0, 0,0,0,0])], { type: "image/jpeg" }), "f.jpg");
  return fd;
}

describe("uploadDealAttachment — rollback on DB failure", () => {
  it("deletes the blob if the DB insert throws", async () => {
    // Use the real shared DB to seed the parent deal (the owner-check SELECT
    // runs against the active db()), then swap in a proxy whose .insert throws
    // for the dealAttachments write that follows.
    await __setTestDb(db);
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
    }).returning();

    const realDb = db;
    const stubDb = new Proxy(realDb, {
      get(target, prop) {
        if (prop === "insert") {
          return () => ({ values: () => { throw new Error("simulated DB failure"); } });
        }
        // @ts-expect-error proxy passthrough
        return target[prop];
      },
    }) as unknown as Db;
    await __setTestDb(stubDb);
    try {
      const res = await uploadDealAttachment(jpegFD(d.id));
      expect(res).toEqual({ ok: false, error: "Database error" });
      expect(storeWrites).toHaveLength(1);
      expect(storeDeletes).toEqual(storeWrites); // same key deleted
    } finally {
      await __setTestDb(null);
    }
  });
});
