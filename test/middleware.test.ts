// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { SignJWT } from "jose";
import { config } from "@/middleware";
import { middleware } from "@/middleware";
import { createSession } from "@/lib/auth/session";

// Translate a Next.js middleware matcher string into a RegExp the same way
// Next does (the `:path*` segment is path-to-regexp syntax).
function matcherToRegExp(pattern: string): RegExp {
  const source =
    "^" +
    pattern
      .replace(/\/:path\*/g, "(?:/.*)?")
      .replace(/\/:path\+/g, "/.+") +
    "$";
  return new RegExp(source); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
}

function isMatched(pathname: string): boolean {
  return (config.matcher as string[]).some((p) => matcherToRegExp(p).test(pathname));
}

describe("middleware matcher", () => {
  it("guards the dashboard root and quotes API (slice-0/slice-1)", () => {
    expect(isMatched("/")).toBe(true);
    expect(isMatched("/api/quotes")).toBe(true);
  });

  it("guards the convert and history data APIs (slice-1a)", () => {
    expect(isMatched("/api/convert")).toBe(true);
    expect(isMatched("/api/history")).toBe(true);
  });

  it("guards the inventory admin route (slice-1b-1)", () => {
    expect(isMatched("/inventory")).toBe(true);
  });

  it("guards every /company admin route (slice-2)", () => {
    for (const route of [
      "/company/clients",
      "/company/revenue",
      "/company/profit",
      "/company/employees",
      "/company/projections",
    ]) {
      expect(isMatched(route)).toBe(true);
    }
  });

  it("guards the diamonds admin + history API (slice-1b-3)", () => {
    expect(isMatched("/diamonds")).toBe(true);
    expect(isMatched("/api/diamond-history")).toBe(true);
  });

  it("guards /deals (slice-2)", () => {
    expect(isMatched("/deals")).toBe(true);
  });

  it("guards /website (slice-5)", () => {
    expect(isMatched("/website")).toBe(true);
  });

  it("guards /customers incl. subroutes, /activity, /watchlists (backfill)", () => {
    for (const route of [
      "/customers",
      "/customers/new",
      "/customers/2201/edit",
      "/activity",
      "/watchlists",
    ]) {
      expect(isMatched(route)).toBe(true);
    }
  });

  it("guards /invoices incl. subroutes (slice 27)", () => {
    for (const route of [
      "/invoices",
      "/invoices/new",
      "/invoices/3/edit",
      // Slice 30-3: /invoices/import rides the same `/invoices/:path*`
      // matcher entry — no middleware.ts change needed, asserted here for
      // the record (backfill note above documents what happens when a new
      // admin route ships without a matcher check like this one).
      "/invoices/import",
    ]) {
      expect(isMatched(route)).toBe(true);
    }
  });

  it("does not guard the public login page", () => {
    expect(isMatched("/login")).toBe(false);
  });
});

describe("demo mode auth bypass", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("lets an unauthenticated request through when demo is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const req = { cookies: { get: () => undefined }, nextUrl: { clone: () => ({}) } } as never;
    const res = await middleware(req);
    expect((res as { status?: number }).status).not.toBe(307);
  });
});

describe("middleware token verification", () => {
  const SECRET = "test-secret-test-secret-test-secret";
  const ALG = "HS256";
  const enc = (s: string) => new TextEncoder().encode(s);

  beforeEach(() => {
    vi.unstubAllEnvs();
    process.env.SESSION_SECRET = SECRET;
  });

  function reqWith(token: string | undefined) {
    return {
      cookies: { get: (n: string) => (token ? { name: n, value: token } : undefined) },
      nextUrl: { clone: () => new URL("http://localhost/") },
    } as never;
  }

  it("redirects a request with a malformed JWT cookie to /login (defense-in-depth)", async () => {
    // Garbage that doesn't even decode as base64-url JWT parts.
    const res = await middleware(reqWith("garbage.token.value"));
    expect((res as { status?: number }).status).toBe(307);
  });

  it("redirects a request with a structurally-valid but unsigned JWT to /login", async () => {
    // Three dot-separated base64url segments, but the signature was never produced
    // by HS256 over this header/payload with our secret.
    const fakeHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const fakePayload = Buffer.from(JSON.stringify({ user: "boss", orgId: 1 })).toString("base64url");
    const fakeSig = Buffer.from("not-a-real-signature").toString("base64url");
    const malformed = `${fakeHeader}.${fakePayload}.${fakeSig}`;
    const res = await middleware(reqWith(malformed));
    expect((res as { status?: number }).status).toBe(307);
  });

  it("redirects a request whose JWT is missing orgId (legacy / pre-slice-3 shape) to /login", async () => {
    const legacy = await new SignJWT({ user: "boss" })
      .setProtectedHeader({ alg: ALG })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(enc(SECRET));
    const res = await middleware(reqWith(legacy));
    expect((res as { status?: number }).status).toBe(307);
  });

  it("allows a request with a valid { user, orgId } JWT", async () => {
    const token = await createSession("boss", 1, SECRET);
    const res = await middleware(reqWith(token));
    expect((res as { status?: number }).status).not.toBe(307);
  });
});
