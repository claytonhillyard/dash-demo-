import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";

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
