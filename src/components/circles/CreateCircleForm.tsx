"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";

export function CreateCircleForm({
  createAction,
}: {
  createAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  function normalizeSlug(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await createAction({ name: name.trim(), slug: normalizeSlug(slug) });
      if (res.ok) {
        setOk(true);
        setName("");
        setSlug("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-text/40">Create a circle</h2>
      <form onSubmit={submit} className="surface-card grid grid-cols-2 gap-2 rounded-xl p-4 text-sm">
        <label className="flex flex-col">
          Name
          <input aria-label="circle-name" className="bg-bg p-2" maxLength={120}
            value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col">
          Slug
          <input aria-label="circle-slug" className="bg-bg p-2" maxLength={64}
            value={slug} onChange={(e) => setSlug(e.target.value)}
            onBlur={(e) => setSlug(normalizeSlug(e.target.value))} />
        </label>
        <div className="col-span-2 flex items-center justify-between">
          <button type="submit" disabled={pending}
            className="rounded bg-gold p-2 text-black disabled:opacity-50">
            Create circle
          </button>
          {error && <span className="text-sm text-bad">{error}</span>}
          {ok && <span className="text-sm text-ok">Created.</span>}
        </div>
      </form>
    </section>
  );
}
