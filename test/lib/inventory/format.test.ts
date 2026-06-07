import { describe, it, expect } from "vitest";
import { formatInventoryVisibility } from "@/lib/inventory/format";

describe("formatInventoryVisibility", () => {
  it("returns kind: 'private' for null", () => {
    expect(formatInventoryVisibility(null, new Map())).toEqual({ kind: "private" });
  });

  it("returns kind: 'circle' with the circle name when the id is in the map", () => {
    const map = new Map([[7, "Trusted Partners"]]);
    expect(formatInventoryVisibility(7, map)).toEqual({
      kind: "circle",
      circleName: "Trusted Partners",
    });
  });

  it("foreign-id fallback: returns kind: 'private' for an id not in the map", () => {
    // Defense in depth: a future bug in the query path that returns a row
    // with a visibilityCircleId the viewer can't see must NOT surface the
    // raw id or render a name leak — the formatter says 'private'.
    expect(formatInventoryVisibility(999, new Map())).toEqual({ kind: "private" });
  });
});
