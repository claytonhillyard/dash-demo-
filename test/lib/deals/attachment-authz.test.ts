// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealAttachments, circles, circleMembers } from "@/db/schema";
import { uploadDealAttachment, deleteDealAttachment, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

let db: Db;
let storeWrites: { key: string; bytes: number }[] = [];
let storeDeletes: string[] = [];

const stub: BlobStore = {
  set: async (k, d) => {
    const size =
      typeof d === "string" ? d.length :
      d instanceof Uint8Array ? d.byteLength :
      d instanceof ArrayBuffer ? d.byteLength :
      0;
    storeWrites.push({ key: k, bytes: size });
  },
  delete: async (k) => { storeDeletes.push(k); },
  getSignedUrl: async (k) => `https://stub/${k}`,
};

beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
  __setTestBlobStore(stub);
});
beforeEach(async () => {
  vi.clearAllMocks();
  storeWrites = [];
  storeDeletes = [];
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  __setTestBlobStore(null);
  await closeSharedDb();
});

/** Build a FormData for upload. The `file` is constructed from a Blob whose
 *  first bytes match the requested kind's magic-byte signature. */
function buildFormData(opts: {
  dealId: number;
  kind: "image" | "cert";
  bodyBytes?: Uint8Array;
  altText?: string;
}): FormData {
  const fd = new FormData();
  fd.set("dealId", String(opts.dealId));
  fd.set("kind", opts.kind);
  if (opts.altText !== undefined) fd.set("altText", opts.altText);
  const bytes = opts.bodyBytes ?? (opts.kind === "image"
    // JPEG magic: FF D8 FF + padding
    ? new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    // PDF magic: %PDF + padding
    : new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]));
  fd.set("file", new Blob([bytes], { type: opts.kind === "image" ? "image/jpeg" : "application/pdf" }), "f.bin");
  return fd;
}

async function seedDeal(orgId: number, circleId: number | null = null) {
  const [row] = await db.insert(deals).values({
    orgId, kind: "SELL", category: "Diamond", subject: "x",
    quantity: 1, priceCents: 1000, postedByLabel: "x", visibilityCircleId: circleId,
  }).returning();
  return row.id;
}

async function ensureCircle(slug: string, members: number[]) {
  const [c] = await db.insert(circles).values({ name: "Trusted", slug, ownerOrgId: 1 }).returning();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId: c.id, orgId }).onConflictDoNothing();
  }
  return c.id;
}

describe("uploadDealAttachment — authz", () => {
  it("allows the deal owner to upload an image", async () => {
    const dealId = await seedDeal(1);
    const res = await uploadDealAttachment(buildFormData({ dealId, kind: "image", altText: "front" }));
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(dealAttachments);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("image");
    expect(rows[0].altText).toBe("front");
    expect(storeWrites).toHaveLength(1);
  });

  it("forbids an in-circle partner from uploading (read-only access for non-owners)", async () => {
    const circleId = await ensureCircle("au1", [1, 999]);
    const dealId = await seedDeal(1, circleId);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await uploadDealAttachment(buildFormData({ dealId, kind: "image" }));
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(storeWrites).toHaveLength(0);
    const rows = await db.select().from(dealAttachments);
    expect(rows).toHaveLength(0);
  });

  it("forbids an out-of-circle org from uploading", async () => {
    const dealId = await seedDeal(1);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await uploadDealAttachment(buildFormData({ dealId, kind: "image" }));
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(storeWrites).toHaveLength(0);
  });
});

describe("uploadDealAttachment — MIME validation", () => {
  it("rejects a PDF uploaded as kind=image (magic-byte mismatch)", async () => {
    const dealId = await seedDeal(1);
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);
    const res = await uploadDealAttachment(
      buildFormData({ dealId, kind: "image", bodyBytes: pdf }),
    );
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(storeWrites).toHaveLength(0);
  });

  it("rejects truncated bytes (under 12 bytes)", async () => {
    const dealId = await seedDeal(1);
    const res = await uploadDealAttachment(
      buildFormData({ dealId, kind: "image", bodyBytes: new Uint8Array([0xff, 0xd8]) }),
    );
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});

describe("deleteDealAttachment — authz", () => {
  it("allows the deal owner to delete an attachment + deletes the blob", async () => {
    const dealId = await seedDeal(1);
    const [a] = await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k", mimeType: "image/jpeg", sizeBytes: 1, altText: null,
    }).returning();
    storeDeletes = [];
    const res = await deleteDealAttachment({ attachmentId: a.id });
    expect(res).toEqual({ ok: true });
    expect(storeDeletes).toEqual(["k"]);
    const rows = await db.select().from(dealAttachments);
    expect(rows).toHaveLength(0);
  });

  it("forbids a non-owner from deleting (blob untouched)", async () => {
    const dealId = await seedDeal(1);
    const [a] = await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k2", mimeType: "image/jpeg", sizeBytes: 1, altText: null,
    }).returning();
    storeDeletes = [];
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await deleteDealAttachment({ attachmentId: a.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(storeDeletes).toEqual([]);
    const rows = await db.select().from(dealAttachments);
    expect(rows).toHaveLength(1); // unchanged
  });
});
