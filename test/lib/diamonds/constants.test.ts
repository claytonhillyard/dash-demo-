import { describe, it, expect } from "vitest";
import {
  DIAMOND_COLORS, DIAMOND_CLARITIES, CARAT_BANDS, BENCHMARK, SHEETS, SHAPES,
} from "@/lib/diamonds/constants";

describe("diamond constants", () => {
  it("defines the grading scales and a benchmark cell", () => {
    expect(DIAMOND_COLORS).toContain("D");
    expect(DIAMOND_COLORS).toContain("Z");
    expect(DIAMOND_CLARITIES[0]).toBe("IF");
    expect(DIAMOND_CLARITIES).toContain("I3");
    expect(CARAT_BANDS).toContain("1.00-1.49");
    expect(SHEETS).toEqual(["natural", "lab"]);
    expect(SHAPES).toEqual(["round", "fancy"]);
    expect(BENCHMARK).toEqual({ shape: "round", color: "G", clarity: "VS1", caratBand: "1.00-1.49" });
  });
});
