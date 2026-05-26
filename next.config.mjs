/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pglite ships a WASM module + uses Node fs to load it. If Next bundles it for
  // the server runtime, its asset paths get rewritten to URLs and the WASM/file
  // load throws ("path must be a string ... received URL"), so the dev DB never
  // migrates. Keeping it external lets it load from node_modules normally.
  // (Tests use vitest, not the bundler, so they were unaffected.)
  serverExternalPackages: ["@electric-sql/pglite"],
};
export default nextConfig;
