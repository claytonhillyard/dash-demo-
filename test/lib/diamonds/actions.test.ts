// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss" })),
}));

import { createTestDb, type Db } from "@/db/client";
import { getDiamondSummary } from "@/db/diamonds";
import {
  importMatrix, upsertMatrixCell, savePricePoint, deletePricePoint, __setTestDb,
} from "@/lib/diamonds/actions";
import { diamondPricePoints } from "@/db/schema";

let close: () => Promise<void>;
let db: Db;
beforeEach(async () => {
  vi.clearAllMocks();
  const t = await createTestDb();
  await __setTestDb(t.db);
  db = t.db; close = t.close;
});
afterEach(async () => { await close(); });

const HEADER = "carat_band,color,clarity,price_per_carat";

describe("diamond actions", () => {
  it("imports a CSV that sets the benchmark -> index becomes available", async () => {
    const res = await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,G,VS1,8000` });
    expect(res).toEqual({ ok: true, imported: 1 });
    const s = await getDiamondSummary(db);
    expect(s.naturalIndex?.cents).toBe(800000);
  });

  it("rejects a malformed CSV with no partial writes", async () => {
    const res = await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,ZZ,VS1,8000` });
    expect(res.ok).toBe(false);
    const s = await getDiamondSummary(db);
    expect(s.naturalIndex).toBeNull();
  });

  it("re-import replaces the prior sheet/shape cells", async () => {
    await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,G,VS1,8000` });
    await importMatrix({ sheet: "natural", shape: "round", csv: `${HEADER}\n1.00-1.49,G,VS1,9000` });
    const s = await getDiamondSummary(db);
    expect(s.naturalIndex?.cents).toBe(900000);
  });

  it("upserts a single cell and CRUDs a named point", async () => {
    expect(await upsertMatrixCell({
      sheet: "lab", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 120000,
    })).toEqual({ ok: true });
    expect((await getDiamondSummary(db)).labIndex?.cents).toBe(120000);

    expect(await savePricePoint({ label: "Emerald", kind: "gem", pricePerCaratCents: 50000 })).toEqual({ ok: true });
    const [row] = await db.select({ id: diamondPricePoints.id }).from(diamondPricePoints);
    expect((await getDiamondSummary(db)).points).toHaveLength(1);
    expect(await deletePricePoint(row.id)).toEqual({ ok: true });
    expect((await getDiamondSummary(db)).points).toHaveLength(0);
  });

  it("surfaces unauthorized as a typed error", async () => {
    const { requireSession } = await import("@/lib/auth/requireSession");
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await savePricePoint({ label: "X", kind: "gem", pricePerCaratCents: 1 });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });
});
