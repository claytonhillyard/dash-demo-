"use client";

import { useState, useTransition } from "react";
import type { PostInventoryBidInput } from "@/lib/inventory/bidValidation";
import type { ActionResult } from "@/lib/inventory/actions";

export function PostInventoryBidForm({
  inventoryItemId,
  availableQuantity,
  postInventoryBid,
}: {
  inventoryItemId: number;
  availableQuantity: number;
  postInventoryBid: (input: PostInventoryBidInput) => Promise<ActionResult>;
}) {
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<"USD" | "EUR" | "INR" | "JPY">("USD");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cents = (() => {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  })();

  const qty = (() => {
    const n = Number(quantity);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return 0;
    return n;
  })();

  const overStock = qty > availableQuantity;

  function submit() {
    setError(null);
    if (overStock) return;
    start(async () => {
      const res = await postInventoryBid({
        inventoryItemId,
        priceCents: cents,
        currency,
        notes: notes.trim() ? notes.trim() : undefined,
        quantityRequested: qty,
      });
      if (res.ok) {
        setPrice("");
        setNotes("");
        setQuantity("1");
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
      <p className="text-[10px] text-text/40">
        Available: {availableQuantity} unit{availableQuantity === 1 ? "" : "s"}
      </p>
      <div className="flex gap-2">
        <input
          aria-label="quantity"
          type="number"
          min={1}
          max={availableQuantity}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Qty"
          className="w-16 bg-bg p-1 text-sm"
        />
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
      {overStock && (
        <p role="alert" className="text-xs text-bad">
          Cannot bid for more than {availableQuantity} units.
        </p>
      )}
      <button
        type="submit"
        disabled={pending || cents === 0 || qty === 0 || overStock}
        className="rounded border border-gold/40 px-3 py-1 text-xs uppercase tracking-wider text-gold/80 disabled:opacity-40"
      >
        {pending ? "Submitting…" : "Place Bid"}
      </button>
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </form>
  );
}
