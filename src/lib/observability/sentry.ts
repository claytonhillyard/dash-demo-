import * as Sentry from "@sentry/nextjs";
import { isDemoMode } from "@/lib/demo/mode";
import { stripOrgId } from "./stripOrgId";

/**
 * `beforeSend` is the SINGLE SOURCE OF TRUTH for the "no orgId in
 * breadcrumbs/extras/contexts" rule. It runs once per event right before
 * transmission. `event.tags` is INTENTIONALLY untouched — `orgId` is allowed
 * there (set server-side via `withOrgScope`) and is used for triage filtering
 * inside the Sentry workspace UI, never leaving the operator's control plane.
 *
 * The plan's signature used `Sentry.Event` / `Sentry.EventHint`, but
 * @sentry/nextjs v8 narrows the beforeSend option to `ErrorEvent` (and
 * `Contexts` is not re-exported). The body is unchanged; only the
 * parameter/return types and the `contexts` cast are adjusted to match
 * the v8 type surface so this file compiles under strict typecheck.
 */
export function beforeSend(
  event: Sentry.ErrorEvent,
  _hint: Sentry.EventHint,
): Sentry.ErrorEvent | null {
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      data: stripOrgId(b.data as Record<string, unknown> | undefined),
    }));
  }
  if (event.extra) {
    event.extra = stripOrgId(event.extra as Record<string, unknown>);
  }
  if (event.contexts) {
    const cleaned: Record<string, Record<string, unknown>> = {};
    for (const k of Object.keys(event.contexts)) {
      const v = event.contexts[k] as Record<string, unknown> | undefined;
      cleaned[k] = stripOrgId(v) as Record<string, unknown>;
    }
    event.contexts = cleaned as unknown as Sentry.ErrorEvent["contexts"];
  }
  return event;
}

/**
 * `beforeBreadcrumb` strips orgId before a breadcrumb is queued. Belt-and-
 * braces with `beforeSend` — the latter is the canonical strip, the former
 * keeps the in-memory breadcrumb buffer clean so a developer inspecting it
 * via DevTools never sees `orgId` either.
 *
 * The plan's signature required `_hint: BreadcrumbHint`, but
 * @sentry/nextjs v8 declares the option as `hint?: BreadcrumbHint`. The
 * param is widened to optional to match v8's type surface.
 */
export function beforeBreadcrumb(
  breadcrumb: Sentry.Breadcrumb,
  _hint?: Sentry.BreadcrumbHint,
): Sentry.Breadcrumb | null {
  return {
    ...breadcrumb,
    data: stripOrgId(breadcrumb.data as Record<string, unknown> | undefined),
  };
}

/**
 * Server-side helper for tagging an event with the request's `orgId`. Tags
 * are filterable in the Sentry workspace UI and are necessary for an operator
 * to triage a real error back to a tenant. Tags do NOT leave the Sentry
 * workspace.
 *
 * Usage:
 *   await withOrgScope(orgId, async () => { ... ;Sentry.captureException(e); });
 */
export function withOrgScope<T>(orgId: number, fn: () => T): T {
  let result!: T;
  Sentry.withScope((scope) => {
    scope.setTag("orgId", orgId);
    result = fn();
  });
  return result;
}

/**
 * Idempotent SDK initialisation. Called from `sentry.server.config.ts`,
 * `sentry.client.config.ts`, and `sentry.edge.config.ts`. The function itself
 * is safe to call multiple times — `Sentry.init` is documented as re-init-safe.
 *
 * Demo mode → `enabled: false`. Missing DSN → `enabled: false`, `dsn: undefined`.
 * Both shapes make the SDK a no-op without throwing or crashing the host app.
 */
export function initSentry(): void {
  if (isDemoMode()) {
    Sentry.init({ enabled: false });
    return;
  }
  // Read SENTRY_DSN at call time, not module load time. Module-level capture
  // was fragile under vi.resetModules() and any parallel test runner that
  // imported this module transitively before resetting env vars. (Slice-11
  // review finding #2.) Matches isDemoMode()'s call-time read pattern.
  const sentryDsn = process.env.SENTRY_DSN;
  Sentry.init({
    dsn: sentryDsn,
    enabled: !!sentryDsn,
    tracesSampleRate: 0, // tracing deferred to slice 12+
    beforeSend,
    beforeBreadcrumb,
  });
}
