"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { websiteSnapshots } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import {
  websiteSnapshotInput,
  websiteSnapshotUpdateInput,
  firstZodError,
  type WebsiteSnapshotInput,
} from "./validation";

export type ActionResult =
  | { ok: true }
  | { ok: true; duplicate: true } // (orgId, weekStart) already exists
  | { ok: false; error: string };

// Test seam — mirrors src/lib/inventory/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Re-assert session, resolve orgId, validate, run, revalidate; never throw
 *  to the UI. Mirrors src/lib/inventory/actions.ts::run, with the result type
 *  widened so create can return the ON CONFLICT DO NOTHING signal. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<ActionResult>,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    const result = await fn(parsed.data, orgId);
    revalidatePath("/");
    revalidatePath("/website");
    return result;
  } catch (e) {
    console.error("[website action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

function values(input: WebsiteSnapshotInput, orgId: number) {
  return {
    orgId,
    weekStart: input.weekStart,
    visitors: input.visitors,
    uniqueVisitors: input.uniqueVisitors,
    pageViews: input.pageViews,
    avgSessionDurationSeconds: input.avgSessionDurationSeconds,
    bounceRatePercent: input.bounceRatePercent,
  };
}

export async function createWebsiteSnapshot(raw: unknown): Promise<ActionResult> {
  return run(websiteSnapshotInput, raw, async (input, orgId) => {
    // TODO(slice-5 review): plan code used `.returning({ id: websiteSnapshots.id })`,
    // but the Db union (Neon | PGlite) doesn't resolve the overloaded returning
    // signature under tsc — same finding as slice-4 and Phase A query tests.
    // Switched to no-arg returning() (returns all columns; we only read
    // .length to detect the ON CONFLICT DO NOTHING branch). Runtime identical.
    const inserted = await db()
      .insert(websiteSnapshots)
      .values(values(input, orgId))
      .onConflictDoNothing({
        target: [websiteSnapshots.orgId, websiteSnapshots.weekStart],
      })
      .returning();
    if (inserted.length === 0) {
      // Row already exists for (orgId, weekStart). NOT an error from the
      // caller's perspective — the UI gets a clear signal to suggest
      // "edit the existing row" rather than silently no-op'ing.
      return { ok: true, duplicate: true };
    }
    return { ok: true };
  });
}

export async function updateWebsiteSnapshot(raw: unknown): Promise<ActionResult> {
  return run(websiteSnapshotUpdateInput, raw, async (input, orgId) => {
    // CRITICAL: WHERE is `id AND orgId`. Never id alone. Slice-3 invariant.
    await db()
      .update(websiteSnapshots)
      .set({ ...values(input, orgId), updatedAt: new Date() })
      .where(
        and(
          eq(websiteSnapshots.id, input.id),
          eq(websiteSnapshots.orgId, orgId),
        ),
      );
    return { ok: true };
  });
}

export async function deleteWebsiteSnapshot(id: number): Promise<ActionResult> {
  return run(z.number().int().positive(), id, async (rid, orgId) => {
    // CRITICAL: WHERE is `id AND orgId`. Never id alone. Slice-3 invariant.
    await db()
      .delete(websiteSnapshots)
      .where(
        and(
          eq(websiteSnapshots.id, rid),
          eq(websiteSnapshots.orgId, orgId),
        ),
      );
    return { ok: true };
  });
}
