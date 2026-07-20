/**
 * Runtime constants shared between the "use server" actions module
 * (./actions.ts) and future client components (PaymentsPanel, slice 29-3).
 * Lives outside actions.ts on purpose: Next's server-actions compiler
 * requires every export of a "use server" file to be an async function, so
 * a plain `export const` array breaks `next build` — the same constraint
 * documented on src/lib/actionErrors.ts for a different pair of helpers.
 *
 * src/lib/invoices/actions.ts sidesteps this by never exporting a runtime
 * value at all (only inferred *types*, which are erased at compile time, so
 * they're invisible to the "use server" export check) — its Zod schemas
 * stay private to that file. This module matches that split: only
 * PAYMENT_METHODS needs a real runtime export (the method <select> needs the
 * actual array), so it — and it alone — lives here. The Zod schemas in
 * actions.ts stay file-local/unexported, exactly like invoices.
 */

/** Fixed set of payment methods (spec §4). Zod-enforced on the way in
 *  (`z.enum(PAYMENT_METHODS)` in actions.ts). */
export const PAYMENT_METHODS = ["cash", "check", "card", "wire", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
