import { describe, it, expect } from "vitest";
import {
  createCircleInput,
  inviteOrgToCircleInput,
  tokenInput,
  removeOrgFromCircleInput,
  leaveCircleInput,
} from "@/lib/circles/validation";

describe("createCircleInput", () => {
  it("accepts a valid name + slug", () => {
    const r = createCircleInput.safeParse({ name: "AIYA Trusted Partners", slug: "aiya-trusted-partners" });
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(createCircleInput.safeParse({ name: "", slug: "x" }).success).toBe(false);
  });

  it("rejects slug with uppercase or spaces", () => {
    expect(createCircleInput.safeParse({ name: "x", slug: "AIYA" }).success).toBe(false);
    expect(createCircleInput.safeParse({ name: "x", slug: "ai ya" }).success).toBe(false);
    expect(createCircleInput.safeParse({ name: "x", slug: "ai_ya" }).success).toBe(false);
  });

  it("strips unknown fields (no orgId leak)", () => {
    const r = createCircleInput.safeParse({ name: "x", slug: "x", orgId: 999, ownerOrgId: 999 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect("orgId" in r.data).toBe(false);
      expect("ownerOrgId" in r.data).toBe(false);
    }
  });
});

describe("inviteOrgToCircleInput", () => {
  it("accepts a valid pair", () => {
    expect(inviteOrgToCircleInput.safeParse({ circleId: 1, toOrgSlug: "alpha" }).success).toBe(true);
  });

  it("rejects circleId <= 0", () => {
    expect(inviteOrgToCircleInput.safeParse({ circleId: 0, toOrgSlug: "alpha" }).success).toBe(false);
    expect(inviteOrgToCircleInput.safeParse({ circleId: -1, toOrgSlug: "alpha" }).success).toBe(false);
  });

  it("rejects invalid slug shape", () => {
    expect(inviteOrgToCircleInput.safeParse({ circleId: 1, toOrgSlug: "Alpha" }).success).toBe(false);
    expect(inviteOrgToCircleInput.safeParse({ circleId: 1, toOrgSlug: "" }).success).toBe(false);
  });

  it("strips fromOrgId from the wire", () => {
    const r = inviteOrgToCircleInput.safeParse({ circleId: 1, toOrgSlug: "x", fromOrgId: 999 });
    expect(r.success).toBe(true);
    if (r.success) expect("fromOrgId" in r.data).toBe(false);
  });
});

describe("tokenInput", () => {
  it("accepts a UUID-shaped token", () => {
    expect(tokenInput.safeParse({ token: "550e8400-e29b-41d4-a716-446655440000" }).success).toBe(true);
  });

  it("rejects empty / short tokens", () => {
    expect(tokenInput.safeParse({ token: "" }).success).toBe(false);
    expect(tokenInput.safeParse({ token: "short" }).success).toBe(false);
  });
});

describe("removeOrgFromCircleInput", () => {
  it("accepts (circleId, orgId)", () => {
    expect(removeOrgFromCircleInput.safeParse({ circleId: 1, orgId: 2 }).success).toBe(true);
  });

  it("rejects non-positive ids", () => {
    expect(removeOrgFromCircleInput.safeParse({ circleId: 0, orgId: 1 }).success).toBe(false);
    expect(removeOrgFromCircleInput.safeParse({ circleId: 1, orgId: 0 }).success).toBe(false);
  });
});

describe("leaveCircleInput", () => {
  it("accepts circleId only", () => {
    expect(leaveCircleInput.safeParse({ circleId: 1 }).success).toBe(true);
  });

  it("strips any orgId attempt", () => {
    const r = leaveCircleInput.safeParse({ circleId: 1, orgId: 999 });
    expect(r.success).toBe(true);
    if (r.success) expect("orgId" in r.data).toBe(false);
  });
});
