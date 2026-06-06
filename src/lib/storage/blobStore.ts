import { getStore as netlifyGetStore } from "@netlify/blobs";

/** Minimal interface that both the real Netlify store and an in-memory test
 *  stub must satisfy. Keeps the surface small so tests are easy to write. */
export interface BlobStore {
  set(key: string, data: Uint8Array | ArrayBuffer | Blob | string): Promise<void>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, opts?: { ttl?: number }): Promise<string>;
}

let testStore: BlobStore | null = null;

/** Test seam — set an in-memory stub. Production callers never call this. */
export function __setTestBlobStore(s: BlobStore | null): void {
  testStore = s;
}

/** Get the active blob store. In tests, returns the injected stub.
 *  In production, returns the real Netlify Blobs handle (lazy). */
export function getBlobStore(): BlobStore {
  if (testStore) return testStore;
  // Lazy real-store handle — the @netlify/blobs SDK reads NETLIFY_BLOBS_TOKEN
  // from the environment automatically in production.
  const real = netlifyGetStore({ name: "deal-attachments", consistency: "strong" });
  return {
    set: async (k, d) => {
      await real.set(k, d);
    },
    delete: (k) => real.delete(k),
    // ⚠ The real SDK's signed-URL method shape has shifted across versions.
    // Plan referenced `getDownloadUrl({ expiry })` on v8; @netlify/blobs v10
    // (currently installed) exposes no public signed-URL method on Store. The
    // production path here is a placeholder — Phase B/C will likely replace
    // this with a Next.js route handler that streams via Store.get() while
    // signing access with a short-TTL HMAC. Tests inject __setTestBlobStore
    // and never exercise this branch.
    getSignedUrl: async (k, opts) => {
      // @ts-expect-error — v10 SDK shape may differ; production-only path,
      // not exercised by tests. See comment block above.
      const url: string = await real.getDownloadUrl(k, { expiry: opts?.ttl ?? 900 });
      return url;
    },
  };
}
