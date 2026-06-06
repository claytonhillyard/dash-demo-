"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql as drizzleSql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { deals, dealMessages, circleMembers, orgs, bids, dealAttachments } from "@/db/schema";
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
import {
  postBidInput, acceptBidInput, rejectBidInput, withdrawBidInput, setDealBidModeInput,
  type PostBidInput, type AcceptBidInput, type RejectBidInput,
  type WithdrawBidInput, type SetDealBidModeInput,
} from "./bidValidation";
import {
  uploadAttachmentMetaInput,
  deleteAttachmentInput,
  type DeleteAttachmentInput,
} from "./attachmentValidation";
import { detectKindFromBytes } from "./attachmentMime";
import { getBlobStore } from "@/lib/storage/blobStore";
import { countAttachmentsByKind } from "@/db/dealAttachments";

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
    Sentry.captureException(e, { tags: { layer: "deals-action" } });
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
    Sentry.captureException(e, { tags: { layer: "deals-action" } });
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
 *  action so we never widen visibility in TS.
 *
 *  ⚠ VISIBILITY PREDICATE — mirrored in 2 other places.
 *  If you change the outer rule here (owner OR in-circle), update:
 *    - src/db/dealMessages.ts → getDealMessages WHERE clause
 *    - src/db/dealMessages.ts → getUnreadCountsForOrg WHERE clause
 *  All three must agree. Divergence is a silent visibility hole. */
async function canSeeDeal(d: Db, orgId: number, dealId: number): Promise<
  | { ok: true; ownerOrgId: number; threadMode: "private" | "group"; bidMode: "single" | "history" }
  | { ok: false }
> {
  const [row] = await d
    .select({
      ownerOrgId: deals.orgId,
      visibilityCircleId: deals.visibilityCircleId,
      threadMode: deals.threadMode,
      bidMode: deals.bidMode,
    })
    .from(deals)
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!row) return { ok: false };
  if (row.ownerOrgId === orgId)
    return { ok: true, ownerOrgId: row.ownerOrgId, threadMode: row.threadMode, bidMode: row.bidMode };
  if (row.visibilityCircleId !== null) {
    const [member] = await d
      .select({ orgId: circleMembers.orgId })
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, row.visibilityCircleId), eq(circleMembers.orgId, orgId)))
      .limit(1);
    if (member)
      return { ok: true, ownerOrgId: row.ownerOrgId, threadMode: row.threadMode, bidMode: row.bidMode };
  }
  return { ok: false };
}

export async function postDealMessage(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealMessageInput, raw, async (input: PostDealMessageInput, _user, orgId) => {
    const d = db();
    const access = await canSeeDeal(d, orgId, input.dealId);
    if (!access.ok) throw new ForbiddenError();
    // Per spec §4: in private mode each interested partner has a 1-to-1
    // thread WITH the deal owner. So in-circle partners CAN post; the
    // message gets snapshotted as `private` and getDealMessages' WHERE
    // clause then restricts the row's visibility to {owner, sender}.
    // (A previous review added an owner-only gate here; that broke the
    // partner→owner DM feature. Removed.)
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
    // Defense-in-depth: the UPDATE re-asserts orgId in the WHERE clause so a
    // theoretical race between SELECT and UPDATE can never write to a deal
    // that doesn't belong to the caller. Matches slice-3 inventory/actions.ts
    // pattern (see updateInventoryItem). Costs nothing.
    await d
      .update(deals)
      .set({ threadMode: input.mode })
      .where(and(eq(deals.id, input.dealId), eq(deals.orgId, orgId)));
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
    // Defensive cast: pglite and Neon both *should* round-trip timestamptz as
    // a JS Date, but the Db union has surprised us before (see Phase A's
    // identical defense in src/db/dealMessages.ts row-mapper). Without this,
    // any future shape drift would throw TypeError inside runWithUser and
    // become an opaque "Database error" instead of a clean window-check fail.
    const createdAtMs =
      msg.createdAt instanceof Date
        ? msg.createdAt.getTime()
        : new Date(msg.createdAt as unknown as string).getTime();
    const ageMs = Date.now() - createdAtMs;
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

// ---------------------------------------------------------------------------
// Slice 16: Bids
// ---------------------------------------------------------------------------

/** Slice-16 write-side gate: can the caller bid on this deal?
 *  Returns the deal's owner + bid_mode snapshot for the insert.
 *
 *  ⚠ Mirrors getBidsForDeal's bidder|owner SQL visibility, with the
 *  added "no self-bidding" rule. If you change visibility in either
 *  place, change both. */
async function canBidOn(d: Db, orgId: number, dealId: number): Promise<
  { ok: true; ownerOrgId: number; bidMode: "single" | "history" } | { ok: false }
> {
  const seen = await canSeeDeal(d, orgId, dealId);
  if (!seen.ok) return { ok: false };
  if (seen.ownerOrgId === orgId) return { ok: false }; // no self-bidding
  // canSeeDeal already SELECTs deals.bid_mode in its single read — no second round-trip.
  return { ok: true, ownerOrgId: seen.ownerOrgId, bidMode: seen.bidMode };
}

export async function postBid(raw: unknown): Promise<ActionResult> {
  return runWithUser(postBidInput, raw, async (input: PostBidInput, _user, orgId) => {
    const d = db();
    const access = await canBidOn(d, orgId, input.dealId);
    if (!access.ok) throw new ForbiddenError();
    const label = await resolveOrgLabel(d, orgId);
    await d.insert(bids).values({
      dealId: input.dealId,
      bidderOrgId: orgId,
      bidderOrgLabel: label,
      priceCents: input.priceCents,
      currency: input.currency,
      notes: input.notes ?? null,
      bidMode: access.bidMode,
    });
  });
}

export async function acceptBid(raw: unknown): Promise<ActionResult> {
  return runWithUser(acceptBidInput, raw, async (input: AcceptBidInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidId: bids.id,
        bidStatus: bids.status,
        dealId: bids.dealId,
        dealOwnerOrgId: deals.orgId,
        dealStatus: deals.status,
      })
      .from(bids)
      .innerJoin(deals, eq(deals.id, bids.dealId))
      .where(eq(bids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError();
    if (row.dealOwnerOrgId !== orgId) throw new ForbiddenError();
    if (row.dealStatus !== "Open") throw new ForbiddenError();
    if (row.bidStatus !== "pending") throw new ForbiddenError();

    const now = new Date();
    await d.transaction(async (tx) => {
      await tx
        .update(bids)
        .set({ status: "accepted", decidedAt: now })
        .where(and(eq(bids.id, input.bidId), eq(bids.status, "pending")));
      await tx
        .update(bids)
        .set({ status: "auto_rejected", decidedAt: now })
        .where(and(eq(bids.dealId, row.dealId), eq(bids.status, "pending"), ne(bids.id, input.bidId)));
      await tx
        .update(deals)
        .set({ status: "Filled", updatedAt: now })
        .where(and(eq(deals.id, row.dealId), eq(deals.orgId, orgId)));
    });
  });
}

export async function rejectBid(raw: unknown): Promise<ActionResult> {
  return runWithUser(rejectBidInput, raw, async (input: RejectBidInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidStatus: bids.status,
        dealOwnerOrgId: deals.orgId,
      })
      .from(bids)
      .innerJoin(deals, eq(deals.id, bids.dealId))
      .where(eq(bids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError();
    if (row.dealOwnerOrgId !== orgId) throw new ForbiddenError();
    if (row.bidStatus !== "pending") throw new ForbiddenError();
    await d
      .update(bids)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(and(eq(bids.id, input.bidId), eq(bids.status, "pending")));
  });
}

export async function withdrawBid(raw: unknown): Promise<ActionResult> {
  return runWithUser(withdrawBidInput, raw, async (input: WithdrawBidInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidderOrgId: bids.bidderOrgId,
        status: bids.status,
      })
      .from(bids)
      .where(eq(bids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError();
    if (row.bidderOrgId !== orgId) throw new ForbiddenError();
    if (row.status === "withdrawn") return; // idempotent
    if (row.status !== "pending") throw new ForbiddenError();
    await d
      .update(bids)
      .set({ status: "withdrawn", decidedAt: new Date() })
      .where(and(eq(bids.id, input.bidId), eq(bids.bidderOrgId, orgId)));
  });
}

export async function setDealBidMode(raw: unknown): Promise<ActionResult> {
  return runWithUser(setDealBidModeInput, raw, async (input: SetDealBidModeInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({ ownerOrgId: deals.orgId })
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .limit(1);
    if (!row || row.ownerOrgId !== orgId) throw new ForbiddenError();
    await d
      .update(deals)
      .set({ bidMode: input.mode })
      .where(and(eq(deals.id, input.dealId), eq(deals.orgId, orgId)));
  });
}

// ---------------------------------------------------------------------------
// Slice 17: Deal attachments (photos + certs)
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGES_PER_DEAL = 8;
const MAX_CERTS_PER_DEAL = 4;

/** Server action: multipart upload of a single image or cert.
 *  Cannot use runWithUser's Zod-on-JSON contract because the body is
 *  FormData with a binary file. Inlines session + Zod-on-fields + the
 *  same "demo guard, error mapping" contract from runWithUser. */
export async function uploadDealAttachment(formData: FormData): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };

  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  // Field parsing — FormData values are string | File. Coerce into the Zod shape.
  const dealIdRaw = formData.get("dealId");
  const kindRaw = formData.get("kind");
  const fileRaw = formData.get("file");
  const altTextRaw = formData.get("altText");

  const meta = uploadAttachmentMetaInput.safeParse({
    dealId: typeof dealIdRaw === "string" ? Number(dealIdRaw) : undefined,
    kind: typeof kindRaw === "string" ? kindRaw : undefined,
    altText: typeof altTextRaw === "string" && altTextRaw !== "" ? altTextRaw : undefined,
  });
  if (!meta.success) return { ok: false, error: firstZodError(meta.error) };

  if (!(fileRaw instanceof Blob)) {
    return { ok: false, error: "Missing file" };
  }

  // Owner-only authz — in-circle partners get READ-only access to attachments.
  const d = db();
  const [deal] = await d
    .select({ ownerOrgId: deals.orgId })
    .from(deals)
    .where(eq(deals.id, meta.data.dealId))
    .limit(1);
  if (!deal || deal.ownerOrgId !== orgId) return { ok: false, error: "Forbidden" };

  // Size cap
  if (fileRaw.size > MAX_FILE_BYTES) return { ok: false, error: "Forbidden" };

  // MIME magic-byte validation (never trust Content-Type header from request)
  const head = new Uint8Array(await fileRaw.slice(0, 12).arrayBuffer());
  const detected = detectKindFromBytes(head);
  if (!detected || detected.kind !== meta.data.kind) {
    return { ok: false, error: "Forbidden" };
  }

  // Per-deal kind cap
  const counts = await countAttachmentsByKind(d, meta.data.dealId);
  if (meta.data.kind === "image" && counts.image >= MAX_IMAGES_PER_DEAL) {
    return { ok: false, error: "Forbidden" };
  }
  if (meta.data.kind === "cert" && counts.cert >= MAX_CERTS_PER_DEAL) {
    return { ok: false, error: "Forbidden" };
  }

  // Compose storage key. UUID prevents same-name collisions across uploads;
  // extension is derived from the detected MIME (not the filename).
  const ext = detected.mime === "image/jpeg" ? "jpg"
    : detected.mime === "image/png" ? "png"
    : detected.mime === "image/webp" ? "webp"
    : "pdf";
  const storageKey = `org/${orgId}/deal/${meta.data.dealId}/${meta.data.kind}/${crypto.randomUUID()}.${ext}`;

  // Read full bytes for the upload
  const bytes = new Uint8Array(await fileRaw.arrayBuffer());

  // Blob first, then DB. If DB throws, delete the blob — no orphans.
  const store = getBlobStore();

  // Storage write: a Netlify Blobs network failure / 5xx surfaces here.
  // Without this catch the exception bypasses the action's {ok,error} contract
  // and hits Next.js as an opaque 500 — and Sentry never tags it with
  // layer="deals-action". Matches the slice-11 capture convention.
  try {
    await store.set(storageKey, bytes);
  } catch (e) {
    console.error("[deals action] blob set failed", { storageKey, error: e });
    Sentry.captureException(e, {
      tags: { layer: "deals-action", subsystem: "blob-store" },
      extra: { storageKey },
    });
    return { ok: false, error: "Upload failed" };
  }

  try {
    await d.insert(dealAttachments).values({
      dealId: meta.data.dealId,
      uploadedByOrgId: orgId,
      kind: meta.data.kind,
      storageKey,
      mimeType: detected.mime,
      sizeBytes: bytes.byteLength,
      altText: meta.data.altText ?? null,
    });
  } catch (e) {
    let rollbackOk = true;
    try {
      await store.delete(storageKey);
    } catch (rollbackErr) {
      rollbackOk = false;
      // Orphan blob: log + Sentry-capture so a future GC sweep has the key.
      console.warn("[deals action] orphan blob rollback failed", {
        storageKey, error: rollbackErr,
      });
      Sentry.captureException(rollbackErr, {
        tags: { layer: "deals-action", subsystem: "blob-store-rollback" },
        extra: { storageKey },
      });
    }
    console.error("[deals action] upload db insert failed", {
      storageKey, rollbackOk, error: e,
    });
    Sentry.captureException(e, {
      tags: { layer: "deals-action" },
      extra: { storageKey, rollbackOk },
    });
    return { ok: false, error: "Database error" };
  }

  revalidatePath("/");
  revalidatePath("/deals");
  return { ok: true };
}

/** Server action: owner-only delete of a single attachment.
 *  Uses runWithUser (JSON input, ForbiddenError → "Forbidden"). Delete order
 *  is reversed from upload: blob FIRST, then DB row. If the blob delete
 *  fails, we leave the DB row in place so a future reconciliation sweep
 *  can find it — better orphan-blob than orphan-DB-row pointing at a
 *  nonexistent blob. */
export async function deleteDealAttachment(raw: unknown): Promise<ActionResult> {
  return runWithUser(deleteAttachmentInput, raw, async (input: DeleteAttachmentInput, _user, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        attachmentId: dealAttachments.id,
        storageKey: dealAttachments.storageKey,
        dealOwnerOrgId: deals.orgId,
      })
      .from(dealAttachments)
      .innerJoin(deals, eq(deals.id, dealAttachments.dealId))
      .where(eq(dealAttachments.id, input.attachmentId))
      .limit(1);
    if (!row) throw new ForbiddenError();
    if (row.dealOwnerOrgId !== orgId) throw new ForbiddenError();

    // Delete blob FIRST. If blob delete fails, the DB row stays and a future
    // GC sweep can reconcile. Better orphan-blob than orphan-DB-row pointing
    // at a nonexistent blob.
    const store = getBlobStore();
    try {
      await store.delete(row.storageKey);
    } catch (e) {
      console.error("[deals action] blob delete failed for", row.storageKey, e);
      throw e;
    }
    // Defense-in-depth: WHERE pins the row's uploaded_by_org_id so a race
    // between SELECT and DELETE cannot remove a row that doesn't belong to
    // the caller. The owner check above (dealOwnerOrgId === orgId) already
    // gates this; the extra WHERE clause is belt-and-suspenders.
    await d
      .delete(dealAttachments)
      .where(and(
        eq(dealAttachments.id, input.attachmentId),
        eq(dealAttachments.uploadedByOrgId, orgId),
      ));
  });
}
