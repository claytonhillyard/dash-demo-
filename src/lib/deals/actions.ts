"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { deals } from "@/db/schema";
import { AIYA_ORG_ID } from "@/db/org";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import {
  postDealInput, updateDealStatusInput, firstZodError,
  type PostDealInput, type UpdateDealStatusInput,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

// test seam — inject an isolated pglite db (mirrors inventory + diamonds pattern)
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> { testDb = db; }
function db(): Db { return testDb ?? getDb(); }

/** Demo-guard, session re-assert, validate, run, revalidate; never throw to UI. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T) => Promise<void>
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  try {
    await requireSession();
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data);
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

/** Same as run() but resolves the session first and threads `session.user`
 *  into the mutation, so postDeal can stamp postedByLabel without a second
 *  requireSession() call. */
async function runWithUser<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, user: string) => Promise<void>
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let user: string;
  try {
    const session = await requireSession();
    user = session.user;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, user);
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

export async function postDeal(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealInput, raw, async (input: PostDealInput, user) => {
    // NOTE: plan called for `.returning({ id: deals.id })` to log the inserted
    // id, but TypeScript can't narrow `.returning()` across the neon-http +
    // pglite Db union (TS2554: "Expected 0 arguments, but got 1"). No existing
    // call site in the repo uses `.returning()` on the shared Db. Since the id
    // is only used for an info log (no test asserts it), drop the chained
    // `.returning()` to keep `tsc --noEmit` clean.
    await db().insert(deals).values({
      orgId: AIYA_ORG_ID,
      kind: input.kind,
      category: input.category,
      subject: input.subject,
      quantity: input.quantity,
      priceCents: input.priceCents,
      currency: input.currency,
      postedByLabel: user,
    });
    console.log(
      `[deals] posted deal kind=${input.kind} category=${input.category} by=${user}`
    );
  });
}

async function updateStatus(input: UpdateDealStatusInput): Promise<void> {
  await db()
    .update(deals)
    .set({ status: input.status, updatedAt: new Date() })
    .where(and(eq(deals.id, input.id), eq(deals.orgId, AIYA_ORG_ID)));
  console.log(`[deals] deal id=${input.id} status changed to ${input.status}`);
}

export async function markDealFilled(id: number): Promise<ActionResult> {
  return run(updateDealStatusInput, { id, status: "Filled" }, updateStatus);
}

export async function withdrawDeal(id: number): Promise<ActionResult> {
  return run(updateDealStatusInput, { id, status: "Withdrawn" }, async (input) => {
    await updateStatus(input);
    console.log(`[deals] deal id=${input.id} withdrawn`);
  });
}
