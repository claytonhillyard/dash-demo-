"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { deals } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import {
  postDealInput, updateDealStatusInput, firstZodError,
  type PostDealInput, type UpdateDealStatusInput,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> { testDb = db; }
function db(): Db { return testDb ?? getDb(); }

/** Demo-guard, session re-assert + orgId resolve, validate, run, revalidate; never throw to UI. */
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
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

/** Same as run() but also threads `session.user` (for postedByLabel stamping). */
async function runWithUser<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, user: string, orgId: number) => Promise<void>
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let user: string;
  let orgId: number;
  try {
    const session = await requireSession();
    user = session.user;
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, user, orgId);
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

export async function postDeal(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealInput, raw, async (input: PostDealInput, user, orgId) => {
    await db().insert(deals).values({
      orgId,
      kind: input.kind,
      category: input.category,
      subject: input.subject,
      quantity: input.quantity,
      priceCents: input.priceCents,
      currency: input.currency,
      postedByLabel: user,
    });
    console.log(
      `[deals] posted deal kind=${input.kind} category=${input.category} by=${user} org=${orgId}`
    );
  });
}

async function updateStatus(input: UpdateDealStatusInput, orgId: number): Promise<void> {
  await db()
    .update(deals)
    .set({ status: input.status, updatedAt: new Date() })
    .where(and(eq(deals.id, input.id), eq(deals.orgId, orgId)));
  console.log(`[deals] deal id=${input.id} status changed to ${input.status} (org=${orgId})`);
}

export async function markDealFilled(id: number): Promise<ActionResult> {
  return run(updateDealStatusInput, { id, status: "Filled" }, updateStatus);
}

export async function withdrawDeal(id: number): Promise<ActionResult> {
  return run(updateDealStatusInput, { id, status: "Withdrawn" }, async (input, orgId) => {
    await updateStatus(input, orgId);
    console.log(`[deals] deal id=${input.id} withdrawn (org=${orgId})`);
  });
}
