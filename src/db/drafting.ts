import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { draftingPrefs } from "@/db/schema";
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
