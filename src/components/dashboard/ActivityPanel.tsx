import Link from "next/link";
import type { ActivityEvent } from "@/lib/activity/types";
import { ActivityList } from "@/components/activity/ActivityList";

export function ActivityPanel({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">Recent Activity</h3>
      <ActivityList compact events={events} />
      <div className="mt-2 text-right">
        <Link href="/activity" className="text-xs text-zinc-400 hover:text-gold">
          View all →
        </Link>
      </div>
    </div>
  );
}
