"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { isOrgMemberOfCircle } from "@/lib/circles/membership";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  inventoryItemInput,
  inventoryItemUpdateInput,
  firstZodError,
  type InventoryItemInput,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

// test seam — inject an isolated pglite db (mirrors the company actions pattern)
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Re-assert session, resolve orgId, validate, run, revalidate; never throw to the UI. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<void>
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
    await fn(parsed.data, orgId);
    revalidatePath("/");
    revalidatePath("/inventory");
    revalidatePath("/exchange");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      console.warn(`[inventory] forbidden update by org=${orgId}: ${e.message}`);
      Sentry.captureException(e, { tags: { layer: "inventory-action", reason: "forbidden" } });
      return { ok: false, error: "Forbidden" };
    }
    console.error("[inventory action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "inventory-action" } });
    return { ok: false, error: "Database error" };
  }
}

function baseValues(input: InventoryItemInput, orgId: number) {
  return {
    orgId,
    category: input.category,
    name: input.name,
    sku: input.sku ?? null,
    quantity: input.quantity,
    status: input.status,
    unitCostCents: input.unitCostCents,
    retailPriceCents: input.retailPriceCents,
    metal: input.metal ?? null,
    weightMg: input.weightMg ?? null,
    caratX100: input.caratX100 ?? null,
    cut: input.cut ?? null,
    color: input.color ?? null,
    clarity: input.clarity ?? null,
  };
}

/** For UPDATE: only include visibilityCircleId in the SET clause when the
 *  input explicitly provided a value. Editing qty on a shared row must NOT
 *  silently un-share the item. */
function updateValues(input: InventoryItemInput, orgId: number) {
  const base = baseValues(input, orgId);
  if (!("visibilityCircleId" in input) || input.visibilityCircleId === undefined) return base;
  return { ...base, visibilityCircleId: input.visibilityCircleId ?? null };
}

/** For INSERT: visibilityCircleId is always set (NULL if undefined or null). */
function insertValues(input: InventoryItemInput, orgId: number) {
  return {
    ...baseValues(input, orgId),
    visibilityCircleId: input.visibilityCircleId ?? null,
  };
}

/** Slice 15 membership pre-check. Runs BEFORE any UPDATE/INSERT. The
 *  authoritative orgId is the session's, NEVER the wire. A `null` or
 *  `undefined` visibility is a no-op (un-share or preserve respectively).
 *  Throws ForbiddenError when the session org is not a member of the
 *  requested circle — `run` catches and maps to { ok: false, error: "Forbidden" }. */
async function ensureCanShare(
  orgId: number,
  visibilityCircleId: number | null | undefined,
): Promise<void> {
  if (visibilityCircleId === undefined || visibilityCircleId === null) return;
  const allowed = await isOrgMemberOfCircle(db(), orgId, visibilityCircleId);
  if (!allowed) throw new ForbiddenError("Forbidden");
}

export async function createInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemInput, raw, async (input, orgId) => {
    await ensureCanShare(orgId, input.visibilityCircleId);
    await db().insert(inventoryItems).values(insertValues(input, orgId));
  });
}

export async function updateInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemUpdateInput, raw, async (input, orgId) => {
    await ensureCanShare(orgId, input.visibilityCircleId);
    await db()
      .update(inventoryItems)
      .set({ ...updateValues(input, orgId), updatedAt: new Date() })
      .where(and(eq(inventoryItems.id, input.id), eq(inventoryItems.orgId, orgId)));
  });
}

export async function deleteInventoryItem(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid, orgId) => {
    await db()
      .delete(inventoryItems)
      .where(and(eq(inventoryItems.id, rid), eq(inventoryItems.orgId, orgId)));
  });
}
