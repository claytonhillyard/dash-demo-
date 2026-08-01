import { NextResponse } from "next/server";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getDocumentForDownload } from "@/db/documents";
import { getBlobStore } from "@/lib/storage/blobStore";
import { sanitizePdfFilename } from "@/lib/invoices/pdfFilename";

export const dynamic = "force-dynamic";

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * GET /documents/[id]/file — session-guarded, org-scoped streaming download.
 * Mirrors src/app/(admin)/invoices/[id]/pdf/route.ts: @netlify/blobs v10 has
 * no signed-URL method (slice 17's blobStore comment's "Phase C"), so a
 * download is a route handler that resolves bytes via `BlobStore.get` and
 * streams them back directly, rather than redirecting to a signed URL.
 *
 * Demo mode is deliberately allowed (spec §7/§8): the download is pure
 * computation over already-public seed data/bytes, no different from any
 * other demo page — the demo-mode BlobStore branch (src/lib/storage/
 * blobStore.ts) resolves ANY key to a real, tiny, valid PDF so the demo
 * download is an openable file rather than an inert placeholder.
 *
 * Auth resolves via `getCurrentOrgId()` (demo short-circuit built in) inside
 * a try/catch so an expired/missing session becomes a 401 instead of an
 * unhandled throw — checked BEFORE touching the db, so the unauthenticated
 * path never needs a live connection.
 *
 * `getDocumentForDownload` is org-scoped and returns null identically for a
 * missing id OR a cross-org id (never leak existence); `getBlobStore().get`
 * returning null (blob vanished / never written) is a second, independent
 * 404 — the DB row existing is not a guarantee the blob still does.
 *
 * Route files may only export HTTP-method handlers + config consts under
 * Next 15's route-type validation (the slice-28 build lesson) — EXT_BY_MIME
 * below is a local, non-exported const, not a violation of that rule.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  // Upper bound matches the int4 id column — without it a crafted
  // /documents/99999999999/file overflows in the db layer and 500s.
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) {
    return new NextResponse(null, { status: 404 });
  }

  let orgId: number;
  try {
    orgId = await getCurrentOrgId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDbReady();
  const doc = await getDocumentForDownload(db, orgId, id);
  if (!doc) {
    return new NextResponse(null, { status: 404 });
  }

  const bytes = await getBlobStore().get(doc.storageKey);
  if (!bytes) {
    return new NextResponse(null, { status: 404 });
  }

  const ext = EXT_BY_MIME[doc.mimeType] ?? "bin";
  const filename = sanitizePdfFilename(doc.title, "document");

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${filename}.${ext}"`,
      "Cache-Control": "no-store",
    },
  });
}
