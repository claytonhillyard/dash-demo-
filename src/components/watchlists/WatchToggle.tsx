"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { watchEntity, unwatchEntity } from "@/lib/watchlists/actions";
import type { ActivityEntityType } from "@/lib/activity/types";

/**
 * Watch/unwatch toggle for a single entity. Mirrors CustomerForm's
 * action-call conventions: useTransition + inline role="alert" error +
 * router.refresh() on success (the server passes fresh `initial` state on
 * the next render).
 *
 * Unwatched → email input + "Watch" button (calls watchEntity).
 * Watched   → "Watching" label + "Unwatch" button (calls unwatchEntity).
 */
export function WatchToggle({
  entityType,
  entityId,
  initial,
}: {
  entityType: ActivityEntityType;
  entityId: number;
  initial: { watching: boolean; notifyEmail: string | null };
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initial.notifyEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitWatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await watchEntity({
        entityType,
        entityId,
        notifyEmail: email.trim(),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function submitUnwatch() {
    setError(null);
    startTransition(async () => {
      const res = await unwatchEntity({ entityType, entityId });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (initial.watching) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-gold">Watching</span>
          <button
            type="button"
            onClick={submitUnwatch}
            disabled={pending}
            className="rounded border border-border px-3 py-1.5 text-xs uppercase tracking-wider text-text/70 hover:text-text disabled:opacity-50"
          >
            {pending ? "Unwatching…" : "Unwatch"}
          </button>
        </div>
        <FormStatus error={error} />
      </div>
    );
  }

  return (
    <form onSubmit={submitWatch} className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Notify email
          <input
            aria-label="notify email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            maxLength={200}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <button
          type="submit"
          disabled={pending || email.trim() === ""}
          className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
        >
          {pending ? "Watching…" : "Watch"}
        </button>
      </div>
      <FormStatus error={error} />
    </form>
  );
}
