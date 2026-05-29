import { describe, it, expect } from "vitest";
import { formatDealVisibility } from "@/lib/deals/format";

describe("formatDealVisibility", () => {
  it("returns kind=private for a null visibilityCircleId", () => {
    expect(formatDealVisibility(null, new Map())).toEqual({ kind: "private" });
  });

  it("returns kind=circle with the matching name when the id is in the map", () => {
    const map = new Map([[7, "Trusted Partners"]]);
    expect(formatDealVisibility(7, map)).toEqual({
      kind: "circle",
      circleName: "Trusted Partners",
    });
  });

  it("returns kind=private for an unknown id (name-leak guard)", () => {
    // The widened query only returns rows whose visibilityCircleId is in
    // the viewer's circle ids. If a bug ever surfaces a foreign id, the
    // helper must NOT render the name — it returns "private" so the badge
    // silently disappears rather than leaking a circle name the viewer
    // shouldn't know.
    const map = new Map([[1, "Mine"]]);
    expect(formatDealVisibility(99, map)).toEqual({ kind: "private" });
  });
});
