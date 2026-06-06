// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealAttachments } from "@/db/schema";
import { uploadDealAttachment, __setTestDb } from "@/lib/deals/actions";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

const stub: BlobStore = {
  set: async () => {}, delete: async () => {},
  getSignedUrl: async (k) => `https://stub/${k}`,
};

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
  __setTestBlobStore(stub);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
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

function pdfFD(dealId: number): FormData {
  const fd = new FormData();
  fd.set("dealId", String(dealId));
  fd.set("kind", "cert");
  fd.set("file", new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0,0,0,0])], { type: "application/pdf" }), "c.pdf");
  return fd;
}

async function seedDeal(): Promise<number> {
  const [row] = await db.insert(deals).values({
    orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
    quantity: 1, priceCents: 1000, postedByLabel: "x",
  }).returning();
  return row.id;
}

describe("uploadDealAttachment — per-deal kind caps", () => {
  it("allows up to 8 images, then forbids the 9th", async () => {
    const dealId = await seedDeal();
    for (let i = 0; i < 8; i++) {
      expect(await uploadDealAttachment(jpegFD(dealId))).toEqual({ ok: true });
    }
    expect(await uploadDealAttachment(jpegFD(dealId))).toEqual({ ok: false, error: "Forbidden" });
    const count = await db.select().from(dealAttachments).then((rows) => rows.length);
    expect(count).toBe(8);
  });

  it("allows up to 4 certs, then forbids the 5th", async () => {
    const dealId = await seedDeal();
    for (let i = 0; i < 4; i++) {
      expect(await uploadDealAttachment(pdfFD(dealId))).toEqual({ ok: true });
    }
    expect(await uploadDealAttachment(pdfFD(dealId))).toEqual({ ok: false, error: "Forbidden" });
    const count = await db.select().from(dealAttachments).then((rows) => rows.length);
    expect(count).toBe(4);
  });

  it("caps are independent: 8 images + 4 certs on the same deal both OK", async () => {
    const dealId = await seedDeal();
    for (let i = 0; i < 8; i++) await uploadDealAttachment(jpegFD(dealId));
    for (let i = 0; i < 4; i++) await uploadDealAttachment(pdfFD(dealId));
    const rows = await db.select().from(dealAttachments);
    expect(rows.filter((r) => r.kind === "image")).toHaveLength(8);
    expect(rows.filter((r) => r.kind === "cert")).toHaveLength(4);
  });
});
