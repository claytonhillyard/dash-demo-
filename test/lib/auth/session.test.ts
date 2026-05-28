// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { createSession, verifySession } from "@/lib/auth/session";

const SECRET = "test-secret-test-secret-test-secret";
const ALG = "HS256";
const enc = (s: string) => new TextEncoder().encode(s);

describe("session", () => {
  it("round-trips a valid token with user + orgId", async () => {
    const token = await createSession("boss", 1, SECRET);
    expect(await verifySession(token, SECRET)).toEqual({ user: "boss", orgId: 1 });
  });

  it("round-trips a non-AIYA orgId (proof orgId is not hardcoded)", async () => {
    const token = await createSession("alice", 42, SECRET);
    expect(await verifySession(token, SECRET)).toEqual({ user: "alice", orgId: 42 });
  });

  it("rejects a tampered token", async () => {
    const token = await createSession("boss", 1, SECRET);
    expect(await verifySession(token + "x", SECRET)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const token = await createSession("boss", 1, SECRET);
    expect(await verifySession(token, "another-secret-another-secret")).toBeNull();
  });

  it("rejects a token missing orgId (back-compat: pre-slice-3 token)", async () => {
    const legacy = await new SignJWT({ user: "boss" })
      .setProtectedHeader({ alg: ALG })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(enc(SECRET));
    expect(await verifySession(legacy, SECRET)).toBeNull();
  });

  it("rejects a token whose orgId is a string", async () => {
    const bad = await new SignJWT({ user: "boss", orgId: "1" })
      .setProtectedHeader({ alg: ALG })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(enc(SECRET));
    expect(await verifySession(bad, SECRET)).toBeNull();
  });

  it("rejects a token whose orgId is zero or negative", async () => {
    for (const orgId of [0, -1, -999]) {
      const bad = await new SignJWT({ user: "boss", orgId })
        .setProtectedHeader({ alg: ALG })
        .setIssuedAt()
        .setExpirationTime("12h")
        .sign(enc(SECRET));
      expect(await verifySession(bad, SECRET)).toBeNull();
    }
  });

  it("rejects a token whose orgId is non-integer", async () => {
    const bad = await new SignJWT({ user: "boss", orgId: 1.5 })
      .setProtectedHeader({ alg: ALG })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(enc(SECRET));
    expect(await verifySession(bad, SECRET)).toBeNull();
  });

  it("rejects a token whose payload has been edited but signature reused (JWT tampering)", async () => {
    // Sign a real token for org 1, then surgically rewrite the payload to claim org 999
    // while keeping the original header+signature. jose must reject the HS256 mismatch.
    const real = await createSession("boss", 1, SECRET);
    const [headerB64, payloadB64, sigB64] = real.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    decoded.orgId = 999;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url")
      .replace(/=+$/, "");
    const tampered = `${headerB64}.${tamperedPayload}.${sigB64}`;
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });
});
