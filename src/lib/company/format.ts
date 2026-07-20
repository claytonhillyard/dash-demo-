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

const USD_EXACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Integer cents to exact USD string with cents ("$1,234.56"), or an em dash
 *  when there is no value. Financial records (invoices) need the exact
 *  amount, unlike the whole-dollar `formatCents` KPI panels use — kept as a
 *  separate function rather than a flag so callers can't accidentally
 *  round money away. */
export function formatCentsExact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return USD_EXACT.format(cents / 100);
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

/** Relative time label: "just now" / "15m ago" / "3h ago" / "2d ago" / short date.
 *  `now` is injectable for deterministic tests. */
export function timeAgo(date: Date, now: number = Date.now()): string {
  const diffMs = now - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}
