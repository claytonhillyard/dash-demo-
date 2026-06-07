import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";
import { getBlobStore } from "@/lib/storage/blobStore";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

export type AttachmentKind = "image" | "cert";

export type DealAttachmentView = {
  id: number;
  dealId: number;
  uploadedByOrgId: number;
  kind: AttachmentKind;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  altText: string | null;
  createdAt: Date;
};

/**
 * Returns attachment metadata for a deal visible to `viewerOrgId`,
 * ordered (kind ASC, created_at ASC). Does NOT return signed URLs —
 * those resolve per-attachment via `resolveSignedUrl`.
 *
 * Visibility is SQL-enforced and mirrors slice-10 `getDealMessages`'s
 * outer can-see-deal predicate (owner OR in-circle).
 *
 * ⚠ VISIBILITY PREDICATE — mirrored in 2 other places. If you change
 * the outer rule, also update:
 *   - src/db/dealMessages.ts → getDealMessages WHERE clause
 *   - src/lib/deals/actions.ts → canSeeDeal helper
 *
 * Demo mode: short-circuits to the in-memory DEMO_DEAL_ATTACHMENTS
 * authored constant (see seed.ts). The caller should NOT call
 * resolveSignedUrl on demo-mode attachments — the publicCdnUrl on the
 * seed entry is the renderable URL directly.
 */
export async function getAttachmentsForDeal(
  db: Db,
  viewerOrgId: number,
  dealId: number,
): Promise<DealAttachmentView[]> {
  if (isDemoMode()) {
    // Demo mode is wired in by the caller (RSC reads DEMO_DEAL_ATTACHMENTS
    // directly). This query helper returns [] in demo so the SQL path is
    // never hit; the demo seed UI shim renders authored data only.
    return [];
  }

  const res = await db.execute(sql`
    SELECT a.id, a.deal_id, a.uploaded_by_org_id, a.kind, a.storage_key,
           a.mime_type, a.size_bytes, a.alt_text, a.created_at
    FROM deal_attachments a
    JOIN deals d ON d.id = a.deal_id
    WHERE a.deal_id = ${dealId}
      AND (
        d.org_id = ${viewerOrgId}
        OR (
          d.visibility_circle_id IS NOT NULL
          AND d.visibility_circle_id IN (
            SELECT circle_id FROM circle_members WHERE org_id = ${viewerOrgId}
          )
        )
      )
    ORDER BY a.kind ASC, a.created_at ASC
  `);

  const rows = rowsOf<{
    id: number;
    deal_id: number;
    uploaded_by_org_id: number;
    kind: AttachmentKind;
    storage_key: string;
    mime_type: string;
    size_bytes: number;
    alt_text: string | null;
    created_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id,
    uploadedByOrgId: r.uploaded_by_org_id,
    kind: r.kind,
    storageKey: r.storage_key,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    altText: r.alt_text,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

/** Returns per-kind counts for a deal, used by uploadDealAttachment to
 *  enforce per-deal kind caps. */
export async function countAttachmentsByKind(
  db: Db,
  dealId: number,
): Promise<{ image: number; cert: number }> {
  if (isDemoMode()) return { image: 0, cert: 0 };
  const res = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE kind = 'image')::int AS image,
      COUNT(*) FILTER (WHERE kind = 'cert')::int AS cert
    FROM deal_attachments
    WHERE deal_id = ${dealId}
  `);
  const [row] = rowsOf<{ image: number; cert: number }>(res);
  return { image: row?.image ?? 0, cert: row?.cert ?? 0 };
}

/**
 * Resolves a short-TTL signed URL for an attachment, after verifying
 * the caller can see the parent deal.
 *
 * Throws on visibility failure (caller should catch and map to ForbiddenError
 * if reached from a server action — but normally callers are RSC server
 * components that resolve only attachments returned by getAttachmentsForDeal,
 * so the visibility check here is belt-and-suspenders).
 *
 * Demo-mode short-circuit: returns the DEMO_DEAL_ATTACHMENTS row's
 * publicCdnUrl. The RSC seed layer handles this directly so this branch
 * may never execute in practice — but defensive in case a test seam path
 * reaches here.
 */
export async function resolveSignedUrl(
  db: Db,
  viewerOrgId: number,
  dealId: number,
  attachmentId: number,
  ttlSeconds: number = 900,
): Promise<string> {
  if (isDemoMode()) {
    throw new Error(
      "resolveSignedUrl called in demo mode — RSC should read DEMO_DEAL_ATTACHMENTS.publicCdnUrl directly",
    );
  }
  const res = await db.execute(sql`
    SELECT a.storage_key
    FROM deal_attachments a
    JOIN deals d ON d.id = a.deal_id
    WHERE a.id = ${attachmentId} AND a.deal_id = ${dealId}
      AND (
        d.org_id = ${viewerOrgId}
        OR (
          d.visibility_circle_id IS NOT NULL
          AND d.visibility_circle_id IN (
            SELECT circle_id FROM circle_members WHERE org_id = ${viewerOrgId}
          )
        )
      )
    LIMIT 1
  `);
  const [row] = rowsOf<{ storage_key: string }>(res);
  if (!row) throw new Error("Attachment not visible");
  return getBlobStore().getSignedUrl(row.storage_key, { ttl: ttlSeconds });
}
