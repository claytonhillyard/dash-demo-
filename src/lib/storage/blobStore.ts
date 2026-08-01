import { getStore as netlifyGetStore } from "@netlify/blobs";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_PDF_BYTES } from "@/lib/demo/seed";

/** Minimal interface that both the real Netlify store and an in-memory test
 *  stub must satisfy. Keeps the surface small so tests are easy to write. */
export interface BlobStore {
  set(key: string, data: Uint8Array | ArrayBuffer | Blob | string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Read bytes back for streaming (slice 31). Returns null for a missing
   *  key — never throws on a plain not-found. */
  get(key: string): Promise<Uint8Array | null>;
  getSignedUrl(key: string, opts?: { ttl?: number }): Promise<string>;
}

let testStore: BlobStore | null = null;

/** Test seam — set an in-memory stub. Production callers never call this. */
export function __setTestBlobStore(s: BlobStore | null): void {
  testStore = s;
}

/** Get the active blob store. In tests, returns the injected stub.
 *  In production, returns the real Netlify Blobs handle (lazy). In demo
 *  mode, returns an in-memory stub whose `get` always resolves a real, tiny,
 *  valid PDF (slice 31-2). Order matters: the test-stub short-circuit stays
 *  FIRST so a test can still exercise "blob vanished" 404s against the demo
 *  download route by injecting its own stub — that must win over the demo
 *  branch, not the other way around. */
export function getBlobStore(): BlobStore {
  if (testStore) return testStore;

  if (isDemoMode()) {
    // No real Netlify Blobs token exists in the demo deploy, and nothing in
    // demo mode ever legitimately calls set/delete — every mutating action
    // (uploadDocument, deleteDocument, uploadDealAttachment, ...) demo-guards
    // before it ever reaches the blob layer. But the document DOWNLOAD
    // ROUTE deliberately allows demo reads (spec §7/§8), so `get` must
    // resolve to real bytes rather than null/throw: it returns the same
    // tiny, valid, hand-built PDF (DEMO_PDF_BYTES) for ANY key, so a demo
    // download is always a real, openable file rather than a buffer that
    // merely starts with the right magic bytes.
    //
    // Import-cycle note: this imports a VALUE (DEMO_PDF_BYTES) from
    // src/lib/demo/seed.ts. Safe because seed.ts's own top-level imports are
    // ALL `import type` (verified — grep '^import' src/lib/demo/seed.ts),
    // which TypeScript erases entirely at runtime; seed.ts has zero runtime
    // imports of its own, so there is no path back from seed.ts to this
    // module. If a future edit adds a real (non-type) import to seed.ts,
    // re-check this note before it becomes a cycle.
    return {
      set: async () => {},
      delete: async () => {},
      get: async () => DEMO_PDF_BYTES,
      getSignedUrl: async () => {
        throw new Error(
          "BlobStore.getSignedUrl: not supported in demo mode — nothing should call this " +
            "(see the real-store branch's Phase C note below for the production equivalent).",
        );
      },
    };
  }

  // Lazy real-store handle — the @netlify/blobs SDK reads NETLIFY_BLOBS_TOKEN
  // from the environment automatically in production.
  const real = netlifyGetStore({ name: "deal-attachments", consistency: "strong" });
  return {
    set: async (k, d) => {
      await real.set(k, d);
    },
    delete: (k) => real.delete(k),
    // @netlify/blobs' Store.get(key, { type: "arrayBuffer" }) resolves an
    // ArrayBuffer, or null if the key doesn't exist (verified against the
    // SDK's own type declarations + its 404 → null runtime branch). Wrap
    // into a Uint8Array so callers never touch the SDK's ArrayBuffer type
    // directly.
    get: async (k) => {
      const ab = await real.get(k, { type: "arrayBuffer" });
      return ab ? new Uint8Array(ab) : null;
    },
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
