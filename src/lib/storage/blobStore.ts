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
    // ⚠ @netlify/blobs v10 exposes NO public signed-URL method on Store.
    // (v8 had `getDownloadUrl({ expiry })`; v10 removed it.) The production
    // path here will be a Next.js route handler that streams via Store.get()
    // while signing access with a short-TTL HMAC — Phase C work.
    //
    // For now, this branch throws a CLEAR runtime error rather than a cryptic
    // `TypeError: real.getDownloadUrl is not a function`. Tests inject a stub
    // via __setTestBlobStore and never reach this code. If you see this
    // thrown in production, it means a Phase C consumer (RSC, server action)
    // forgot to route through the upcoming route handler.
    getSignedUrl: async (_k, _opts) => {
      // Acknowledge the unused `real` reference so tsc doesn't strip the lazy
      // store construction (also useful — the construction itself is the
      // smoke test that @netlify/blobs is configured).
      void real;
      throw new Error(
        "BlobStore.getSignedUrl: no signed-URL method on @netlify/blobs v10. " +
          "Phase C must replace this branch with a route-handler-based flow " +
          "(stream via Store.get + HMAC-signed query string). Tests should " +
          "inject a stub via __setTestBlobStore.",
      );
    },
  };
}
