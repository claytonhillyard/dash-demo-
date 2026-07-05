import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { getWatchlistsForActor, type WatchlistView } from "@/lib/watchlists/queries";
import { UnwatchButton } from "@/components/watchlists/UnwatchButton";
import { relativeTime } from "@/lib/format/bids";
import type { ActivityEntityType } from "@/lib/activity/types";

export const dynamic = "force-dynamic";

// Same literal DEMO_WATCHLISTS (src/lib/demo/seed.ts) seeds its two watches
// under — see the identical constant + comment on the customer edit page.
const DEMO_ACTOR = "owner@aiya.demo";

// Mirrors buildAlertEmail's entityPath map (src/lib/watchlists/buildAlertEmail.ts)
// exactly. Kept as its own tiny local fn per the slice-25 plan rather than
// exported/shared — the page only needs the customer case today (slice 25b
// adds deal/inventory/circle toggles), and duplicating a 3-line map is
// cheaper than introducing a cross-module dependency for it.
function entityHref(entityType: ActivityEntityType, entityId: number): string {
  if (entityType === "customer") return `/customers/${entityId}/edit`;
  if (entityType === "deal") return "/deals";
  return "/activity";
}

export default async function WatchlistsPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const actor = isDemoMode() ? DEMO_ACTOR : (await requireSession()).user;
  const watches = await getWatchlistsForActor(db, orgId, actor);

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          Watchlists
        </h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">
          Back to dashboard
        </Link>
      </header>

      {watches.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No watches yet. Watch a customer from its edit page.
        </p>
      ) : (
        <div aria-label="watchlists table" className="surface-card overflow-x-auto rounded-xl">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-text/50">
                <th className="p-3 font-normal">Entity</th>
                <th className="p-3 font-normal">Notify email</th>
                <th className="p-3 font-normal">Created</th>
                <th className="p-3 font-normal">Last notified</th>
                <th className="p-3 font-normal" />
              </tr>
            </thead>
            <tbody>
              {watches.map((w: WatchlistView) => (
                <tr key={w.id} className="border-b border-border/50 last:border-0">
                  <td className="p-3">
                    <Link
                      href={entityHref(w.entityType, w.entityId)}
                      className="text-text hover:text-gold"
                    >
                      {w.entityType} #{w.entityId}
                    </Link>
                  </td>
                  <td className="p-3 text-text/80">{w.notifyEmail}</td>
                  <td className="p-3 text-xs text-zinc-500">
                    {relativeTime(w.createdAt)}
                  </td>
                  <td className="p-3 text-xs text-zinc-500">
                    {w.lastNotifiedAt ? relativeTime(w.lastNotifiedAt) : "never"}
                  </td>
                  <td className="p-3 text-right">
                    <UnwatchButton entityType={w.entityType} entityId={w.entityId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
