import * as Sentry from "@sentry/nextjs";

/**
 * Wraps one independent dashboard-panel fetch so a rejection degrades to a
 * caller-supplied empty/zero fallback instead of failing the ENTIRE
 * dashboard render (C-7 hardening pass). Before this, `src/app/page.tsx`'s
 * panel-data `Promise.all` had no try/catch anywhere — any single reader
 * throwing 500'd the whole page.
 *
 * The catch path is never silent: the original error is Sentry-captured,
 * tagged with `area: "dashboard-panel"` plus the caller-supplied `label`, so
 * a degraded panel is still visible to an operator even though the viewer
 * just sees an empty panel instead of a 500.
 *
 * Plain module — no "use server"/"use client" directive — so it's
 * importable from the RSC page AND unit-testable in isolation without
 * pulling in the rest of page.tsx's heavy mock surface.
 */
export async function safePanel<T>(
  label: string,
  p: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await p;
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "dashboard-panel", panel: label } });
    return fallback;
  }
}
