"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";
import { formatCents } from "@/lib/company/format";

export interface ClientRow {
  id: number;
  name: string;
  status: "active" | "prospect" | "churned";
  valueCents: number;
  acquiredOn: string;
}

export function ClientsAdmin({
  clients,
  createAction,
  deleteAction,
}: {
  clients: ClientRow[];
  createAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<ClientRow["status"]>("active");
  const [valueDollars, setValueDollars] = useState("");
  const [acquiredOn, setAcquiredOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const res = await createAction({
      name,
      status,
      valueCents: Math.round(Number(valueDollars || 0) * 100),
      acquiredOn,
    });
    setPending(false);
    if (res.ok) {
      setOk(true);
      setName("");
      setValueDollars("");
      setAcquiredOn("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function remove(id: number) {
    setError(null);
    const res = await deleteAction(id);
    if (res.ok) {
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">Clients</h2>

      <form onSubmit={submit} className="mb-4 grid grid-cols-2 gap-2 text-sm">
        <label className="flex flex-col">
          Name
          <input aria-label="name" className="bg-bg p-2" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Status
          <select
            aria-label="status"
            className="bg-bg p-2"
            value={status}
            onChange={(e) => setStatus(e.target.value as ClientRow["status"])}
          >
            <option value="active">active</option>
            <option value="prospect">prospect</option>
            <option value="churned">churned</option>
          </select>
        </label>
        <label className="flex flex-col">
          Value ($)
          <input
            aria-label="value"
            type="number"
            className="bg-bg p-2"
            value={valueDollars}
            onChange={(e) => setValueDollars(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Acquired on
          <input
            aria-label="acquired on"
            type="date"
            className="bg-bg p-2"
            value={acquiredOn}
            onChange={(e) => setAcquiredOn(e.target.value)}
          />
        </label>
        <div className="col-span-2 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Add client
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>

      {clients.length === 0 ? (
        <p className="text-text/40 text-sm">Add your first client to start tracking the book.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {clients.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <span>{c.name}</span>
              <span className="text-text/60">{c.status}</span>
              <span className="text-text/60">{formatCents(c.valueCents)}</span>
              <button className="text-bad" onClick={() => remove(c.id)} aria-label={`delete ${c.name}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
