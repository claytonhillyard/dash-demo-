/**
 * PII-safe error shaping + constraint mapping shared by server-action
 * modules. Lives OUTSIDE any "use server" file on purpose: Next's
 * server-actions compiler requires every export of a "use server" module
 * to be an async function, and these are deliberately synchronous helpers
 * called inside catch blocks. (Exporting them from customers/actions.ts
 * broke `next build` — caught by the D-2 installer work.)
 */

/**
 * Build a PII-safe shape from an arbitrary error for logs + Sentry.extra.
 * Critical: Postgres errors carry the failing SQL parameters in `detail` /
 * `where` / `internalQuery` / `internalPosition` — those values frequently
 * include customer email, phone, address, notes. We DROP those fields and
 * keep only the symbolic identifiers (code, constraint name, error class).
 * Mirrors PostgresError shape per drizzle's `postgres` driver.
 */
export function safeErrShape(e: unknown): Record<string, unknown> {
  if (typeof e !== "object" || e === null) {
    return { kind: "non-object", value: String(e).slice(0, 200) };
  }
  const x = e as Record<string, unknown>;
  // Note: NOT including `message` raw — it sometimes inlines the parameter
  // value (e.g. "duplicate key value violates unique constraint ... DETAIL: Key
  // (org_id, external_ref)=(1, WJ-10421) already exists."). Truncate hard.
  const message =
    typeof x.message === "string" ? x.message.split("\n")[0]?.slice(0, 120) : undefined;
  return {
    name: typeof x.name === "string" ? x.name : undefined,
    message,
    code: typeof x.code === "string" ? x.code : undefined,
    constraint: typeof x.constraint === "string" ? x.constraint : undefined,
    // Deliberately omit: detail, hint, where, internalQuery, parameters, schema,
    // table, column — any of these may include user-supplied PII.
  };
}

/**
 * Map a Postgres unique-constraint violation (SQLSTATE 23505) to a friendly
 * user-facing error string. Returns null for everything else so the caller
 * falls back to its generic "Server error" path. We only translate the
 * `external_ref` partial unique today; the `customers` table has no other
 * unique constraints, so additional cases would be a future migration.
 */
export function mapDbConstraintError(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const code = (e as { code?: string }).code;
  if (code !== "23505") return null;
  const constraint = (e as { constraint?: string }).constraint;
  if (typeof constraint === "string" && constraint.includes("external_ref")) {
    return "Another customer in your org already uses that external reference";
  }
  // Some other unique constraint we don't know about — surface a clear but
  // generic message so the user knows it's their input, not a server bug.
  return "That value is already in use by another customer";
}
