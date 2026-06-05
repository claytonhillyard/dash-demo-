"use client";

import { useState, useTransition } from "react";
import type { TodaysBidView } from "@/db/bids";
import { formatPrice, relativeTime, truncate } from "@/lib/format/bids";

export type TodaysBidsPanelProps = {
  bids: TodaysBidView[];
  actions: {
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

export function TodaysBidsPanel(props: TodaysBidsPanelProps) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div aria-label="todays bids panel" className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
      <h3 className="text-sm font-semibold text-zinc-200 mb-2">Today&apos;s Bids</h3>
      {actionError && (
        <p role="alert" className="text-xs text-rose-400 mb-2">{actionError}</p>
      )}
      {props.bids.length === 0 ? (
        <p className="text-xs text-zinc-500">No bids today yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.bids.map((b) => (
            <li key={b.bidId} aria-label="todays bid row" className="text-xs">
              <p className="text-zinc-300">
                <span className="font-semibold">{b.bidderOrgLabel}</span>
                {" bid "}<span className="text-amber-300">{formatPrice(b.priceCents, b.currency)}</span>
                {" on "}<span className="text-zinc-200">&quot;{truncate(b.dealSubject, 40)}&quot;</span>
              </p>
              <p className="text-zinc-500">{relativeTime(b.createdAt)}</p>
              <div className="flex gap-1 mt-1">
                <button
                  aria-label={`accept bid ${b.bidId}`}
                  className="text-xs px-2 py-0.5 bg-emerald-500/80 hover:bg-emerald-500 text-zinc-900 rounded"
                  disabled={pending}
                  onClick={() => {
                    setActionError(null);
                    startTransition(async () => {
                      const res = await props.actions.acceptBid({ bidId: b.bidId });
                      if (!res.ok) setActionError(res.error);
                    });
                  }}
                >
                  Accept
                </button>
                <button
                  aria-label={`reject bid ${b.bidId}`}
                  className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded"
                  disabled={pending}
                  onClick={() => {
                    setActionError(null);
                    startTransition(async () => {
                      const res = await props.actions.rejectBid({ bidId: b.bidId });
                      if (!res.ok) setActionError(res.error);
                    });
                  }}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
