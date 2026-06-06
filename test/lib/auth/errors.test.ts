// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";

describe("ForbiddenError", () => {
  it("is an Error subclass with name = 'ForbiddenError'", () => {
    const e = new ForbiddenError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ForbiddenError");
  });

  it("accepts an optional message", () => {
    const e = new ForbiddenError("custom");
    expect(e.message).toBe("custom");
  });

  it("defaults message to 'Forbidden'", () => {
    expect(new ForbiddenError().message).toBe("Forbidden");
  });
});
