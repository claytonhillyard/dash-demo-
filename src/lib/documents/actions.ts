"use server";

import { revalidatePath } from "next/cache";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { documents } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { getCustomerById } from "@/db/customers";
import { detectKindFromBytes } from "@/lib/deals/attachmentMime";
import { getBlobStore } from "@/lib/storage/blobStore";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import { firstZodError } from "@/lib/company/validation";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type UploadDocumentResult = { ok: true; id: number } | { ok: false; error: string };

// Test seam — see test/lib/documents/actions.test.ts. Production paths read
// the live Neon/pglite via getDb(). Identical pattern to
// src/lib/deals/actions.ts / src/lib/invoices/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  // Test seam only. "use server" exports are POST-invokable; outside the
  // test runner this must do nothing so it can't poison db() in prod (review chip).
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) return;
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

// 15 MB — generous for a scanned contract/NDA PDF or a photographed receipt,
// well under Netlify Blobs' per-object limits.
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
// A friendly ceiling, not a technical one — keeps the vault list (the
// default-LIMIT-200 reader, src/db/documents.ts getDocuments) sane and gives
// an operator a clear signal to prune well before the org nears any real
// storage/DB limit.
const MAX_DOCUMENTS_PER_ORG = 500;

const DOC_TYPES = ["contract", "nda", "agreement", "receipt", "other"] as const;

/** FormData field parsing — mirrors uploadAttachmentMetaInput
 *  (src/lib/deals/attachmentValidation.ts): the file itself is binary and
 *  validated separately (magic bytes, then size), everything else is a
 *  plain string field coerced into the Zod shape. */
const uploadDocumentMetaInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  docType: z.enum(DOC_TYPES),
  customerId: z.number().int().positive().optional(),
});

const deleteDocumentInput = z.object({
  id: z.number().int().positive(),
});

type ActorResult =
  | { ok: true; orgId: number; actor: string }
  | { ok: false; error: string };

/** Demo guard + session re-assert, shared by both actions below — same
 *  "demo guard FIRST, then session" order as uploadDealAttachment /
 *  deleteDealAttachment. On failure, returns the exact { ok:false, error }
 *  the caller should return unchanged. */
async function requireActor(): Promise<ActorResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  try {
    const session = await requireSession();
    return { ok: true, orgId: session.orgId, actor: session.user };
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
}

/** Extension derived from the DETECTED mime (never the request's declared
 *  Content-Type or filename) — same ternary as uploadDealAttachment. */
function extFor(mime: string): string {
  return mime === "image/jpeg" ? "jpg"
    : mime === "image/png" ? "png"
    : mime === "image/webp" ? "webp"
    : "pdf";
}

async function countDocumentsForOrg(d: Db, orgId: number): Promise<number> {
  const res = await d.execute(sql`
    SELECT COUNT(*)::int AS count FROM documents WHERE org_id = ${orgId}
  `);
  const [row] = rowsOf<{ count: number }>(res);
  return row?.count ?? 0;
}

/**
 * Server action: multipart upload of a single document (contract, NDA,
 * receipt, ...). Mirrors uploadDealAttachment's contract — demo guard,
 * FormData -> Zod, magic-byte sniff, size + org caps, blob-then-DB with
 * orphan cleanup on a DB failure — with two differences from the deal
 * attachment scaffold: ANY non-null detectKindFromBytes result is accepted
 * (there's no separate "kind" field here to cross-check against, unlike
 * deal attachments' image/cert split), and an optional customerId link is
 * verified org-owned before the write (spec §5).
 */
export async function uploadDocument(formData: FormData): Promise<UploadDocumentResult> {
  const who = await requireActor();
  if (!who.ok) return who;
  const { orgId, actor } = who;

  const titleRaw = formData.get("title");
  const docTypeRaw = formData.get("docType");
  const customerIdRaw = formData.get("customerId");
  const fileRaw = formData.get("file");

  const meta = uploadDocumentMetaInput.safeParse({
    title: typeof titleRaw === "string" ? titleRaw : undefined,
    docType: typeof docTypeRaw === "string" ? docTypeRaw : undefined,
    customerId:
      typeof customerIdRaw === "string" && customerIdRaw !== ""
        ? Number(customerIdRaw)
        : undefined,
  });
  if (!meta.success) return { ok: false, error: firstZodError(meta.error) };

  if (!(fileRaw instanceof Blob)) {
    return { ok: false, error: "Missing file" };
  }

  // MIME magic-byte validation — never trust the request's Content-Type.
  // Accept ANY signature detectKindFromBytes recognizes (PDF or image);
  // unlike deal attachments there's no separate "kind" field to cross-check
  // the detection against.
  const head = new Uint8Array(await fileRaw.slice(0, 12).arrayBuffer());
  const detected = detectKindFromBytes(head);
  if (!detected) {
    return { ok: false, error: "Unsupported file — upload a PDF or image" };
  }

  if (fileRaw.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "File is too large — 15MB max" };
  }

  const d = db();

  const existingCount = await countDocumentsForOrg(d, orgId);
  if (existingCount >= MAX_DOCUMENTS_PER_ORG) {
    return { ok: false, error: "Document limit reached for this organization" };
  }

  if (meta.data.customerId !== undefined) {
    const customer = await getCustomerById(d, orgId, meta.data.customerId);
    if (!customer) return { ok: false, error: "Forbidden" };
  }

  // Compose storage key. UUID prevents same-name collisions across uploads;
  // the extension is derived from the detected MIME, never the filename.
  const ext = extFor(detected.mime);
  const storageKey = `org/${orgId}/documents/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await fileRaw.arrayBuffer());

  // Blob first, then DB. If the insert throws, delete the blob — no orphans.
  const store = getBlobStore();
  try {
    await store.set(storageKey, bytes);
  } catch (e) {
    console.error("[documents action] blob set failed", { storageKey, error: e });
    Sentry.captureException(e, {
      tags: { layer: "documents-action", subsystem: "blob-store" },
      extra: { storageKey },
    });
    return { ok: false, error: "Upload failed" };
  }

  let newId: number;
  try {
    // No-arg .returning() (all columns) — a parameterized
    // `.returning({ id: documents.id })` doesn't resolve cleanly under tsc
    // for the Neon|PGlite Db union in this codebase (see the TODOs in
    // src/lib/circles/actions.ts and src/lib/website/actions.ts).
    const [row] = await d
      .insert(documents)
      .values({
        orgId,
        customerId: meta.data.customerId ?? null,
        title: meta.data.title,
        docType: meta.data.docType,
        storageKey,
        mimeType: detected.mime,
        sizeBytes: bytes.byteLength,
        uploadedByLabel: actor,
      })
      .returning();
    newId = row.id;
  } catch (e) {
    let rollbackOk = true;
    try {
      await store.delete(storageKey);
    } catch (rollbackErr) {
      rollbackOk = false;
      // Orphan blob: log + Sentry-capture so a future GC sweep has the key.
      console.warn("[documents action] orphan blob rollback failed", {
        storageKey, error: rollbackErr,
      });
      Sentry.captureException(rollbackErr, {
        tags: { layer: "documents-action", subsystem: "blob-store-rollback" },
        extra: { storageKey },
      });
    }
    console.error("[documents action] upload db insert failed", {
      storageKey, rollbackOk, error: e,
    });
    Sentry.captureException(e, {
      tags: { layer: "documents-action" },
      extra: { storageKey, rollbackOk },
    });
    return { ok: false, error: "Database error" };
  }

  await recordActivitySafely(
    d,
    {
      orgId,
      actor,
      entityType: "document",
      entityId: newId,
      verb: "created",
      summary: `Uploaded document "${meta.data.title}"`,
      payload: { docType: meta.data.docType },
    },
    { action: "documents.upload" },
  );

  revalidatePath("/documents");
  if (meta.data.customerId !== undefined) {
    revalidatePath(`/customers/${meta.data.customerId}/edit`);
  }

  return { ok: true, id: newId };
}

/**
 * Server action: owner-only delete of a single document. Delete ORDER is
 * reversed from uploadDealAttachment/deleteDealAttachment (which delete the
 * blob first): here the DB row is the source of truth (spec §5), so it is
 * removed FIRST via a single atomic `DELETE ... RETURNING`. That statement
 * doubles as the org-scoped existence/ownership check — a cross-org or
 * missing id deletes zero rows, collapsing both cases into the same
 * Forbidden with no separate SELECT to race against, and it's how this
 * action resolves storageKey for the blob cleanup below without adding a
 * second storageKey-exposing reader next to getDocumentForDownload
 * (src/db/documents.ts), which stays the only export that hands storageKey
 * to a caller outside this module.
 *
 * The blob delete that follows is best-effort: a failure is logged and
 * Sentry-captured but must NOT fail the action, because the row — the
 * thing the rest of the app treats as truth — is already gone.
 */
export async function deleteDocument(raw: unknown): Promise<ActionResult> {
  const who = await requireActor();
  if (!who.ok) return who;
  const { orgId, actor } = who;

  const parsed = deleteDocumentInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  const d = db();
  let deletedRow: { title: string; storageKey: string };
  try {
    // No-arg .returning() — see the upload-side comment above for why a
    // parameterized returning() is avoided in this codebase.
    const res = await d
      .delete(documents)
      .where(and(eq(documents.id, parsed.data.id), eq(documents.orgId, orgId)))
      .returning();
    if (res.length === 0) return { ok: false, error: "Forbidden" };
    deletedRow = res[0]!;
  } catch (e) {
    console.error("[documents action] delete db error", e);
    Sentry.captureException(e, { tags: { layer: "documents-action" } });
    return { ok: false, error: "Database error" };
  }

  // Best-effort blob cleanup AFTER the row is gone. A failure here (network
  // blip, already-gone blob, ...) must never surface as an action failure —
  // Sentry-capture it for a future GC sweep and move on.
  try {
    await getBlobStore().delete(deletedRow.storageKey);
  } catch (e) {
    console.warn("[documents action] best-effort blob delete failed", {
      storageKey: deletedRow.storageKey, error: e,
    });
    Sentry.captureException(e, {
      tags: { layer: "documents-action", subsystem: "blob-store" },
      extra: { storageKey: deletedRow.storageKey },
    });
  }

  await recordActivitySafely(
    d,
    {
      orgId,
      actor,
      entityType: "document",
      entityId: parsed.data.id,
      verb: "deleted",
      summary: `Deleted document "${deletedRow.title}"`,
      payload: null,
    },
    { action: "documents.delete" },
  );

  revalidatePath("/documents");
  return { ok: true };
}
