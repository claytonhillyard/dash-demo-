// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

// Mock the Sentry SDK BEFORE importing the action, same
// mocked-Sentry-to-globalThis technique as test/lib/command/actions.test.ts
// — adapted to the direct `captureException(error, {tags, extra})` call
// shape this action actually uses. `withScope` is a defensive no-op: it is
// never called directly by this action, but recordActivitySafely's own
// swallow-catch (transitively invoked below) uses it on a failure path.
vi.mock("@sentry/nextjs", () => ({
  captureException: (e: unknown, options?: { tags?: Record<string, unknown>; extra?: unknown }) => {
    (globalThis as Record<string, unknown>).__docSentryError = e;
    (globalThis as Record<string, unknown>).__docSentryTags = options?.tags;
    (globalThis as Record<string, unknown>).__docSentryExtra = options?.extra;
  },
  withScope: (fn: (scope: { setTag: () => void }) => void) => fn({ setTag: () => {} }),
}));

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { documents, customers, activityEvents } from "@/db/schema";
import { uploadDocument, deleteDocument, __setTestDb } from "@/lib/documents/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

let db: Db;
let storeWrites: { key: string; bytes: number }[] = [];
let storeDeletes: string[] = [];
let storeDeleteShouldThrow = false;

const stub: BlobStore = {
  set: async (k, d) => {
    const size =
      d instanceof Uint8Array ? d.byteLength :
      d instanceof ArrayBuffer ? d.byteLength :
      typeof d === "string" ? d.length : 0;
    storeWrites.push({ key: k, bytes: size });
  },
  delete: async (k) => {
    if (storeDeleteShouldThrow) throw new Error("simulated blob delete failure");
    storeDeletes.push(k);
  },
  get: async () => null,
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
  storeDeleteShouldThrow = false;
  (globalThis as Record<string, unknown>).__docSentryError = undefined;
  await resetSharedDb();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await __setTestDb(null);
  __setTestBlobStore(null);
  await closeSharedDb();
});

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]); // "%PDF-1.4" + pad
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const TEXT_BYTES = new TextEncoder().encode("this is plainly not a PDF...");

function buildFormData(opts: {
  title?: string;
  docType?: string;
  customerId?: number;
  bytes?: Uint8Array;
  contentType?: string;
  omitFile?: boolean;
}): FormData {
  const fd = new FormData();
  if (opts.title !== undefined) fd.set("title", opts.title);
  if (opts.docType !== undefined) fd.set("docType", opts.docType);
  if (opts.customerId !== undefined) fd.set("customerId", String(opts.customerId));
  if (!opts.omitFile) {
    const bytes = opts.bytes ?? PDF_BYTES;
    fd.set("file", new Blob([bytes], { type: opts.contentType ?? "application/pdf" }), "f.bin");
  }
  return fd;
}

function defaultFD(overrides: Parameters<typeof buildFormData>[0] = {}): FormData {
  return buildFormData({ title: "NDA with Acme", docType: "nda", ...overrides });
}

async function seedCustomer(orgId: number, name = "Cust"): Promise<number> {
  const [row] = await db.insert(customers).values({ orgId, name }).returning();
  return row.id;
}

async function fillOrgDocuments(orgId: number, count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => ({
    orgId,
    title: `Filler ${i}`,
    docType: "other" as const,
    storageKey: `org/${orgId}/documents/filler-${i}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 10,
    uploadedByLabel: "seed",
  }));
  await db.insert(documents).values(rows);
}

describe("uploadDocument — happy path", () => {
  it("inserts a row, writes the blob, and records a 'created' activity on entityType document", async () => {
    const res = await uploadDocument(defaultFD());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const rows = await db.select().from(documents).where(eq(documents.id, res.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("NDA with Acme");
    expect(rows[0].docType).toBe("nda");
    expect(rows[0].mimeType).toBe("application/pdf");
    expect(rows[0].customerId).toBeNull();
    expect(rows[0].sizeBytes).toBe(PDF_BYTES.byteLength);

    expect(storeWrites).toHaveLength(1);
    expect(storeWrites[0].key).toContain("org/1/documents/");
    expect(storeWrites[0].key.endsWith(".pdf")).toBe(true);

    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.entityId, res.id));
    const created = events.find((e) => e.entityType === "document" && e.verb === "created");
    expect(created).toBeDefined();
    expect(created?.summary).toBe('Uploaded document "NDA with Acme"');
    expect(created?.payload).toEqual({ docType: "nda" });

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/documents");
  });

  it("links to an org-owned customerId and revalidates the customer edit page", async () => {
    const custId = await seedCustomer(1, "Ginza Pearl House");
    const res = await uploadDocument(defaultFD({ customerId: custId }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db.select().from(documents).where(eq(documents.id, res.id));
    expect(row.customerId).toBe(custId);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/documents");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/customers/${custId}/edit`);
  });

  it("derives storage key extension + stored mimeType from a JPEG's magic bytes", async () => {
    const res = await uploadDocument(
      defaultFD({ bytes: JPEG_BYTES, contentType: "image/jpeg" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db.select().from(documents).where(eq(documents.id, res.id));
    expect(row.mimeType).toBe("image/jpeg");
    expect(storeWrites[0].key.endsWith(".jpg")).toBe(true);
  });
});

describe("uploadDocument — MIME validation (never trust Content-Type)", () => {
  it("rejects a plain text file (no recognized magic-byte signature)", async () => {
    const res = await uploadDocument(defaultFD({ bytes: TEXT_BYTES, contentType: "application/pdf" }));
    expect(res).toEqual({ ok: false, error: "Unsupported file — upload a PDF or image" });
    expect(storeWrites).toHaveLength(0);
  });

  it("stores by ACTUAL bytes, ignoring a spoofed Content-Type (PDF bytes claimed as image/jpeg)", async () => {
    const res = await uploadDocument(
      defaultFD({ bytes: PDF_BYTES, contentType: "image/jpeg" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db.select().from(documents).where(eq(documents.id, res.id));
    expect(row.mimeType).toBe("application/pdf");
    expect(storeWrites[0].key.endsWith(".pdf")).toBe(true);
  });
});

describe("uploadDocument — caps", () => {
  it("rejects a file over the size cap", async () => {
    const big = new Uint8Array(15 * 1024 * 1024 + 1);
    big.set(PDF_BYTES.subarray(0, 4), 0); // keep the magic bytes valid
    const res = await uploadDocument(defaultFD({ bytes: big }));
    expect(res).toEqual({ ok: false, error: "File is too large — 15MB max" });
    expect(storeWrites).toHaveLength(0);
  });

  it("rejects the 501st document for an org", async () => {
    await fillOrgDocuments(1, 500);
    const res = await uploadDocument(defaultFD());
    expect(res).toEqual({ ok: false, error: "Document limit reached for this organization" });
    expect(storeWrites).toHaveLength(0);
  });
});

describe("uploadDocument — customerId ownership", () => {
  it("forbids a customerId belonging to a different org", async () => {
    const foreignCustId = await seedCustomer(999, "Not Mine");
    const res = await uploadDocument(defaultFD({ customerId: foreignCustId }));
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(storeWrites).toHaveLength(0);
  });

  it("forbids a customerId that doesn't exist at all", async () => {
    const res = await uploadDocument(defaultFD({ customerId: 999_999 }));
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(storeWrites).toHaveLength(0);
  });
});

describe("uploadDocument — validation", () => {
  it("rejects a missing file", async () => {
    const res = await uploadDocument(defaultFD({ omitFile: true }));
    expect(res).toEqual({ ok: false, error: "Missing file" });
  });

  it("rejects an empty title", async () => {
    const res = await uploadDocument(defaultFD({ title: "   " }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.startsWith("title:")).toBe(true);
  });

  it("rejects a title over 200 characters", async () => {
    const res = await uploadDocument(defaultFD({ title: "x".repeat(201) }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.startsWith("title:")).toBe(true);
  });

  it("rejects an invalid docType", async () => {
    const res = await uploadDocument(defaultFD({ docType: "invoice" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.startsWith("docType:")).toBe(true);
  });
});

describe("uploadDocument — auth / demo", () => {
  it("is demo-blocked", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await uploadDocument(defaultFD());
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(storeWrites).toHaveLength(0);
  });

  it("requires authentication", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await uploadDocument(defaultFD());
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });
});

describe("uploadDocument — rollback on DB failure", () => {
  it("deletes the blob if the DB insert throws (orphan cleanup)", async () => {
    const realDb = db;
    const stubDb = new Proxy(realDb, {
      get(target, prop) {
        if (prop === "insert") {
          return () => ({
            values: () => ({
              returning: () => {
                throw new Error("simulated DB failure");
              },
            }),
          });
        }
        // @ts-expect-error proxy passthrough
        return target[prop];
      },
    }) as unknown as Db;
    await __setTestDb(stubDb);
    try {
      const res = await uploadDocument(defaultFD());
      expect(res).toEqual({ ok: false, error: "Database error" });
      expect(storeWrites).toHaveLength(1);
      expect(storeDeletes).toEqual([storeWrites[0].key]);
    } finally {
      await __setTestDb(db);
    }
  });
});

describe("deleteDocument — happy path", () => {
  it("deletes the row and the blob", async () => {
    const [doc] = await db
      .insert(documents)
      .values({
        orgId: 1, title: "To Delete", docType: "other",
        storageKey: "org/1/documents/gone.pdf", mimeType: "application/pdf",
        sizeBytes: 5, uploadedByLabel: "boss",
      })
      .returning();
    const res = await deleteDocument({ id: doc.id });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(rows).toHaveLength(0);
    expect(storeDeletes).toEqual(["org/1/documents/gone.pdf"]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/documents");
  });

  it("records a 'deleted' activity event", async () => {
    const [doc] = await db
      .insert(documents)
      .values({
        orgId: 1, title: "Audited Doc", docType: "receipt",
        storageKey: "org/1/documents/audited.pdf", mimeType: "application/pdf",
        sizeBytes: 5, uploadedByLabel: "boss",
      })
      .returning();
    await deleteDocument({ id: doc.id });
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.entityId, doc.id));
    const deleted = events.find((e) => e.entityType === "document" && e.verb === "deleted");
    expect(deleted).toBeDefined();
    expect(deleted?.summary).toBe('Deleted document "Audited Doc"');
  });
});

describe("deleteDocument — best-effort blob cleanup", () => {
  it("still succeeds when the blob delete fails, and Sentry-captures it", async () => {
    const [doc] = await db
      .insert(documents)
      .values({
        orgId: 1, title: "Stubborn Blob", docType: "other",
        storageKey: "org/1/documents/stubborn.pdf", mimeType: "application/pdf",
        sizeBytes: 5, uploadedByLabel: "boss",
      })
      .returning();
    storeDeleteShouldThrow = true;
    const res = await deleteDocument({ id: doc.id });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(rows).toHaveLength(0); // row is gone even though the blob delete failed
    expect((globalThis as Record<string, unknown>).__docSentryError).toBeInstanceOf(Error);
  });
});

describe("deleteDocument — authz", () => {
  it("forbids deleting a document owned by a different org", async () => {
    const [doc] = await db
      .insert(documents)
      .values({
        orgId: 999, title: "Theirs", docType: "other",
        storageKey: "org/999/documents/theirs.pdf", mimeType: "application/pdf",
        sizeBytes: 5, uploadedByLabel: "them",
      })
      .returning();
    const res = await deleteDocument({ id: doc.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const rows = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(rows).toHaveLength(1); // unchanged
    expect(storeDeletes).toEqual([]);
  });

  it("forbids deleting a missing id", async () => {
    const res = await deleteDocument({ id: 999_999 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("rejects a malformed id (Zod)", async () => {
    const res = await deleteDocument({ id: "not-a-number" });
    expect(res.ok).toBe(false);
  });

  it("is demo-blocked", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await deleteDocument({ id: 1 });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
  });

  it("requires authentication", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await deleteDocument({ id: 1 });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });
});
