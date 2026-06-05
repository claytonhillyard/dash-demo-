/** Integer seconds to "m:ss" (or "h:mm:ss" when >= 1h). Returns "—" for
 *  negative or non-finite input — useful for table cells where the source
 *  data might briefly be missing or zero-from-default. */
export function formatSessionDuration(totalSeconds: number): string {
  if (totalSeconds < 0 || !Number.isFinite(totalSeconds)) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Week-over-week percentage delta with consistent rounding and sign.
 *
 *  Returns null when `previous` is null/undefined (no comparison possible —
 *  the panel renders an em-dash). The `previous === 0` branch is explicit:
 *  any positive `current` yields up/100% (an honest stand-in for "infinite
 *  growth from zero"); both-zero yields flat/0. */
export function weekOverWeekDelta(
  current: number,
  previous: number | null | undefined,
): { sign: "up" | "down" | "flat"; percent: number } | null {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) {
    if (current === 0) return { sign: "flat", percent: 0 };
    return { sign: "up", percent: 100 };
  }
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change * 10) / 10;
  if (rounded === 0) return { sign: "flat", percent: 0 };
  return { sign: rounded > 0 ? "up" : "down", percent: Math.abs(rounded) };
}
