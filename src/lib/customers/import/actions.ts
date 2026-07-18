"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { customers } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import { firstZodError } from "@/lib/company/validation";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import { safeErrShape, mapDbConstraintError } from "@/lib/actionErrors";
import { parseCsv, type CsvParseResult } from "@/lib/csv/parse";
import { matchHeaders, mapRow, type ImportCustomer } from "./winjewelPreset";

/**
 * previewImport / commitImport — the WinJewel CSV customer-import server
 * actions. Spec §5 (docs/superpowers/specs/2026-07-17-winjewel-csv-import-slice-26-design.md).
 *
 * Stateless two-action flow (spec §8 decision 2): the CSV text is re-parsed
 * from scratch on every call, including commit — no server-side temp
 * storage. Both actions share `buildImportPlan`, the pure parse -> header
 * match -> row map -> in-file-dedupe pipeline, so "what preview shows" and
 * "what commit does" can never drift apart.
 *
 * Commit's idempotency comes from a chunked batch UPSERT keyed on the
 * `(org_id, external_ref)` partial-unique index
 * (`customers_org_external_ref_unique` — src/db/schema.ts /
 * drizzle/0016_left_starbolt.sql, `WHERE external_ref IS NOT NULL`).
 */

// Test seam — see test/lib/customers/import/actions.test.ts. Production
// paths read the live Neon/pglite via getDb(). Independent module-local
// binding from src/lib/customers/actions.ts's own __setTestDb — every
// "use server" module owns its own seam (same pattern as watchlists).
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const SAMPLE_SIZE = 20;
// Bounds IN-list / batch-values statement size for both the membership
// SELECT and the UPSERT — spec §5.
const MEMBERSHIP_CHUNK = 500;
const UPSERT_CHUNK = 500;

const importInput = z.object({
  // Byte-accurate cap: z.string().max() counts UTF-16 code units, which lets
  // a ~10MB CJK-heavy file pass a "5MB" check (3-byte UTF-8 sequences collapse
  // to 1 code unit). Buffer.byteLength measures what actually crossed the
  // wire. The client-side check (ImportWizard) uses file.size — also bytes —
  // so the two caps agree. Cheap length pre-check first so a pathological
  // string never reaches byteLength unnecessarily.
  csvText: z
    .string()
    .min(1)
    .max(MAX_CSV_BYTES) // fast UTF-16 upper screen (bytes >= code units)
    .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_CSV_BYTES, {
      message: "CSV is too large (5MB max)",
    }),
});

export type ImportSampleEntry = {
  rowIndex: number;
  ok: boolean;
  name?: string;
  externalRef?: string;
  errors?: string[];
};

export type ImportPreview =
  | {
      ok: true;
      totalRows: number;
      validCount: number;
      invalidCount: number;
      wouldCreate: number;
      wouldUpdate: number;
      sample: ImportSampleEntry[]; // first 20 rows, incl. flagged in-file duplicates
    }
  | { ok: false; error: string };

export type ImportCommitResult =
  | { ok: true; created: number; updated: number; skipped: number }
  | { ok: false; error: string };

type ImportPlan = {
  totalRows: number;
  validCustomers: ImportCustomer[]; // deduped, last-in-file wins
  invalidCount: number; // mapRow validation failures
  skippedInFileCount: number; // valid rows superseded by a later duplicate ref
  sample: ImportSampleEntry[];
};

/**
 * Pure parse -> header-match -> row-map -> in-file-dedupe pipeline. No db,
 * no session — safe to call from either action.
 *
 * Dedup rule (spec §5 / §8 decision 3): the LAST occurrence of a given
 * externalRef in the file wins; every earlier occurrence is counted in
 * `skippedInFileCount` (rolled into commitImport's `skipped`, kept separate
 * from `invalidCount` which is reserved for actual mapRow validation
 * failures) and, when within the first 20 rows, flagged in the sample as
 * `ok: false` with a duplicate-specific error message.
 */
function buildImportPlan(
  csvText: string,
): { ok: true; plan: ImportPlan } | { ok: false; error: string } {
  let parsed: CsvParseResult;
  try {
    parsed = parseCsv(csvText);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not parse CSV",
    };
  }

  const { headers, rows } = parsed;
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `CSV has too many rows (max ${MAX_ROWS})` };
  }

  const matched = matchHeaders(headers);
  if (!matched.ok) {
    return {
      ok: false,
      error: `CSV is missing required column(s): ${matched.missing.join(", ")}`,
    };
  }
  const map = matched.map;

  const outcomes = rows.map((row, i) => ({
    rowIndex: i + 1,
    result: mapRow(map, row, i + 1),
  }));

  // Forward pass: each valid row overwrites any earlier entry for the same
  // externalRef, so once the loop finishes the map holds the WINNING
  // (last-in-file) rowIndex per ref.
  const winnerRowIndexByRef = new Map<string, number>();
  for (const { rowIndex, result } of outcomes) {
    if (result.ok) winnerRowIndexByRef.set(result.value.externalRef, rowIndex);
  }

  let invalidCount = 0;
  let skippedInFileCount = 0;
  const validCustomers: ImportCustomer[] = [];
  const sample: ImportSampleEntry[] = [];

  for (const { rowIndex, result } of outcomes) {
    const inSample = rowIndex <= SAMPLE_SIZE;

    if (!result.ok) {
      invalidCount++;
      if (inSample) sample.push({ rowIndex, ok: false, errors: result.errors });
      continue;
    }

    const isWinner = winnerRowIndexByRef.get(result.value.externalRef) === rowIndex;
    if (!isWinner) {
      skippedInFileCount++;
      if (inSample) {
        sample.push({
          rowIndex,
          ok: false,
          name: result.value.name,
          externalRef: result.value.externalRef,
          errors: [
            `Row ${rowIndex}: duplicate external_ref "${result.value.externalRef}" — superseded by a later row in this file`,
          ],
        });
      }
      continue;
    }

    validCustomers.push(result.value);
    if (inSample) {
      sample.push({
        rowIndex,
        ok: true,
        name: result.value.name,
        externalRef: result.value.externalRef,
      });
    }
  }

  return {
    ok: true,
    plan: { totalRows: rows.length, validCustomers, invalidCount, skippedInFileCount, sample },
  };
}

/**
 * Chunked `external_ref` membership check, scoped to the org. Shared by
 * previewImport (wouldCreate/wouldUpdate) and commitImport (created/updated)
 * — literally the same query, re-run inside commit because the flow is
 * deliberately stateless (spec §5).
 */
async function fetchExistingRefs(
  database: Db,
  orgId: number,
  refs: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < refs.length; i += MEMBERSHIP_CHUNK) {
    const chunk = refs.slice(i, i + MEMBERSHIP_CHUNK);
    const rows = await database
      .select({ externalRef: customers.externalRef })
      .from(customers)
      .where(and(eq(customers.orgId, orgId), inArray(customers.externalRef, chunk)));
    for (const r of rows) {
      if (r.externalRef !== null) existing.add(r.externalRef);
    }
  }
  return existing;
}

/**
 * Chunked batch UPSERT on the `(org_id, external_ref)` partial-unique index.
 * Every row here has a guaranteed non-empty externalRef (mapRow's
 * required-field check), so the partial index's predicate always matches —
 * `targetWhere` tells Postgres which (partial) unique index to use as the
 * conflict inference target; without it PG can't match a plain
 * `(org_id, external_ref)` target against a WHERE-qualified index. Verified
 * empirically against pglite (drizzle-orm 0.45.2 renders
 * `on conflict ("org_id","external_ref") where "customers"."external_ref"
 * is not null do update ...`, which pglite/Postgres accepts as matching the
 * migration's identically-predicated index).
 *
 * SET list is name/business_name/email/phone/address/first_seen_at/
 * updated_at — NOT created_at, NOT org_id (spec §5). Every field is
 * overwritten unconditionally from `excluded.*` (including to NULL), so
 * re-importing an edited source file always converges to exactly what's in
 * the file — no partial-merge semantics to reason about.
 */
async function upsertCustomers(
  database: Db,
  orgId: number,
  items: ImportCustomer[],
): Promise<void> {
  for (let i = 0; i < items.length; i += UPSERT_CHUNK) {
    const chunk = items.slice(i, i + UPSERT_CHUNK);
    await database
      .insert(customers)
      .values(
        chunk.map((c) => ({
          orgId,
          externalRef: c.externalRef,
          name: c.name,
          businessName: c.businessName ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          address: c.address ?? null,
          firstSeenAt: c.firstSeenAt ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [customers.orgId, customers.externalRef],
        targetWhere: isNotNull(customers.externalRef),
        set: {
          name: sql`excluded.name`,
          businessName: sql`excluded.business_name`,
          email: sql`excluded.email`,
          phone: sql`excluded.phone`,
          address: sql`excluded.address`,
          firstSeenAt: sql`excluded.first_seen_at`,
          updatedAt: new Date(),
        },
      });
  }
}

/** Shared catch-block error mapping — mirrors src/lib/customers/actions.ts
 * `run()` exactly (ForbiddenError -> "Forbidden", unique-constraint ->
 * friendly message, everything else -> logged + Sentry-captured, opaque
 * "Server error"). Structurally assignable to either action's `ok: false`
 * arm, so no generics needed at the call sites. */
function mapActionError(e: unknown, action: string): { ok: false; error: string } {
  if (e instanceof ForbiddenError) {
    return { ok: false, error: "Forbidden" };
  }
  const friendly = mapDbConstraintError(e);
  if (friendly !== null) {
    return { ok: false, error: friendly };
  }
  const safe = safeErrShape(e);
  // Constant format string + structured extras — keeps the log format free
  // of caller-controlled substitution patterns (CWE-134), same discipline
  // as src/lib/customers/actions.ts.
  console.error("[customers import action] error", { action, ...safe });
  Sentry.captureException(new Error("customers import action failed"), {
    tags: { layer: "customers-import-action", action },
    extra: safe,
  });
  return { ok: false, error: "Server error" };
}

/**
 * previewImport — parses + maps + dedupes the CSV and computes the
 * create/update split against the caller's org. Writes NOTHING; safe to
 * call repeatedly (e.g. re-preview after editing the source file).
 */
export async function previewImport(raw: unknown): Promise<ImportPreview> {
  if (isDemoMode()) {
    return { ok: false, error: "Demo mode — changes are disabled" };
  }
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = importInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }

  const built = buildImportPlan(parsed.data.csvText);
  if (!built.ok) return { ok: false, error: built.error };
  const { plan } = built;

  try {
    const refs = plan.validCustomers.map((c) => c.externalRef);
    const existing = await fetchExistingRefs(db(), orgId, refs);
    const wouldUpdate = plan.validCustomers.filter((c) => existing.has(c.externalRef)).length;
    return {
      ok: true,
      totalRows: plan.totalRows,
      validCount: plan.validCustomers.length,
      invalidCount: plan.invalidCount,
      wouldCreate: plan.validCustomers.length - wouldUpdate,
      wouldUpdate,
      sample: plan.sample,
    };
  } catch (e) {
    return mapActionError(e, "previewImport");
  }
}

/**
 * commitImport — re-parses the same csvText (stateless — spec §8 decision
 * 2), UPSERTs every valid deduped row, records ONE summary audit event, and
 * revalidates /customers. Re-running the same file is idempotent by
 * construction: the UPSERT's conflict target IS the idempotency key.
 */
export async function commitImport(raw: unknown): Promise<ImportCommitResult> {
  if (isDemoMode()) {
    return { ok: false, error: "Demo mode — changes are disabled" };
  }
  let orgId: number;
  let actor: string;
  try {
    const session = await requireSession();
    orgId = session.orgId;
    actor = session.user;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = importInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }

  const built = buildImportPlan(parsed.data.csvText);
  if (!built.ok) return { ok: false, error: built.error };
  const { plan } = built;

  try {
    const refs = plan.validCustomers.map((c) => c.externalRef);
    const existing = await fetchExistingRefs(db(), orgId, refs);
    const updated = plan.validCustomers.filter((c) => existing.has(c.externalRef)).length;
    const created = plan.validCustomers.length - updated;
    const skipped = plan.invalidCount + plan.skippedInFileCount;

    await upsertCustomers(db(), orgId, plan.validCustomers);

    // ONE summary event per commit — entityType "org", never per-row (would
    // spam the feed and fire the watcher chokepoint N times). Payload is
    // counts only; no names/emails in the audit trail (spec §5 PII rule).
    await recordActivitySafely(
      db(),
      {
        orgId,
        actor,
        entityType: "org",
        entityId: orgId,
        verb: "imported",
        summary: `Imported ${created + updated} customers (${created} new, ${updated} updated) from WinJewel CSV`,
        payload: { totalRows: plan.totalRows, created, updated, skipped },
      },
      { action: "customers.import" },
    );

    revalidatePath("/customers");
    return { ok: true, created, updated, skipped };
  } catch (e) {
    return mapActionError(e, "commitImport");
  }
}
