"use client";

/** Inline error/success line for admin forms. Errors use role="alert" so tests + a11y catch them. */
export function FormStatus({ error, ok }: { error?: string | null; ok?: boolean }) {
  if (error) {
    return (
      <p role="alert" className="text-bad text-sm">
        {error}
      </p>
    );
  }
  if (ok) {
    return <p className="text-ok text-sm">Saved.</p>;
  }
  return null;
}
