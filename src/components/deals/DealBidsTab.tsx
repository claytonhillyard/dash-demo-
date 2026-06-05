"use client";

import { useState, useTransition, useMemo } from "react";
import type { BidView } from "@/db/bids";

export type DealBidsTabProps = {
  dealId: number;
  viewerOrgId: number;
  isOwner: boolean;
  /** Null when viewer is not the owner (mode selector hidden). */
  currentBidMode: "single" | "history" | null;
  bids: BidView[];
  actions: {
    postBid: (input: {
      dealId: number; priceCents: number; currency?: string; notes?: string;
    }) => Promise<{ ok: true } | { ok: false; error: string }>;
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    withdrawBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    setBidMode: (input: { dealId: number; mode: "single" | "history" }) => Promise<
      { ok: true } | { ok: false; error: string }
    >;
  };
};

function formatPrice(cents: number, currency: string): string {
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(dollars);
  } catch {
    return `${currency} ${dollars.toFixed(2)}`;
  }
}

function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

function statusBadgeClass(status: BidView["status"]): string {
  switch (status) {
    case "pending": return "text-amber-300";
    case "accepted": return "text-emerald-400";
    case "rejected":
    case "withdrawn":
    case "auto_rejected": return "text-zinc-500";
  }
}

export function DealBidsTab(props: DealBidsTabProps) {
  const [pending, startTransition] = useTransition();

  const visibleBids = useMemo(() => {
    if (!props.isOwner || props.currentBidMode === "history") return props.bids;
    // Single mode (owner): latest pending per bidder; older rows hidden behind disclosure later.
    const seen = new Set<number>();
    return props.bids
      .filter((b) => b.status === "pending")
      .filter((b) => {
        if (seen.has(b.bidderOrgId)) return false;
        seen.add(b.bidderOrgId);
        return true;
      });
  }, [props.bids, props.isOwner, props.currentBidMode]);

  return (
    <div aria-label="deal bids" className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
      {props.isOwner && props.currentBidMode !== null && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <label htmlFor={`bidmode-${props.dealId}`} className="text-zinc-400">Display:</label>
          <select
            id={`bidmode-${props.dealId}`}
            aria-label="bid display mode"
            value={props.currentBidMode}
            disabled={pending}
            onChange={(e) =>
              startTransition(async () => {
                await props.actions.setBidMode({
                  dealId: props.dealId,
                  mode: e.target.value as "single" | "history",
                });
              })
            }
            className="bg-zinc-800 text-zinc-100 px-1 py-0.5 rounded"
          >
            <option value="single">Single (latest per bidder)</option>
            <option value="history">History (all bids)</option>
          </select>
        </div>
      )}

      {visibleBids.length === 0 ? (
        <p className="text-sm text-zinc-500 mb-2">No bids yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {visibleBids.map((b) => (
            <li key={b.id} aria-label="bid row" className="border-b border-zinc-800 pb-2 last:border-b-0">
              <p className="text-xs text-zinc-400">
                {b.bidderOrgId === props.viewerOrgId ? "You" : b.bidderOrgLabel}
                {" · "}{relativeTime(b.createdAt)}
                {" · "}<span className={statusBadgeClass(b.status)}>{b.status}</span>
              </p>
              <p className="text-sm text-zinc-100 font-semibold">
                {formatPrice(b.priceCents, b.currency)}
              </p>
              {b.notes && (
                <p className="whitespace-pre-wrap text-xs text-zinc-300 mt-1">{b.notes}</p>
              )}
              {props.isOwner && b.status === "pending" && (
                <div className="flex gap-2 mt-1">
                  <button
                    aria-label={`accept bid ${b.id}`}
                    className="text-xs px-2 py-0.5 bg-emerald-500/80 hover:bg-emerald-500 text-zinc-900 rounded"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await props.actions.acceptBid({ bidId: b.id });
                      })
                    }
                  >
                    Accept
                  </button>
                  <button
                    aria-label={`reject bid ${b.id}`}
                    className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await props.actions.rejectBid({ bidId: b.id });
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
              {b.bidderOrgId === props.viewerOrgId && b.status === "pending" && (
                <button
                  aria-label={`withdraw bid ${b.id}`}
                  className="text-xs text-zinc-500 hover:text-rose-400 mt-1"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await props.actions.withdrawBid({ bidId: b.id });
                    })
                  }
                >
                  Withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!props.isOwner && (
        <PostBidFormInline
          dealId={props.dealId}
          postBid={props.actions.postBid}
          disabled={pending}
        />
      )}
    </div>
  );
}

function PostBidFormInline(props: {
  dealId: number;
  postBid: DealBidsTabProps["actions"]["postBid"];
  disabled?: boolean;
}) {
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = () => {
    setError(null);
    const parsed = parseFloat(price);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const priceCents = Math.round(parsed * 100);
    startTransition(async () => {
      const res = await props.postBid({
        dealId: props.dealId, priceCents, currency,
        notes: notes.trim() === "" ? undefined : notes.trim(),
      });
      if (res.ok) {
        setPrice("");
        setNotes("");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1 border-t border-zinc-700 pt-2">
      <div className="flex gap-1">
        <input
          aria-label="bid price"
          type="number"
          step="0.01"
          min="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Your bid"
          className="flex-1 bg-zinc-800 text-zinc-100 text-sm p-1 rounded"
        />
        <select
          aria-label="bid currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="bg-zinc-800 text-zinc-100 text-sm p-1 rounded"
        >
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="INR">INR</option>
          <option value="JPY">JPY</option>
        </select>
      </div>
      <textarea
        aria-label="bid notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional note (≤500 chars)"
        maxLength={500}
        rows={1}
        className="bg-zinc-800 text-zinc-100 text-xs p-1 rounded"
      />
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
      <button
        aria-label="submit bid"
        onClick={handleSubmit}
        disabled={pending || props.disabled || price.trim() === ""}
        className="self-end text-xs px-2 py-1 bg-amber-500/80 hover:bg-amber-500 text-zinc-900 rounded disabled:opacity-50"
      >
        {pending ? "Submitting..." : "Submit bid"}
      </button>
    </div>
  );
}
