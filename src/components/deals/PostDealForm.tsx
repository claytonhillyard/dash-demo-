"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { DEAL_KINDS, DEAL_CATEGORIES, type DealKind, type DealCategory } from "@/lib/deals/constants";
import type { ActionResult } from "@/lib/deals/actions";

export interface CircleOption {
  id: number;
  name: string;
}

export function PostDealForm({
  postAction,
  circles = [],
}: {
  postAction: (raw: unknown) => Promise<ActionResult>;
  /** The viewer's circles — drives the "Share with" dropdown. Pass [] (or omit)
   *  for an org with no memberships; the dropdown is hidden in that case. */
  circles?: CircleOption[];
}) {
  const router = useRouter();
  const formId = useId();
  const [kind, setKind] = useState<DealKind>("SELL");
  const [category, setCategory] = useState<DealCategory>("Diamond");
  const [subject, setSubject] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priceDollars, setPriceDollars] = useState("");
  const [visibilityCircleId, setVisibilityCircleId] = useState<number | null>(null);
  const [threadMode, setThreadMode] = useState<"private" | "group">("private");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const raw: Record<string, unknown> = {
      kind,
      category,
      subject: subject.trim(),
      quantity: Math.round(Number(quantity || 0)),
      priceCents: Math.round(Number(priceDollars || 0) * 100),
      visibilityCircleId,
    };
    // Per the plan: thread_mode is moot for owner-only deals — only stamp it
    // when the deal is being shared into a circle.
    if (visibilityCircleId !== null) {
      raw.threadMode = threadMode;
    }
    const res = await postAction(raw);
    setPending(false);
    if (res.ok) {
      setOk(true);
      setSubject("");
      setQuantity("1");
      setPriceDollars("");
      setVisibilityCircleId(null);
      setThreadMode("private");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <form onSubmit={submit} className="surface-card mb-4 grid grid-cols-2 gap-2 rounded-xl p-4 text-sm md:grid-cols-3">
      <label className="flex flex-col">
        Kind
        <select aria-label="kind" className="bg-bg p-2" value={kind}
          onChange={(e) => setKind(e.target.value as DealKind)}>
          {DEAL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label className="flex flex-col">
        Category
        <select aria-label="category" className="bg-bg p-2" value={category}
          onChange={(e) => setCategory(e.target.value as DealCategory)}>
          {DEAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="flex flex-col md:col-span-1">
        Quantity
        <input aria-label="quantity" type="number" min={1} className="bg-bg p-2" value={quantity}
          onChange={(e) => setQuantity(e.target.value)} />
      </label>
      <label className="col-span-2 flex flex-col md:col-span-2">
        Subject
        <input aria-label="subject" maxLength={280} className="bg-bg p-2" value={subject}
          onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="flex flex-col">
        Price ($)
        <input aria-label="price" type="number" min={0} step="0.01" className="bg-bg p-2"
          value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)} />
      </label>
      {circles.length > 0 && (
        <label className="col-span-2 flex flex-col md:col-span-1">
          Share with
          <select
            aria-label="visibility"
            className="bg-bg p-2"
            value={visibilityCircleId ?? ""}
            onChange={(e) => setVisibilityCircleId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Private (your org only)</option>
            {circles.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}
      {visibilityCircleId !== null && (
        <fieldset className="col-span-2 flex flex-col gap-1 md:col-span-3" aria-label="thread mode">
          <legend className="text-xs text-text/60">Replies</legend>
          <label className="text-xs text-text/80">
            <input
              type="radio"
              name={`thread-mode-${formId}`}
              value="private"
              checked={threadMode === "private"}
              onChange={() => setThreadMode("private")}
              className="mr-1"
            />
            Private — replies are 1-to-1 with you (default)
          </label>
          <label className="text-xs text-text/80">
            <input
              type="radio"
              name={`thread-mode-${formId}`}
              value="group"
              checked={threadMode === "group"}
              onChange={() => setThreadMode("group")}
              className="mr-1"
            />
            Group — replies visible to everyone in this circle
          </label>
        </fieldset>
      )}
      <div className="col-span-2 flex items-center justify-between md:col-span-3">
        <button type="submit" disabled={pending} className="rounded bg-gold p-2 text-black disabled:opacity-50">
          Post deal
        </button>
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}
