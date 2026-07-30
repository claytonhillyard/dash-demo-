"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { draftingPrefs, customers } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import { firstZodError } from "@/lib/company/validation";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import { safeErrShape, mapDbConstraintError } from "@/lib/actionErrors";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Test seam — see test/lib/drafting/actions.test.ts. Production paths read
// the live Neon/pglite via getDb(). Identical pattern to
// src/lib/payments/actions.ts / src/lib/invoices/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

// ---------------------------------------------------------------------------
// Validation (spec §6) — kept file-local/unexported (only the inferred
// *types* below are exported — erased at compile time, so they don't trip
// the "use server" export-must-be-async-function rule), same convention as
// src/lib/payments/actions.ts.
// ---------------------------------------------------------------------------

const saveDraftingPrefsInput = z.object({
  tone: z.string().trim().max(500).optional(),
  signature: z.string().trim().max(200).optional(),
});
export type SaveDraftingPrefsInput = z.infer<typeof saveDraftingPrefsInput>;

const saveCustomerStyleNoteInput = z.object({
  customerId: z.number().int().positive(),
  styleNote: z.string().trim().max(300),
});
export type SaveCustomerStyleNoteInput = z.infer<typeof saveCustomerStyleNoteInput>;

// ---------------------------------------------------------------------------
// Shared helpers — copied from src/lib/payments/actions.ts's run()/
// FriendlyError (which itself copies src/lib/invoices/actions.ts) — house
// convention: mirror the sibling file's scaffold rather than extract a
// shared module (that refactor is chip territory, not this slice).
// ---------------------------------------------------------------------------

/** Thrown inside a `run()` callback to surface a short, user-facing message
 *  that is neither an authz reject (`ForbiddenError` -> "Forbidden") nor an
 *  opaque, Sentry-captured failure ("Server error"). Neither action in
 *  slice 37-1 actually throws it — saveDraftingPrefs is a pure upsert, and
 *  saveCustomerStyleNote's only failure mode is the atomic cross-org
 *  Forbidden check — but slice 37-2 extends this same file with
 *  `sendDraft`, which needs its own wording for "no email on file for this
 *  customer" (mirrors sendInvoice's identical guard). Scaffolded now so
 *  the `run()` catch chain below doesn't change shape between 37-1 and
 *  37-2. Local to this file, not shared, same as every other action
 *  module in this codebase.
 */
class FriendlyError extends Error {}

/**
 * Shared wrapper: demo guard, session re-assert + orgId resolve, validate,
 * run the callback, revalidate, catch chain. Never throws to the UI —
 * every failure is mapped to { ok: false, error }. Copied from
 * src/lib/payments/actions.ts `run()`, with one deliberate adaptation:
 * payments/invoices hardcode an unconditional `revalidatePath("/invoices")`
 * because every action in those files concerns one shared list page. This
 * module has no such shared home — saveDraftingPrefs is org-level (no page
 * of its own yet) and saveCustomerStyleNote is per-customer — so revalidation
 * is entirely opt-in via `revalidate`, called with whatever path(s) each
 * action names (possibly none).
 *
 * Layered error mapping:
 *   ForbiddenError      → "Forbidden"   (deliberate authz reject inside fn)
 *   FriendlyError        → e.message    (reserved for slice 37-2's sendDraft)
 *   constraint violation → mapDbConstraintError's friendly string
 *   anything else       → "Server error" (Sentry-captured, opaque to UI)
 */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number, actor: string) => Promise<void>,
  opts: { action: string; revalidate?: (input: T) => string[] },
): Promise<ActionResult> {
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
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  try {
    await fn(parsed.data, orgId, actor);
    if (opts.revalidate) {
      for (const p of opts.revalidate(parsed.data)) revalidatePath(p);
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    if (e instanceof FriendlyError) {
      return { ok: false, error: e.message };
    }
    const friendly = mapDbConstraintError(e);
    if (friendly !== null) {
      return { ok: false, error: friendly };
    }
    const safe = safeErrShape(e);
    // Constant format string + structured extras — keeps the log format
    // free of caller-controlled substitution patterns (CWE-134).
    console.error("[drafting action] error", { action: opts.action, ...safe });
    Sentry.captureException(new Error("drafting action failed"), {
      tags: { layer: "drafting-action", action: opts.action },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}

// ---------------------------------------------------------------------------
// saveDraftingPrefs
// ---------------------------------------------------------------------------

/**
 * saveDraftingPrefs — org-level upsert (spec §6): one row per org via
 * `onConflictDoUpdate` on the `drafting_prefs_org_unique` index, so saving
 * twice updates the same row rather than erroring or duplicating (a plain
 * single-column `target` — verified against the Db union type; no
 * `.returning()` is chained, so the parameterized-overload fights seen
 * elsewhere in this codebase with `.returning({...})` never come up here).
 * Blank/omitted fields store as NULL, not empty string — a blank tone means
 * "no preference set". Audit payload is deliberately `{}`: the tone/
 * signature text is free-form voice configuration, kept out of the audit
 * log the same way invoice notes and customer notes never appear in theirs.
 */
export async function saveDraftingPrefs(raw: unknown): Promise<ActionResult> {
  return run(
    saveDraftingPrefsInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();
      const tone = input.tone || null;
      const signature = input.signature || null;

      await d
        .insert(draftingPrefs)
        .values({ orgId, tone, signature })
        .onConflictDoUpdate({
          target: draftingPrefs.orgId,
          set: { tone, signature, updatedAt: new Date() },
        });

      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "org",
          entityId: orgId,
          verb: "updated",
          summary: "Updated email drafting preferences",
          payload: {},
        },
        { action: "drafting.savePrefs" },
      );
    },
    { action: "saveDraftingPrefs" },
  );
}

// ---------------------------------------------------------------------------
// saveCustomerStyleNote
// ---------------------------------------------------------------------------

/**
 * saveCustomerStyleNote — org-scoped UPDATE on customers (spec §6). Same
 * atomic-WHERE pattern as `updateCustomer` (src/lib/customers/actions.ts):
 * zero rows updated means the id doesn't exist OR belongs to another org,
 * and the caller can't tell which — both collapse to Forbidden. Blank
 * input clears the note to NULL rather than storing `""`. Audit payload is
 * `{}` — the note itself is free-form per-customer voice text, kept out of
 * the audit trail the same way drafting prefs and invoice notes are.
 */
export async function saveCustomerStyleNote(raw: unknown): Promise<ActionResult> {
  return run(
    saveCustomerStyleNoteInput,
    raw,
    async (input, orgId, actor) => {
      const d = db();
      const styleNote = input.styleNote || null;

      // Zero-arg returning() (RETURNING *) — the Db union type only surfaces
      // the parameterless overload (same workaround as updateCustomer /
      // deletePayment elsewhere in this codebase).
      const res = await d
        .update(customers)
        .set({ styleNote, updatedAt: new Date() })
        .where(and(eq(customers.id, input.customerId), eq(customers.orgId, orgId)))
        .returning();
      if (res.length === 0) throw new ForbiddenError();
      const updated = res[0]!;

      await recordActivitySafely(
        d,
        {
          orgId,
          actor,
          entityType: "customer",
          entityId: input.customerId,
          verb: "updated",
          summary: `Updated style note for ${updated.name}`,
          payload: {},
        },
        { action: "drafting.saveCustomerStyleNote" },
      );
    },
    {
      action: "saveCustomerStyleNote",
      revalidate: (input) => [`/customers/${input.customerId}/edit`],
    },
  );
}
