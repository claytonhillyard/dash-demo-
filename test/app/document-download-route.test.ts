// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Demo-mode short-circuit (getDocumentForDownload already serves DEMO_DOCUMENTS
// without touching the db) — same harness shape as test/app/invoice-pdf-route.test.ts:
// stub the env var, and mock ensureDbReady to a fake object so a real pglite
// never boots for these tests.
afterEach(() => {
  vi.unstubAllEnvs();
  __setTestBlobStore(null);
});
beforeEach(() => vi.clearAllMocks());

vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

// Partial mock of the reader: every export passes through to the REAL
// implementation by default (so the demo-mode tests exercise the actual
// getSeedDocumentById branch), overridden per-test to simulate "missing" or
// a crafted title (§ filename-sanitization) without needing a live db.
vi.mock("@/db/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/documents")>();
  return { ...actual, getDocumentForDownload: vi.fn(actual.getDocumentForDownload) };
});

import { requireSession } from "@/lib/auth/requireSession";
import { getDocumentForDownload } from "@/db/documents";
import { GET } from "@/app/(admin)/documents/[id]/file/route";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";
import { DEMO_DOCUMENTS } from "@/lib/demo/seed";

function callRoute(id: string) {
  return GET(new Request(`http://localhost/documents/${id}/file`), {
    params: Promise.resolve({ id }),
  });
}

const nullStore: BlobStore = {
  set: async () => {},
  delete: async () => {},
  get: async () => null,
  getSignedUrl: async (k) => `https://stub/${k}`,
};

// DEMO_DOCUMENTS[1] (src/lib/demo/seed.ts): id 9602, "Master Consignment
// Agreement", application/pdf, org-level (no customer link) — plain ASCII
// title, so its sanitized filename is the title unchanged. DEMO_DOCUMENTS[0]
// deliberately isn't used here: its title contains an en dash (non-ASCII),
// which sanitizePdfFilename strips — a fine real behavior, just a confusing
// pick for a "does the happy path work" assertion.
const SEED_DOC = DEMO_DOCUMENTS[1];

describe("GET /documents/[id]/file — demo mode", () => {
  it("serves a valid %PDF with the right headers for a seed document", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute(String(SEED_DOC.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${SEED_DOC.title}.pdf"`,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 4)).toString("utf-8")).toBe("%PDF");
  });

  it("404s for an id that doesn't exist (missing/cross-org collapse identically)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute("999999");
    expect(res.status).toBe(404);
  });

  it("404s for a non-numeric id", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await callRoute("abc");
    expect(res.status).toBe(404);
  });

  it("404s when the blob store has no bytes for the storage key (blob vanished)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    __setTestBlobStore(nullStore);
    const res = await callRoute(String(SEED_DOC.id));
    expect(res.status).toBe(404);
  });

  it("sanitizes a title containing a quote for the Content-Disposition filename", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    vi.mocked(getDocumentForDownload).mockResolvedValueOnce({
      storageKey: "org/1/documents/crafted.pdf",
      mimeType: "application/pdf",
      title: 'Weird "Quoted" Title',
    });
    const res = await callRoute(String(SEED_DOC.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Weird Quoted Title.pdf"',
    );
  });

  it("derives a .jpg extension from an image/jpeg mimeType", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const jpegSeed = DEMO_DOCUMENTS.find((d) => d.mimeType === "image/jpeg")!;
    expect(jpegSeed).toBeDefined();
    const res = await callRoute(String(jpegSeed.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toContain(".jpg");
  });
});

describe("GET /documents/[id]/file — auth", () => {
  it("401s when there is no valid session (live mode)", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await callRoute(String(SEED_DOC.id));
    expect(res.status).toBe(401);
  });
});
