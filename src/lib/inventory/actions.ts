"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
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
    return { ok: true };
  } catch (e) {
    console.error("[inventory action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

function values(input: InventoryItemInput, orgId: number) {
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

export async function createInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemInput, raw, async (input, orgId) => {
    await db().insert(inventoryItems).values(values(input, orgId));
  });
}

export async function updateInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemUpdateInput, raw, async (input, orgId) => {
    await db()
      .update(inventoryItems)
      .set({ ...values(input, orgId), updatedAt: new Date() })
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
