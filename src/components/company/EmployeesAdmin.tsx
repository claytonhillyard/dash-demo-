"use client";

import { useState } from "react";
import { FormStatus } from "./FormStatus";
import type { ActionResult } from "@/lib/company/actions";

export interface EmployeeRow {
  id: number;
  name: string;
  role: string;
  hiredOn: string;
}

export function EmployeesAdmin({
  rows,
  createAction,
  deleteAction,
}: {
  rows: EmployeeRow[];
  createAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [hiredOn, setHiredOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setPending(true);
    const res = await createAction({ name, role, hiredOn });
    setPending(false);
    if (res.ok) {
      setOk(true);
      setName("");
      setRole("");
      setHiredOn("");
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="rounded-lg bg-surface p-4">
      <h2 className="font-display text-gold mb-3 tracking-wider">Employees</h2>
      <form onSubmit={submit} className="mb-4 grid grid-cols-3 gap-2 text-sm">
        <label className="flex flex-col">
          Name
          <input
            aria-label="employee name"
            className="bg-bg p-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Role
          <input aria-label="role" className="bg-bg p-2" value={role} onChange={(e) => setRole(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Hired on
          <input
            aria-label="hired on"
            type="date"
            className="bg-bg p-2"
            value={hiredOn}
            onChange={(e) => setHiredOn(e.target.value)}
          />
        </label>
        <div className="col-span-3 flex items-center justify-between">
          <button className="bg-gold p-2 text-black" type="submit" disabled={pending}>
            Add employee
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="text-text/40 text-sm">Add your first employee to track headcount.</p>
      ) : (
        <ul className="divide-y divide-text/10 text-sm">
          {rows.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2">
              <span>{e.name}</span>
              <span className="text-text/60">{e.role}</span>
              <span className="text-text/40">{e.hiredOn}</span>
              <button className="text-bad" onClick={() => deleteAction(e.id)} aria-label={`delete ${e.name}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
