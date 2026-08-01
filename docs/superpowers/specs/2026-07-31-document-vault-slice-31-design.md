# iDesign Command Center — Slice 31: Document Vault — Design

**Date:** 2026-07-31
**Status:** Approved; implementation plan pending
**Builds on:** slice 17 (Netlify Blobs store + magic-byte MIME sniffing), slice 22 (customers — optional link target), slice 24 (audit), slice 28 (the streaming PDF route pattern).
**Domain note:** core, greenfield. Deliberately NOT the deals/bids domain (another tab owns `aiya-todays-inventory-bids-18c`). Reuses only the shared, additive blob primitive.

---

## 1. Overview & Goals

An org-scoped document vault for contracts, NDAs, and signed agreements — upload a PDF or scanned image, list them, download them, optionally link one to a customer. Reuses the slice-17 blob store + magic-byte MIME validation; adds the streaming-download half the blob comment anticipated ("Phase C").

**Goals:**
- Migration `0024`: `documents` table (org-scoped, optional customer link).
- **Extend `BlobStore` with `get(key)`** — @netlify/blobs v10 has no signed URL, so downloads stream through a route handler (the slice-28 pattern). Additive to the interface; deal attachments unaffected.
- `uploadDocument` / `deleteDocument` actions (magic-byte validated, size-capped, owner/org-scoped, audited), reusing the `uploadDealAttachment` scaffold.
- `GET /documents/[id]/file` — org-scoped streaming download.
- `/documents` vault page (list + upload) + nav.
- ~40 tests. ONE migration, ZERO new deps.

## 2. Non-goals (named homes)

Formats beyond PDF + images (DOCX/XLSX → later; v1 accepts exactly what `detectKindFromBytes` already validates). E-signature / signing flow → separate slice. Document versioning → later. Full-text search inside documents → needs slice-34 (Pinecone). Folder hierarchy → tags/customer-link only for v1. Sharing documents cross-org via circles → later.

## 3. Blob primitive extension — `src/lib/storage/blobStore.ts` (additive)

```ts
export interface BlobStore {
  set(key, data): Promise<void>;
  delete(key): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;   // NEW — read bytes back for streaming
  getSignedUrl(key, opts?): Promise<string>;      // unchanged (still throws in prod on v10)
}
```
- Real impl: `const ab = await real.get(key, { type: "arrayBuffer" }); return ab ? new Uint8Array(ab) : null;` (@netlify/blobs `Store.get` supports `{ type: "arrayBuffer" }`; returns null for a missing key).
- The in-memory test stub (tests already inject one via `__setTestBlobStore`) gains a `get` backed by its Map. Deal-attachment code only uses `set`/`delete` — unaffected by the new method.
- `__setTestBlobStore` is a plain lib export (NOT a "use server" action) — not POST-invokable, so no C-7-style prod guard is needed (unlike `__setTestDb`). Note this so review doesn't flag it.

## 4. Schema — migration `0024`

```ts
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull().references(() => orgs.id),
    // Optional customer link — a contract can be org-level or tied to a
    // customer. set null on customer delete (the doc outlives the link).
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    docType: text("doc_type", { enum: ["contract", "nda", "agreement", "receipt", "other"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),         // application/pdf | image/jpeg | image/png | image/webp
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByLabel: text("uploaded_by_label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("documents_org_created_idx").on(t.orgId, t.createdAt)],
);
```
`ACTIVITY_ENTITY_TYPES += "document"` (src/lib/activity/types.ts). No new verbs — reuse `created`/`deleted`.

## 5. Actions — `src/lib/documents/actions.ts` (mirror `uploadDealAttachment`/`deleteDealAttachment`)

- `uploadDocument(formData)`: demo guard FIRST → requireSession → parse `{ title (1..200), docType (enum), customerId? (int) }` via Zod + the `file` Blob → magic-byte sniff via `detectKindFromBytes` (accept ANY non-null result — PDF or image; store `detected.mime`; reject null → "Unsupported file — upload a PDF or image") → size cap `MAX_DOCUMENT_BYTES` (reuse the deal `MAX_FILE_BYTES` value or define 15MB) → if `customerId` given, verify it's org-owned (else Forbidden) → storage key `org/${orgId}/documents/${crypto.randomUUID()}.${ext}` (ext from detected mime) → **blob `set` FIRST, then DB insert; if the insert throws, `delete` the blob (no orphans)** → audit verb `created`, entityType `document`, entityId, summary `` `Uploaded document "${title}"` ``, payload `{ docType }` (title in summary is fine — org's own data; NO file bytes/keys in audit) → revalidate `/documents` (+ the customer edit path if linked). Return `{ ok:true, id }`.
- `deleteDocument({ id })`: demo guard → session → load org-scoped (missing/cross-org → Forbidden) → **DB delete FIRST (the source of truth), then best-effort blob `delete`** (a blob-delete failure must NOT fail the action — the row is already gone; Sentry-capture it) → audit verb `deleted`, entityType document, summary `` `Deleted document "${title}"` ``. Revalidate.
- Per-org cap: `MAX_DOCUMENTS_PER_ORG` (e.g. 500) — friendly error when exceeded.

## 6. Reader — `src/db/documents.ts`

- `DocumentRow = { id, title, docType, mimeType, sizeBytes, customerId, uploadedByLabel, createdAt }` (NO storageKey in the list shape — internal).
- `getDocuments(db, orgId, opts?: { customerId?: number }): Promise<DocumentRow[]>` — org-scoped, newest-first; optional customer filter. Demo branch → DEMO_DOCUMENTS.
- `getDocumentForDownload(db, orgId, id): Promise<{ storageKey, mimeType, title } | null>` — org-scoped; the ONLY reader exposing storageKey, used solely by the route. Demo branch → a demo descriptor whose storageKey the demo blob store resolves to placeholder bytes.

## 7. Download route — `src/app/(admin)/documents/[id]/file/route.ts` (mirror the slice-28 invoice PDF route)

`GET`: `getCurrentOrgId()` try/catch → 401; demo allowed; `getDocumentForDownload` → null → 404; `getBlobStore().get(storageKey)` → null → 404 (blob vanished); Response with the bytes, `Content-Type: <mimeType>`, `Content-Disposition: attachment; filename="<sanitized title>.<ext>"` (reuse the slice-28 `sanitizePdfFilename` idiom — export/share it or a local twin; strip quotes/CR/LF + non-ASCII), `Cache-Control: no-store`. NO non-handler exports (the slice-28 build lesson). Demo: `getBlobStore()` in demo returns a stub whose `get` yields a tiny valid `%PDF` placeholder so the demo download is a real (minimal) file.

## 8. Demo — `src/lib/demo/seed.ts`

`DEMO_DOCUMENTS` (ids 9601+): 2–3 rows (e.g. "AIYA–Ginza Pearl NDA" linked to customer 2204, "Master Consignment Agreement" org-level, "2026 Insurance Certificate"), varied docType/mime. The demo blob store branch: `getBlobStore()` when `isDemoMode()` returns an in-memory stub whose `get(anyKey)` yields a ~200-byte valid PDF (hardcoded `%PDF-1.4 … %%EOF` byte array) so downloads work offline. Integrity test: all DEMO_DOCUMENTS have a resolvable storageKey + valid docType.

## 9. UI — `/documents` + nav

- **Page** `src/app/(admin)/documents/page.tsx` (RSC, force-dynamic): title + an upload form (client) + a list (title, type badge, size, date, customer link if set, a Download `<a href="/documents/${id}/file">` + a two-step Delete). Demo-harness compatible.
- **Upload form** `src/components/documents/DocumentUploadForm.tsx` (client): file input (accept `.pdf,image/*`), title, docType select, optional customer select (or leave for v1: customerId omitted from the vault page, only set via a future customer-edit section — DECISION: v1 vault page has NO customer picker; keep it org-level. Customer-linking is schema-ready but surfaced later). useTransition, alert, `router.refresh` on success; the `readFile`-style FormData submit to `uploadDocument`.
- **Delete**: two-step inline confirm (the house pattern), calls `deleteDocument`.
- **Nav**: add "Documents" to the sidebar (near Customers/Invoices). Middleware `/documents` — check the matcher; add if needed (+test).

## 10. Test plan (~40)

- **Blob store (~4):** the new `get` on the test stub round-trips set→get; get(missing)→null; deal-attachment set/delete still work (regression); real-branch `get` shape (unit with a mocked netlify store if feasible, else covered by the stub).
- **Migration smoke (+3):** documents table + columns + index; customer_id nullable + set-null FK.
- **Reader (~6, shared-db):** getDocuments newest-first + org-scoping (org-999 invisible) + customer filter; getDocumentForDownload org-scoped + cross-org → null; demo branch.
- **uploadDocument (~12, shared-db + injected blob stub):** happy path inserts + blob set + audit `created` on entityType document; magic-byte reject (a text file → "unsupported"); a spoofed Content-Type (PDF bytes, claimed image) still stored by ACTUAL bytes; size cap; org cap; customerId cross-org → Forbidden; demo-blocked; unauthenticated; missing file; orphan cleanup (mock the DB insert to throw → assert blob.delete called); title/docType Zod.
- **deleteDocument (~6):** deletes row + blob; cross-org Forbidden; missing Forbidden; a blob-delete failure still succeeds (row gone) + Sentry-captured; audit `deleted`.
- **Download route (~5):** demo-mode 200 + headers + %PDF bytes + filename from title; 401 unauth; 404 missing/cross-org; 404 when blob.get returns null; filename sanitization (title with quotes/CJK).
- **UI (~4, jsdom + RSC):** upload form submits FormData to the action; delete confirm calls deleteDocument; vault page renders the seed docs list with a download link; nav has Documents.

## 11. Decisions

- Downloads stream through a route handler (blob `get`), not signed URLs — @netlify/blobs v10 removed signed URLs (the exact "Phase C" the blob comment anticipated).
- Blob-first-then-DB on upload (orphan cleanup on DB failure); DB-first-then-blob on delete (row is the source of truth; a stray blob is harmless and Sentry-noted).
- Accept exactly what `detectKindFromBytes` validates (PDF + JPEG/PNG/WebP) — never trust the request Content-Type.
- customerId is schema-ready but NOT surfaced in the v1 vault UI (org-level upload only); a customer-edit documents section is a later slice.
- No new deps, no new audit verbs; `document` is the only new entity type.
