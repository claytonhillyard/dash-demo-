"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { diamondMatrixPrices, diamondPricePoints, diamondIndexHistory } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { BENCHMARK } from "@/lib/diamonds/constants";
import { parseMatrixCsv } from "@/lib/diamonds/csv";
import { isDemoMode } from "@/lib/demo/mode";
import {
  matrixCellInput, pricePointInput, pricePointUpdateInput, importInput, firstZodError,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };
type ImportResult = { ok: true; imported: number } | { ok: false; error: string };

let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> { testDb = db; }
function db(): Db { return testDb ?? getDb(); }

/** Append a snapshot of the natural/lab benchmark indices to history for `orgId`. */
async function snapshotIndices(d: Db, orgId: number): Promise<void> {
  for (const [sheet, series] of [["natural", "natural_index"], ["lab", "lab_index"]] as const) {
    const rows = await d
      .select({ cents: diamondMatrixPrices.pricePerCaratCents })
      .from(diamondMatrixPrices)
      .where(and(
        eq(diamondMatrixPrices.orgId, orgId), eq(diamondMatrixPrices.sheet, sheet),
        eq(diamondMatrixPrices.shape, BENCHMARK.shape), eq(diamondMatrixPrices.color, BENCHMARK.color),
        eq(diamondMatrixPrices.clarity, BENCHMARK.clarity), eq(diamondMatrixPrices.caratBand, BENCHMARK.caratBand)
      ))
      .limit(1);
    if (rows[0]) {
      await d.insert(diamondIndexHistory).values({ orgId, series, valueCents: rows[0].cents });
    }
  }
}

export async function importMatrix(raw: unknown): Promise<ImportResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsedInput = importInput.safeParse(raw);
  if (!parsedInput.success) return { ok: false, error: firstZodError(parsedInput.error) };
  const { sheet, shape, csv } = parsedInput.data;
  const parsed = parseMatrixCsv(csv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  try {
    const d = db();
    // Atomic replace: delete the old sheet/shape cells and insert the new ones
    // inside one transaction, so an infra failure mid-insert can't leave the
    // sheet/shape with no pricing. Both drivers (pglite + neon-http) support a
    // transaction over statements whose values are known upfront (no reads
    // inside). The index snapshot is append-only and runs after, outside the tx.
    await d.transaction(async (tx) => {
      await tx.delete(diamondMatrixPrices).where(and(
        eq(diamondMatrixPrices.orgId, orgId),
        eq(diamondMatrixPrices.sheet, sheet),
        eq(diamondMatrixPrices.shape, shape)
      ));
      await tx.insert(diamondMatrixPrices).values(
        parsed.rows.map((r) => ({
          orgId, sheet, shape,
          color: r.color, clarity: r.clarity, caratBand: r.caratBand,
          pricePerCaratCents: r.pricePerCaratCents,
        }))
      );
    });
    await snapshotIndices(d, orgId);
    revalidatePath("/");
    revalidatePath("/diamonds");
    return { ok: true, imported: parsed.rows.length };
  } catch (e) {
    console.error("[diamond import] database error:", e);
    Sentry.captureException(e, { tags: { layer: "diamonds-action" } });
    return { ok: false, error: "Database error" };
  }
}

async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<void>,
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
    revalidatePath("/diamonds");
    return { ok: true };
  } catch (e) {
    console.error("[diamond action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "diamonds-action" } });
    return { ok: false, error: "Database error" };
  }
}

export async function upsertMatrixCell(raw: unknown): Promise<ActionResult> {
  return run(matrixCellInput, raw, async (input, orgId) => {
    await db().insert(diamondMatrixPrices).values({ orgId, ...input })
      .onConflictDoUpdate({
        target: [
          diamondMatrixPrices.orgId, diamondMatrixPrices.sheet, diamondMatrixPrices.shape,
          diamondMatrixPrices.color, diamondMatrixPrices.clarity, diamondMatrixPrices.caratBand,
        ],
        set: { pricePerCaratCents: input.pricePerCaratCents, updatedAt: new Date() },
      });
    await snapshotIndices(db(), orgId);
  });
}

export async function savePricePoint(raw: unknown): Promise<ActionResult> {
  const isUpdate = typeof (raw as { id?: unknown })?.id === "number";
  if (isUpdate) {
    return run(pricePointUpdateInput, raw, async (input, orgId) => {
      await db().update(diamondPricePoints)
        .set({ label: input.label, kind: input.kind, pricePerCaratCents: input.pricePerCaratCents, updatedAt: new Date() })
        .where(and(eq(diamondPricePoints.id, input.id), eq(diamondPricePoints.orgId, orgId)));
    });
  }
  return run(pricePointInput, raw, async (input, orgId) => {
    await db().insert(diamondPricePoints).values({ orgId, ...input });
  });
}

export async function deletePricePoint(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid, orgId) => {
    await db().delete(diamondPricePoints)
      .where(and(eq(diamondPricePoints.id, rid), eq(diamondPricePoints.orgId, orgId)));
  });
}
