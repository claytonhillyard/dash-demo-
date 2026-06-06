# AIYA Dashboard — Slice 17: Photos on deals (Netlify Blobs) — Design

**Date:** 2026-06-06
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 2 (Deal Room), slice 3 (Multi-tenant), slice 4 (Circles), slice 10 (Reply Threads), slice 11 (Polish + Observability), slice 16 (Bidding). Reuses slice-10 `canSeeDeal` + `runWithUser` + `ForbiddenError` + denormalized org-label pattern, slice-11 panel registry (`PANEL_REGISTRY` / `PanelCtx`), slice-16 `Promise.all` parallel-fetch convention.

**Numbering note:** Slices 12-15 are reserved for the parallel-agent track (slice 12 Web Vitals + slice 14 Lighthouse CI already shipped). Slice 17 is the natural sequel to slice 16 on the Deal Room track.

---

## 1. Overview & Goals

Jewelry deals without photos are nearly worthless. Slice 17 attaches **multiple images + multiple PDF certs** to every deal. Photos render in a **carousel strip above the Messages | Bids tabs** in the existing `DealThreadAccordion` — partners see what the piece looks like the moment they open a deal.

The storage layer is **Netlify Blobs (private store) + 15-minute signed URLs**, so a $50k stone photo never lives at a static public CDN URL that can leak via email forwarding. The visibility model matches every other deal-attached primitive in the project: bidder + owner + circle members can read; only the deal owner can upload or delete.

**Goals:**

- New `deal_attachments` table with the schema in §3.
- New Netlify Blobs store `deal-attachments` (private, default access).
- Two server actions wrapped in `runWithUser` + Zod: `uploadDealAttachment`, `deleteDealAttachment`.
- Two query functions in `src/db/dealAttachments.ts`: `getAttachmentsForDeal` (metadata-only) and `resolveSignedUrl` (per-attachment, on-demand).
- New `DealAttachmentCarousel` component rendered above the slice-10 tab strip in `DealThreadAccordion`.
- CSS `<dialog>`-based lightbox for full-size image viewing.
- Magic-byte MIME validation (server-side), not Content-Type header (which is spoofable).
- 10 MB per-file cap; 8 images + 4 certs per-deal cap.
- Authored-only demo seed `DEMO_DEAL_ATTACHMENTS` constant with public-CDN URLs.
- Cross-circle visibility truth-table test, owner-only authz test, MIME validation test, cap enforcement test, rollback test on DB-insert failure, component tests.

## 2. Non-Goals (each has a named home)

- **Server-side image transforms / responsive thumbnails** — `next/image` handles client-side optimization on the signed URLs. A future slice can add a sharp+Blob pipeline if the demand ever surfaces.
- **Drag-to-reorder attachments** — order is `created_at ASC` only.
- **Replace-in-place** — user deletes then re-uploads. Keeps the action surface minimal.
- **Watermarking, signing-as-original-author** — out of scope.
- **Bulk operations (multi-select delete, download-all)** — single-attachment ops only.
- **Per-message attachments inside reply threads** — slice 10's `deal_messages.body` is plain-text-only by spec. A future slice could add `message_attachments` if needed.
- **Public sharing links / "view-without-login" deep URLs** — out of scope; the private+signed model is intentional.
- **Per-attachment access logs / audit** — slice 19 (Activity feed) is the right home.

## 3. Schema

### 3.1 `deal_attachments` (new)

```ts
deal_attachments
  id                   serial PK
  deal_id              int    NOT NULL   FK → deals(id) ON DELETE CASCADE
  uploaded_by_org_id   int    NOT NULL   FK → orgs(id)
                                          -- always equals deals.org_id (owner-only upload);
                                          -- denormalized for audit clarity
  kind                 enum   NOT NULL   -- "image" | "cert"
  storage_key          text   NOT NULL   -- "org/{orgId}/deal/{dealId}/{kind}/{uuid}.{ext}"
  mime_type            text   NOT NULL   -- "image/jpeg" | "image/png" | "image/webp" | "application/pdf"
  size_bytes           int    NOT NULL
  alt_text             text   NULL       -- for image accessibility; null for certs
  created_at           timestamptz NOT NULL DEFAULT now()
```

Indexes:
- `UNIQUE (storage_key)` — belt-and-suspenders against duplicate row writes after a retry
- `(deal_id, kind, created_at ASC)` — covers the carousel render query (group by kind, time-order within group)

Migration: drizzle generates the next sequential migration file (`0010_*` or similar — read `drizzle/meta/_journal.json` at execution time to confirm number).

### 3.2 Demo-seed deltas

Append to `src/lib/demo/seed.ts` after `DEMO_BIDS`:

```ts
export type SeedDealAttachment = {
  dealId: number;
  uploadedByOrgId: number;
  kind: "image" | "cert";
  /** For demo mode: a public CDN URL rendered directly. The real query layer
   *  short-circuits demo mode, so this URL is what the demo UI shim displays. */
  publicCdnUrl: string;
  mimeType: string;
  altText: string | null;
  createdAtOffsetMinutes: number;
};

export const DEMO_DEAL_ATTACHMENTS: SeedDealAttachment[] = [
  {
    dealId: 109,
    uploadedByOrgId: DEMO_AIYA_ORG_ID,
    kind: "image",
    publicCdnUrl: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=400",
    mimeType: "image/jpeg",
    altText: "1.02ct G/VS1 round diamond, top view, daylight",
    createdAtOffsetMinutes: 120,
  },
  {
    dealId: 109,
    uploadedByOrgId: DEMO_AIYA_ORG_ID,
    kind: "image",
    publicCdnUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=400",
    mimeType: "image/jpeg",
    altText: "1.02ct G/VS1 round diamond, side view, studio light",
    createdAtOffsetMinutes: 115,
  },
  {
    dealId: 110,
    uploadedByOrgId: DEMO_AIYA_ORG_ID,
    kind: "image",
    publicCdnUrl: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=400",
    mimeType: "image/jpeg",
    altText: "18k gold chain lot, fanned display",
    createdAtOffsetMinutes: 90,
  },
];
```

Authored-only, no pglite insert at runtime — matches the slice-10/16 demo seed pattern. The query layer short-circuits on `isDemoMode()`, so the public-CDN URLs are what render in the live demo.

## 4. Storage configuration

- **Provider:** Netlify Blobs (selected over Vercel Blob and Cloudflare R2 because the app deploys to Netlify — keeps storage colocated with the host, fewest secrets to manage).
- **Store name:** `deal-attachments`
- **Access:** Netlify Blobs default is private to the site. We use `getStore({ name: "deal-attachments", consistency: "strong" })`.
- **Storage key shape:** `org/{orgId}/deal/{dealId}/{kind}/{uuidv4}.{ext}`
  - The `org/{orgId}/` prefix lets us cleanup-sweep an entire org if needed (e.g. tenant deletion in a far-future slice).
  - The UUID is the non-guessable secret. Even with `kind` + `deal_id` exposed in error messages, a partner cannot enumerate.
- **Signed URL TTL:** 15 minutes (`getSignedUrl({ ttl: 900 })`). Tabs left open for >15 min will need a re-render to refresh; revalidatePath after every action handles this for the common case.
- **Env var:** `NETLIFY_BLOBS_TOKEN` — auto-injected by Netlify in production. For local dev + CI, set manually (`.env` already gitignored).

## 5. Visibility & authz (all server-enforced via `runWithUser`)

1. **Upload (`uploadDealAttachment`)** — caller's `orgId` must equal `deal.org_id`. Partners cannot add photos to your deals even if they can see them.
2. **List metadata + resolve signed URL** — caller must satisfy the slice-10 `canSeeDeal` predicate (owner OR in-circle partner). Bidders/repliers get read access by virtue of seeing the deal.
3. **Delete (`deleteDealAttachment`)** — caller's `orgId` must equal `deal.org_id` (same as upload — only the owner curates the photo set).
4. **MIME bypass** — server-side magic-byte signature check runs BEFORE the blob write. A rejected MIME means zero blob writes AND zero DB rows.
5. **Cap bypass** — per-deal cap (`8 images + 4 certs`) is checked inside the server action with a `SELECT count(*) FROM deal_attachments WHERE deal_id = $1 AND kind = $2` immediately before the insert. Concurrency window is small and acceptable for slice 17 (cap-by-one over-count not a security issue).

Violations → `ForbiddenError` inside the `runWithUser` callback → `{ok:false, error:"Forbidden"}` with zero writes (blob OR DB). Same slice-10/16 pattern.

## 6. Upload mechanism

**Server-action multipart**, NOT presigned client-direct upload.

Reasoning:
- Keeps all authz at the action boundary — slice-3/10/16 invariant.
- No client-side secret to leak.
- Single error-handling surface (action returns `{ok, error}`; client handles uniformly).
- Multipart-up-to-10MB is well within Next.js server-action limits when `experimental.serverActions.bodySizeLimit = '10mb'` is set in `next.config.mjs`.

Server-side pipeline (inside `runWithUser` callback):

1. Parse multipart form via Next.js `FormData` API; extract `dealId` (number), `kind` ("image" | "cert"), `file` (`File`), `altText?` (string).
2. Look up deal owner; if `!== orgId` → `ForbiddenError`.
3. Cap check: `file.size > 10 * 1024 * 1024` → `ForbiddenError("File too large")`.
4. **Magic-byte signature** check on the first 12 bytes:
   - `image/jpeg`: `FF D8 FF`
   - `image/png`: `89 50 4E 47 0D 0A 1A 0A`
   - `image/webp`: `RIFF????WEBP`
   - `application/pdf`: `25 50 44 46` (`%PDF`)
   - Allow-list per `kind`: images must be jpeg/png/webp; certs must be pdf. Mismatch → `ForbiddenError("Invalid file type")`.
5. Per-deal kind-count check: `SELECT count(*) FROM deal_attachments WHERE deal_id = $1 AND kind = $2`. If kind=image and count ≥ 8 → `ForbiddenError("Image limit reached")`. If kind=cert and count ≥ 4 → `ForbiddenError("Cert limit reached")`.
6. Generate `storage_key = "org/" + orgId + "/deal/" + dealId + "/" + kind + "/" + crypto.randomUUID() + "." + ext`.
7. Compute MIME from the magic-byte detection (never trust `file.type` from the request).
8. `await store.set(storage_key, file)` — Netlify Blobs upload.
9. `await db.insert(dealAttachments).values({...})`. **If this throws, delete the blob:** `await store.delete(storage_key)` then re-throw. The outer `runWithUser` catches and maps to `{ok:false, error:"Database error"}`; the blob is not orphaned.
10. `revalidatePath("/")` + `revalidatePath("/deals")` happen via the wrapper.

## 7. Server actions (`src/lib/deals/actions.ts`)

```ts
uploadDealAttachment(formData: FormData): Promise<ActionResult>
  → input parsed from FormData (not Zod-validated like JSON inputs;
    multipart + Zod is awkward — instead manually validate each field
    with explicit narrowing)
  → returns { ok: true } | { ok: false; error: string }

deleteDealAttachment(raw: { attachmentId: number }): Promise<ActionResult>
  → Zod-validated
  → owner-only: looks up deal owner via JOIN, asserts === caller.orgId
  → DELETE FROM deal_attachments WHERE id = $1 AND deal_id IN (SELECT id FROM deals WHERE org_id = $orgId)
  → store.delete(storage_key)
  → Order matters: delete blob FIRST, then DB row. If blob delete throws, the
    DB row stays — better an orphan blob than an orphan DB row pointing nowhere.
    A future "garbage collect orphans" sweep can reconcile.
```

Validation Zod schemas live in new file `src/lib/deals/attachmentValidation.ts` (parallel to slice-10's `replyValidation.ts` and slice-16's `bidValidation.ts`).

## 8. Query layer (`src/db/dealAttachments.ts`)

### 8.1 `getAttachmentsForDeal(db, viewerOrgId, dealId): Promise<DealAttachmentView[]>`

Returns metadata only — NOT signed URLs. URL resolution is deferred to `resolveSignedUrl` so the caller can decide whether to do a bulk fetch or per-render fetch.

```ts
type DealAttachmentView = {
  id: number;
  dealId: number;
  uploadedByOrgId: number;
  kind: "image" | "cert";
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  altText: string | null;
  createdAt: Date;
};
```

SQL skeleton:
```sql
SELECT a.* FROM deal_attachments a
JOIN deals d ON d.id = a.deal_id
WHERE a.deal_id = $dealId
  AND (
    d.org_id = $viewerOrgId
    OR (
      d.visibility_circle_id IS NOT NULL
      AND d.visibility_circle_id IN (
        SELECT circle_id FROM circle_members WHERE org_id = $viewerOrgId
      )
    )
  )
ORDER BY a.kind ASC, a.created_at ASC
```

Visibility predicate mirrors slice-10 `getDealMessages` exactly (the slice-4 can-see-deal rule). NOT the slice-16 bidder-OR-owner rule — attachments are deal-level public-to-viewers (bidders, repliers, circle partners), unlike bids which are bidder+owner only.

Demo-mode short-circuit: returns the `DEMO_DEAL_ATTACHMENTS` constant filtered by `dealId` (UNLIKE slice-10/16 where demo returns `[]`). Reason: photos are the slice's visible payload; an empty demo defeats the purpose. The signed-URL resolver also short-circuits in demo mode and returns the `publicCdnUrl` directly.

⚠ VISIBILITY PREDICATE — mirrors slice-10's `getDealMessages` outer WHERE clause. If you change the can-see-deal rule, update both sites + slice-10's `canSeeDeal()`.

### 8.2 `resolveSignedUrl(orgId, dealId, attachmentId, ttlSeconds=900): Promise<string>`

```ts
async function resolveSignedUrl(
  orgId: number,
  dealId: number,
  attachmentId: number,
  ttlSeconds: number = 900,
): Promise<string>
```

Steps:
1. If `isDemoMode()`, look up the `DEMO_DEAL_ATTACHMENTS` row by `attachmentId` and return its `publicCdnUrl`.
2. Otherwise: SELECT the attachment row + JOIN parent deal; assert `canSeeDeal(orgId, dealId)` predicate. Throw `ForbiddenError` if not visible.
3. Call `store.getSignedUrl(storageKey, { ttl: ttlSeconds })` and return the URL.

This runs PER attachment per render. The carousel's RSC code wraps a batch in `Promise.all` for parallelism.

### 8.3 `countAttachmentsByKind(db, dealId): Promise<{ image: number; cert: number }>`

Small helper used by `uploadDealAttachment` for the cap check (step 5). Returns `{ image, cert }` counts. Single SQL query with `FILTER (WHERE kind = ...)` aggregates.

## 9. UI

### 9.1 `DealAttachmentCarousel` (new component)

Props: `{ dealId, viewerOrgId, isOwner, attachments, signedUrls, actions }` where `signedUrls: Map<attachmentId, string>` (pre-resolved by RSC) and `actions = { uploadAttachment, deleteAttachment }`.

Renders:
- **No attachments**: nothing (returns `null`). The accordion collapses naturally without empty placeholder.
- **At least one image**: horizontal-scroll thumbnail strip via Tailwind `overflow-x-auto flex gap-2`. Each thumbnail is `<Image src={signedUrls.get(a.id)} alt={a.altText} width={120} height={120} className="rounded object-cover flex-shrink-0" />`.
- **At least one cert**: a row of `📄 {kind}-{shortHash}` styled as `<a href={signedUrls.get(a.id)} download>` links below the image strip.
- **Owner-only "Add image" + "Add cert" buttons** at the end of the image row. Each opens a hidden `<input type="file">`.
- **Owner-only per-attachment delete**: hover-revealed `×` button at the top-right corner of each thumbnail; calls `deleteAttachment({ attachmentId })`.
- **Click on image** → opens a CSS `<dialog>` lightbox. The dialog has the full-resolution image (still via the same signed URL — `next/image` handles upscaling). `Esc` closes; click-outside closes; explicit `×` close button.

### 9.2 `DealThreadAccordion` — minimal extension

Read the current file to confirm shape (post-slice-16 it has tabs for Messages | Bids). Add optional props:

```ts
attachments?: DealAttachmentView[];
attachmentSignedUrls?: Map<number, string>;
attachmentActions?: {
  uploadAttachment: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteAttachment: (input: { attachmentId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
};
```

Render `<DealAttachmentCarousel … />` above the existing `<div role="tablist">`. The carousel returns `null` when empty, so the existing accordion visual rhythm is unchanged when no photos exist.

### 9.3 `next.config.mjs` — server-action body limit

```js
experimental: {
  serverActions: {
    bodySizeLimit: '10mb',
  },
},
```

The slice-11 / slice-14 work already touched `next.config.mjs`. Read its current state before modifying; the `experimental` block may already exist.

### 9.4 RSC wiring (`src/app/page.tsx`)

Inside the existing per-deal-id `Promise.all` loop (slice-16 cleanup added this), add:

```ts
const attachmentsByDealId = new Map<number, DealAttachmentView[]>();
const signedUrlsByDealId = new Map<number, Map<number, string>>();

await Promise.all(
  dealIds.map(async (id) => {
    const atts = await getAttachmentsForDeal(db, orgId, id);
    attachmentsByDealId.set(id, atts);
    const urls = new Map<number, string>();
    await Promise.all(
      atts.map(async (a) => {
        const url = await resolveSignedUrl(orgId, id, a.id);
        urls.set(a.id, url);
      }),
    );
    signedUrlsByDealId.set(id, urls);
  }),
);
```

These maps thread into `DealRoomPanel` → `DealThreadAccordion` like the other Phase-C wirings.

### 9.5 Plain-text on alt text

`alt_text` is rendered as `<Image alt={a.altText}>` — React escapes string children. No HTML construction. The same plain-text contract that slice-10 messages and slice-16 bid notes use.

## 10. Testing (mirrors slice 10/16 truth-table structure)

All under `test/lib/deals/` and `test/components/deals/` and `test/db/`.

### 10.1 `test/db/dealAttachments.test.ts` — query visibility truth table

Matrix dimensions: `{owner, in-circle partner, out-of-circle org}` × `{has attachment, no attachment}`. 6 cells. Each cell asserts the `getAttachmentsForDeal` row count. Mirrors `test/db/dealMessages.test.ts` cross-circle pattern.

Plus: `kind ASC, created_at ASC` ordering assertion.

### 10.2 `test/lib/deals/attachment-authz.test.ts` — upload/delete authz

Matrix: `{owner, in-circle partner, out-of-circle org}` × `{uploadDealAttachment, deleteDealAttachment}`. Owner allowed; everyone else `Forbidden`. Zero blob writes + zero DB writes on `Forbidden`.

### 10.3 `test/lib/deals/attachment-mime.test.ts` — magic-byte validation

- Valid JPEG (`FF D8 FF` prefix) as image → ok
- Valid PNG as image → ok
- Valid WebP as image → ok
- PDF renamed `.jpg` with `Content-Type: image/jpeg` from request → `Forbidden("Invalid file type")` (magic-byte check catches the spoof)
- Truncated file (< 12 bytes) → `Forbidden`
- Random binary garbage → `Forbidden`
- Valid PDF as cert → ok
- JPEG sent as cert → `Forbidden` (cert kind doesn't accept images)

This test is the security gate — the slice's whole MIME-bypass story depends on it.

### 10.4 `test/lib/deals/attachment-cap.test.ts`

- Seed 8 images on a deal; 9th upload → `Forbidden("Image limit reached")`. No blob written. DB count stays at 8.
- Seed 4 certs; 5th → `Forbidden("Cert limit reached")`.
- Seed 8 images + 4 certs (caps hit on both); upload of NEW kind on a fresh deal → ok.

### 10.5 `test/lib/deals/attachment-rollback.test.ts`

Mocks the DB layer to throw after the blob has been written. Asserts:
- The action returns `{ok:false, error:"Database error"}`.
- The blob does NOT exist after the action returns (the action deleted it before throwing).

Mechanism: `__setTestDb()` to a stub that throws on `.insert(dealAttachments)`, then watch `store.delete(storageKey)` get called via a spy.

### 10.6 `test/components/deals/DealAttachmentCarousel.test.tsx`

- Empty state renders `null` (no DOM output).
- Populated with 3 images renders 3 `<img>` elements with correct `alt` text.
- Cert row renders `<a download>` links for PDFs.
- Owner sees "Add image" + "Add cert" buttons + per-attachment delete.
- Non-owner does NOT see add or delete buttons.
- Click on an image opens the lightbox `<dialog>` (asserted via `dialog[open]` selector).
- Esc closes the lightbox.
- Delete click fires the action callback with the right `attachmentId`.

### 10.7 `test/db/migration-attachments-smoke.test.ts`

Asserts: `deal_attachments` table exists; expected column nullability; UNIQUE constraint on `storage_key` is present (insert a row, attempt duplicate-key insert, expect error).

### 10.8 Demo seed test update (`test/lib/demo/seed.test.ts`)

Assert `DEMO_DEAL_ATTACHMENTS` has 3 entries on deals 109 + 110 with valid public CDN URLs.

## 11. Migration & rollout

- New drizzle migration (next sequential number — likely 0010 or higher).
- Migration is additive only.
- `outputFileTracingIncludes` already covers `./drizzle/**/*`.
- New env var `NETLIFY_BLOBS_TOKEN` — production gets it automatically from Netlify; dev/CI get a documented stub. Add to `.env.example` if that file exists; otherwise note in `docs/deploy.md` (slice 11 created this).
- New npm dep: `@netlify/blobs`. Plus `crypto.randomUUID()` (built-in Node 18+).
- `next.config.mjs` gains `experimental.serverActions.bodySizeLimit: '10mb'`.

## 12. Out-of-scope follow-ups (named, not built)

- **Per-message attachments** (photos in reply threads) — slice 18+ if needed.
- **AI image-to-listing on upload** — slice 18 (the next queued slice).
- **Server-side thumbnails / responsive variants** — sharp + Blob pipeline; deferred.
- **Image cropping / rotation in-browser** — out of scope.
- **Audit log of who-viewed-which-photo-when** — slice 19 (Activity feed).
- **Public sharing links** — out of scope.
- **Watermarking** — out of scope.

---

## Design summary table

| Concern | Choice |
|---|---|
| Storage provider | Netlify Blobs (private store) |
| Schema | New `deal_attachments` table; multi-image + multi-cert |
| Caps | 8 images + 4 certs per deal; 10 MB per file |
| MIME validation | Magic-byte signature, not Content-Type header |
| Authz upload/delete | Owner-only |
| Authz read | `canSeeDeal` predicate (owner OR in-circle partner) |
| Upload flow | Server-action multipart (no presigned client-direct) |
| Rollback on insert failure | Delete blob, then re-throw |
| Signed URL TTL | 15 minutes |
| Demo mode | Authored constant + public CDN URLs; query returns the constant (NOT `[]`) so demo is visually populated |
| UI placement | Carousel strip ABOVE the Messages \| Bids tabs |
| Rendering | `next/image` for thumbnails; CSS `<dialog>` lightbox; PDF as `<a download>` link |
| Per-attachment delete | Hover-revealed `×` on each thumbnail; owner-only |
| Security posture | Secure-by-default — high-level Netlify Blobs API (no custom signing crypto), magic-byte MIME check (no Content-Type trust), private storage with short-TTL signed URLs (no public CDN exposure for real uploads) |
