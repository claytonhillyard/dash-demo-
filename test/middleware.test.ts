import { describe, it, expect } from "vitest";
import { config } from "@/middleware";

// Translate a Next.js middleware matcher string into a RegExp the same way
// Next does (the `:path*` segment is path-to-regexp syntax).
function matcherToRegExp(pattern: string): RegExp {
  const source =
    "^" +
    pattern
      .replace(/\/:path\*/g, "(?:/.*)?")
      .replace(/\/:path\+/g, "/.+") +
    "$";
  return new RegExp(source);
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

  it("does not guard the public login page", () => {
    expect(isMatched("/login")).toBe(false);
  });
});
