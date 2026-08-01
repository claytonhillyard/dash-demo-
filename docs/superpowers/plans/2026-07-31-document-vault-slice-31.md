# Slice 31 — Document Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Org-scoped document vault (contracts/NDAs) on the slice-17 blob primitive, with streaming downloads (blob `get` + a route handler, since @netlify/blobs v10 has no signed URLs).

**Spec (authoritative — read cited §§ first):** `docs/superpowers/specs/2026-07-31-document-vault-slice-31-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-31-doc-vault`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; demo RSC harness; NEVER write the literal `@vitest-environment` string in prose comments; route files export ONLY handlers + config (slice-28 build lesson); a silent exit-1 may be the flapping host sandbox — retry.

**Reference files:** `src/lib/storage/blobStore.ts` (the primitive to extend), `src/lib/deals/attachmentMime.ts` (`detectKindFromBytes` — reuse as-is), `src/lib/deals/actions.ts` (`uploadDealAttachment`/`deleteDealAttachment` — the scaffold to mirror), `src/app/(admin)/invoices/[id]/pdf/route.ts` (the streaming route + `sanitizePdfFilename` in `src/lib/invoices/pdfFilename.ts`), `src/db/schema.ts` (`deal_attachments` shape), `src/lib/demo/seed.ts`, `test/lib/deals/` attachment tests + the injected-blob-stub pattern, `Nav.tsx`, `test/middleware.test.ts`.

---

## Task 31-1 — Schema + blob `get` + reader + demo seed

**Files:** `src/db/schema.ts` (+`documents` per spec §4; index `documents_org_created_idx`); `npx drizzle-kit generate` → inspect `drizzle/0024_*.sql` additive-only (report filename); `src/lib/storage/blobStore.ts` (+`get(key): Promise<Uint8Array | null>` on the interface, the real handle (`real.get(key, { type: "arrayBuffer" })` → Uint8Array | null), and note the in-memory test stubs consumers will add — DO NOT break deal attachments); `src/lib/activity/types.ts` (`ACTIVITY_ENTITY_TYPES += "document"`); `src/db/documents.ts` (new: `DocumentRow`, `getDocuments(db, orgId, {customerId?})`, `getDocumentForDownload(db, orgId, id)` — the only storageKey-exposing reader; demo branches); `src/lib/demo/seed.ts` (`DEMO_DOCUMENTS` per spec §8 + a `getSeedDocumentById`; the demo PDF placeholder bytes constant). Tests: blob-store get round-trip + deal-attachment regression (~4); migration smoke (+3); reader tests (~6, org-scoping + customer filter + demo); seed integrity (+2). Ripple: grep any BlobStore stub in existing tests (deals) — extend it with `get` so those tests still compile.

Verify scoped + tsc. Commit `feat(documents): schema + blob get + reader + demo seed (slice 31-1)`.

## Task 31-2 — Upload/delete actions + download route

**Files:** `src/lib/documents/actions.ts` (new "use server" — `uploadDocument(formData)` + `deleteDocument({id})` per spec §5, mirroring `uploadDealAttachment`/`deleteDealAttachment`: demo guard, session, Zod, `detectKindFromBytes` magic-byte validation, size + org caps, customerId org-ownership check, blob-first-then-DB with orphan cleanup on upload / DB-first-then-best-effort-blob on delete, audits on entityType `document`; define `MAX_DOCUMENT_BYTES`/`MAX_DOCUMENTS_PER_ORG`); `src/app/(admin)/documents/[id]/file/route.ts` (new GET per spec §7 — mirror the invoices PDF route; reuse `sanitizePdfFilename` from `@/lib/invoices/pdfFilename` or a local twin; `getBlobStore().get` → 404 on null; NO non-handler exports). Tests: `test/lib/documents/actions.test.ts` (~18 per spec §10 — inject a blob stub via `__setTestBlobStore`; the spoofed-Content-Type + orphan-cleanup + org-scoping cases) + `test/app/document-download-route.test.ts` (~5 — demo-harness %PDF bytes + headers + 404s + filename sanitization).

Verify scoped + tsc. Commit `feat(documents): upload/delete actions + streaming download route (slice 31-2)`.

## Task 31-3 — Vault page + upload UI + nav

**Files:** `src/app/(admin)/documents/page.tsx` (RSC, force-dynamic — list via getDocuments + the upload form + per-row Download link + two-step Delete); `src/components/documents/DocumentUploadForm.tsx` (client — file input accept `.pdf,image/*`, title, docType select, FormData → `uploadDocument`, useTransition/alert/refresh; NO customer picker in v1 per spec §9); a small client delete control (two-step confirm → `deleteDocument`) or fold into the list component; `Nav.tsx` (+ "Documents" entry); middleware matcher (+`/documents` if not wildcard-covered — CHECK) + `test/middleware.test.ts` (+1). Tests: `test/components/documents/DocumentUploadForm.test.tsx` (~4 — submits FormData with the file+title+docType; error alert; pending) + extend a page/RSC test (+2 — vault renders seed docs + download link; nav has Documents) + the delete-confirm test.

Verify scoped + tsc + `npx next build` (new "use server" + route + client form). Commit `feat(documents): vault page + upload UI + nav (slice 31-3)`.

---

## Final verification (controller)

Full suite detached. `npx tsc --noEmit`. `npx next build`. Review probes: magic-byte validation can't be bypassed by Content-Type; org-scoping on every reader/action + the customerId ownership check; blob-first/DB-first ordering + orphan/stray handling; the download route streams the right bytes with sanitized filename + no-store + no non-handler exports; demo blob stub yields valid %PDF; `document` entity type wired (dot map? check ActivityList — add if it has a default it's fine); no secrets/keys in audit or Sentry; BlobStore `get` addition didn't break deal attachments; client bundle (the upload form must not pull server-only blob/db code). Apply fixes → merge --no-ff → ROADMAP row 31 shipped + HANDOFF → clean up `.worktrees/slice-c8-neon-driver` + branch.

## Done condition

- 3 commits + docs; migration 0024; ZERO new deps
- Demo: `/documents` lists seed docs; a download yields a valid (tiny) PDF; upload demo-blocked with the friendly message
- Full suite green; tsc clean; next build clean; ROADMAP row 31 shipped
