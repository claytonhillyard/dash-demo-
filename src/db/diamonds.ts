import { and, eq, asc, desc } from "drizzle-orm";
import type { Db } from "./client";
import { diamondMatrixPrices, diamondPricePoints, diamondIndexHistory } from "./schema";
import { BENCHMARK, type Sheet } from "@/lib/diamonds/constants";
import { isDemoMode } from "@/lib/demo/mode";
import { seedDiamondSummary } from "@/lib/demo/seed";

export interface IndexValue { cents: number; change24hPct: number | null }
export interface NamedPoint { label: string; kind: string; cents: number }
export interface DiamondSummary {
  naturalIndex: IndexValue | null;
  labIndex: IndexValue | null;
  points: NamedPoint[];
  updatedAt: Date | null;
}

async function benchmarkCents(db: Db, orgId: number, sheet: Sheet): Promise<number | null> {
  const rows = await db
    .select({ cents: diamondMatrixPrices.pricePerCaratCents })
    .from(diamondMatrixPrices)
    .where(
      and(
        eq(diamondMatrixPrices.orgId, orgId),
        eq(diamondMatrixPrices.sheet, sheet),
        eq(diamondMatrixPrices.shape, BENCHMARK.shape),
        eq(diamondMatrixPrices.color, BENCHMARK.color),
        eq(diamondMatrixPrices.clarity, BENCHMARK.clarity),
        eq(diamondMatrixPrices.caratBand, BENCHMARK.caratBand)
      )
    )
    .limit(1);
  return rows[0]?.cents ?? null;
}

/** Latest vs most-recent snapshot >= 24h older; null if <2 usable points. */
async function change24hPct(db: Db, orgId: number, series: string): Promise<number | null> {
  const rows = await db
    .select({ valueCents: diamondIndexHistory.valueCents, recordedAt: diamondIndexHistory.recordedAt })
    .from(diamondIndexHistory)
    .where(and(eq(diamondIndexHistory.orgId, orgId), eq(diamondIndexHistory.series, series)))
    .orderBy(desc(diamondIndexHistory.recordedAt));
  if (rows.length < 2) return null;
  const latest = rows[0];
  const cutoff = latest.recordedAt.getTime() - 24 * 3600 * 1000;
  const prior = rows.find((r) => r.recordedAt.getTime() <= cutoff) ?? rows[rows.length - 1];
  if (!prior.valueCents) return null;
  return ((latest.valueCents - prior.valueCents) / prior.valueCents) * 100;
}

async function indexValue(db: Db, orgId: number, sheet: Sheet, series: string): Promise<IndexValue | null> {
  const cents = await benchmarkCents(db, orgId, sheet);
  if (cents == null) return null;
  return { cents, change24hPct: await change24hPct(db, orgId, series) };
}

export async function getDiamondSummary(db: Db, orgId: number): Promise<DiamondSummary> {
  if (isDemoMode()) return seedDiamondSummary();
  const [naturalIndex, labIndex, pointRows] = await Promise.all([
    indexValue(db, orgId, "natural", "natural_index"),
    indexValue(db, orgId, "lab", "lab_index"),
    db
      .select({
        label: diamondPricePoints.label,
        kind: diamondPricePoints.kind,
        cents: diamondPricePoints.pricePerCaratCents,
        updatedAt: diamondPricePoints.updatedAt,
      })
      .from(diamondPricePoints)
      .where(eq(diamondPricePoints.orgId, orgId))
      .orderBy(asc(diamondPricePoints.label)),
  ]);
  const updatedAt = pointRows[0]?.updatedAt ?? null;
  const points = pointRows.map((p) => ({ label: p.label, kind: p.kind, cents: p.cents }));
  return { naturalIndex, labIndex, points, updatedAt };
}

export async function getDiamondTrend(
  db: Db,
  series: string,
  orgId: number,
): Promise<number[]> {
  const rows = await db
    .select({ valueCents: diamondIndexHistory.valueCents })
    .from(diamondIndexHistory)
    .where(and(eq(diamondIndexHistory.orgId, orgId), eq(diamondIndexHistory.series, series)))
    .orderBy(asc(diamondIndexHistory.recordedAt));
  return rows.map((r) => r.valueCents);
}
