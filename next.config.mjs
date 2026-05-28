/** @type {import('next').NextConfig} */
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
};
export default nextConfig;
