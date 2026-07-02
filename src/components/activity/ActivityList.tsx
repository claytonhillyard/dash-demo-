import type { ActivityEvent, ActivityVerb } from "@/lib/activity/types";
import { relativeTime } from "@/lib/format/bids";

/** Verb → dot color. Presentation concern — lives here, not in types.ts. */
function verbDotClass(verb: ActivityVerb): string {
  switch (verb) {
    case "created":
    case "restored":
    case "bid_accepted":
      return "bg-emerald-400";
    case "updated":
      return "bg-amber-300";
    case "deleted":
    case "comment_deleted":
    case "bid_rejected":
      return "bg-rose-400";
    case "bid_placed":
    case "bid_withdrawn":
    case "invited":
    case "joined":
    case "left":
      return "bg-sky-400";
    default:
      return "bg-zinc-500";
  }
}

/**
 * Shared audit-feed list. Used by the dashboard ActivityPanel (compact),
 * the /activity page (full), and the per-customer Activity section
 * (compact). Hook-free so it renders server-side on RSC pages and inside
 * the client DashboardGrid alike.
 */
export function ActivityList({
  events,
  compact = false,
}: {
  events: ActivityEvent[];
  compact?: boolean;
}) {
  if (events.length === 0) {
    return <p className="text-xs text-zinc-500">No activity yet.</p>;
  }
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2.5"}>
      {events.map((e) => (
        <li key={e.id} className="flex items-baseline gap-2 text-sm">
          <span
            data-verb-dot
            className={`mt-1 h-1.5 w-1.5 shrink-0 self-center rounded-full ${verbDotClass(e.verb)}`}
          />
          <span className="min-w-0 flex-1 truncate text-zinc-200">{e.summary}</span>
          {!compact && e.actor ? (
            <span className="shrink-0 text-xs text-zinc-500">{e.actor}</span>
          ) : null}
          <span className="shrink-0 text-xs text-zinc-500">
            {relativeTime(e.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
