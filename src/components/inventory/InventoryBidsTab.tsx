"use client";

import { useTransition, useState } from "react";
import type { InventoryBidView } from "@/db/inventoryBids";
import type {
  PostInventoryBidInput,
  AcceptInventoryBidInput,
  RejectInventoryBidInput,
  WithdrawInventoryBidInput,
} from "@/lib/inventory/bidValidation";
import type { ActionResult } from "@/lib/inventory/actions";
import { PostInventoryBidForm } from "./PostInventoryBidForm";
import { timeAgo } from "@/lib/company/format";

function fmt(cents: number, ccy: string) {
  return `${ccy} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

const STATUS_CLASS: Record<InventoryBidView["status"], string> = {
  pending: "bg-amber-500/20 text-amber-200",
  accepted: "bg-emerald-500/20 text-emerald-200",
  rejected: "bg-zinc-500/20 text-zinc-300",
  withdrawn: "bg-zinc-500/20 text-zinc-300",
  auto_rejected: "bg-zinc-500/20 text-zinc-300",
};

type Props = {
  inventoryItem: { id: number; name: string; ownerOrgId: number; bidMode: "single" | "history" | null };
  viewerOrgId: number;
  bids: InventoryBidView[];
  actions: {
    postInventoryBid: (input: PostInventoryBidInput) => Promise<ActionResult>;
    acceptInventoryBid: (input: AcceptInventoryBidInput) => Promise<ActionResult>;
    rejectInventoryBid: (input: RejectInventoryBidInput) => Promise<ActionResult>;
    withdrawInventoryBid: (input: WithdrawInventoryBidInput) => Promise<ActionResult>;
  };
  onClose: () => void;
};

export function InventoryBidsTab({ inventoryItem, viewerOrgId, bids, actions, onClose }: Props) {
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const isOwner = viewerOrgId === inventoryItem.ownerOrgId;
  const myBids = bids.filter((b) => b.bidderOrgId === viewerOrgId);

  function on(act: () => Promise<ActionResult>) {
    setActionError(null);
    start(async () => {
      const res = await act();
      if (!res.ok) setActionError(res.error);
    });
  }

  return (
    <aside aria-label="bids" className="border border-text/10 bg-bg p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-gold/80">Bids · {inventoryItem.name}</h2>
        <button onClick={onClose} aria-label="close" className="text-xs text-text/40">Close</button>
      </header>

      {actionError && (
        <p role="alert" className="mb-2 text-xs text-bad">{actionError}</p>
      )}

      {inventoryItem.bidMode === null && (
        <p className="text-xs text-text/50">Bidding is not enabled on this item.</p>
      )}

      {inventoryItem.bidMode !== null && bids.length === 0 && !isOwner && (
        <>
          <p className="text-xs text-text/50">No bids yet — submit one below.</p>
          <PostInventoryBidForm inventoryItemId={inventoryItem.id} postInventoryBid={actions.postInventoryBid} />
        </>
      )}

      {inventoryItem.bidMode !== null && (isOwner || bids.length > 0) && (
        <ul className="divide-y divide-text/10 text-sm">
          {(isOwner ? bids : myBids).map((b) => (
            <li key={b.id} aria-label="bid row" className="flex flex-wrap items-center gap-2 py-2">
              <span className="flex-1 text-text/80">{isOwner ? b.bidderOrgLabel : "You"}</span>
              <span className="font-mono text-text/70">{fmt(b.priceCents, b.currency)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_CLASS[b.status]}`}>{b.status}</span>
              <span className="text-[10px] text-text/40">{timeAgo(b.createdAt)}</span>
              {isOwner && b.status === "pending" && (
                <>
                  <button
                    aria-label={`accept bid ${b.id}`}
                    onClick={() => on(() => actions.acceptInventoryBid({ bidId: b.id }))}
                    disabled={pending}
                    className="text-xs text-emerald-300"
                  >
                    Accept
                  </button>
                  <button
                    aria-label={`reject bid ${b.id}`}
                    onClick={() => on(() => actions.rejectInventoryBid({ bidId: b.id }))}
                    disabled={pending}
                    className="text-xs text-bad"
                  >
                    Reject
                  </button>
                </>
              )}
              {!isOwner && b.bidderOrgId === viewerOrgId && b.status === "pending" && (
                <button
                  aria-label={`withdraw bid ${b.id}`}
                  onClick={() => on(() => actions.withdrawInventoryBid({ bidId: b.id }))}
                  disabled={pending}
                  className="text-xs text-text/60"
                >
                  Withdraw
                </button>
              )}
              {b.notes && <p className="basis-full whitespace-pre-wrap pt-1 text-xs text-text/60">{b.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      {inventoryItem.bidMode !== null && !isOwner && bids.length > 0 && (
        <PostInventoryBidForm inventoryItemId={inventoryItem.id} postInventoryBid={actions.postInventoryBid} />
      )}
    </aside>
  );
}
