/**
 * Next.js sets NEXT_PHASE="phase-production-build" while running `next build`.
 * We use that to short-circuit any external market-data fetches: the build
 * must never depend on a live upstream (gold-api, coingecko, frankfurter,
 * finnhub, twelvedata, ...) being reachable or returning well-formed JSON.
 *
 * On flaky networks, those providers occasionally return an empty/truncated
 * body, which surfaces in Next's build output as
 *   `unhandledRejection: SyntaxError: Unexpected end of JSON input`
 *   `Retrying 1/3 ...`
 * Even when the build eventually succeeds, those retries are wasted time and
 * an unsteady CI signal. Guarding at the entry points (router/cache, history)
 * keeps the build deterministic and fully offline.
 */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}
