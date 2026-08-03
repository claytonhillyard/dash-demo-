"use client";

import { useState, useTransition } from "react";
import { getNegotiationCoaching } from "@/lib/negotiation/actions";
import type { NegotiationCoachingResult } from "@/lib/negotiation/actions";
import type { NegotiationStats } from "@/lib/negotiation/compute";
import { formatCentsExact } from "@/lib/company/format";
import { FormStatus } from "@/components/company/FormStatus";

export type NegotiationCoachCardProps = {
  dealId: number;
  leadBidderOrgId: number;
  leadBidderLabel: string;
};

/**
 * NegotiationCoachCard — the "Coach me" affordance in a deal's Bids tab
 * (slice 42 spec, docs/superpowers/plans/2026-07-31-negotiation-coach-slice-42.md,
 * Task 42-3). Owner-only, on-demand: nothing is fetched or computed until
 * the owner clicks, so a dashboard render never bills the AI seam.
 *
 * Conventions mirror SendInvoicePanel/PaymentsPanel exactly: plain buttons
 * (no <form>), a single useTransition, FormStatus for the house alert.
 *
 * Client-bundle rule: this file imports ONLY the server action (its
 * "use server" directive is what strips the real db/compute implementation
 * out of the client bundle, leaving just an RPC stub), React, formatCentsExact,
 * and the stats/result types via `import type` (erased at compile time) —
 * NEVER src/lib/negotiation/compute.ts or any src/db/* module as a value.
 */
export function NegotiationCoachCard(props: NegotiationCoachCardProps) {
  const [result, setResult] = useState<NegotiationCoachingResult | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCoachMe() {
    // Belt-and-suspenders alongside the button's `disabled={pending}` —
    // a real disabled <button> already swallows the click at the DOM
    // level, but this guard keeps a double-fire impossible even if that
    // ever changes (no double-fire requirement, spec Task 42-3).
    if (pending) return;
    startTransition(async () => {
      const res = await getNegotiationCoaching({
        dealId: props.dealId,
        bidderOrgId: props.leadBidderOrgId,
      });
      setResult(res);
    });
  }

  return (
    <div className="surface-card flex flex-col gap-3 rounded-xl p-4 text-sm" aria-label="negotiation coach">
      <h2 className="text-[10px] uppercase tracking-widest text-text/40">Negotiation coach</h2>

      {result === null && (
        <p className="text-text/70 text-sm">
          Analyzes your negotiation history with {props.leadBidderLabel}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCoachMe}
          disabled={pending}
          className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
        >
          {pending ? "Coaching…" : "Coach me"}
        </button>
      </div>

      {result?.ok && result.stats.kind === "coached" && (
        <CoachedVerdict stats={result.stats} lines={result.lines} />
      )}

      {result?.ok && result.stats.kind === "insufficient_history" && (
        <InsufficientVerdict stats={result.stats} />
      )}

      {result?.ok && result.simulated && (
        <p className="text-text/70 text-sm">
          Simulated — set AI_GATEWAY_API_KEY for live coaching
        </p>
      )}

      {result && !result.ok && <FormStatus error={result.error} />}
    </div>
  );
}

function CoachedVerdict({
  stats,
  lines,
}: {
  stats: Extract<NegotiationStats, { kind: "coached" }>;
  lines: string[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-text/80">
        {lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <p className="text-xs text-text/60" aria-label="coach stat strip">
        {/* "N of M decided", not "M% win rate": the denominator counts only
            negotiations you explicitly decided, so deals this partner lost to
            a competing bidder are not in it. Calling that a win rate would
            over-claim — and this is advice you act on (review finding). */}
        {stats.closes} of {stats.decidedDeals} decided ({stats.winRatePct}%) ·{" "}
        {formatCentsExact(stats.avgUpliftCents)} avg uplift · {stats.avgRounds} avg rounds
      </p>
      <div className="flex flex-col items-start gap-0.5 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2">
        <span className="text-[10px] uppercase tracking-widest text-text/40">Suggested counter</span>
        <span className="text-foil text-2xl font-semibold" aria-label="suggested counter">
          {formatCentsExact(stats.suggestedCounterCents)}
        </span>
      </div>
    </div>
  );
}

function InsufficientVerdict({
  stats,
}: {
  stats: Extract<NegotiationStats, { kind: "insufficient_history" }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* Built as ONE expression, not interleaved JSX children: separate
          children become separate text nodes, which breaks a contiguous
          `findByText` regex (and SSR splits them with comment nodes). */}
      <p className="text-text/80 text-sm">
        {`Not enough history with ${stats.partnerLabel} yet (${stats.closes} ${
          stats.closes === 1 ? "close" : "closes"
        }).`}
      </p>
      <p className="text-xs text-text/60">
        Their best bid:{" "}
        {stats.currentBestCents === null ? "no pending bid" : formatCentsExact(stats.currentBestCents)}
        {" · "}Your ask: {formatCentsExact(stats.askCents)}
      </p>
    </div>
  );
}
