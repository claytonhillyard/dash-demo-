"use client";

/** Inline error/success line for admin forms. Errors use role="alert" so tests + a11y catch them.
 *
 *  slice-5 extension: when `duplicate` is true (the action returned
 *  { ok: true, duplicate: true } from an ON CONFLICT DO NOTHING), the UI
 *  surfaces a soft hint that the (orgId, weekStart) pair already exists. */
export function FormStatus({
  error, ok, duplicate,
}: {
  error?: string | null;
  ok?: boolean;
  duplicate?: boolean;
}) {
  if (error) {
    return (
      <p role="alert" className="text-bad text-sm">
        {error}
      </p>
    );
  }
  if (duplicate) {
    return (
      <p className="text-text/70 text-sm">
        Snapshot for this week already exists — edit it in the table below.
      </p>
    );
  }
  if (ok) {
    return <p className="text-ok text-sm">Saved.</p>;
  }
  return null;
}
