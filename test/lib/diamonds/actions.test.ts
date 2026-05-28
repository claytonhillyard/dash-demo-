// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { getDiamondSummary } from "@/db/diamonds";
import {
  importMatrix, upsertMatrixCell, savePricePoint, deletePricePoint, __setTestDb,
} from "@/lib/diamonds/actions";
import { diamondPricePoints } from "@/db/schema";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

const HEADER = "carat_band,color,clarity,price_per_carat";

describe("diamond actions", () => {
  it("imports a CSV that sets the benchmark -> index becomes available", async () => {
    const res = await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,G,VS1,8000` });
    expect(res).toEqual({ ok: true, imported: 1 });
    const s = await getDiamondSummary(db, 1);
    expect(s.naturalIndex?.cents).toBe(800000);
  });

  it("rejects a malformed CSV with no partial writes", async () => {
    const res = await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,ZZ,VS1,8000` });
    expect(res.ok).toBe(false);
    const s = await getDiamondSummary(db, 1);
    expect(s.naturalIndex).toBeNull();
  });

  it("re-import replaces the prior sheet/shape cells", async () => {
    await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,G,VS1,8000` });
    await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,G,VS1,9000` });
    const s = await getDiamondSummary(db, 1);
    expect(s.naturalIndex?.cents).toBe(900000);
  });

  it("upserts a single cell and CRUDs a named point", async () => {
    expect(await upsertMatrixCell({
      sheet: "lab", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 120000,
    })).toEqual({ ok: true });
    expect((await getDiamondSummary(db, 1)).labIndex?.cents).toBe(120000);

    expect(await savePricePoint({ label: "Emerald", kind: "gem", pricePerCaratCents: 50000 })).toEqual({ ok: true });
    const [row] = await db.select({ id: diamondPricePoints.id }).from(diamondPricePoints);
    expect((await getDiamondSummary(db, 1)).points).toHaveLength(1);
    expect(await deletePricePoint(row.id)).toEqual({ ok: true });
    expect((await getDiamondSummary(db, 1)).points).toHaveLength(0);
  });

  it("surfaces unauthorized as a typed error", async () => {
    const { requireSession } = await import("@/lib/auth/requireSession");
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await savePricePoint({ label: "X", kind: "gem", pricePerCaratCents: 1 });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });
});

describe("diamond writes disabled in demo", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("importMatrix and savePricePoint return the disabled error", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(await importMatrix({ sheet: "natural", shape: "round", csv: "x" }))
      .toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(await savePricePoint({ label: "X", kind: "gem", pricePerCaratCents: 1 }))
      .toEqual({ ok: false, error: "Demo mode — changes are disabled" });
  });
});

import { requireSession } from "@/lib/auth/requireSession";
import { diamondMatrixPrices } from "@/db/schema";
import { and, eq } from "drizzle-orm";

describe("diamond cross-org tenancy enforcement", () => {
  it("upsertMatrixCell stamps the row with session.orgId", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 999,
    });
    await upsertMatrixCell({
      sheet: "natural", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 700000,
    });
    const rows = await db.select({ orgId: diamondMatrixPrices.orgId })
      .from(diamondMatrixPrices);
    expect(rows.map((r) => r.orgId)).toContain(999);
    expect(rows.map((r) => r.orgId)).not.toContain(1);
  });

  it("savePricePoint (update branch) cannot mutate another org's row", async () => {
    // Seed an org 999 row.
    await db.insert(diamondPricePoints).values({
      orgId: 999, label: "untouchable", kind: "gem", pricePerCaratCents: 100,
    });
    const [target] = await db.select({ id: diamondPricePoints.id }).from(diamondPricePoints);

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await savePricePoint({
      id: target.id, label: "PWNED", kind: "gem", pricePerCaratCents: 999999,
    });

    const [after] = await db.select({ label: diamondPricePoints.label, cents: diamondPricePoints.pricePerCaratCents })
      .from(diamondPricePoints)
      .where(eq(diamondPricePoints.id, target.id));
    expect(after.label).toBe("untouchable");
    expect(after.cents).toBe(100);
  });

  it("deletePricePoint cannot reach another org's row", async () => {
    await db.insert(diamondPricePoints).values({
      orgId: 999, label: "survivor", kind: "gem", pricePerCaratCents: 100,
    });
    const [target] = await db.select({ id: diamondPricePoints.id }).from(diamondPricePoints);

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await deletePricePoint(target.id);

    const all = await db.select({ id: diamondPricePoints.id }).from(diamondPricePoints);
    expect(all.map((r) => r.id)).toContain(target.id);
  });
});
