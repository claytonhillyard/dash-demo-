/**
 * PII-safe error shaping + constraint mapping shared by server-action
 * modules. Lives OUTSIDE any "use server" file on purpose: Next's
 * server-actions compiler requires every export of a "use server" module
 * to be an async function, and these are deliberately synchronous helpers
 * called inside catch blocks. (Exporting them from customers/actions.ts
 * broke `next build` — caught by the D-2 installer work.)
 */

/**
 * drizzle-orm (0.45.x) wraps every driver-level failure in a
 * `DrizzleQueryError` before it reaches application code — what a catch
 * block actually sees is `{ message, query, params, cause }`, NOT the
 * Postgres error's own `code` / `constraint` fields. Those live one level
 * down, on `.cause` (verified against both the neon-http and pglite
 * drivers — both sit on drizzle's shared pg-core session layer, so the
 * wrapping is uniform across dev/test and production). Unwrap once here so
 * every caller below reads the real SQLSTATE instead of `undefined`.
 *
 * Falls back to the top-level object when there's no `.cause`, so a raw
 * (unwrapped) Postgres error — e.g. a future direct driver call — still
 * works unchanged.
 */
export function pgErrorFields(e: unknown): { code?: string; constraint?: string } {
  if (typeof e !== "object" || e === null) return {};
  const top = e as { cause?: unknown };
  const source =
    typeof top.cause === "object" && top.cause !== null
      ? (top.cause as Record<string, unknown>)
      : (e as Record<string, unknown>);
  return {
    code: typeof source.code === "string" ? source.code : undefined,
    constraint: typeof source.constraint === "string" ? source.constraint : undefined,
  };
}

/**
 * Build a PII-safe shape from an arbitrary error for logs + Sentry.extra.
 * Critical: Postgres errors carry the failing SQL parameters in `detail` /
 * `where` / `internalQuery` / `internalPosition` — those values frequently
 * include customer email, phone, address, notes. We DROP those fields and
 * keep only the symbolic identifiers (code, constraint name, error class).
 * `code`/`constraint` are read via `pgErrorFields` (see above) since the
 * real Postgres error is one level down, on `e.cause`.
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
  const { code, constraint } = pgErrorFields(e);
  return {
    name: typeof x.name === "string" ? x.name : undefined,
    message,
    code,
    constraint,
    // Deliberately omit: detail, hint, where, internalQuery, parameters, schema,
    // table, column — any of these may include user-supplied PII.
  };
}

/**
 * Map a Postgres constraint violation to a friendly user-facing error
 * string. Returns null for everything else so the caller falls back to its
 * generic "Server error" path.
 *
 * 23505 (unique_violation): `external_ref` (customers) and
 * `invoices_org_number_unique` (invoices) get named messages; any other
 * unique constraint gets a generic-but-clear fallback so the user at least
 * knows it's their input, not a server bug.
 *
 * 23503 (foreign_key_violation, slice 27): only the invoices -> customers
 * no-action FK is translated (deleting a customer that still has invoices).
 * Every other FK violation returns null — we don't yet know enough about
 * those cases to word a friendly message, so the caller's generic path
 * handles them.
 */
export function mapDbConstraintError(e: unknown): string | null {
  const { code, constraint } = pgErrorFields(e);
  if (code === "23505") {
    if (typeof constraint === "string" && constraint.includes("external_ref")) {
      return "Another customer in your org already uses that external reference";
    }
    if (typeof constraint === "string" && constraint.includes("invoices_org_number_unique")) {
      return "That invoice number is already in use";
    }
    return "That value is already in use by another customer";
  }
  if (code === "23503") {
    if (
      typeof constraint === "string" &&
      constraint.includes("invoices_customer_id_customers_id_fk")
    ) {
      return "Cannot delete a customer that has invoices";
    }
    return null;
  }
  return null;
}
