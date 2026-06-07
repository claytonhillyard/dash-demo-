"use client";

import { useState, useTransition } from "react";
import type { DealMessageView } from "@/db/dealMessages";
import type { BidView } from "@/db/bids";
import type { DealAttachmentView } from "@/db/dealAttachments";
import { DealBidsTab } from "./DealBidsTab";
import { DealAttachmentCarousel } from "./DealAttachmentCarousel";

export type DealThreadAccordionProps = {
  dealId: number;
  viewerOrgId: number;
  isOwner: boolean;
  /** Null when viewer is not the owner (mode selector is hidden). */
  currentMode: "private" | "group" | null;
  messages: DealMessageView[];
  /**
   * Whether the viewer is allowed to post a reply to this thread.
   * - Owner: always true.
   * - In-circle non-owner: true iff `currentMode === "group"` (private mode is owner-only per Phase B authz).
   * - Out-of-circle: false.
   *
   * Optional with default true to preserve the plan's component-test fixtures
   * (which assume the input renders unconditionally). The RSC + DealRoomPanel
   * pass it explicitly so non-posters never see an input.
   */
  canPost?: boolean;
  /** Server actions, passed in so the component is testable without next/server. */
  actions: {
    postMessage: (input: { dealId: number; body: string }) => Promise<
      { ok: true } | { ok: false; error: string }
    >;
    setMode: (input: { dealId: number; mode: "private" | "group" }) => Promise<
      { ok: true } | { ok: false; error: string }
    >;
    deleteMessage: (input: { messageId: number }) => Promise<
      { ok: true } | { ok: false; error: string }
    >;
  };
  // --- Slice 16: optional bid props (default to safe no-op when omitted) ---
  /** Per-deal preloaded bids for the Bids tab. Defaults to []. */
  bids?: BidView[];
  /** Owner's current bid display mode. Null for non-owners (selector hidden). */
  currentBidMode?: "single" | "history" | null;
  /** Bid action wiring. When omitted, the Bids tab silently no-ops. */
  bidActions?: {
    postBid: (input: { dealId: number; priceCents: number; currency?: string; notes?: string }) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
    acceptBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    rejectBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    withdrawBid: (input: { bidId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
    setBidMode: (input: { dealId: number; mode: "single" | "history" }) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
  };
  // --- Slice 17: optional attachment props (default to safe no-op when omitted) ---
  /** Per-deal preloaded attachments for the carousel. Defaults to []. */
  attachments?: DealAttachmentView[];
  /** Per-attachment signed URLs (or public CDN URLs in demo). Defaults to empty Map. */
  attachmentSignedUrls?: Map<number, string>;
  /** Attachment action wiring. When omitted, owner upload/delete silently fails closed. */
  attachmentActions?: {
    uploadAttachment: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
    deleteAttachment: (input: { attachmentId: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function DealThreadAccordion(props: DealThreadAccordionProps) {
  // Defense-in-depth: default canPost to FALSE. Any callsite that omits the
  // prop should get the safe "view-only" rendering, not a reply input that
  // would round-trip to a server Forbidden. Server-side authz still gates
  // the actual post — this just keeps the UI honest about what's allowed.
  // (Slice-10 review finding S5.)
  const canPost = props.canPost ?? false;
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"messages" | "bids">("messages");

  const handleSend = () => {
    setError(null);
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    startTransition(async () => {
      const res = await props.actions.postMessage({ dealId: props.dealId, body: trimmed });
      if (res.ok) setBody("");
      else setError(res.error);
    });
  };

  // Build banner positions: every place where adjacent messages differ in mode
  const banners: { afterIndex: number; mode: "private" | "group"; at: Date }[] = [];
  for (let i = 1; i < props.messages.length; i++) {
    if (props.messages[i].threadMode !== props.messages[i - 1].threadMode) {
      banners.push({
        afterIndex: i - 1,
        mode: props.messages[i].threadMode,
        at: props.messages[i].createdAt,
      });
    }
  }
  const bannerAfter = new Map(banners.map((b) => [b.afterIndex, b]));

  const defaultBidActions = {
    postBid: async () => ({ ok: false as const, error: "Bid actions not configured" }),
    acceptBid: async () => ({ ok: false as const, error: "Bid actions not configured" }),
    rejectBid: async () => ({ ok: false as const, error: "Bid actions not configured" }),
    withdrawBid: async () => ({ ok: false as const, error: "Bid actions not configured" }),
    setBidMode: async () => ({ ok: false as const, error: "Bid actions not configured" }),
  };

  const defaultAttachmentActions = {
    uploadAttachment: async () => ({ ok: false as const, error: "Upload not configured" }),
    deleteAttachment: async () => ({ ok: false as const, error: "Delete not configured" }),
  };

  return (
    <div aria-label="deal thread" className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
      <DealAttachmentCarousel
        dealId={props.dealId}
        isOwner={props.isOwner}
        attachments={props.attachments ?? []}
        signedUrls={props.attachmentSignedUrls ?? new Map()}
        actions={props.attachmentActions ?? defaultAttachmentActions}
      />
      <div role="tablist" className="flex gap-2 mb-2 text-xs border-b border-zinc-700 pb-1">
        <button
          role="tab"
          aria-selected={tab === "messages"}
          onClick={() => setTab("messages")}
          className={`px-2 py-0.5 rounded ${tab === "messages" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          Messages
        </button>
        <button
          role="tab"
          aria-selected={tab === "bids"}
          onClick={() => setTab("bids")}
          className={`px-2 py-0.5 rounded ${tab === "bids" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          Bids
        </button>
      </div>

      {tab === "bids" ? (
        <DealBidsTab
          dealId={props.dealId}
          viewerOrgId={props.viewerOrgId}
          isOwner={props.isOwner}
          currentBidMode={props.currentBidMode ?? null}
          bids={props.bids ?? []}
          actions={props.bidActions ?? defaultBidActions}
        />
      ) : (
        <>
      {props.isOwner && props.currentMode !== null && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <label htmlFor={`mode-${props.dealId}`} className="text-zinc-400">Mode:</label>
          <select
            id={`mode-${props.dealId}`}
            aria-label="thread mode"
            value={props.currentMode}
            disabled={pending}
            onChange={(e) =>
              startTransition(async () => {
                await props.actions.setMode({
                  dealId: props.dealId,
                  mode: e.target.value as "private" | "group",
                });
              })
            }
            className="bg-zinc-800 text-zinc-100 px-1 py-0.5 rounded"
          >
            <option value="private">Private</option>
            <option value="group">Group</option>
          </select>
          <span className="text-zinc-500" title="This only affects new replies. Earlier messages stay where they were sent.">
            (future replies only)
          </span>
        </div>
      )}

      {props.messages.length === 0 ? (
        <p className="text-sm text-zinc-500 mb-2">No replies yet. Be the first.</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {props.messages.map((m, i) => (
            <li key={m.id} aria-label="thread message">
              {m.isDeleted ? (
                <p className="italic text-xs text-zinc-500">
                  {m.fromOrgLabel} deleted a message · {relativeTime(m.createdAt)}
                </p>
              ) : (
                <div>
                  <p className="text-xs text-zinc-400">
                    {m.fromOrgLabel} · {relativeTime(m.createdAt)} · {m.threadMode}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-zinc-100">{m.body}</p>
                  {m.fromOrgId === props.viewerOrgId &&
                    Date.now() - m.createdAt.getTime() < 15 * 60 * 1000 && (
                      <button
                        className="text-xs text-zinc-500 hover:text-rose-400 mt-1"
                        onClick={() =>
                          startTransition(async () => {
                            await props.actions.deleteMessage({ messageId: m.id });
                          })
                        }
                      >
                        Delete
                      </button>
                    )}
                </div>
              )}
              {bannerAfter.has(i) && (
                <p className="text-xs text-amber-300/80 mt-1">
                  Mode switched to {bannerAfter.get(i)!.mode} at {relativeTime(bannerAfter.get(i)!.at)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canPost ? (
        <div className="flex flex-col gap-1">
          <textarea
            aria-label="reply body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a reply..."
            maxLength={2000}
            rows={2}
            className="w-full bg-zinc-800 text-zinc-100 text-sm p-2 rounded"
          />
          {error && (
            <p role="alert" className="text-xs text-rose-400">{error}</p>
          )}
          <button
            onClick={handleSend}
            disabled={pending || body.trim().length === 0}
            className="self-end text-xs px-2 py-1 bg-amber-500/80 hover:bg-amber-500 text-zinc-900 rounded disabled:opacity-50"
          >
            {pending ? "Sending..." : "Send"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-zinc-500 italic">
          Replies are limited to the deal owner while this thread is private.
        </p>
      )}
        </>
      )}
    </div>
  );
}
