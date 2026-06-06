# AIYA Slice 17 — Photos on deals (Netlify Blobs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-image + multi-cert attachments to every deal, stored privately in Netlify Blobs with 15-minute signed URLs, surfaced as a carousel above the slice-10/16 `Messages | Bids` tabs in `DealThreadAccordion`.

**Architecture:** New `deal_attachments` table (multi-attachment per deal). Two server actions: `uploadDealAttachment` (multipart, owner-only, magic-byte MIME validation, blob-then-DB with rollback) and `deleteDealAttachment` (owner-only, blob-then-DB delete). Two query helpers: `getAttachmentsForDeal` (metadata, `canSeeDeal` predicate) and `resolveSignedUrl` (per-attachment, 15-min TTL). New `DealAttachmentCarousel` component above the existing tab strip. Netlify Blobs accessed via a small injectable `getBlobStore()` seam so tests can swap in an in-memory stub. `next.config.mjs` gains `experimental.serverActions.bodySizeLimit: '10mb'`.

**Tech Stack:** Drizzle ORM (pglite dev/test, Neon HTTP prod) · Next.js 15 App Router + Server Actions · `@netlify/blobs` v8+ · React 19 · vitest (jsdom + node) · Testing Library · Tailwind · `crypto.randomUUID()` (built-in Node 18+).

**Branch:** `feature/slice-17-deal-photos` worktree at `.worktrees/slice-17-deal-photos`. See `docs/worktrees.md`. Implementer subagents work **only** inside the worktree.

---

## File Structure

**New files:**
- `src/db/dealAttachments.ts` — query layer: `getAttachmentsForDeal`, `resolveSignedUrl`, `countAttachmentsByKind`, types `DealAttachmentView`, `AttachmentKind`
- `src/lib/deals/attachmentValidation.ts` — Zod schemas for delete + helpers
- `src/lib/deals/attachmentMime.ts` — pure-function magic-byte signature validator
- `src/lib/storage/blobStore.ts` — `getBlobStore()` injectable seam + test-time `__setTestBlobStore`
- `src/components/deals/DealAttachmentCarousel.tsx` — UI carousel + lightbox
- `drizzle/NNNN_attachments.sql` — auto-generated migration (NNNN = next sequential)
- `test/db/dealAttachments.test.ts` (visibility truth table + ordering + caps query)
- `test/db/migration-attachments-smoke.test.ts`
- `test/lib/deals/attachment-mime.test.ts` (pure-function magic-byte tests)
- `test/lib/deals/attachment-authz.test.ts` (upload/delete owner-only)
- `test/lib/deals/attachment-cap.test.ts`
- `test/lib/deals/attachment-rollback.test.ts`
- `test/components/deals/DealAttachmentCarousel.test.tsx`

**Modified files:**
- `src/db/schema.ts` — add `dealAttachments` table
- `src/lib/deals/actions.ts` — append `uploadDealAttachment` + `deleteDealAttachment`
- `src/lib/demo/seed.ts` — append `SeedDealAttachment` type + `DEMO_DEAL_ATTACHMENTS` constant
- `src/components/deals/DealThreadAccordion.tsx` — add optional attachment props + render `<DealAttachmentCarousel>` above tab strip
- `src/components/dashboard/DealRoomPanel.tsx` — thread `attachmentsByDealId`, `signedUrlsByDealId`, `attachmentActions` props through
- `src/app/page.tsx` — fetch attachment metadata + resolve signed URLs via `Promise.all`; thread into panel
- `next.config.mjs` — add `experimental.serverActions.bodySizeLimit: '10mb'`
- `test/lib/demo/seed.test.ts` — assert `DEMO_DEAL_ATTACHMENTS` shape
- `package.json` — add `@netlify/blobs` dependency

---

## Pre-flight

- [ ] **Pre-flight Step 1: Sync main + verify clean working tree**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git fetch origin --quiet
git pull --ff-only origin main
git status -sb
git log --oneline -3
```

Expected: `## main...origin/main`. Latest commit should be the slice-17 spec commit `e886fa4` or a descendant (parallel agent may have merged).

- [ ] **Pre-flight Step 2: Cut the worktree**

```bash
git worktree add .worktrees/slice-17-deal-photos -b feature/slice-17-deal-photos
cd .worktrees/slice-17-deal-photos
ln -sf ../../.env .env
ln -sf ../../node_modules node_modules
git branch --show-current
```

Expected: `feature/slice-17-deal-photos`. Symlinks present.

**All remaining steps run from `.worktrees/slice-17-deal-photos`, NOT `/root`.**

- [ ] **Pre-flight Step 3: Determine the next migration number**

```bash
ls -1 drizzle/ | grep -E '^[0-9]{4}_' | sort | tail -3
```

Expected: lists highest-numbered migration. Slice 17 = the next sequential number (e.g. `0010_*` if the last is `0009`). Call this `NNNN` for the rest of the plan. **Keep the auto-name** drizzle-kit assigns; the parallel-agent convention has been to NOT rename.

- [ ] **Pre-flight Step 4: Confirm baseline test suite is green**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: a "Tests N passed (N)" summary with zero failures. If anything fails before slice-17 edits, stop and fix that first.

- [ ] **Pre-flight Step 5: Install `@netlify/blobs`**

```bash
npm install @netlify/blobs
```

Expected: package installs cleanly. Test run still passes (no behavior change yet).

```bash
git diff package.json package-lock.json | head -20
```

Confirms `@netlify/blobs` was added to `dependencies`.

---

## Phase A — DB foundation, query layer, MIME validator

### Task A1: Add `deal_attachments` table to `src/db/schema.ts`

**Files:** Modify: `src/db/schema.ts`

- [ ] **Step 1: Locate the slice-16 `bids` table block.** Slice 17 adds the new table immediately below it (file ordering is cosmetic).

- [ ] **Step 2: Add the table.** Verify `sql`, `index`, and `uniqueIndex` are imported from `drizzle-orm/pg-core` (slices 4/10/16 use them). Append:

```ts
export const dealAttachments = pgTable(
  "deal_attachments",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    uploadedByOrgId: integer("uploaded_by_org_id")
      .notNull()
      .references(() => orgs.id),
    kind: text("kind", { enum: ["image", "cert"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    altText: text("alt_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    storageKeyUnique: uniqueIndex("deal_attachments_storage_key_unique").on(t.storageKey),
    dealKindCreatedIdx: index("deal_attachments_deal_kind_created_idx").on(
      t.dealId,
      t.kind,
      t.createdAt.asc(),
    ),
  }),
);
```

- [ ] **Step 3: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit.**

```bash
git add src/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): deal_attachments table (slice 17 schema)

Multi-image + multi-cert attachments per deal. UNIQUE index on
storage_key guards against duplicate-row writes after retries.
Composite index (deal_id, kind, created_at ASC) covers the carousel
read path (group by kind, ordered).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Generate migration + smoke test

- [ ] **Step 1: Generate.**

```bash
npx drizzle-kit generate
ls -1 drizzle/NNNN_*.sql | tail -1
cat drizzle/NNNN_*.sql
```

Replace `NNNN` with the actual number. Expect `CREATE TABLE deal_attachments`, FK with CASCADE, the unique index, and the composite index.

- [ ] **Step 2: Write `test/db/migration-attachments-smoke.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { sql } from "drizzle-orm";

describe("migration NNNN — deal_attachments (slice 17)", () => {
  it("creates the table with expected columns and UNIQUE on storage_key", async () => {
    const { db, close } = await createTestDb();
    try {
      const tables = await db.execute(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'deal_attachments'
      `);
      expect(
        (tables as unknown as { rows: { tablename: string }[] }).rows.map((r) => r.tablename),
      ).toEqual(["deal_attachments"]);

      const cols = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'deal_attachments'
        ORDER BY ordinal_position
      `);
      const colMap = new Map(
        (cols as unknown as { rows: { column_name: string; is_nullable: "YES" | "NO" }[] }).rows.map(
          (r) => [r.column_name, r.is_nullable],
        ),
      );
      expect(colMap.get("id")).toBe("NO");
      expect(colMap.get("deal_id")).toBe("NO");
      expect(colMap.get("uploaded_by_org_id")).toBe("NO");
      expect(colMap.get("storage_key")).toBe("NO");
      expect(colMap.get("mime_type")).toBe("NO");
      expect(colMap.get("alt_text")).toBe("YES");
      expect(colMap.get("size_bytes")).toBe("NO");
      expect(colMap.get("kind")).toBe("NO");

      // UNIQUE INDEX on storage_key smoke: insert twice → 2nd throws
      const orgs = await db.execute(sql`INSERT INTO orgs (id, name, slug) VALUES (1, 'AIYA', 'aiya') RETURNING id`);
      const orgId = (orgs as unknown as { rows: { id: number }[] }).rows[0].id;
      const dealRes = await db.execute(sql`
        INSERT INTO deals (org_id, kind, category, subject, quantity, price_cents, posted_by_label)
        VALUES (${orgId}, 'SELL', 'Diamond', 'x', 1, 1, 'x') RETURNING id
      `);
      const dealId = (dealRes as unknown as { rows: { id: number }[] }).rows[0].id;
      const insertOnce = sql`
        INSERT INTO deal_attachments (deal_id, uploaded_by_org_id, kind, storage_key, mime_type, size_bytes)
        VALUES (${dealId}, ${orgId}, 'image', 'org/1/deal/${sql.raw(String(dealId))}/image/abc.jpg', 'image/jpeg', 1024)
      `;
      await db.execute(insertOnce);
      await expect(db.execute(insertOnce)).rejects.toThrow();
    } finally {
      await close();
    }
  });
});
```

- [ ] **Step 3: Run.**

```bash
npx vitest run test/db/migration-attachments-smoke.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: `1 passed`.

- [ ] **Step 4: Commit.**

```bash
git add drizzle/ test/db/migration-attachments-smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(db): generate NNNN migration (deal_attachments table)

Smoke test asserts the table exists with expected nullability and
that the UNIQUE constraint on storage_key actually fires on duplicate
inserts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Pure-function magic-byte MIME validator (`src/lib/deals/attachmentMime.ts`)

Implement the validator as a pure function so it can be unit-tested without going through `runWithUser`.

- [ ] **Step 1: Write the failing test at `test/lib/deals/attachment-mime.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import { detectKindFromBytes, type AttachmentKind } from "@/lib/deals/attachmentMime";

function bytesOf(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe("detectKindFromBytes — magic byte signatures", () => {
  it("accepts a JPEG header as an image", () => {
    expect(detectKindFromBytes(bytesOf("FF D8 FF E0 00 10 4A 46 49 46 00 01"))).toEqual({
      kind: "image", mime: "image/jpeg",
    });
  });

  it("accepts a PNG header as an image", () => {
    expect(detectKindFromBytes(bytesOf("89 50 4E 47 0D 0A 1A 0A 00 00 00 0D"))).toEqual({
      kind: "image", mime: "image/png",
    });
  });

  it("accepts a WebP header as an image", () => {
    expect(detectKindFromBytes(bytesOf("52 49 46 46 24 00 00 00 57 45 42 50"))).toEqual({
      kind: "image", mime: "image/webp",
    });
  });

  it("accepts a PDF header as a cert", () => {
    expect(detectKindFromBytes(bytesOf("25 50 44 46 2D 31 2E 34 0A 25 D0 D4"))).toEqual({
      kind: "cert", mime: "application/pdf",
    });
  });

  it("rejects a buffer shorter than 12 bytes", () => {
    expect(detectKindFromBytes(bytesOf("FF D8"))).toBeNull();
  });

  it("rejects random binary garbage", () => {
    expect(detectKindFromBytes(bytesOf("AA BB CC DD EE FF 11 22 33 44 55 66"))).toBeNull();
  });

  it("rejects a RIFF header that is NOT a WebP", () => {
    expect(detectKindFromBytes(bytesOf("52 49 46 46 24 00 00 00 41 56 49 20"))).toBeNull(); // AVI
  });
});
```

- [ ] **Step 2: Run — expect compile failure (module not found).**

```bash
npx vitest run test/lib/deals/attachment-mime.test.ts --reporter=verbose 2>&1 | tail -10
```

- [ ] **Step 3: Implement `src/lib/deals/attachmentMime.ts`.**

```ts
export type AttachmentKind = "image" | "cert";

export type MimeDetection =
  | { kind: AttachmentKind; mime: string }
  | null;

/**
 * Detect the file's kind + canonical MIME type from its first 12 bytes.
 *
 * The HTTP request's Content-Type header is trivially spoofable, so we never
 * trust it. Instead we sniff the magic-byte signature off the actual bytes
 * the client sent. A renamed PDF→.jpg upload (Content-Type: image/jpeg)
 * will fail this check at the buffer level.
 *
 * Returns null if the buffer is too short or matches none of the allowed
 * signatures. The caller (uploadDealAttachment) maps null to ForbiddenError.
 */
export function detectKindFromBytes(bytes: Uint8Array): MimeDetection {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { kind: "image", mime: "image/png" };
  }

  // WebP: "RIFF????WEBP" — bytes 0-3 == 'R','I','F','F'; bytes 8-11 == 'W','E','B','P'
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { kind: "image", mime: "image/webp" };
  }

  // PDF: 25 50 44 46 ('%PDF')
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { kind: "cert", mime: "application/pdf" };
  }

  return null;
}
```

- [ ] **Step 4: Run — expect `7 passed`.**

```bash
npx vitest run test/lib/deals/attachment-mime.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/attachmentMime.ts test/lib/deals/attachment-mime.test.ts
git commit -m "$(cat <<'EOF'
feat(deals): magic-byte MIME signature validator (slice 17 security gate)

Pure function — no I/O, no DB, easy to unit-test. Never trusts the
request's Content-Type header. A renamed PDF→.jpg upload gets caught
at the buffer level by the JPEG signature mismatch.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Inject-able Netlify Blob store seam (`src/lib/storage/blobStore.ts`)

The `@netlify/blobs` SDK talks to a real Netlify backend in production. For tests, we inject an in-memory stub via a test-only setter, mirroring slice-10's `__setTestDb` pattern.

- [ ] **Step 1: Create the file.**

```ts
import { getStore as netlifyGetStore } from "@netlify/blobs";

/** Minimal interface that both the real Netlify store and an in-memory test
 *  stub must satisfy. Keeps the surface small so tests are easy to write. */
export interface BlobStore {
  set(key: string, data: Uint8Array | ArrayBuffer | Blob | string): Promise<void>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, opts?: { ttl?: number }): Promise<string>;
}

let testStore: BlobStore | null = null;

/** Test seam — set an in-memory stub. Production callers never call this. */
export function __setTestBlobStore(s: BlobStore | null): void {
  testStore = s;
}

/** Get the active blob store. In tests, returns the injected stub.
 *  In production, returns the real Netlify Blobs handle (lazy). */
export function getBlobStore(): BlobStore {
  if (testStore) return testStore;
  // Lazy real-store handle — the @netlify/blobs SDK reads NETLIFY_BLOBS_TOKEN
  // from the environment automatically in production.
  const real = netlifyGetStore({ name: "deal-attachments", consistency: "strong" });
  return {
    set: (k, d) => real.set(k, d),
    delete: (k) => real.delete(k),
    // The real SDK's signed-URL method may be named differently across SDK
    // versions. As of @netlify/blobs v8, this is `getDownloadUrl(key, { expiry })`.
    // If the install resolves a different version, the implementer should
    // check the SDK's docs and adapt — the wrapper above is the single seam.
    getSignedUrl: (k, opts) =>
      // @ts-expect-error — SDK shape may differ; verify at install time.
      real.getDownloadUrl(k, { expiry: opts?.ttl ?? 900 }),
  };
}
```

- [ ] **Step 2: Typecheck.**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

> If tsc complains about `getDownloadUrl` not existing, check the installed `@netlify/blobs` SDK's signed-URL method (could be `getSignedURL`, `getDownloadUrl`, or `getMetadata({ url: true })` depending on the version). Adapt the wrapper to the actual API. The `@ts-expect-error` line documents the uncertainty.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/storage/blobStore.ts
git commit -m "$(cat <<'EOF'
feat(storage): BlobStore interface + getBlobStore() seam

Mirrors slice-10's __setTestDb pattern: production gets the real
Netlify Blobs handle, tests inject an in-memory stub via
__setTestBlobStore(). Keeps the @netlify/blobs SDK surface behind a
tiny interface so the rest of the code reads "BlobStore" not
"NetlifyStore".

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: `src/db/dealAttachments.ts` query layer — `getAttachmentsForDeal`

- [ ] **Step 1: Write failing test at `test/db/dealAttachments.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { deals, dealAttachments, circles, circleMembers } from "@/db/schema";
import { getAttachmentsForDeal } from "@/db/dealAttachments";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

async function seedDeal(orgId: number, circleId: number | null = null) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
      visibilityCircleId: circleId,
    })
    .returning();
  return row.id;
}

async function ensureCircle(name: string, slug: string, ownerOrgId: number, members: number[]) {
  const [c] = await db.insert(circles).values({ name, slug, ownerOrgId }).returning();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId: c.id, orgId }).onConflictDoNothing();
  }
  return c.id;
}

describe("getAttachmentsForDeal — visibility truth table", () => {
  it("returns attachments to the deal owner", async () => {
    const dealId = await seedDeal(1);
    await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k1", mimeType: "image/jpeg", sizeBytes: 1024, altText: null,
    });
    const rows = await getAttachmentsForDeal(db, 1, dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("image");
  });

  it("returns attachments to an in-circle partner", async () => {
    const circleId = await ensureCircle("Trusted", "trusted-attach-1", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId);
    await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k2", mimeType: "image/png", sizeBytes: 2048, altText: "side view",
    });
    const rows = await getAttachmentsForDeal(db, 999, dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0].altText).toBe("side view");
  });

  it("hides attachments from an out-of-circle org", async () => {
    const circleId = await ensureCircle("Trusted", "trusted-attach-2", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId);
    await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k3", mimeType: "image/jpeg", sizeBytes: 1024, altText: null,
    });
    const rows = await getAttachmentsForDeal(db, 888, dealId);
    expect(rows).toEqual([]);
  });

  it("hides attachments on a private (no-circle) deal from non-owners", async () => {
    const dealId = await seedDeal(1);
    await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k4", mimeType: "image/jpeg", sizeBytes: 1024, altText: null,
    });
    expect(await getAttachmentsForDeal(db, 999, dealId)).toEqual([]);
  });

  it("orders by kind ASC, then created_at ASC", async () => {
    const dealId = await seedDeal(1);
    await db.insert(dealAttachments).values([
      { dealId, uploadedByOrgId: 1, kind: "image", storageKey: "i2",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null,
        createdAt: new Date(Date.now() - 1000) },
      { dealId, uploadedByOrgId: 1, kind: "cert", storageKey: "c1",
        mimeType: "application/pdf", sizeBytes: 1, altText: null,
        createdAt: new Date(Date.now() - 5000) },
      { dealId, uploadedByOrgId: 1, kind: "image", storageKey: "i1",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null,
        createdAt: new Date(Date.now() - 2000) },
    ]);
    const rows = await getAttachmentsForDeal(db, 1, dealId);
    expect(rows.map((r) => r.storageKey)).toEqual(["c1", "i1", "i2"]);
  });
});
```

- [ ] **Step 2: Run — expect compile failure (missing import).**

- [ ] **Step 3: Create `src/db/dealAttachments.ts` with `getAttachmentsForDeal`.**

```ts
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
```

> Demo-mode handling here is deliberately different from slice-10/16 — see spec §8.1. The query returns `[]` in demo; the RSC layer in Phase C reads `DEMO_DEAL_ATTACHMENTS` directly and stitches it into the panel context.

- [ ] **Step 4: Run — expect `5 passed`.**

```bash
npx vitest run test/db/dealAttachments.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 5: Commit.**

```bash
git add src/db/dealAttachments.ts test/db/dealAttachments.test.ts
git commit -m "$(cat <<'EOF'
feat(db): getAttachmentsForDeal with SQL-enforced visibility

Visibility predicate mirrors slice-10 getDealMessages. JSDoc carries
the 3-site mirroring obligation. Demo mode returns [] at this layer;
the RSC reads DEMO_DEAL_ATTACHMENTS directly per spec §8.1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: Add `countAttachmentsByKind` + `resolveSignedUrl`

- [ ] **Step 1: Append failing tests to `test/db/dealAttachments.test.ts`.**

```ts
import { countAttachmentsByKind, resolveSignedUrl } from "@/db/dealAttachments";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

describe("countAttachmentsByKind", () => {
  it("returns per-kind counts", async () => {
    const dealId = await seedDeal(1);
    await db.insert(dealAttachments).values([
      { dealId, uploadedByOrgId: 1, kind: "image", storageKey: "i1",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null },
      { dealId, uploadedByOrgId: 1, kind: "image", storageKey: "i2",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null },
      { dealId, uploadedByOrgId: 1, kind: "cert", storageKey: "c1",
        mimeType: "application/pdf", sizeBytes: 1, altText: null },
    ]);
    expect(await countAttachmentsByKind(db, dealId)).toEqual({ image: 2, cert: 1 });
  });

  it("returns zeros for a deal with no attachments", async () => {
    const dealId = await seedDeal(1);
    expect(await countAttachmentsByKind(db, dealId)).toEqual({ image: 0, cert: 0 });
  });
});

describe("resolveSignedUrl", () => {
  it("returns the signed URL from the store when caller can see the deal", async () => {
    const stub: BlobStore = {
      set: async () => {},
      delete: async () => {},
      getSignedUrl: async (key) => `https://stub/${key}?signed=1`,
    };
    __setTestBlobStore(stub);
    try {
      const dealId = await seedDeal(1);
      const [a] = await db.insert(dealAttachments).values({
        dealId, uploadedByOrgId: 1, kind: "image",
        storageKey: "org/1/deal/x/image/abc.jpg",
        mimeType: "image/jpeg", sizeBytes: 1, altText: null,
      }).returning();
      const url = await resolveSignedUrl(db, 1, dealId, a.id);
      expect(url).toBe("https://stub/org/1/deal/x/image/abc.jpg?signed=1");
    } finally {
      __setTestBlobStore(null);
    }
  });

  it("throws when caller cannot see the deal", async () => {
    const stub: BlobStore = {
      set: async () => {},
      delete: async () => {},
      getSignedUrl: async () => "not-reached",
    };
    __setTestBlobStore(stub);
    try {
      const dealId = await seedDeal(1);
      const [a] = await db.insert(dealAttachments).values({
        dealId, uploadedByOrgId: 1, kind: "image",
        storageKey: "k", mimeType: "image/jpeg", sizeBytes: 1, altText: null,
      }).returning();
      await expect(resolveSignedUrl(db, 999, dealId, a.id)).rejects.toThrow();
    } finally {
      __setTestBlobStore(null);
    }
  });
});
```

- [ ] **Step 2: Run — expect missing-export errors.**

- [ ] **Step 3: Append the two functions to `src/db/dealAttachments.ts`.**

Add imports at the top:
```ts
import { getBlobStore } from "@/lib/storage/blobStore";
```

Then append:
```ts
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
```

- [ ] **Step 4: Run — expect all dealAttachments tests pass (~9 total).**

```bash
npx vitest run test/db/dealAttachments.test.ts --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 5: Commit.**

```bash
git add src/db/dealAttachments.ts test/db/dealAttachments.test.ts
git commit -m "$(cat <<'EOF'
feat(db): countAttachmentsByKind + resolveSignedUrl

countAttachmentsByKind backs the per-deal cap check in
uploadDealAttachment. resolveSignedUrl verifies the caller can see
the parent deal before asking the blob store for a 15-min signed URL.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A7: Phase A green-bar verification

- [ ] Step 1: Full suite. `npm test -- --run 2>&1 | tail -10`. Expect zero failures and the new test cases (~9 + 1 smoke + 7 MIME = 17 new) all passing.
- [ ] Step 2: tsc. `npx tsc --noEmit 2>&1 | tail -10`.

---

## Phase B — Server actions

### Task B1: Zod schemas in `src/lib/deals/attachmentValidation.ts`

- [ ] Step 1: Create the file.
```ts
import { z } from "zod";

/** uploadDealAttachment takes FormData, not a typed JSON object, so its
 *  validation is split: dealId + kind + altText are field-parsed; the
 *  file is binary and validated separately by attachmentMime + size cap. */
export const uploadAttachmentMetaInput = z.object({
  dealId: z.number().int().positive(),
  kind: z.enum(["image", "cert"]),
  altText: z.string().trim().max(280).optional(),
});
export type UploadAttachmentMetaInput = z.infer<typeof uploadAttachmentMetaInput>;

export const deleteAttachmentInput = z.object({
  attachmentId: z.number().int().positive(),
});
export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentInput>;
```

- [ ] Step 2: Typecheck + commit.
```bash
npx tsc --noEmit 2>&1 | tail -5
git add src/lib/deals/attachmentValidation.ts
git commit -m "feat(deals): Zod schemas for slice-17 attachment actions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B2: `uploadDealAttachment` + authz/MIME/cap/rollback tests

- [ ] **Step 1: Write the failing tests at `test/lib/deals/attachment-authz.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealAttachments, circles, circleMembers } from "@/db/schema";
import { uploadDealAttachment, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

let db: Db;
let storeWrites: { key: string; bytes: number }[] = [];
let storeDeletes: string[] = [];

const stub: BlobStore = {
  set: async (k, d) => {
    const size =
      typeof d === "string" ? d.length :
      d instanceof Uint8Array ? d.byteLength :
      d instanceof ArrayBuffer ? d.byteLength :
      0;
    storeWrites.push({ key: k, bytes: size });
  },
  delete: async (k) => { storeDeletes.push(k); },
  getSignedUrl: async (k) => `https://stub/${k}`,
};

beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
  __setTestBlobStore(stub);
});
beforeEach(async () => {
  vi.clearAllMocks();
  storeWrites = [];
  storeDeletes = [];
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  __setTestBlobStore(null);
  await closeSharedDb();
});

/** Build a FormData for upload. The `file` is constructed from a Blob whose
 *  first bytes match the requested kind's magic-byte signature. */
function buildFormData(opts: {
  dealId: number;
  kind: "image" | "cert";
  bodyBytes?: Uint8Array;
  altText?: string;
}): FormData {
  const fd = new FormData();
  fd.set("dealId", String(opts.dealId));
  fd.set("kind", opts.kind);
  if (opts.altText !== undefined) fd.set("altText", opts.altText);
  const bytes = opts.bodyBytes ?? (opts.kind === "image"
    // JPEG magic: FF D8 FF + padding
    ? new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    // PDF magic: %PDF + padding
    : new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]));
  fd.set("file", new Blob([bytes], { type: opts.kind === "image" ? "image/jpeg" : "application/pdf" }), "f.bin");
  return fd;
}

async function seedDeal(orgId: number, circleId: number | null = null) {
  const [row] = await db.insert(deals).values({
    orgId, kind: "SELL", category: "Diamond", subject: "x",
    quantity: 1, priceCents: 1000, postedByLabel: "x", visibilityCircleId: circleId,
  }).returning();
  return row.id;
}

async function ensureCircle(slug: string, members: number[]) {
  const [c] = await db.insert(circles).values({ name: "Trusted", slug, ownerOrgId: 1 }).returning();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId: c.id, orgId }).onConflictDoNothing();
  }
  return c.id;
}

describe("uploadDealAttachment — authz", () => {
  it("allows the deal owner to upload an image", async () => {
    const dealId = await seedDeal(1);
    const res = await uploadDealAttachment(buildFormData({ dealId, kind: "image", altText: "front" }));
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(dealAttachments);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("image");
    expect(rows[0].altText).toBe("front");
    expect(storeWrites).toHaveLength(1);
  });

  it("forbids an in-circle partner from uploading (read-only access for non-owners)", async () => {
    const circleId = await ensureCircle("au1", [1, 999]);
    const dealId = await seedDeal(1, circleId);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await uploadDealAttachment(buildFormData({ dealId, kind: "image" }));
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(storeWrites).toHaveLength(0);
    const rows = await db.select().from(dealAttachments);
    expect(rows).toHaveLength(0);
  });

  it("forbids an out-of-circle org from uploading", async () => {
    const dealId = await seedDeal(1);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await uploadDealAttachment(buildFormData({ dealId, kind: "image" }));
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(storeWrites).toHaveLength(0);
  });
});

describe("uploadDealAttachment — MIME validation", () => {
  it("rejects a PDF uploaded as kind=image (magic-byte mismatch)", async () => {
    const dealId = await seedDeal(1);
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);
    const res = await uploadDealAttachment(
      buildFormData({ dealId, kind: "image", bodyBytes: pdf }),
    );
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(storeWrites).toHaveLength(0);
  });

  it("rejects truncated bytes (under 12 bytes)", async () => {
    const dealId = await seedDeal(1);
    const res = await uploadDealAttachment(
      buildFormData({ dealId, kind: "image", bodyBytes: new Uint8Array([0xff, 0xd8]) }),
    );
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});
```

- [ ] **Step 2: Run — expect missing-export error.**

- [ ] **Step 3: Implement `uploadDealAttachment` in `src/lib/deals/actions.ts`.**

Add imports at top of the file:
```ts
import { dealAttachments } from "@/db/schema";
import { uploadAttachmentMetaInput, deleteAttachmentInput, type DeleteAttachmentInput } from "./attachmentValidation";
import { detectKindFromBytes } from "./attachmentMime";
import { getBlobStore } from "@/lib/storage/blobStore";
import { countAttachmentsByKind } from "@/db/dealAttachments";
```

Add the action:
```ts
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGES_PER_DEAL = 8;
const MAX_CERTS_PER_DEAL = 4;

/** Server action: multipart upload of a single image or cert.
 *  Cannot use runWithUser's Zod-on-JSON contract because the body is
 *  FormData with a binary file. Inlines session + Zod-on-fields + the
 *  same "demo guard, error mapping" contract from runWithUser. */
export async function uploadDealAttachment(formData: FormData): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };

  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  // Field parsing
  const dealIdRaw = formData.get("dealId");
  const kindRaw = formData.get("kind");
  const fileRaw = formData.get("file");
  const altTextRaw = formData.get("altText");

  const meta = uploadAttachmentMetaInput.safeParse({
    dealId: typeof dealIdRaw === "string" ? Number(dealIdRaw) : undefined,
    kind: typeof kindRaw === "string" ? kindRaw : undefined,
    altText: typeof altTextRaw === "string" && altTextRaw !== "" ? altTextRaw : undefined,
  });
  if (!meta.success) return { ok: false, error: firstZodError(meta.error) };

  if (!(fileRaw instanceof Blob)) {
    return { ok: false, error: "Missing file" };
  }

  // Owner-only authz
  const d = db();
  const [deal] = await d.select({ ownerOrgId: deals.orgId }).from(deals).where(eq(deals.id, meta.data.dealId)).limit(1);
  if (!deal || deal.ownerOrgId !== orgId) return { ok: false, error: "Forbidden" };

  // Size cap
  if (fileRaw.size > MAX_FILE_BYTES) return { ok: false, error: "Forbidden" };

  // MIME magic-byte validation (never trust Content-Type)
  const head = new Uint8Array(await fileRaw.slice(0, 12).arrayBuffer());
  const detected = detectKindFromBytes(head);
  if (!detected || detected.kind !== meta.data.kind) return { ok: false, error: "Forbidden" };

  // Per-deal kind cap
  const counts = await countAttachmentsByKind(d, meta.data.dealId);
  if (meta.data.kind === "image" && counts.image >= MAX_IMAGES_PER_DEAL) {
    return { ok: false, error: "Forbidden" };
  }
  if (meta.data.kind === "cert" && counts.cert >= MAX_CERTS_PER_DEAL) {
    return { ok: false, error: "Forbidden" };
  }

  // Compose storage key
  const ext = detected.mime === "image/jpeg" ? "jpg"
    : detected.mime === "image/png" ? "png"
    : detected.mime === "image/webp" ? "webp"
    : "pdf";
  const storageKey = `org/${orgId}/deal/${meta.data.dealId}/${meta.data.kind}/${crypto.randomUUID()}.${ext}`;

  // Read full bytes for the upload
  const bytes = new Uint8Array(await fileRaw.arrayBuffer());

  // Blob first, then DB. If DB throws, delete the blob.
  const store = getBlobStore();
  await store.set(storageKey, bytes);
  try {
    await d.insert(dealAttachments).values({
      dealId: meta.data.dealId,
      uploadedByOrgId: orgId,
      kind: meta.data.kind,
      storageKey,
      mimeType: detected.mime,
      sizeBytes: bytes.byteLength,
      altText: meta.data.altText ?? null,
    });
  } catch (e) {
    try { await store.delete(storageKey); } catch { /* best effort */ }
    console.error("[deals action] upload db insert failed:", e);
    return { ok: false, error: "Database error" };
  }

  revalidatePath("/");
  revalidatePath("/deals");
  return { ok: true };
}
```

> The action does NOT use `runWithUser` because the wrapper's Zod-on-JSON shape doesn't fit FormData with a binary file. The pattern here re-implements the wrapper's guarantees inline.

- [ ] **Step 4: Run — expect all `attachment-authz.test.ts` cases pass.**

- [ ] **Step 5: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/attachment-authz.test.ts
git commit -m "$(cat <<'EOF'
feat(deals): uploadDealAttachment with magic-byte MIME validation

Multipart server action. Owner-only authz, 10MB cap, per-kind caps
(8 images + 4 certs per deal), magic-byte signature check via
detectKindFromBytes (never trusts request Content-Type). If the DB
insert fails after a successful blob write, the blob is deleted before
the error returns — no orphans.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: Per-deal cap enforcement test

- [ ] **Step 1: Write the cap test at `test/lib/deals/attachment-cap.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealAttachments } from "@/db/schema";
import { uploadDealAttachment, __setTestDb } from "@/lib/deals/actions";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

const stub: BlobStore = {
  set: async () => {}, delete: async () => {},
  getSignedUrl: async (k) => `https://stub/${k}`,
};

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
  __setTestBlobStore(stub);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  __setTestBlobStore(null);
  await closeSharedDb();
});

function jpegFD(dealId: number): FormData {
  const fd = new FormData();
  fd.set("dealId", String(dealId));
  fd.set("kind", "image");
  fd.set("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0,0,0,0, 0,0,0,0])], { type: "image/jpeg" }), "f.jpg");
  return fd;
}

function pdfFD(dealId: number): FormData {
  const fd = new FormData();
  fd.set("dealId", String(dealId));
  fd.set("kind", "cert");
  fd.set("file", new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0,0,0,0])], { type: "application/pdf" }), "c.pdf");
  return fd;
}

async function seedDeal(): Promise<number> {
  const [row] = await db.insert(deals).values({
    orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
    quantity: 1, priceCents: 1000, postedByLabel: "x",
  }).returning();
  return row.id;
}

describe("uploadDealAttachment — per-deal kind caps", () => {
  it("allows up to 8 images, then forbids the 9th", async () => {
    const dealId = await seedDeal();
    for (let i = 0; i < 8; i++) {
      expect(await uploadDealAttachment(jpegFD(dealId))).toEqual({ ok: true });
    }
    expect(await uploadDealAttachment(jpegFD(dealId))).toEqual({ ok: false, error: "Forbidden" });
    const count = await db.select().from(dealAttachments).then((rows) => rows.length);
    expect(count).toBe(8);
  });

  it("allows up to 4 certs, then forbids the 5th", async () => {
    const dealId = await seedDeal();
    for (let i = 0; i < 4; i++) {
      expect(await uploadDealAttachment(pdfFD(dealId))).toEqual({ ok: true });
    }
    expect(await uploadDealAttachment(pdfFD(dealId))).toEqual({ ok: false, error: "Forbidden" });
    const count = await db.select().from(dealAttachments).then((rows) => rows.length);
    expect(count).toBe(4);
  });

  it("caps are independent: 8 images + 4 certs on the same deal both OK", async () => {
    const dealId = await seedDeal();
    for (let i = 0; i < 8; i++) await uploadDealAttachment(jpegFD(dealId));
    for (let i = 0; i < 4; i++) await uploadDealAttachment(pdfFD(dealId));
    const rows = await db.select().from(dealAttachments);
    expect(rows.filter((r) => r.kind === "image")).toHaveLength(8);
    expect(rows.filter((r) => r.kind === "cert")).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run — expect all 3 cases pass against the existing implementation.**

```bash
npx vitest run test/lib/deals/attachment-cap.test.ts --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 3: Commit.**

```bash
git add test/lib/deals/attachment-cap.test.ts
git commit -m "test(deals): per-deal cap enforcement on uploadDealAttachment

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B4: Rollback test — blob deleted when DB insert throws

- [ ] **Step 1: Write `test/lib/deals/attachment-rollback.test.ts`.**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import { uploadDealAttachment, __setTestDb } from "@/lib/deals/actions";
import { __setTestBlobStore, type BlobStore } from "@/lib/storage/blobStore";

let db: Db;
let storeWrites: string[] = [];
let storeDeletes: string[] = [];

const stub: BlobStore = {
  set: async (k) => { storeWrites.push(k); },
  delete: async (k) => { storeDeletes.push(k); },
  getSignedUrl: async (k) => `https://stub/${k}`,
};

beforeAll(async () => {
  db = await getSharedDb();
  __setTestBlobStore(stub);
});
beforeEach(async () => {
  vi.clearAllMocks();
  storeWrites = []; storeDeletes = [];
  await resetSharedDb();
});
afterAll(async () => {
  __setTestBlobStore(null);
  await closeSharedDb();
});

function jpegFD(dealId: number): FormData {
  const fd = new FormData();
  fd.set("dealId", String(dealId));
  fd.set("kind", "image");
  fd.set("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0,0,0,0, 0,0,0,0])], { type: "image/jpeg" }), "f.jpg");
  return fd;
}

describe("uploadDealAttachment — rollback on DB failure", () => {
  it("deletes the blob if the DB insert throws", async () => {
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
    }).returning();

    // Stub DB whose .insert throws once to simulate a transient failure.
    const realDb = db;
    const stubDb = new Proxy(realDb, {
      get(target, prop) {
        if (prop === "insert") {
          return () => ({ values: () => { throw new Error("simulated DB failure"); } });
        }
        // @ts-expect-error proxy passthrough
        return target[prop];
      },
    }) as unknown as Db;
    await __setTestDb(stubDb);
    try {
      const res = await uploadDealAttachment(jpegFD(d.id));
      expect(res).toEqual({ ok: false, error: "Database error" });
      expect(storeWrites).toHaveLength(1);
      expect(storeDeletes).toEqual(storeWrites); // same key deleted
    } finally {
      await __setTestDb(null);
    }
  });
});
```

- [ ] **Step 2: Run — expect pass.**

```bash
npx vitest run test/lib/deals/attachment-rollback.test.ts --reporter=verbose 2>&1 | tail -10
```

- [ ] **Step 3: Commit.**

```bash
git add test/lib/deals/attachment-rollback.test.ts
git commit -m "test(deals): blob is deleted when DB insert fails post-upload

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B5: `deleteDealAttachment` + authz test

- [ ] **Step 1: Append to `test/lib/deals/attachment-authz.test.ts`.**

```ts
import { deleteDealAttachment } from "@/lib/deals/actions";

describe("deleteDealAttachment — authz", () => {
  it("allows the deal owner to delete an attachment + deletes the blob", async () => {
    const dealId = await seedDeal(1);
    const [a] = await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k", mimeType: "image/jpeg", sizeBytes: 1, altText: null,
    }).returning();
    storeDeletes = [];
    const res = await deleteDealAttachment({ attachmentId: a.id });
    expect(res).toEqual({ ok: true });
    expect(storeDeletes).toEqual(["k"]);
    const rows = await db.select().from(dealAttachments);
    expect(rows).toHaveLength(0);
  });

  it("forbids a non-owner from deleting", async () => {
    const dealId = await seedDeal(1);
    const [a] = await db.insert(dealAttachments).values({
      dealId, uploadedByOrgId: 1, kind: "image",
      storageKey: "k2", mimeType: "image/jpeg", sizeBytes: 1, altText: null,
    }).returning();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await deleteDealAttachment({ attachmentId: a.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const rows = await db.select().from(dealAttachments);
    expect(rows).toHaveLength(1); // unchanged
  });
});
```

- [ ] **Step 2: Implement `deleteDealAttachment` in `src/lib/deals/actions.ts`.**

```ts
export async function deleteDealAttachment(raw: unknown): Promise<ActionResult> {
  return runWithUser(deleteAttachmentInput, raw, async (input: DeleteAttachmentInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        attachmentId: dealAttachments.id,
        storageKey: dealAttachments.storageKey,
        dealOwnerOrgId: deals.orgId,
      })
      .from(dealAttachments)
      .innerJoin(deals, eq(deals.id, dealAttachments.dealId))
      .where(eq(dealAttachments.id, input.attachmentId))
      .limit(1);
    if (!row) throw new ForbiddenError();
    if (row.dealOwnerOrgId !== orgId) throw new ForbiddenError();

    // Delete blob FIRST. If blob delete fails, the DB row stays and a future
    // GC sweep can reconcile. Better orphan-blob than orphan-DB-row pointing
    // at a nonexistent blob.
    const store = getBlobStore();
    try {
      await store.delete(row.storageKey);
    } catch (e) {
      console.error("[deals action] blob delete failed for", row.storageKey, e);
      throw e;
    }
    await d
      .delete(dealAttachments)
      .where(and(eq(dealAttachments.id, input.attachmentId), eq(dealAttachments.uploadedByOrgId, orgId)));
  });
}
```

- [ ] **Step 3: Run — expect both new cases pass.**

- [ ] **Step 4: Commit.**

```bash
git add src/lib/deals/actions.ts test/lib/deals/attachment-authz.test.ts
git commit -m "feat(deals): deleteDealAttachment — owner-only blob+row delete

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B6: Phase B green-bar verification

- [ ] Step 1: Full suite. Expect zero failures.
- [ ] Step 2: tsc clean.

---

## Phase C — Demo seed + UI + RSC wiring

### Task C1: `DEMO_DEAL_ATTACHMENTS` constant + seed test

- [ ] **Step 1: Open `src/lib/demo/seed.ts`. After `DEMO_BIDS`, append:**

```ts
// --- Slice 17 demo seed: authored-only attachment examples ---
// Same pattern as DEMO_DEAL_MESSAGES / DEMO_BIDS — TS constants, not
// inserted at runtime. The query layer short-circuits demo mode and the
// RSC stitches these directly into the carousel via their publicCdnUrl.
export type SeedDealAttachment = {
  id: number;                    // synthetic id (not from a real serial)
  dealId: number;
  uploadedByOrgId: number;
  kind: "image" | "cert";
  publicCdnUrl: string;
  mimeType: string;
  altText: string | null;
  createdAtOffsetMinutes: number;
};

export const DEMO_DEAL_ATTACHMENTS: SeedDealAttachment[] = [
  {
    id: 1701,
    dealId: 109,
    uploadedByOrgId: DEMO_AIYA_ORG_ID,
    kind: "image",
    publicCdnUrl: "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=400",
    mimeType: "image/jpeg",
    altText: "1.02ct G/VS1 round diamond, top view, daylight",
    createdAtOffsetMinutes: 120,
  },
  {
    id: 1702,
    dealId: 109,
    uploadedByOrgId: DEMO_AIYA_ORG_ID,
    kind: "image",
    publicCdnUrl: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=400",
    mimeType: "image/jpeg",
    altText: "1.02ct G/VS1 round diamond, side view, studio light",
    createdAtOffsetMinutes: 115,
  },
  {
    id: 1703,
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

- [ ] **Step 2: Add test to `test/lib/demo/seed.test.ts`.**

```ts
import { DEMO_DEAL_ATTACHMENTS } from "@/lib/demo/seed";

describe("DEMO_DEAL_ATTACHMENTS — slice-17 authored seed", () => {
  it("exports 3 image attachments across deals 109 + 110", () => {
    expect(DEMO_DEAL_ATTACHMENTS).toHaveLength(3);
    const byDeal = new Map<number, number>();
    for (const a of DEMO_DEAL_ATTACHMENTS) {
      byDeal.set(a.dealId, (byDeal.get(a.dealId) ?? 0) + 1);
    }
    expect(byDeal.get(109)).toBe(2);
    expect(byDeal.get(110)).toBe(1);
    expect(DEMO_DEAL_ATTACHMENTS.every((a) => a.kind === "image")).toBe(true);
    expect(DEMO_DEAL_ATTACHMENTS.every((a) => a.publicCdnUrl.startsWith("https://"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run + commit.**

```bash
npx vitest run test/lib/demo/seed.test.ts --reporter=verbose 2>&1 | tail -10
git add src/lib/demo/seed.ts test/lib/demo/seed.test.ts
git commit -m "feat(demo): DEMO_DEAL_ATTACHMENTS — authored seed for slice-17 carousel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C2: `DealAttachmentCarousel` component + lightbox

- [ ] **Step 1: Create `src/components/deals/DealAttachmentCarousel.tsx`.**

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import type { DealAttachmentView } from "@/db/dealAttachments";

export type DealAttachmentCarouselProps = {
  dealId: number;
  isOwner: boolean;
  attachments: DealAttachmentView[];
  signedUrls: Map<number, string>;
  actions: {
    uploadAttachment: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
    deleteAttachment: (input: { attachmentId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

export function DealAttachmentCarousel(props: DealAttachmentCarouselProps) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const certInputRef = useRef<HTMLInputElement>(null);

  const images = props.attachments.filter((a) => a.kind === "image");
  const certs = props.attachments.filter((a) => a.kind === "cert");
  if (images.length === 0 && certs.length === 0 && !props.isOwner) return null;

  const triggerUpload = (kind: "image" | "cert", file: File) => {
    setActionError(null);
    const fd = new FormData();
    fd.set("dealId", String(props.dealId));
    fd.set("kind", kind);
    fd.set("file", file);
    startTransition(async () => {
      const res = await props.actions.uploadAttachment(fd);
      if (!res.ok) setActionError(res.error);
    });
  };

  const lightboxAttachment = lightboxId !== null
    ? props.attachments.find((a) => a.id === lightboxId)
    : null;

  return (
    <div aria-label="deal attachments" className="mb-2">
      {actionError && (
        <p role="alert" className="text-xs text-rose-400 mb-1">{actionError}</p>
      )}

      {images.length > 0 && (
        <div className="overflow-x-auto flex gap-2 pb-1">
          {images.map((a) => (
            <div key={a.id} aria-label="attachment thumbnail" className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setLightboxId(a.id)}
                className="block"
                aria-label={`Open ${a.altText ?? "deal photo"}`}
              >
                <Image
                  src={props.signedUrls.get(a.id) ?? ""}
                  alt={a.altText ?? "deal photo"}
                  width={120}
                  height={120}
                  className="rounded object-cover"
                />
              </button>
              {props.isOwner && (
                <button
                  aria-label={`delete attachment ${a.id}`}
                  className="absolute top-0 right-0 bg-zinc-900/80 text-rose-400 text-xs px-1 rounded-tr rounded-bl opacity-0 hover:opacity-100"
                  disabled={pending}
                  onClick={() => {
                    setActionError(null);
                    startTransition(async () => {
                      const res = await props.actions.deleteAttachment({ attachmentId: a.id });
                      if (!res.ok) setActionError(res.error);
                    });
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {props.isOwner && (
            <button
              aria-label="add image"
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="flex-shrink-0 w-[120px] h-[120px] border border-dashed border-zinc-700 rounded text-zinc-400 hover:text-zinc-100 text-xs"
              disabled={pending}
            >
              + Add image
            </button>
          )}
        </div>
      )}

      {props.isOwner && images.length === 0 && (
        <button
          aria-label="add image"
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="w-[120px] h-[120px] border border-dashed border-zinc-700 rounded text-zinc-400 hover:text-zinc-100 text-xs mb-1"
          disabled={pending}
        >
          + Add image
        </button>
      )}

      {certs.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs mt-1">
          {certs.map((c) => (
            <li key={c.id} aria-label="attachment cert" className="flex items-center gap-1">
              <a
                href={props.signedUrls.get(c.id) ?? "#"}
                download
                className="text-zinc-200 hover:text-amber-300 underline"
              >
                📄 cert-{c.id}
              </a>
              {props.isOwner && (
                <button
                  aria-label={`delete attachment ${c.id}`}
                  className="text-zinc-500 hover:text-rose-400"
                  disabled={pending}
                  onClick={() => {
                    setActionError(null);
                    startTransition(async () => {
                      const res = await props.actions.deleteAttachment({ attachmentId: c.id });
                      if (!res.ok) setActionError(res.error);
                    });
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {props.isOwner && (
        <button
          aria-label="add cert"
          type="button"
          onClick={() => certInputRef.current?.click()}
          className="text-xs text-zinc-400 hover:text-zinc-100 mt-1"
          disabled={pending}
        >
          + Add cert
        </button>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) triggerUpload("image", f);
          if (e.target) e.target.value = "";
        }}
      />
      <input
        ref={certInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) triggerUpload("cert", f);
          if (e.target) e.target.value = "";
        }}
      />

      {lightboxAttachment && (
        <dialog open className="bg-zinc-900/95 fixed inset-0 z-50 flex items-center justify-center p-4 w-full h-full"
                aria-label="image lightbox"
                onClick={() => setLightboxId(null)}>
          <Image
            src={props.signedUrls.get(lightboxAttachment.id) ?? ""}
            alt={lightboxAttachment.altText ?? "deal photo"}
            width={800}
            height={800}
            className="max-w-full max-h-full object-contain rounded"
          />
          <button
            type="button"
            aria-label="close lightbox"
            className="absolute top-3 right-3 text-zinc-200 hover:text-rose-400 text-xl"
            onClick={(e) => { e.stopPropagation(); setLightboxId(null); }}
          >
            ×
          </button>
        </dialog>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/components/deals/DealAttachmentCarousel.tsx
git commit -m "feat(deals): DealAttachmentCarousel + lightbox + owner upload/delete UX

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C3: Component tests for `DealAttachmentCarousel`

- [ ] **Step 1: Create `test/components/deals/DealAttachmentCarousel.test.tsx`.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealAttachmentCarousel } from "@/components/deals/DealAttachmentCarousel";
import type { DealAttachmentView } from "@/db/dealAttachments";

const noopActions = {
  uploadAttachment: vi.fn(async (_fd: FormData) => ({ ok: true as const })),
  deleteAttachment: vi.fn(async (_i: { attachmentId: number }) => ({ ok: true as const })),
};

function att(over: Partial<DealAttachmentView>): DealAttachmentView {
  return {
    id: 1, dealId: 1, uploadedByOrgId: 1, kind: "image",
    storageKey: "k", mimeType: "image/jpeg", sizeBytes: 1024,
    altText: "photo", createdAt: new Date(), ...over,
  };
}

describe("DealAttachmentCarousel", () => {
  it("returns null when there are no attachments AND viewer is not owner", () => {
    const { container } = render(<DealAttachmentCarousel
      dealId={1} isOwner={false} attachments={[]} signedUrls={new Map()} actions={noopActions}
    />);
    expect(container.firstChild).toBeNull();
  });

  it("renders thumbnails for images", () => {
    render(<DealAttachmentCarousel
      dealId={1} isOwner={false}
      attachments={[att({ id: 1, altText: "front" }), att({ id: 2, altText: "side" })]}
      signedUrls={new Map([[1, "https://stub/1"], [2, "https://stub/2"]])}
      actions={noopActions}
    />);
    expect(screen.getAllByLabelText("attachment thumbnail")).toHaveLength(2);
  });

  it("renders cert as download link", () => {
    render(<DealAttachmentCarousel
      dealId={1} isOwner={false}
      attachments={[att({ id: 7, kind: "cert", mimeType: "application/pdf", altText: null })]}
      signedUrls={new Map([[7, "https://stub/7.pdf"]])}
      actions={noopActions}
    />);
    const link = screen.getByText(/cert-7/);
    expect(link).toHaveAttribute("download");
    expect(link).toHaveAttribute("href", "https://stub/7.pdf");
  });

  it("shows + Add image and + Add cert ONLY for owner", () => {
    const { rerender } = render(<DealAttachmentCarousel
      dealId={1} isOwner={true} attachments={[]} signedUrls={new Map()} actions={noopActions}
    />);
    expect(screen.getByLabelText("add image")).toBeInTheDocument();
    expect(screen.getByLabelText("add cert")).toBeInTheDocument();
    rerender(<DealAttachmentCarousel
      dealId={1} isOwner={false} attachments={[att({ id: 1 })]} signedUrls={new Map([[1, "x"]])} actions={noopActions}
    />);
    expect(screen.queryByLabelText("add image")).toBeNull();
    expect(screen.queryByLabelText("add cert")).toBeNull();
  });

  it("delete button click fires deleteAttachment with the right id", async () => {
    const actions = { ...noopActions, deleteAttachment: vi.fn(async () => ({ ok: true as const })) };
    render(<DealAttachmentCarousel
      dealId={1} isOwner={true}
      attachments={[att({ id: 42 })]}
      signedUrls={new Map([[42, "x"]])}
      actions={actions}
    />);
    fireEvent.click(screen.getByLabelText("delete attachment 42"));
    await waitFor(() => expect(actions.deleteAttachment).toHaveBeenCalledWith({ attachmentId: 42 }));
  });

  it("clicking an image opens the lightbox; clicking close closes it", () => {
    render(<DealAttachmentCarousel
      dealId={1} isOwner={false}
      attachments={[att({ id: 1, altText: "front" })]}
      signedUrls={new Map([[1, "https://stub/1"]])}
      actions={noopActions}
    />);
    fireEvent.click(screen.getByLabelText(/Open front/));
    expect(screen.getByLabelText("image lightbox")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("close lightbox"));
    expect(screen.queryByLabelText("image lightbox")).toBeNull();
  });

  it("renders alert when upload returns ok:false", async () => {
    const actions = {
      ...noopActions,
      uploadAttachment: vi.fn(async (_fd: FormData) => ({ ok: false as const, error: "Forbidden" })),
    };
    render(<DealAttachmentCarousel
      dealId={1} isOwner={true} attachments={[]} signedUrls={new Map()} actions={actions}
    />);
    // Trigger the hidden input via the actual button
    fireEvent.click(screen.getByLabelText("add image"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], "f.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/forbidden/i));
  });
});
```

> The `next/image` component in jsdom may warn about width/height but should not fail the tests. If it does, add a `vi.mock("next/image", () => ({ default: (p: any) => <img {...p} /> }))` shim at the top of the test file.

- [ ] **Step 2: Run + commit.**

```bash
npx vitest run test/components/deals/DealAttachmentCarousel.test.tsx --reporter=verbose 2>&1 | tail -20
git add test/components/deals/DealAttachmentCarousel.test.tsx
git commit -m "test(deals): DealAttachmentCarousel — render, owner gating, lightbox, errors

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C4: Extend `DealThreadAccordion` to render the carousel

**FIRST: Read the current state of `src/components/deals/DealThreadAccordion.tsx`** (slices 11/12/14 may have touched it indirectly through merges).

- [ ] **Step 1: Add optional attachment props.**

In the component props type:
```ts
import type { DealAttachmentView } from "@/db/dealAttachments";

  attachments?: DealAttachmentView[];
  attachmentSignedUrls?: Map<number, string>;
  attachmentActions?: {
    uploadAttachment: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
    deleteAttachment: (input: { attachmentId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
```

- [ ] **Step 2: Render the carousel above the existing tab strip.**

Add `import { DealAttachmentCarousel } from "./DealAttachmentCarousel"` at the top.

Inside the JSX root (the existing `<div aria-label="deal thread" …>` wrapper), insert as the FIRST child before the `<div role="tablist">`:

```tsx
<DealAttachmentCarousel
  dealId={props.dealId}
  isOwner={props.isOwner}
  attachments={props.attachments ?? []}
  signedUrls={props.attachmentSignedUrls ?? new Map()}
  actions={props.attachmentActions ?? {
    uploadAttachment: async () => ({ ok: false, error: "Upload not configured" }),
    deleteAttachment: async () => ({ ok: false, error: "Delete not configured" }),
  }}
/>
```

- [ ] **Step 3: Run existing DealThreadAccordion tests** to confirm legacy callers (no attachment props) still pass.

```bash
npx vitest run test/components/deals/DealThreadAccordion.test.tsx --reporter=verbose 2>&1 | tail -15
```

- [ ] **Step 4: tsc + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
git add src/components/deals/DealThreadAccordion.tsx
git commit -m "feat(deals): DealThreadAccordion renders DealAttachmentCarousel above tabs

All attachment props optional with no-op defaults. Backward compatible
with slice-10 (messages-only) and slice-16 (messages + bids) callers.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C5: Wire bid query results through `src/app/page.tsx` + `DealRoomPanel`

**FIRST: Read `src/components/dashboard/DealRoomPanel.tsx` and `src/app/page.tsx`** to see slice-11/16 wiring.

- [ ] **Step 1: Add attachment props to `DealRoomPanel`.**

```ts
import type { DealAttachmentView } from "@/db/dealAttachments";

  attachmentsByDealId?: Map<number, DealAttachmentView[]>;
  signedUrlsByDealId?: Map<number, Map<number, string>>;
  attachmentActions?: {
    uploadAttachment: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
    deleteAttachment: (input: { attachmentId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
```

Pass through to the accordion per-row:
```tsx
<DealThreadAccordion
  /* …existing message + bid props… */
  attachments={props.attachmentsByDealId?.get(d.id) ?? []}
  attachmentSignedUrls={props.signedUrlsByDealId?.get(d.id) ?? new Map()}
  attachmentActions={props.attachmentActions}
/>
```

- [ ] **Step 2: In `src/app/page.tsx`, add the attachment fetches.**

```ts
import {
  getAttachmentsForDeal, resolveSignedUrl,
} from "@/db/dealAttachments";
import { uploadDealAttachment, deleteDealAttachment } from "@/lib/deals/actions";
import { DEMO_DEAL_ATTACHMENTS } from "@/lib/demo/seed";
import { isDemoMode } from "@/lib/demo/mode";

// Inside the RSC body, after the existing slice-16 Promise.all block:
const attachmentsByDealId = new Map<number, Awaited<ReturnType<typeof getAttachmentsForDeal>>>();
const signedUrlsByDealId = new Map<number, Map<number, string>>();

if (isDemoMode()) {
  // Demo path: read from the authored constant, use publicCdnUrl as the URL.
  for (const id of dealIds) {
    const demoForDeal = DEMO_DEAL_ATTACHMENTS
      .filter((a) => a.dealId === id)
      .map((a) => ({
        id: a.id,
        dealId: a.dealId,
        uploadedByOrgId: a.uploadedByOrgId,
        kind: a.kind,
        storageKey: a.publicCdnUrl, // unused in demo
        mimeType: a.mimeType,
        sizeBytes: 0,
        altText: a.altText,
        createdAt: new Date(Date.now() - a.createdAtOffsetMinutes * 60_000),
      }));
    attachmentsByDealId.set(id, demoForDeal);
    const urls = new Map<number, string>();
    for (const a of demoForDeal) urls.set(a.id, a.storageKey);
    signedUrlsByDealId.set(id, urls);
  }
} else {
  await Promise.all(
    dealIds.map(async (id) => {
      const atts = await getAttachmentsForDeal(db, orgId, id);
      attachmentsByDealId.set(id, atts);
      const urls = new Map<number, string>();
      await Promise.all(
        atts.map(async (a) => {
          urls.set(a.id, await resolveSignedUrl(db, orgId, id, a.id));
        }),
      );
      signedUrlsByDealId.set(id, urls);
    }),
  );
}
```

Pass into `<DealRoomPanel>`:
```tsx
<DealRoomPanel
  /* …existing props… */
  attachmentsByDealId={attachmentsByDealId}
  signedUrlsByDealId={signedUrlsByDealId}
  attachmentActions={{
    uploadAttachment: uploadDealAttachment,
    deleteAttachment: deleteDealAttachment,
  }}
/>
```

- [ ] **Step 3: tsc + build smoke.**

```bash
npx tsc --noEmit 2>&1 | tail -10
npm run build 2>&1 | tail -20
```

Expected: build succeeds. The build will optimize `next/image` for the carousel — confirm no missing remote-image-domain errors. If Netlify Blobs signed-URL hosts aren't in `next.config.mjs`'s `images.remotePatterns`, add them in Task C6.

- [ ] **Step 4: Commit.**

```bash
git add src/components/dashboard/DealRoomPanel.tsx src/app/page.tsx
git commit -m "feat(deals): wire attachments + signed URLs through DealRoomPanel render

Demo branch reads DEMO_DEAL_ATTACHMENTS directly (publicCdnUrl).
Live branch uses Promise.all to fetch attachments + signed URLs in
parallel per deal.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C6: `next.config.mjs` — body limit + remote-image patterns

- [ ] **Step 1: Read current `next.config.mjs`.** Slices 11/12/14 may have edited it.

- [ ] **Step 2: Add or extend the `experimental` block.**

```js
// inside the existing config object (or add it if missing):
experimental: {
  serverActions: {
    bodySizeLimit: '10mb',
  },
},
```

If `experimental.serverActions` already exists from another slice, merge — don't overwrite.

- [ ] **Step 3: Add Netlify-Blobs domain to `images.remotePatterns`.**

Netlify Blobs signed URLs are served from a Netlify CDN domain. The exact hostname depends on the site — likely `*.netlify.app` plus an `*.blob.netlify.com` subdomain (verify with a real signed URL from the `getSignedUrl` call). For demo mode, also allowlist `images.unsplash.com`.

```js
images: {
  remotePatterns: [
    { protocol: "https", hostname: "**.netlify.app" },
    { protocol: "https", hostname: "**.netlify.com" },
    { protocol: "https", hostname: "images.unsplash.com" },
  ],
},
```

- [ ] **Step 4: tsc + build smoke + commit.**

```bash
npx tsc --noEmit 2>&1 | tail -10
npm run build 2>&1 | tail -20
git add next.config.mjs
git commit -m "feat(deals): server-action body limit + next/image remote patterns

10mb body limit for slice-17 photo uploads. Allowlist Netlify Blobs
host (production) and Unsplash (demo seed) in next/image remotePatterns.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task C7: Phase C green-bar verification

- [ ] Step 1: Full suite. Expect zero failures. Test count delta is ~7 (Phase A) + ~12 (Phase B) + ~9 (C tests so far) = 28 cases over the slice-16 baseline.
- [ ] Step 2: tsc + build clean.

---

## Phase D — Verify + merge + deploy

### Task D1: Lint, full verify, dev smoke

- [ ] Step 1: Full suite. `npm test -- --run 2>&1 | tail -10`. Zero failures.
- [ ] Step 2: tsc. `npx tsc --noEmit 2>&1 | tail -10`. Zero errors.
- [ ] Step 3: Build. `npm run build 2>&1 | tail -25`. Success.
- [ ] Step 4: Demo-mode dev smoke.

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:3000/ -o /tmp/slice17-home.html
grep -oE "(attachment thumbnail|deal photo|unsplash)" /tmp/slice17-home.html | sort -u
kill $DEV_PID 2>/dev/null
```

Expected: at least one of those markers appears (signals the carousel rendered with the demo seed).

### Task D2: Merge feature branch → main + push + verify Netlify

- [ ] **Step 1:** From `.worktrees/slice-17-deal-photos`, confirm commit history. `git log --oneline ^main HEAD | wc -l` expects ~24-28 commits across the four phases.

- [ ] **Step 2:** Switch to `/root`, sync, merge, push.

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git fetch origin --quiet
git pull --ff-only origin main
git merge --no-ff feature/slice-17-deal-photos -m "$(cat <<'EOF'
Merge feature/slice-17-deal-photos: Photos on deals (slice 17)

Multi-image + multi-cert attachments per deal via Netlify Blobs
(private store, 15-min signed URLs). Server-action multipart upload
with magic-byte MIME validation (not Content-Type). Per-deal caps:
8 images + 4 certs. 10MB per file. Owner-only upload/delete;
canSeeDeal predicate for read. Demo mode renders DEMO_DEAL_ATTACHMENTS
with public Unsplash URLs. Carousel renders above the slice-10/16
Messages | Bids tabs in DealThreadAccordion.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 3:** Poll Netlify for the deploy. Marker: the carousel's `aria-label` value is stable and free of apostrophes:

```bash
(
  url="https://idesign-dash-demo.netlify.app/"
  marker="deal attachments"
  start=$(date +%s)
  deadline=$((start + 360))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(curl -sL --max-time 15 "$url" 2>/dev/null || true)
    if echo "$body" | grep -qi "$marker"; then
      echo "SLICE_17_LIVE after $(( $(date +%s) - start ))s"
      exit 0
    fi
    sleep 20
  done
  echo "TIMEOUT — '$marker' not found"
  exit 1
)
```

- [ ] **Step 4:** Tear down worktree + delete merged branch.

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree remove .worktrees/slice-17-deal-photos
git branch -d feature/slice-17-deal-photos
git push origin --delete feature/slice-17-deal-photos 2>/dev/null || true
git worktree list
```

Slice 17 done.

---

## Self-Review Notes

**1. Spec coverage:**
- §3 schema (deal_attachments) → A1, A2 ✓
- §4 storage config (Netlify Blobs) → A4 (`blobStore.ts` seam) ✓
- §5 authz rules → B2 (upload owner-only + MIME + caps), B5 (delete owner-only) ✓
- §6 upload pipeline (10MB, magic-byte, blob-then-DB rollback) → B2, B4 ✓
- §7 server actions → B1 (Zod), B2 (upload), B5 (delete) ✓
- §8 query layer → A5 (getAttachmentsForDeal), A6 (countAttachmentsByKind, resolveSignedUrl) ✓
- §9 UI → C2 (DealAttachmentCarousel + lightbox), C4 (DealThreadAccordion extension), C5 (DealRoomPanel + page.tsx wiring), C6 (next.config.mjs) ✓
- §10 testing → 7 of 8 test files mapped to tasks; demo seed test in C1 ✓
- §11 migration & rollout → A2, pre-flight Step 5 (npm install) ✓

**2. Placeholder scan:** None. The migration number `NNNN` is named with explicit resolution instructions in Pre-flight Step 3. The `@netlify/blobs` signed-URL API uncertainty in Task A4 is explicitly flagged with `@ts-expect-error` and a "adapt to actual SDK version" note.

**3. Type consistency:**
- `DealAttachmentView`, `AttachmentKind`, `MimeDetection` defined once each (A5, A3) and reused in B/C tasks.
- `BlobStore` interface defined once in A4, consumed in A6 (`resolveSignedUrl`), B2 (`uploadDealAttachment` via `getBlobStore`), B5 (`deleteDealAttachment`), and tests.
- Action signatures: `uploadDealAttachment(FormData)` and `deleteDealAttachment(raw)` consistent across tests and implementation.

Plan is ready.
