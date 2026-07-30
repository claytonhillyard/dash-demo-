import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { draftingPrefs, customers } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";

export type DraftingPrefs = { tone: string | null; signature: string | null };

// Deterministic demo voice (slice 37). Named constants rather than a
// src/lib/demo/seed.ts entry: drafting_prefs is a single org-wide row with
// no per-entity id to key a seed array on, so a couple of local constants
// here are simpler than adding a one-row "table" to the seed module.
const DEMO_DRAFTING_TONE = "Warm, concise, plain language";
const DEMO_DRAFTING_SIGNATURE = "— AIYA Designs";

/**
 * Org-level email drafting voice (tone + signature) — read by the AI
 * drafting context builder (src/lib/drafting/context.ts, slice 37-2) and
 * the customer edit page's voice-prefs section (slice 37-3).
 *
 * Returns `null` when the org has never saved prefs (no row) rather than
 * `{ tone: null, signature: null }` — callers can tell "no prefs saved
 * yet" apart from "prefs saved with both fields deliberately blank",
 * mirroring `getCustomerById`'s null-means-absent convention
 * (src/db/customers.ts).
 *
 * Demo mode short-circuits to a fixed, deterministic voice — same honesty
 * pattern as every other demo branch (slice 22 customers, slice 41
 * investor): the deployed demo has no real prefs row to read, but the
 * drafting panel should still render a populated voice section instead of
 * blank inputs.
 */
export async function getDraftingPrefs(
  db: Db,
  orgId: number,
): Promise<DraftingPrefs | null> {
  if (isDemoMode()) {
    return { tone: DEMO_DRAFTING_TONE, signature: DEMO_DRAFTING_SIGNATURE };
  }

  const [row] = await db
    .select({ tone: draftingPrefs.tone, signature: draftingPrefs.signature })
    .from(draftingPrefs)
    .where(eq(draftingPrefs.orgId, orgId))
    .limit(1);
  return row ?? null;
}

/**
 * One customer's drafting style note (slice 37-3) — read by the customer
 * edit page's voice section (src/app/(admin)/customers/[id]/edit/page.tsx).
 * Deliberately its own tiny reader rather than a new field on `CustomerView`
 * (src/db/customers.ts): that type is shared by the customers list/table,
 * the edit form, AND ~13 demo-seed fixtures across src/lib/demo/seed.ts,
 * none of which need this field — the exact same call `buildDraftingContext`
 * already made for the AI context builder's identical field (see
 * `getDraftingCustomerRow` in src/lib/drafting/context.ts), which reads
 * `style_note` directly rather than routing through `CustomerView` for the
 * same reason.
 *
 * Returns `null` both when the customer doesn't exist/belongs to another org
 * (mirrors `getCustomerById`'s contract) and when no note has been saved —
 * callers that need to distinguish "not found" already checked that via
 * `getCustomerById` earlier in the same request (the edit page does, via
 * `notFound()`), so by the time this is called the row is known to exist.
 *
 * Demo mode always returns null: `DEMO_CUSTOMERS` (src/lib/demo/seed.ts)
 * carries no style_note field — `saveCustomerStyleNote` is demo-guarded, so
 * no demo row could ever have one set — same always-null demo branch as
 * `getDraftingCustomerRow`'s identical field.
 */
export async function getCustomerStyleNote(
  db: Db,
  orgId: number,
  customerId: number,
): Promise<string | null> {
  if (isDemoMode()) {
    return null;
  }

  const [row] = await db
    .select({ styleNote: customers.styleNote })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, orgId)))
    .limit(1);
  return row?.styleNote ?? null;
}
