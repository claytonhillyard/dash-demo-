const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Integer cents to whole-dollar USD string, or an em dash when there is no value. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return USD.format(Math.round(cents / 100));
}

/** "updated today" / "updated Nd ago" provenance label, or null when no date. */
export function updatedAgo(
  updatedAt: Date | null | undefined,
  now: number = Date.now()
): string | null {
  if (!updatedAt) return null;
  const days = Math.floor((now - updatedAt.getTime()) / 86_400_000);
  if (days <= 0) return "updated today";
  return `updated ${days}d ago`;
}
