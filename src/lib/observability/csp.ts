/**
 * Derive the exact Sentry ingest origin from a DSN, for CSP `connect-src`
 * widening at build time.
 *
 * Returns the bare origin (e.g. `https://o111222.ingest.sentry.io`) — NEVER a
 * wildcard, NEVER includes the public key, NEVER includes the project path.
 * Returns null when:
 *   - DSN is undefined or empty (demo build, local dev without observability)
 *   - DSN is malformed (URL constructor throws)
 *   - DSN is not https (defense in depth — production DSNs are always https)
 *
 * Caller (`next.config.mjs`) appends the return value to its CONNECT_HOSTS
 * array IFF it is non-null. This keeps the demo build's CSP byte-identical
 * to today.
 */
export function parseSentryIngestHost(dsn: string | undefined): string | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return `${url.protocol}//${url.hostname}`;
}
