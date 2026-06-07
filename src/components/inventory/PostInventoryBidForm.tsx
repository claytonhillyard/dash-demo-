"use client";

import { useState, useTransition } from "react";
import type { PostInventoryBidInput } from "@/lib/inventory/bidValidation";
import type { ActionResult } from "@/lib/inventory/actions";

export function PostInventoryBidForm({
  inventoryItemId,
  postInventoryBid,
}: {
  inventoryItemId: number;
  postInventoryBid: (input: PostInventoryBidInput) => Promise<ActionResult>;
}) {
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<"USD" | "EUR" | "INR" | "JPY">("USD");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cents = (() => {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  })();

  function submit() {
    setError(null);
    start(async () => {
      const res = await postInventoryBid({
        inventoryItemId,
        priceCents: cents,
        currency,
        notes: notes.trim() ? notes.trim() : undefined,
      });
      if (res.ok) {
        setPrice("");
        setNotes("");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="space-y-2 border-t border-text/10 pt-3"
    >
      <div className="flex gap-2">
        <input
          aria-label="price"
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Price"
          className="flex-1 bg-bg p-1 text-sm"
        />
        <select
          aria-label="currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value as "USD" | "EUR" | "INR" | "JPY")}
          className="bg-bg p-1 text-sm"
        >
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="INR">INR</option>
          <option value="JPY">JPY</option>
        </select>
      </div>
      <textarea
        aria-label="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional, ≤500 chars)"
        maxLength={500}
        className="w-full bg-bg p-1 text-xs"
        rows={2}
      />
      <button
        type="submit"
        disabled={pending || cents === 0}
        className="rounded border border-gold/40 px-3 py-1 text-xs uppercase tracking-wider text-gold/80 disabled:opacity-40"
      >
        {pending ? "Submitting…" : "Place Bid"}
      </button>
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </form>
  );
}
