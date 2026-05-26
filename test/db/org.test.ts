// @vitest-environment node
import { describe, it, expect } from "vitest";
import { AIYA_ORG_ID, currentOrgId } from "@/db/org";

describe("org seam", () => {
  it("defaults the current org to AIYA (1)", () => {
    expect(AIYA_ORG_ID).toBe(1);
    expect(currentOrgId()).toBe(1);
  });
});
