import { describe, it, expect } from "vitest";
import {
  websiteSnapshotInput,
  websiteSnapshotUpdateInput,
} from "@/lib/website/validation";

const VALID = {
  weekStart: "2026-05-25",
  visitors: 5000,
  uniqueVisitors: 3500,
  pageViews: 18000,
  avgSessionDurationSeconds: 210,
  bounceRatePercent: 42,
};

describe("websiteSnapshotInput — pass cases", () => {
  it("accepts a fully-populated valid row", () => {
    expect(websiteSnapshotInput.safeParse(VALID).success).toBe(true);
  });

  it("accepts 0 on every count field (no traffic week)", () => {
    expect(websiteSnapshotInput.safeParse({
      ...VALID,
      visitors: 0, uniqueVisitors: 0, pageViews: 0,
      avgSessionDurationSeconds: 0, bounceRatePercent: 0,
    }).success).toBe(true);
  });

  it("accepts bounceRatePercent at the upper boundary (100)", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, bounceRatePercent: 100 }).success).toBe(true);
  });

  it("accepts an arbitrary Wednesday weekStart (spec §2.3 — NOT Monday-only)", () => {
    // 2026-05-27 was a Wednesday. The spec is explicit that the validator
    // must NOT add a Monday-only check. This is the regression guard.
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "2026-05-27" }).success).toBe(true);
  });

  it("accepts an arbitrary Saturday weekStart (US Sat→Sun analytics convention)", () => {
    // 2026-05-30 was a Saturday.
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "2026-05-30" }).success).toBe(true);
  });
});

describe("websiteSnapshotInput — fail cases", () => {
  it("rejects negative visitors", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, visitors: -1 }).success).toBe(false);
  });

  it("rejects negative uniqueVisitors", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, uniqueVisitors: -1 }).success).toBe(false);
  });

  it("rejects negative pageViews", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, pageViews: -1 }).success).toBe(false);
  });

  it("rejects negative avgSessionDurationSeconds", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, avgSessionDurationSeconds: -1 }).success).toBe(false);
  });

  it("rejects bounceRatePercent < 0", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, bounceRatePercent: -1 }).success).toBe(false);
  });

  it("rejects bounceRatePercent > 100", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, bounceRatePercent: 101 }).success).toBe(false);
  });

  it("rejects non-integer counts (Zod .int())", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, visitors: 5000.5 }).success).toBe(false);
  });

  it("rejects weekStart with single-digit month", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "2026-5-25" }).success).toBe(false);
  });

  it("rejects weekStart with slashes", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "2026/05/25" }).success).toBe(false);
  });

  it("rejects weekStart as a human-readable date", () => {
    expect(websiteSnapshotInput.safeParse({ ...VALID, weekStart: "May 25, 2026" }).success).toBe(false);
  });
});

describe("websiteSnapshotInput — slice-3 invariant: no orgId field", () => {
  it("websiteSnapshotInput has no orgId in its shape", () => {
    // Zod object shape inspection — equivalent to the PR-review grep on
    // grep -rn "orgId" src/lib/website/validation.ts → 0 matches.
    const shape = websiteSnapshotInput.shape as Record<string, unknown>;
    expect("orgId" in shape).toBe(false);
  });

  it("strips an orgId-shaped junk field from the parsed output", () => {
    const result = websiteSnapshotInput.safeParse({ ...VALID, orgId: 999 } as never);
    expect(result.success).toBe(true);
    if (result.success) expect("orgId" in result.data).toBe(false);
  });
});

describe("websiteSnapshotUpdateInput", () => {
  it("requires a positive integer id", () => {
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: 1 }).success).toBe(true);
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: 0 }).success).toBe(false);
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: -1 }).success).toBe(false);
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: 1.5 }).success).toBe(false);
  });

  it("inherits every websiteSnapshotInput constraint", () => {
    expect(websiteSnapshotUpdateInput.safeParse({ ...VALID, id: 1, bounceRatePercent: 101 }).success).toBe(false);
  });

  it("has no orgId in its shape (slice-3 invariant)", () => {
    const shape = websiteSnapshotUpdateInput.shape as Record<string, unknown>;
    expect("orgId" in shape).toBe(false);
  });
});
