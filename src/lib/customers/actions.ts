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
  fn: (input: T, orgId: number) => Promise<void>,
  opts: { extraRevalidate?: (input: T) => string[] } = {},
): Promise<ActionResult> {
  if (isDemoMode()) {
    return { ok: false, error: "Demo mode — changes are disabled" };
  }
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error) };
  }
  try {
    await fn(parsed.data, orgId);
    revalidatePath("/customers");
    if (opts.extraRevalidate) {
      for (const p of opts.extraRevalidate(parsed.data)) revalidatePath(p);
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    console.error("[customers action] error:", e);
    Sentry.captureException(e, {
      tags: { layer: "customers-action" },
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
  try {
    const session = await requireSession();
    orgId = session.orgId;
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
        externalRef: input.externalRef ?? null,
        // first_seen_at stays NULL on direct creates; slice 26 (WinJewel
        // import) backfills it from the source system's historical date.
      })
      .returning();
    revalidatePath("/customers");
    return { ok: true, id: row.id };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { ok: false, error: "Forbidden" };
    }
    console.error("[customers action] createCustomer error:", e);
    Sentry.captureException(e, {
      tags: { layer: "customers-action", action: "createCustomer" },
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
    async (input: UpdateCustomerInput, orgId) => {
      const res = await db()
        .update(customers)
        .set({
          name: input.name,
          businessName: input.businessName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
          externalRef: input.externalRef ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(customers.id, input.id), eq(customers.orgId, orgId)))
        .returning();
      if (res.length === 0) {
        // 0 rows updated → either the row doesn't exist OR it belongs to a
        // different org. Caller can't distinguish. By design.
        throw new ForbiddenError();
      }
    },
    {
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
  return run(deleteCustomerInput, raw, async (input: DeleteCustomerInput, orgId) => {
    const res = await db()
      .delete(customers)
      .where(and(eq(customers.id, input.id), eq(customers.orgId, orgId)))
      .returning();
    if (res.length === 0) {
      throw new ForbiddenError();
    }
  });
}
