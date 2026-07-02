import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getOrgActivity } from "@/db/activityEvents";
import { ActivityList } from "@/components/activity/ActivityList";
import {
  ACTIVITY_ENTITY_TYPES,
  type ActivityEntityType,
} from "@/lib/activity/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const FILTERS: Array<{ label: string; type?: ActivityEntityType }> = [
  { label: "All" },
  { label: "Customers", type: "customer" },
  { label: "Deals", type: "deal" },
  { label: "Inventory", type: "inventory_item" },
  { label: "Bids", type: "bid" },
  { label: "Circles", type: "circle" },
];

function pickType(raw: string | string[] | undefined): ActivityEntityType | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (ACTIVITY_ENTITY_TYPES as readonly string[]).includes(v ?? "")
    ? (v as ActivityEntityType)
    : undefined;
}

function pickBefore(raw: string | string[] | undefined): number | undefined {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(v) && v > 0 ? v : undefined;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const type = pickType(params.type);
  const before = pickBefore(params.before);

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const events = await getOrgActivity(db, orgId, {
    limit: PAGE_SIZE,
    beforeId: before,
    entityTypes: type ? [type] : undefined,
  });

  const olderHref =
    events.length === PAGE_SIZE
      ? `/activity?${new URLSearchParams({
          ...(type ? { type } : {}),
          before: String(events[events.length - 1]!.id),
        }).toString()}`
      : null;

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Activity</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">
          Back to dashboard
        </Link>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filter by type">
        {FILTERS.map((f) => {
          const active = f.type === type;
          return (
            <Link
              key={f.label}
              href={f.type ? `/activity?type=${f.type}` : "/activity"}
              className={`rounded px-2 py-0.5 text-xs ${
                active
                  ? "border border-gold/30 bg-gold/10 text-gold"
                  : "border border-transparent text-text/65 hover:bg-surface-2 hover:text-gold"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <ActivityList events={events} />

      {olderHref ? (
        <div className="mt-4 text-right">
          <Link href={olderHref} className="text-sm text-zinc-400 hover:text-gold">
            Older →
          </Link>
        </div>
      ) : null}
    </main>
  );
}
