/** @type {import('next').NextConfig} */

import { withSentryConfig } from "@sentry/nextjs";

// Inline copy of `src/lib/observability/csp.ts#parseSentryIngestHost`.
// Plan fallback: importing the `.ts` source from this `.mjs` works in Node 22
// runtime but triggers a MODULE_TYPELESS_PACKAGE_JSON warning and has bitten
// Netlify's build in prior slices. The canonical implementation + unit tests
// live in `src/lib/observability/csp.ts` — keep this copy byte-equivalent.
/** @param {string | undefined} dsn @returns {string | null} */
function parseSentryIngestHost(dsn) {
  if (!dsn) return null;
  let url;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return `${url.protocol}//${url.hostname}`;
}

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

// Slice 11: widen connect-src with the exact Sentry ingest host derived
// from SENTRY_DSN. When SENTRY_DSN is unset (demo build, local dev), the
// helper returns null and CONNECT_HOSTS is unchanged byte-for-byte.
const SENTRY_INGEST_HOST = parseSentryIngestHost(process.env.SENTRY_DSN);
const EFFECTIVE_CONNECT_HOSTS = SENTRY_INGEST_HOST
  ? [...CONNECT_HOSTS, SENTRY_INGEST_HOST]
  : CONNECT_HOSTS;

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
  `connect-src 'self' ${EFFECTIVE_CONNECT_HOSTS.join(" ")}`,
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
  // Slice 17: server-action multipart bodies for deal-photo uploads need
  // to exceed Next's 1MB default. 10MB matches the per-file cap enforced
  // by `uploadDealAttachment` (validateAttachmentSize). Lives under
  // `experimental` per Next 15's stable surface.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Slice 17: allowlist remote image hosts so `next/image` can optimize the
  // carousel thumbnails. Demo mode uses Unsplash; production uses Netlify
  // Blobs signed URLs (served from a Netlify CDN host). Both wildcards
  // (`*.netlify.app`, `*.netlify.com`) cover the observed signed-URL
  // hostnames in dev + prod — the exact subdomain depends on the site.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.netlify.app" },
      { protocol: "https", hostname: "**.netlify.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
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

// Slice 11: wrap with Sentry's config helper for source-map upload at build
// time. Upload is skipped silently when SENTRY_AUTH_TOKEN is absent (demo
// build, local builds, CI without the secret). The webpack plugins are also
// explicitly disabled in that case so the build never warns about a missing
// auth token.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
});
