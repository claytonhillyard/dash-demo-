// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks the whole @netlify/blobs SDK module so getBlobStore()'s real
// (non-test-stub) branch is exercisable without a live Netlify token.
// Scoped to this file only — vitest's default isolate:true re-imports
// modules per test file, so other suites are unaffected.
const mockRealStore = {
  set: vi.fn(async () => {}),
  delete: vi.fn(async () => {}),
  get: vi.fn(async (): Promise<ArrayBuffer | null> => null),
  getSignedUrl: vi.fn(),
};

vi.mock("@netlify/blobs", () => ({
  getStore: vi.fn(() => mockRealStore),
}));

import { getBlobStore, __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

/** A minimal Map-backed BlobStore, the same shape consumers inject via
 *  __setTestBlobStore in test/lib/deals/*.test.ts and test/db/dealAttachments.test.ts. */
function mapStore(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    set: async (key, data) => {
      const bytes =
        data instanceof Uint8Array
          ? data
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : typeof data === "string"
              ? new TextEncoder().encode(data)
              : new Uint8Array(await (data as Blob).arrayBuffer());
      map.set(key, bytes);
    },
    delete: async (key) => {
      map.delete(key);
    },
    get: async (key) => map.get(key) ?? null,
    getSignedUrl: async (key) => `https://stub/${key}`,
  };
}

describe("BlobStore.get — in-memory Map-backed stub", () => {
  it("round-trips: get returns the exact bytes passed to set", async () => {
    const store = mapStore();
    await store.set("k1", new Uint8Array([1, 2, 3]));
    expect(await store.get("k1")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns null for a key that was never set", async () => {
    const store = mapStore();
    expect(await store.get("nope")).toBeNull();
  });

  it("returns null after the key is deleted (set → delete → get) — set/delete regression", async () => {
    const store = mapStore();
    await store.set("k2", new Uint8Array([9, 9]));
    expect(await store.get("k2")).toEqual(new Uint8Array([9, 9]));
    await store.delete("k2");
    expect(await store.get("k2")).toBeNull();
  });
});

describe("getBlobStore — real Netlify-backed branch (mocked SDK)", () => {
  beforeEach(() => {
    __setTestBlobStore(null); // force the real branch
    vi.clearAllMocks();
  });

  it("get() calls Store.get with { type: 'arrayBuffer' } and wraps the result as a Uint8Array", async () => {
    mockRealStore.get.mockResolvedValueOnce(new Uint8Array([10, 20, 30]).buffer);
    const store = getBlobStore();
    const result = await store.get("org/1/documents/x.pdf");
    expect(mockRealStore.get).toHaveBeenCalledWith("org/1/documents/x.pdf", { type: "arrayBuffer" });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(new Uint8Array([10, 20, 30]));
  });

  it("get() returns null when the underlying store has no such key", async () => {
    mockRealStore.get.mockResolvedValueOnce(null);
    const store = getBlobStore();
    expect(await store.get("missing")).toBeNull();
  });
});
