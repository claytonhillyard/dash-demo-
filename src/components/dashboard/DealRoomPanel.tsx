"use client";

import Link from "next/link";
import { useState } from "react";
import { Panel } from "@/components/Panel";
import { formatCents, timeAgo } from "@/lib/company/format";
import { formatDealVisibility } from "@/lib/deals/format";
import { DealThreadAccordion } from "@/components/deals/DealThreadAccordion";
import type { DealRow } from "@/lib/deals/queries";
import type { DealKind } from "@/lib/deals/constants";
import type { DealMessageView } from "@/db/dealMessages";
import type { BidView } from "@/db/bids";

// Fixed lookup so user input never reaches a className expression.
const KIND_CLASS: Record<DealKind, string> = {
  BUY: "text-ok",
  SELL: "text-gold",
};

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

export type DealRoomPanelActions = {
  postMessage: (input: { dealId: number; body: string }) => Promise<ActionResult>;
  setMode: (input: { dealId: number; mode: "private" | "group" }) => Promise<ActionResult>;
  deleteMessage: (input: { messageId: number }) => Promise<ActionResult>;
  markRead: (input: { dealId: number }) => Promise<ActionResult>;
};

/** Builds the panel subtitle. Driven by the viewer's circle map so the
 *  affordance is data-driven, not hardcoded. */
function circlesSubtitle(circleNamesById: Map<number, string>): string | null {
  if (circleNamesById.size === 0) return null;
  if (circleNamesById.size === 1) {
    // Mockup wording: "AIYA Trusted Partners (2 partner orgs)" — but we don't
    // have the member count cheaply here, so we render the circle name only.
    // The richer "N partner orgs" affordance ships in slice 4c with the
    // /circles route, where member counts are already loaded.
    const [name] = circleNamesById.values();
    return `Connected via ${name}`;
  }
  return `Connected to ${circleNamesById.size} circles`;
}

export type DealRoomPanelBidActions = {
  postBid: (input: { dealId: number; priceCents: number; currency?: string; notes?: string }) =>
    Promise<ActionResult>;
  acceptBid: (input: { bidId: number }) => Promise<ActionResult>;
  rejectBid: (input: { bidId: number }) => Promise<ActionResult>;
  withdrawBid: (input: { bidId: number }) => Promise<ActionResult>;
  setBidMode: (input: { dealId: number; mode: "single" | "history" }) => Promise<ActionResult>;
};

export function DealRoomPanel({
  deals,
  currentOrgId,
  circleNamesById,
  viewerOrgId,
  viewerCircleIds,
  unreadByDealId,
  threadsByDealId,
  threadModeByDealId,
  actions,
  bidsByDealId,
  bidModeByDealId,
  bidActions,
}: {
  deals: DealRow[];
  currentOrgId: number;
  circleNamesById: Map<number, string>;
  /** Slice-10: the viewer's own org id. When omitted, falls back to currentOrgId. */
  viewerOrgId?: number;
  /** Slice-10: set of circle ids the viewer belongs to, used to derive canPost
   *  for non-owner viewers in group-mode threads. Optional — when absent the
   *  panel treats non-owners as out-of-circle and disables posting. */
  viewerCircleIds?: ReadonlySet<number>;
  /** Slice-10: per-deal unread count for the viewer. */
  unreadByDealId?: Map<number, number>;
  /** Slice-10: per-deal preloaded messages for the accordion. */
  threadsByDealId?: Map<number, DealMessageView[]>;
  /** Slice-10: per-deal current thread_mode, populated ONLY for deals the
   *  viewer owns (gates rendering the mode selector). */
  threadModeByDealId?: Map<number, "private" | "group">;
  actions?: DealRoomPanelActions;
  /** Slice-16: per-deal preloaded bids for the Bids tab. */
  bidsByDealId?: Map<number, BidView[]>;
  /** Slice-16: per-deal owner-only bid_mode (populated only for deals the
   *  viewer owns; gates the owner's bid display selector). */
  bidModeByDealId?: Map<number, "single" | "history">;
  /** Slice-16: bid server actions, threaded through to DealBidsTab. */
  bidActions?: DealRoomPanelBidActions;
}) {
  const subtitle = circlesSubtitle(circleNamesById);
  const viewer = viewerOrgId ?? currentOrgId;
  const [openDealId, setOpenDealId] = useState<number | null>(null);

  if (deals.length === 0) {
    return (
      <Panel
        title="Deal Room"
        state="ready"
        action={
          <Link href="/deals" className="text-[10px] uppercase tracking-widest text-text/40 hover:text-gold">
            View all
          </Link>
        }
      >
        <div className="py-6 text-center text-sm text-text/40">
          No open deals — post one from the Deal Room.
        </div>
        {subtitle && (
          <div className="border-t border-text/10 pt-2 text-center text-[10px] uppercase tracking-widest text-text/40">
            {subtitle}
          </div>
        )}
      </Panel>
    );
  }
  return (
    <Panel
      title="Deal Room"
      state="ready"
      action={
        <Link href="/deals" className="text-[10px] uppercase tracking-widest text-text/40 hover:text-gold">
          View all
        </Link>
      }
    >
      {subtitle && (
        <div className="mb-1 text-[10px] uppercase tracking-widest text-text/40" data-testid="deal-room-circle-subtitle">
          {subtitle}
        </div>
      )}
      <ul className="divide-y divide-text/10 text-sm">
        {deals.map((d) => {
          const vis = formatDealVisibility(d.visibilityCircleId, circleNamesById);
          const isForeign = d.orgId !== currentOrgId;
          const badgeTooltip =
            vis.kind === "circle"
              ? isForeign
                ? `Shared by ${d.postedByLabel} via ${vis.circleName}`
                : `Shared with ${vis.circleName}`
              : undefined;
          const unread = unreadByDealId?.get(d.id) ?? 0;
          const threadMessages = threadsByDealId?.get(d.id) ?? [];
          const total = threadMessages.length;
          const isOwner = d.orgId === viewer;
          const ownerThreadMode = threadModeByDealId?.get(d.id) ?? null;
          // canPost derivation (mirrors Phase B's actions authz):
          //   - owner: always true
          //   - in-circle non-owner: true iff deal's thread_mode is 'group'
          //   - out-of-circle: false
          // Source of thread mode for non-owners: the deal row itself (snapshot
          // of the per-deal column, populated by Phase A's schema add).
          const inCircle =
            d.visibilityCircleId !== null &&
            (viewerCircleIds?.has(d.visibilityCircleId) ?? false);
          const canPost = isOwner ? true : inCircle && d.threadMode === "group";
          return (
            <li key={d.id} className="flex flex-col gap-1 py-2">
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[10px] uppercase tracking-wider ${KIND_CLASS[d.kind]}`}>
                  {d.kind}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-text/40">{d.category}</span>
                <span className="flex-1 truncate text-text/80" title={d.subject}>{d.subject}</span>
                {vis.kind === "circle" && (
                  <span
                    className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80"
                    title={badgeTooltip}
                    data-testid="deal-visibility-badge"
                  >
                    {vis.circleName}
                  </span>
                )}
                <span className="font-mono text-text">{formatCents(d.priceCents)}</span>
                <span className="text-[10px] text-text/40">{timeAgo(d.createdAt)}</span>
                {total > 0 && (
                  unread > 0 ? (
                    <span className="text-xs text-rose-400 ml-2">🔴 {unread} new</span>
                  ) : (
                    <span className="text-xs text-zinc-500 ml-2">💬 {total}</span>
                  )
                )}
                {actions && (
                  <button
                    aria-label={`toggle thread for deal ${d.id}`}
                    className="ml-2 text-zinc-500 hover:text-zinc-200"
                    onClick={() => {
                      const willOpen = openDealId !== d.id;
                      setOpenDealId(willOpen ? d.id : null);
                      if (willOpen) {
                        // fire-and-forget — UI updates optimistically
                        void actions.markRead({ dealId: d.id });
                      }
                    }}
                  >
                    {openDealId === d.id ? "▾" : "▸"}
                  </button>
                )}
              </div>
              {openDealId === d.id && actions && (
                <DealThreadAccordion
                  dealId={d.id}
                  viewerOrgId={viewer}
                  isOwner={isOwner}
                  currentMode={ownerThreadMode}
                  messages={threadMessages}
                  canPost={canPost}
                  actions={{
                    postMessage: actions.postMessage,
                    setMode: actions.setMode,
                    deleteMessage: actions.deleteMessage,
                  }}
                  bids={bidsByDealId?.get(d.id) ?? []}
                  currentBidMode={isOwner ? (bidModeByDealId?.get(d.id) ?? null) : null}
                  bidActions={bidActions}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
