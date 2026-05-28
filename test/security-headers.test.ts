import { describe, it, expect } from "vitest";
// next.config.mjs is plain JS; allowJs + moduleResolution: "Bundler" lets us
// import it directly. We import both the default config (to call headers())
// and the exported securityHeaders array (so the CSP can be inspected without
// re-parsing a header value).
import nextConfig, { securityHeaders } from "../next.config.mjs";

type HeaderEntry = { key: string; value: string };
type HeaderRule = { source: string; headers: HeaderEntry[] };

describe("HTTP security headers (next.config.mjs)", () => {
  it("registers a header rule that matches the root route", async () => {
    const rules = (await nextConfig.headers!()) as HeaderRule[];
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);

    // Next's "/:path*" source matches "/" and every nested route. There must
    // be at least one such broad rule.
    const rootRule = rules.find(
      (r) => r.source === "/:path*" || r.source === "/(.*)" || r.source === "/",
    );
    expect(rootRule, "expected a catch-all header rule").toBeDefined();
    expect(rootRule!.headers.length).toBeGreaterThanOrEqual(6);
  });

  it("includes all six required security headers on the root route", async () => {
    const rules = (await nextConfig.headers!()) as HeaderRule[];
    const rootRule = rules.find((r) => r.source === "/:path*")!;
    const keys = rootRule.headers.map((h) => h.key);

    expect(keys).toContain("Strict-Transport-Security");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");
    expect(keys).toContain("Content-Security-Policy");
  });

  it("uses the expected header values", () => {
    const byKey = Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]));

    // HSTS: 2 years + subdomains, no preload (demo deploy on a fluid domain).
    expect(byKey["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(byKey["Strict-Transport-Security"]).not.toContain("preload");

    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    );
  });

  it("CSP locks down framing, base, form action, and inline-eval", () => {
    const csp = securityHeaders.find(
      (h) => h.key === "Content-Security-Policy",
    )!.value;

    // Required hardening directives — these are what the brief explicitly
    // checks for in the acceptance criteria.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");

    // No eval, no wildcards. unsafe-inline is intentional (see config
    // comments); unsafe-eval and `*` are not.
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/\s\*(\s|;|$)/);
  });

  it("CSP connect-src lists every external market-data host", () => {
    const csp = securityHeaders.find(
      (h) => h.key === "Content-Security-Policy",
    )!.value;

    // Hostnames derived from src/lib/market/providers/*.ts. Missing any one
    // of these would silently break live data in production.
    const requiredHosts = [
      "https://api.coingecko.com",
      "https://api.frankfurter.app",
      "https://api.gold-api.com",
      "https://api.twelvedata.com",
      "https://finnhub.io",
    ];
    for (const host of requiredHosts) {
      expect(csp, `connect-src must include ${host}`).toContain(host);
    }
  });
});
