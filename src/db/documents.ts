import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

export type DocumentType = "contract" | "nda" | "agreement" | "receipt" | "other";

/** The `/documents` vault list row shape — deliberately excludes
 *  `storageKey`. storageKey only ever leaves the DB layer via
 *  `getDocumentForDownload`, the sole reader the download route consumes
 *  (spec §4/§6). */
export type DocumentRow = {
  id: number;
  title: string;
  docType: DocumentType;
  mimeType: string;
  sizeBytes: number;
  customerId: number | null;
  uploadedByLabel: string;
  createdAt: Date;
};

const DEFAULT_LIMIT = 200;

/**
 * The `/documents` vault list — org-scoped, newest-first, optionally
 * filtered to a single customer. Demo mode short-circuits to DEMO_DOCUMENTS,
 * filtered + sorted in-memory here (the predicate is a two-field filter —
 * not worth a dedicated seed.ts helper the way getSeedInvoicesForOrg is for
 * the richer invoice-list shape).
 */
export async function getDocuments(
  db: Db,
  orgId: number,
  opts: { customerId?: number } = {},
): Promise<DocumentRow[]> {
  if (isDemoMode()) {
    const { DEMO_DOCUMENTS } = await import("@/lib/demo/seed");
    return DEMO_DOCUMENTS.filter((d) => d.orgId === orgId)
      .filter((d) => opts.customerId === undefined || d.customerId === opts.customerId)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(({ orgId: _orgId, storageKey: _storageKey, ...row }) => row);
  }

  const customerId = opts.customerId ?? null;
  const res = await db.execute(sql`
    SELECT id, title, doc_type, mime_type, size_bytes, customer_id, uploaded_by_label, created_at
    FROM documents
    WHERE org_id = ${orgId}
      AND (${customerId}::int IS NULL OR customer_id = ${customerId}::int)
    ORDER BY created_at DESC, id DESC
    LIMIT ${DEFAULT_LIMIT}
  `);

  const rows = rowsOf<{
    id: number;
    title: string;
    doc_type: DocumentType;
    mime_type: string;
    size_bytes: number;
    customer_id: number | null;
    uploaded_by_label: string;
    created_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    docType: r.doc_type,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    customerId: r.customer_id,
    uploadedByLabel: r.uploaded_by_label,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

/**
 * The ONLY reader that exposes `storageKey` — used solely by the
 * GET /documents/[id]/file route (slice 31-2) to resolve blob bytes.
 * Org-scoped: a cross-org id returns null exactly like a missing id, so the
 * route can 404 either case identically (never leak existence).
 */
export async function getDocumentForDownload(
  db: Db,
  orgId: number,
  id: number,
): Promise<{ storageKey: string; mimeType: string; title: string } | null> {
  if (isDemoMode()) {
    const { getSeedDocumentById } = await import("@/lib/demo/seed");
    const row = getSeedDocumentById(orgId, id);
    if (!row) return null;
    return { storageKey: row.storageKey, mimeType: row.mimeType, title: row.title };
  }

  const res = await db.execute(sql`
    SELECT storage_key, mime_type, title
    FROM documents
    WHERE id = ${id} AND org_id = ${orgId}
    LIMIT 1
  `);
  const [row] = rowsOf<{ storage_key: string; mime_type: string; title: string }>(res);
  if (!row) return null;
  return { storageKey: row.storage_key, mimeType: row.mime_type, title: row.title };
}
