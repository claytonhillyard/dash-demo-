export function formatPrice(cents: number, currency: string): string {
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(dollars);
  } catch {
    return `${currency} ${dollars.toFixed(2)}`;
  }
}

export function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
