"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import {
  revenueMonths,
  revenueTransactions,
  profitMonths,
  clients,
  employees,
  projectionAssumptions,
} from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import {
  revenueMonthInput,
  revenueTransactionInput,
  profitMonthInput,
  clientInput,
  employeeInput,
  projectionInput,
  firstZodError,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

// --- test seam: allow tests to inject an isolated pglite db ---
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Shared wrapper: re-assert session, validate, run, revalidate, never throw to the UI. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T) => Promise<void>
): Promise<ActionResult> {
  // Demo-mode short-circuit BEFORE any session/DB/Sentry work. Matches the
  // pattern in inventory/diamonds/deals/website action wrappers — keeps demo
  // errors out of the production Sentry project and prevents seeded-data
  // mutations. (Slice-11 review finding #3.)
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
    return { ok: true };
  } catch (e) {
    // Never leak DB internals (schema/constraint/column detail) to the client.
    // Log the real error server-side; return a generic message to the UI.
    console.error("[company action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "company-action" } });
    return { ok: false, error: "Database error" };
  }
}

export async function saveRevenueMonth(raw: unknown): Promise<ActionResult> {
  return run(revenueMonthInput, raw, async (input) => {
    await db()
      .insert(revenueMonths)
      .values({ year: input.year, month: input.month, amountCents: input.amountCents })
      .onConflictDoUpdate({
        target: [revenueMonths.year, revenueMonths.month],
        set: { amountCents: input.amountCents, updatedAt: new Date() },
      });
  });
}

export async function addRevenueTransaction(raw: unknown): Promise<ActionResult> {
  return run(revenueTransactionInput, raw, async (input) => {
    await db().insert(revenueTransactions).values({
      occurredOn: input.occurredOn,
      amountCents: input.amountCents,
      memo: input.memo ?? null,
    });
  });
}

export async function deleteRevenueTransaction(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid) => {
    await db().delete(revenueTransactions).where(eq(revenueTransactions.id, rid));
  });
}

export async function saveProfitMonth(raw: unknown): Promise<ActionResult> {
  return run(profitMonthInput, raw, async (input) => {
    await db()
      .insert(profitMonths)
      .values({ year: input.year, month: input.month, amountCents: input.amountCents })
      .onConflictDoUpdate({
        target: [profitMonths.year, profitMonths.month],
        set: { amountCents: input.amountCents, updatedAt: new Date() },
      });
  });
}

export async function createClient(raw: unknown): Promise<ActionResult> {
  return run(clientInput, raw, async (input) => {
    await db().insert(clients).values({
      name: input.name,
      status: input.status,
      valueCents: input.valueCents,
      acquiredOn: input.acquiredOn,
    });
  });
}

const clientUpdateInput = clientInput.extend({ id: z.number().int() });

export async function updateClient(raw: unknown): Promise<ActionResult> {
  return run(clientUpdateInput, raw, async (input) => {
    await db()
      .update(clients)
      .set({
        name: input.name,
        status: input.status,
        valueCents: input.valueCents,
        acquiredOn: input.acquiredOn,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, input.id));
  });
}

export async function deleteClient(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid) => {
    await db().delete(clients).where(eq(clients.id, rid));
  });
}

export async function createEmployee(raw: unknown): Promise<ActionResult> {
  return run(employeeInput, raw, async (input) => {
    await db().insert(employees).values({
      name: input.name,
      role: input.role,
      hiredOn: input.hiredOn,
    });
  });
}

export async function deleteEmployee(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid) => {
    await db().delete(employees).where(eq(employees.id, rid));
  });
}

export async function saveProjection(raw: unknown): Promise<ActionResult> {
  return run(projectionInput, raw, async (input) => {
    const existing = await db()
      .select({ id: projectionAssumptions.id })
      .from(projectionAssumptions)
      .orderBy(desc(projectionAssumptions.updatedAt))
      .limit(1);
    if (existing.length) {
      await db()
        .update(projectionAssumptions)
        .set({
          baseYear: input.baseYear,
          baseRevenueCents: input.baseRevenueCents,
          cagrPct: input.cagrPct,
          perYearOverrides: input.perYearOverrides,
          updatedAt: new Date(),
        })
        .where(eq(projectionAssumptions.id, existing[0].id));
    } else {
      await db().insert(projectionAssumptions).values({
        baseYear: input.baseYear,
        baseRevenueCents: input.baseRevenueCents,
        cagrPct: input.cagrPct,
        perYearOverrides: input.perYearOverrides,
      });
    }
  });
}
