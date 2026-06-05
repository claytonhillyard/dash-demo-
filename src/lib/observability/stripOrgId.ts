/**
 * Removes the `orgId` field from `obj` (shallow) and from any value of `obj`
 * that is itself a plain object (one level deep). Arrays and primitives at any
 * depth are returned untouched.
 *
 * The strip is INTENTIONALLY shallow + one-level-deep, not fully recursive:
 *   - Every intentional `orgId` usage in this codebase is a flat tag/extra
 *     (slice-3 `getCurrentOrgId()` + slice-11 `withOrgScope`).
 *   - A deeply-nested `orgId` would be a bug in some unrelated capture site.
 *     The PR review grep checklist (slice 11 Phase D) is the second line of
 *     defense for that case.
 *   - Full recursion makes the helper expensive on large Sentry event payloads
 *     and harder to reason about. Trade-off accepted; documented here.
 */
export function stripOrgId<T extends Record<string, unknown> | undefined>(
  obj: T,
): T {
  if (!obj || typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "orgId") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};
      for (const [nk, nv] of Object.entries(nested)) {
        if (nk === "orgId") continue;
        cleaned[nk] = nv;
      }
      out[k] = cleaned;
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
