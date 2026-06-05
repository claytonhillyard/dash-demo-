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
 *   - DSN hostname doesn't end in `.ingest.sentry.io` (defense in depth —
 *     a misconfigured DSN env var pointing at an arbitrary host would otherwise
 *     silently widen CSP to that third-party host). This rejects e.g.
 *     `https://my-proxy.example.com/project/123`. Covers all Sentry regions:
 *     `o1.ingest.sentry.io`, `o1.ingest.us.sentry.io`, `o1.ingest.de.sentry.io`,
 *     etc. (Slice-11 review finding #4.)
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
  // The hostname must be a real Sentry ingest host. Accepts:
  //   - o<id>.ingest.sentry.io                (default region)
  //   - o<id>.ingest.us.sentry.io             (US region)
  //   - o<id>.ingest.de.sentry.io             (EU region)
  //   - any future o<id>.ingest.<region>.sentry.io
  // Rejects an arbitrary HTTPS host (e.g. my-proxy.example.com), a host
  // that just contains the substring (sentry.io.evil.com), or a host that
  // lacks the .ingest. segment (anywhere.sentry.io with no ingest).
  if (!url.hostname.endsWith(".sentry.io")) return null;
  if (!url.hostname.includes(".ingest.")) return null;
  return `${url.protocol}//${url.hostname}`;
}
