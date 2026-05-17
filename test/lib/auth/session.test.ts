// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createSession, verifySession } from "@/lib/auth/session";

describe("session", () => {
  const secret = "test-secret-test-secret-test-secret";

  it("round-trips a valid token", async () => {
    const token = await createSession("boss", secret);
    expect(await verifySession(token, secret)).toEqual({ user: "boss" });
  });

  it("rejects a tampered token", async () => {
    const token = await createSession("boss", secret);
    expect(await verifySession(token + "x", secret)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const token = await createSession("boss", secret);
    expect(await verifySession(token, "another-secret-another-secret")).toBeNull();
  });
});
