import { describe, it, expect } from "vitest";
import { stripOrgId } from "@/lib/observability/stripOrgId";

describe("stripOrgId — shallow + one-level-deep", () => {
  it("returns undefined for undefined input (no throw)", () => {
    expect(stripOrgId(undefined)).toBeUndefined();
  });

  it("returns the object unchanged when there is no orgId field", () => {
    const obj = { otherField: "x", count: 3 };
    const out = stripOrgId(obj);
    expect(out).toEqual({ otherField: "x", count: 3 });
  });

  it("strips a shallow orgId field", () => {
    const out = stripOrgId({ orgId: 7, otherField: "x" });
    expect(out).toEqual({ otherField: "x" });
    expect("orgId" in out!).toBe(false);
  });

  it("strips an orgId field one level deep inside a nested object", () => {
    const out = stripOrgId({
      request: { orgId: 7, url: "/foo" },
      keep: "y",
    });
    expect(out).toEqual({
      request: { url: "/foo" },
      keep: "y",
    });
  });

  it("leaves arrays untouched (we do not recurse into arrays)", () => {
    const out = stripOrgId({ list: [{ orgId: 7, name: "a" }], keep: "y" });
    // Array contents preserved verbatim — the strip is documented as shallow +
    // one-level-deep on objects only. Acceptable trade-off; the PR review grep
    // is the belt-and-braces enforcement for intentional usages.
    expect(out).toEqual({ list: [{ orgId: 7, name: "a" }], keep: "y" });
  });

  it("ignores primitive values at the top level", () => {
    const out = stripOrgId({ count: 3, label: "x", flag: true });
    expect(out).toEqual({ count: 3, label: "x", flag: true });
  });
});
