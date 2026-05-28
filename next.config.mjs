/** @type {import('next').NextConfig} */

// External hosts the app contacts at runtime. Derived from
// src/lib/market/providers/*.ts — every fetch() to a non-self URL must be
// listed here, otherwise CSP will block live data in production.
//
//   coingecko.ts   -> api.coingecko.com
//   finnhub.ts     -> finnhub.io
//   frankfurter.ts -> api.frankfurter.app
//   metals.ts      -> api.gold-api.com
//   twelvedata.ts  -> api.twelvedata.com
const CONNECT_HOSTS = [
  "https://api.coingecko.com",
  "https://api.frankfurter.app",
  "https://api.gold-api.com",
  "https://api.twelvedata.com",
  "https://finnhub.io",
];

// Single-line CSP. Each directive ends in ';'. Keep it readable.
//
// Notes:
// - 'unsafe-inline' on script-src is required by Next.js App Router today: the
//   framework injects an inline runtime/bootstrap script (and inline JSON for
//   RSC payloads) on every page. A nonce-based CSP is the proper follow-up
//   (Next supports it via middleware), but our existing JWT middleware
//   collides with that path — tracked as follow-up.
// - 'unsafe-inline' on style-src covers Next's <style jsx> + Tailwind's
//   injected styles in dev. Production CSS is in /_next/static, which 'self'
//   already covers, but inline <style> tags still appear from RSC streaming.
// - connect-src 'self' allows same-origin /api/* (the app's own routes); the
//   listed hosts are direct browser-side fetches (only api.gold-api.com is
//   currently called from the client; the others run server-side, but
//   listing them is harmless and future-proof if any move to client).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${CONNECT_HOSTS.join(" ")}`,
  "img-src 'self' data:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Headers applied to every response. Exported so the test can introspect them
// without booting Next.
export const securityHeaders = [
  {
    // HSTS without `preload` — this is a Netlify demo deploy on a domain in
    // flux, so we don't want to lock browsers into HTTPS-only via the preload
    // list. 2 years is the standard long-lived value.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Both X-Frame-Options: DENY and CSP frame-ancestors 'none' are set — they
  // agree, and X-Frame-Options is kept for older browsers that ignore CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig = {
  reactStrictMode: true,
  // pglite ships a WASM module + uses Node fs to load it. If Next bundles it for
  // the server runtime, its asset paths get rewritten to URLs and the WASM/file
  // load throws ("path must be a string ... received URL"), so the dev DB never
  // migrates. Keeping it external lets it load from node_modules normally.
  // (Tests use vitest, not the bundler, so they were unaffected.)
  serverExternalPackages: ["@electric-sql/pglite"],
  // Drizzle's migrator reads ./drizzle/* at runtime (not via static import), so
  // Next's file-tracer doesn't auto-bundle it. Without this, the deployed
  // function instance can't migrate the local pglite DB and any page that
  // touches the DB throws (e.g. the dashboard / page on Netlify).
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
  async headers() {
    return [
      {
        // Apply to every route, including /_next/* assets and /api/*.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};
export default nextConfig;
