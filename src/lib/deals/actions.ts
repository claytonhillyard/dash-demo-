"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { deals, dealMessages, circleMembers, orgs } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { isOrgMemberOfCircle } from "@/lib/circles/membership";
import {
  postDealInput, updateDealStatusInput, firstZodError,
  type PostDealInput, type UpdateDealStatusInput,
} from "./validation";
import {
  postDealMessageInput, setDealThreadModeInput, deleteDealMessageInput, markDealThreadReadInput,
  type PostDealMessageInput, type SetDealThreadModeInput,
  type DeleteDealMessageInput, type MarkDealThreadReadInput,
} from "./replyValidation";

/** Thrown inside a postDeal callback when the session's org is not a member
 *  of the requested visibility circle. Caught by runWithUser's catch and
 *  converted to { ok: false, error: "Forbidden" } with zero DB writes.
 *  Kept local to deals/actions.ts for slice 4 — promote to src/lib/auth/errors.ts
 *  if another action needs the same semantics. */
class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

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
    if (e instanceof ForbiddenError) {
      // Audit-friendly log of the rejection; the warn already happened
      // inside the callback for full context (org + user + circle).
      return { ok: false, error: "Forbidden" };
    }
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

export async function postDeal(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealInput, raw, async (input: PostDealInput, user, orgId) => {
    // Slice 4: if the caller wants the deal shared into a circle, the session's
    // org must actually be a member of that circle. Check runs against
    // session.orgId (never the wire) BEFORE the insert, so a rejected post
    // writes zero rows.
    if (input.visibilityCircleId !== undefined && input.visibilityCircleId !== null) {
      const allowed = await isOrgMemberOfCircle(db(), orgId, input.visibilityCircleId);
      if (!allowed) {
        console.warn(
          `[deals] forbidden post attempt by org=${orgId} user=${user}: ` +
          `not a member of circle=${input.visibilityCircleId}`
        );
        throw new ForbiddenError("Forbidden");
      }
    }
    await db().insert(deals).values({
      orgId,
      kind: input.kind,
      category: input.category,
      subject: input.subject,
      quantity: input.quantity,
      priceCents: input.priceCents,
      currency: input.currency,
      visibilityCircleId: input.visibilityCircleId ?? null,
      threadMode: input.threadMode,
      postedByLabel: user,
    });
    console.log(
      `[deals] posted deal kind=${input.kind} category=${input.category} ` +
      `by=${user} org=${orgId} visibility=${input.visibilityCircleId ?? "private"}`
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

// ---------------------------------------------------------------------------
// Slice 10: Deal reply threads
// ---------------------------------------------------------------------------

async function resolveOrgLabel(d: Db, orgId: number): Promise<string> {
  const [row] = await d.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  return row?.name ?? `Org ${orgId}`;
}

/** Returns true iff `orgId` is the deal owner OR an in-circle member when the
 *  deal is circle-scoped. Slice-4 predicate, re-encoded here for the message
 *  action so we never widen visibility in TS. */
async function canSeeDeal(d: Db, orgId: number, dealId: number): Promise<
  | { ok: true; ownerOrgId: number; threadMode: "private" | "group" }
  | { ok: false }
> {
  const [row] = await d
    .select({
      ownerOrgId: deals.orgId,
      visibilityCircleId: deals.visibilityCircleId,
      threadMode: deals.threadMode,
    })
    .from(deals)
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!row) return { ok: false };
  if (row.ownerOrgId === orgId) return { ok: true, ownerOrgId: row.ownerOrgId, threadMode: row.threadMode };
  if (row.visibilityCircleId !== null) {
    const [member] = await d
      .select({ orgId: circleMembers.orgId })
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, row.visibilityCircleId), eq(circleMembers.orgId, orgId)))
      .limit(1);
    if (member) return { ok: true, ownerOrgId: row.ownerOrgId, threadMode: row.threadMode };
  }
  return { ok: false };
}

export async function postDealMessage(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealMessageInput, raw, async (input: PostDealMessageInput, _user, orgId) => {
    const d = db();
    const access = await canSeeDeal(d, orgId, input.dealId);
    if (!access.ok) throw new ForbiddenError();
    // TODO(slice-10 review): plan's B2 code block omits this slice-10
    // thread-mode-aware authz check (only enforces slice-4 visibility via
    // canSeeDeal). User prompt's instruction #2 requires it: in 'private'
    // mode, only the owner may post — even an in-circle member is rejected.
    // Without this, a circle member could post in a private thread as soon
    // as the owner shares the deal into a circle. Adding the explicit check.
    if (access.ownerOrgId !== orgId && access.threadMode === "private") {
      throw new ForbiddenError();
    }
    const label = await resolveOrgLabel(d, orgId);
    await d.insert(dealMessages).values({
      dealId: input.dealId,
      fromOrgId: orgId,
      fromOrgLabel: label,
      body: input.body,
      threadMode: access.threadMode,  // snapshot at send time — IMMUTABLE for the life of this row
    });
  });
}

export async function setDealThreadMode(raw: unknown): Promise<ActionResult> {
  return runWithUser(setDealThreadModeInput, raw, async (input: SetDealThreadModeInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({ ownerOrgId: deals.orgId })
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!row || row.ownerOrgId !== orgId) throw new ForbiddenError();
    await d.update(deals).set({ threadMode: input.mode }).where(eq(deals.id, input.dealId));
  });
}

const SOFT_DELETE_WINDOW_MS = 15 * 60 * 1000;

export async function deleteDealMessage(raw: unknown): Promise<ActionResult> {
  return runWithUser(deleteDealMessageInput, raw, async (input: DeleteDealMessageInput, _user, orgId) => {
    const d = db();
    const [msg] = await d
      .select({
        fromOrgId: dealMessages.fromOrgId,
        createdAt: dealMessages.createdAt,
        deletedAt: dealMessages.deletedAt,
      })
      .from(dealMessages)
      .where(eq(dealMessages.id, input.messageId))
      .limit(1);
    if (!msg) throw new ForbiddenError();
    if (msg.fromOrgId !== orgId) throw new ForbiddenError();
    if (msg.deletedAt !== null) return; // idempotent no-op
    const ageMs = Date.now() - msg.createdAt.getTime();
    if (ageMs > SOFT_DELETE_WINDOW_MS) throw new ForbiddenError();
    await d
      .update(dealMessages)
      .set({ deletedAt: new Date() })
      .where(eq(dealMessages.id, input.messageId));
  });
}

export async function markDealThreadRead(raw: unknown): Promise<ActionResult> {
  return runWithUser(markDealThreadReadInput, raw, async (input: MarkDealThreadReadInput, _user, orgId) => {
    const d = db();
    const access = await canSeeDeal(d, orgId, input.dealId);
    if (!access.ok) throw new ForbiddenError();
    await d.execute(drizzleSql`
      INSERT INTO deal_thread_reads (org_id, deal_id, last_read_at)
      VALUES (${orgId}, ${input.dealId}, now())
      ON CONFLICT (org_id, deal_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
    `);
  });
}
