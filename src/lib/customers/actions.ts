"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { customers } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { ForbiddenError } from "@/lib/auth/errors";
import { firstZodError } from "@/lib/company/validation";
import {
  createCustomerInput,
  updateCustomerInput,
  deleteCustomerInput,
  type CreateCustomerInput,
  type UpdateCustomerInput,
  type DeleteCustomerInput,
} from "./validation";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
import { safeErrShape, mapDbConstraintError } from "@/lib/actionErrors";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Test seam — see test/lib/customers/actions.test.ts. Production paths read
// the live Neon/pglite via getDb(). Identical pattern to src/lib/deals/actions.ts.
let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> {
  testDb = d;
}
function db(): Db {
  return testDb ?? getDb();
}

/**
 * Shared wrapper: demo guard, session re-assert + orgId resolve, validate,
 * run the callback, revalidate /customers. Never throws to the UI — every
 * failure is mapped to { ok: false, error }. Mirrors src/lib/deals/actions.ts
 * `runWithUser` modulo the per-action revalidate paths (see runWith opts).
 *
 * Layered error mapping:
 *   ForbiddenError      → "Forbidden"   (deliberate authz reject inside fn)
 *   anything else       → "Server error" (Sentry-captured, opaque to UI)
 */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number, actor: string) => Promise<void>,
  opts: { action: string; extraRevalidate?: (input: T) => string[] },
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
    revalidatePath("/customers");
    if (opts.extraRevalidate) {
      for (const p of opts.extraRevalidate(parsed.data)) revalidatePath(p);
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    const friendly = mapDbConstraintError(e);
    if (friendly !== null) {
      return { ok: false, error: friendly };
    }
    const safe = safeErrShape(e);
    // Constant format string + structured extras — keeps the log format
    // free of caller-controlled substitution patterns (CWE-134).
    console.error("[customers action] error", { action: opts.action, ...safe });
    Sentry.captureException(new Error("customers action failed"), {
      tags: { layer: "customers-action", action: opts.action },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}

/**
 * createCustomer — org_id is set from the session, never from the wire,
 * so there's no cross-org-create surface even if the client lies about its
 * org. Returns the new row's id on success so the form can route to it.
 */
export async function createCustomer(
  raw: unknown,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
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
  const parsed = createCustomerInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  const input: CreateCustomerInput = parsed.data;
  try {
    // Drizzle TS overloads here only resolve cleanly with no-arg .returning();
    // same workaround used by src/lib/circles/actions.ts and
    // src/lib/website/actions.ts. We only need the id off the row.
    const [row] = await db()
      .insert(customers)
      .values({
        orgId,
        name: input.name,
        businessName: input.businessName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        // externalRef + first_seen_at stay NULL on direct creates; slice 26
        // (WinJewel import) is the only writer for those columns and uses
        // (org_id, external_ref) as its UPSERT idempotency key.
      })
      .returning();
    await recordActivitySafely(
      db(),
      {
        orgId,
        actor,
        entityType: "customer",
        entityId: row.id,
        verb: "created",
        summary: `Added ${row.name}`,
        payload: {
          name: row.name,
          businessName: row.businessName ?? null,
          email: row.email ?? null,
        },
      },
      { action: "customers.create" },
    );
    revalidatePath("/customers");
    return { ok: true, id: row.id };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    const friendly = mapDbConstraintError(e);
    if (friendly !== null) {
      return { ok: false, error: friendly };
    }
    const safe = safeErrShape(e);
    console.error("[customers action] createCustomer error:", safe);
    Sentry.captureException(new Error("createCustomer failed"), {
      tags: { layer: "customers-action", action: "createCustomer" },
      extra: safe,
    });
    return { ok: false, error: "Server error" };
  }
}

/**
 * updateCustomer — owner-only with defense-in-depth WHERE. The UPDATE's
 * `WHERE id = $1 AND org_id = $session` means a cross-org id silently
 * writes zero rows; we then throw ForbiddenError so the UI gets a uniform
 * 403 response indistinguishable from "not found". This is the same
 * pattern as slice-3's inventory + diamonds + deals.
 */
export async function updateCustomer(raw: unknown): Promise<ActionResult> {
  return run(
    updateCustomerInput,
    raw,
    async (input: UpdateCustomerInput, orgId, actor) => {
      const res = await db()
        .update(customers)
        .set({
          name: input.name,
          businessName: input.businessName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
          // externalRef intentionally not in .set() — reserved for slice 26.
          updatedAt: new Date(),
        })
        .where(and(eq(customers.id, input.id), eq(customers.orgId, orgId)))
        .returning();
      if (res.length === 0) {
        // 0 rows updated → either the row doesn't exist OR it belongs to a
        // different org. Caller can't distinguish. By design.
        throw new ForbiddenError();
      }
      const updated = res[0]!;
      const changedFields = Object.keys(input).filter((k) => k !== "id");
      await recordActivitySafely(
        db(),
        {
          orgId,
          actor,
          entityType: "customer",
          entityId: input.id,
          verb: "updated",
          summary:
            changedFields.length === 1
              ? `Updated ${updated.name}: ${changedFields[0]}`
              : `Updated ${updated.name}`,
          payload: { changedFields },
        },
        { action: "customers.update" },
      );
    },
    {
      action: "updateCustomer",
      extraRevalidate: (input) => [`/customers/${input.id}`],
    },
  );
}

/**
 * deleteCustomer — owner-only hard delete. WHERE includes the org check so
 * a cross-org id silently affects zero rows; we throw ForbiddenError on a
 * 0-row delete to give the caller a clean 403 instead of a silent no-op.
 */
export async function deleteCustomer(raw: unknown): Promise<ActionResult> {
  return run(
    deleteCustomerInput,
    raw,
    async (input: DeleteCustomerInput, orgId, actor) => {
      const res = await db()
        .delete(customers)
        .where(and(eq(customers.id, input.id), eq(customers.orgId, orgId)))
        .returning();
      if (res.length === 0) {
        throw new ForbiddenError();
      }
      const deleted = res[0]!;
      await recordActivitySafely(
        db(),
        {
          orgId,
          actor,
          entityType: "customer",
          entityId: input.id,
          verb: "deleted",
          summary: `Deleted ${deleted.name}`,
          payload: { name: deleted.name },
        },
        { action: "customers.delete" },
      );
    },
    { action: "deleteCustomer" },
  );
}
