import { describe, it, expect } from "vitest";
import { parseMatrixCsv } from "@/lib/diamonds/csv";

const HEADER = "carat_band,color,clarity,price_per_carat";

describe("parseMatrixCsv", () => {
  it("parses valid rows into cents", () => {
    const r = parseMatrixCsv(`${HEADER}\n1.00-1.49,G,VS1,8000\n1.00-1.49,H,VS2,6500.50`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(2);
      expect(r.rows[0]).toEqual({ caratBand: "1.00-1.49", color: "G", clarity: "VS1", pricePerCaratCents: 800000 });
      expect(r.rows[1].pricePerCaratCents).toBe(650050);
    }
  });
  it("rejects a missing header", () => {
    const r = parseMatrixCsv(`1.00-1.49,G,VS1,8000`);
    expect(r.ok).toBe(false);
  });
  it("rejects a bad grade with the offending line number", () => {
    const r = parseMatrixCsv(`${HEADER}\n1.00-1.49,G,VS1,8000\n1.00-1.49,ZZ,VS1,9000`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/line 3/);
  });
  it("rejects a non-positive or non-numeric price", () => {
    expect(parseMatrixCsv(`${HEADER}\n1.00-1.49,G,VS1,-5`).ok).toBe(false);
    expect(parseMatrixCsv(`${HEADER}\n1.00-1.49,G,VS1,abc`).ok).toBe(false);
  });
});
