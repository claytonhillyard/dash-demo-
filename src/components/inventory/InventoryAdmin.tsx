"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { formatCents } from "@/lib/company/format";
import type { ActionResult } from "@/lib/inventory/actions";
import {
  INVENTORY_CATEGORIES, INVENTORY_STATUSES, METALS,
  type InventoryCategory,
} from "@/lib/inventory/validation";

export interface InventoryRow {
  id: number;
  category: InventoryCategory;
  name: string;
  quantity: number;
  status: string;
  unitCostCents: number;
  retailPriceCents: number;
}

const STONE_CATEGORIES = new Set<InventoryCategory>(["Diamonds", "Gems"]);

export function InventoryAdmin({
  items, createAction, deleteAction,
}: {
  items: InventoryRow[];
  createAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  const [category, setCategory] = useState<InventoryCategory>("Rings");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState<string>("in_stock");
  const [costDollars, setCostDollars] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [metal, setMetal] = useState("");
  const [weightG, setWeightG] = useState("");
  const [carat, setCarat] = useState("");
  const [cut, setCut] = useState("");
  const [color, setColor] = useState("");
  const [clarity, setClarity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const isStone = STONE_CATEGORIES.has(category);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const raw: Record<string, unknown> = {
      category,
      name,
      quantity: Math.round(Number(quantity || 0)),
      status,
      unitCostCents: Math.round(Number(costDollars || 0) * 100),
      retailPriceCents: Math.round(Number(priceDollars || 0) * 100),
    };
    if (isStone) {
      if (carat) raw.caratX100 = Math.round(Number(carat) * 100);
      if (cut) raw.cut = cut;
      if (color) raw.color = color;
      if (clarity) raw.clarity = clarity;
    } else {
      if (metal) raw.metal = metal;
      if (weightG) raw.weightMg = Math.round(Number(weightG) * 1000);
    }
    const res = await createAction(raw);
    setPending(false);
    if (res.ok) {
      setOk(true);
      setName("");
      setQuantity("1");
      setCostDollars("");
      setPriceDollars("");
      setWeightG("");
      setCarat("");
      setCut("");
      setColor("");
      setClarity("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function remove(id: number) {
    setError(null);
    const res = await deleteAction(id);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <section className="surface-card rounded-xl p-4">
      <h2 className="mb-3 font-display tracking-wider text-gold">Inventory</h2>

      <form onSubmit={submit} className="mb-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
        <label className="flex flex-col">
          Category
          <select aria-label="category" className="bg-bg p-2" value={category}
            onChange={(e) => setCategory(e.target.value as InventoryCategory)}>
            {INVENTORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          Name
          <input aria-label="name" className="bg-bg p-2" value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Quantity
          <input aria-label="quantity" type="number" className="bg-bg p-2" value={quantity}
            onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Status
          <select aria-label="status" className="bg-bg p-2" value={status}
            onChange={(e) => setStatus(e.target.value)}>
            {INVENTORY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          Unit cost ($)
          <input aria-label="unit cost" type="number" className="bg-bg p-2" value={costDollars}
            onChange={(e) => setCostDollars(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Retail price ($)
          <input aria-label="retail price" type="number" className="bg-bg p-2" value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)} />
        </label>

        {isStone ? (
          <>
            <label className="flex flex-col">
              Carat
              <input aria-label="carat" type="number" className="bg-bg p-2" value={carat}
                onChange={(e) => setCarat(e.target.value)} />
            </label>
            <label className="flex flex-col">
              Cut
              <input aria-label="cut" className="bg-bg p-2" value={cut}
                onChange={(e) => setCut(e.target.value)} />
            </label>
            <label className="flex flex-col">
              Color
              <input aria-label="color" className="bg-bg p-2" value={color}
                onChange={(e) => setColor(e.target.value)} />
            </label>
            <label className="flex flex-col">
              Clarity
              <input aria-label="clarity" className="bg-bg p-2" value={clarity}
                onChange={(e) => setClarity(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col">
              Metal
              <select aria-label="metal" className="bg-bg p-2" value={metal}
                onChange={(e) => setMetal(e.target.value)}>
                <option value="">—</option>
                {METALS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="flex flex-col">
              Weight (g)
              <input aria-label="weight" type="number" className="bg-bg p-2" value={weightG}
                onChange={(e) => setWeightG(e.target.value)} />
            </label>
          </>
        )}

        <div className="col-span-2 flex items-center justify-between md:col-span-3">
          <button className="rounded bg-gold p-2 text-black" type="submit" disabled={pending}>
            Add item
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-text/40">Add your first item to start tracking inventory.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 py-2">
              <span className="flex-1">{it.name}</span>
              <span className="text-text/50">{it.category}</span>
              <span className="text-text/60">×{it.quantity}</span>
              <span className="text-text/60">{it.status}</span>
              <span className="text-text/60">{formatCents(it.retailPriceCents)}</span>
              <button className="text-bad" onClick={() => remove(it.id)}
                aria-label={`delete ${it.name}`}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
