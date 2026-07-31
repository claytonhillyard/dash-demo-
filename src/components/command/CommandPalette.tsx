"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { FormStatus } from "@/components/company/FormStatus";
import { runCommand, confirmWriteCommand } from "@/lib/command/actions";
import type { CommandResult } from "@/lib/command/registry";

/**
 * AI command palette (slice 35a-3, extended by slice 35b-3 for write
 * commands, spec §6). Client component — receives `helpExamples` as a page
 * prop (static strings only, from `HELP_EXAMPLES` — src/app/(admin)/command/
 * page.tsx is the only place in the client-facing tree that imports
 * src/lib/command/registry.ts) and calls the `runCommand`/`confirmWriteCommand`
 * server actions. Only `CommandResult` is imported here from `registry.ts`,
 * and only as a TYPE (`import type`) — same convention PaymentsPanel/
 * SendInvoicePanel already use for `@/db/invoices`/`@/db/payments` — so it's
 * erased at compile time and the db graph registry.ts pulls in never reaches
 * the client bundle (verified structurally by `npx next build`, per the
 * task's client-bundle check). This file imports NOTHING — value or type —
 * from `@/lib/command/writeRegistry`: everything it needs about a write
 * command's id/params comes back to it already erased down to plain
 * `string`/`unknown` inside `CommandResult`'s `confirm` variant, and
 * `runCommand`/`confirmWriteCommand` (both "use server" actions) are safe
 * value imports — Next.js compiles those into thin client RPC stubs, so the
 * db graph and the three guarded delegate actions they pull in never reach
 * this bundle either.
 *
 * Router-free by design (no next/navigation) — every result comes back
 * inline from the action's response, so there's never anything to refresh.
 *
 * History keeps the last MAX_HISTORY successful Q->result pairs, most-recent
 * first, in local state only (no persistence). A failed submission
 * (`{ok:false}`) shows a transient alert instead of joining history — there's
 * no CommandResult to store for it, and it mirrors every other panel's
 * inline-error convention (PaymentsPanel/SendInvoicePanel/DraftEmailPanel).
 *
 * A `confirm`-kind result (slice 35b) additionally carries a `writeStatus`
 * lifecycle marker alongside its history entry — see `WriteStatus` below.
 */
const MAX_HISTORY = 3;

const EMPTY_MESSAGE = "Nothing to show for that";

export function CommandPalette({ helpExamples }: { helpExamples: string[] }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Stable per-entry ids for the confirm lifecycle (confirmWrite/cancelWrite
  // below target a specific history entry by id, not by array index — array
  // index would still happen to work here since single-flight means the
  // entry a Confirm/Cancel click can ever target is always index 0 at click
  // time, but an id is the more robust identity to update-in-place by, and
  // doubles as a stable React `key` across re-renders/reorders.
  const nextId = useRef(0);

  function ask(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await runCommand({ question: trimmed });
      if (res.ok) {
        const entry: HistoryEntry = {
          id: nextId.current++,
          question: trimmed,
          result: res.result,
          // A write result starts life "previewed" — awaiting the human's
          // Confirm/Cancel decision (spec §3.1: preview alone mutates
          // nothing). Every other result kind has no lifecycle at all.
          writeStatus: res.result.kind === "confirm" ? "previewed" : undefined,
        };
        // Prepending a NEW entry is also what makes single-flight work for
        // any PRIOR confirm card still sitting un-decided at index 0: once
        // this runs, that old entry slides to index 1+ and — per
        // ConfirmResult's `active` gating below — stops rendering its
        // Confirm/Cancel buttons. Nothing about the old write ever ran; it
        // simply stops being reachable ("evaporates", spec §6/task 35b-3).
        setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
      } else {
        setError(res.error);
      }
    });
  }

  /**
   * The palette's ONLY mutation call. Passes `commandId`/`resolvedParams`
   * straight through from the confirm result exactly as `runCommand`'s
   * preview built them — this function never inspects, recomputes, or
   * rebuilds either value (spec §3.2: the delegate re-validates everything;
   * this call is a pure pass-through).
   *
   * Reuses the SAME `pending`/startTransition as `ask` (rather than a
   * second, independent transition) so single-flight falls out structurally:
   * the Ask button (disabled while `pending`) can't fire a new question
   * while a confirm is in flight, and — symmetrically — Confirm/Cancel on
   * the open card are disabled while an `ask()` is in flight. Only one
   * server action from this component is ever in the air at a time.
   */
  function confirmWrite(id: number, result: ConfirmCommandResult) {
    startTransition(async () => {
      const outcome: ConfirmOutcome = await confirmWriteCommand({
        commandId: result.commandId,
        resolvedParams: result.resolvedParams,
      });
      setHistory((prev) =>
        prev.map((entry) => {
          if (entry.id !== id) return entry;
          return outcome.ok
            ? { ...entry, writeStatus: "confirmed", writeSimulated: outcome.simulated, writeError: undefined }
            : { ...entry, writeStatus: "failed", writeError: outcome.error };
        }),
      );
    });
  }

  /** Cancel makes no action call at all (spec §6) — just a local status flip
   *  that discards the card. Synchronous, not wrapped in startTransition:
   *  there's no async work, and `pending` staying false here is what lets
   *  Cancel respond instantly rather than borrowing the Ask/Confirm
   *  in-flight state for work it never does. */
  function cancelWrite(id: number) {
    setHistory((prev) => prev.map((entry) => (entry.id === id ? { ...entry, writeStatus: "cancelled" } : entry)));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      ask(question);
    }
  }

  // Chip click fills the input only — it does NOT auto-submit. Every other
  // action panel in this codebase (PaymentsPanel/SendInvoicePanel/
  // DraftEmailPanel) requires an explicit button click before calling a
  // server action; auto-submitting on a single chip click would be the only
  // place that convention breaks, and it would also fire a request the user
  // may not have meant to send yet (a filled-but-unreviewed question).
  function pickExample(example: string) {
    setQuestion(example);
  }

  return (
    <div data-testid="command-palette" className="surface-card flex flex-col gap-4 rounded-xl p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="ask a question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about customers, invoices, cash…"
          className="min-w-0 flex-1 bg-bg p-2 text-sm text-text"
        />
        <button
          type="button"
          onClick={() => ask(question)}
          disabled={pending}
          className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
        >
          {pending ? "Asking…" : "Ask"}
        </button>
      </div>

      <FormStatus error={error} />

      {history.length === 0 ? (
        <HelpBlock
          intro="Ask about your customers, invoices, or cash. Try one of these:"
          examples={helpExamples}
          onPick={pickExample}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {history.map((entry, i) => (
            <div key={entry.id} className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-widest text-text/40">{entry.question}</p>
              <CommandResultView
                entry={entry}
                active={i === 0}
                pending={pending}
                onPickExample={pickExample}
                onConfirmWrite={confirmWrite}
                onCancelWrite={cancelWrite}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Write-confirm lifecycle types (slice 35b-3).
// ---------------------------------------------------------------------------

/** The confirm-kind member of `CommandResult`, pulled out with `Extract`
 *  rather than a named import from `@/lib/command/writeRegistry` — see the
 *  file-level doc comment's client-bundle-boundary note. */
type ConfirmCommandResult = Extract<CommandResult, { kind: "confirm" }>;

type WriteStatus = "previewed" | "confirmed" | "cancelled" | "failed";

type HistoryEntry = {
  id: number;
  question: string;
  result: CommandResult;
  // The three fields below are only ever set when result.kind === "confirm"
  // — every read-kind entry (stat/table/list/help) leaves them undefined.
  writeStatus?: WriteStatus;
  writeError?: string; // set when writeStatus === "failed"
  writeSimulated?: boolean; // set when writeStatus === "confirmed"
};

/**
 * `confirmWriteCommand`'s DECLARED return type is `writeRegistry.ts`'s
 * `ActionResult` (`{ok:true} | {ok:false,error:string}`) — deliberately
 * minimal, since only one of the three delegates (`sendInvoice`) has a
 * `simulated` concept at all (no RESEND_API_KEY configured). That module's
 * own doc comment already describes `sendInvoice`'s real `{ok:true;
 * simulated?:true}` return as "a structurally-compatible superset" of
 * `ActionResult`'s ok:true branch. This local, palette-only type is exactly
 * that superset: `{ok:true}` (no `simulated` key at all) is still assignable
 * to it since the extra field is optional, so annotating the awaited result
 * with this WIDER type costs nothing for the other two delegates and lets
 * this component read `.simulated` when it's actually there — without
 * widening the shared `ActionResult` type in a server module this client
 * component doesn't (and must never) import as a value anyway.
 */
type ConfirmOutcome = { ok: true; simulated?: boolean } | { ok: false; error: string };

function CommandResultView({
  entry,
  active,
  pending,
  onPickExample,
  onConfirmWrite,
  onCancelWrite,
}: {
  entry: HistoryEntry;
  active: boolean;
  pending: boolean;
  onPickExample: (example: string) => void;
  onConfirmWrite: (id: number, result: ConfirmCommandResult) => void;
  onCancelWrite: (id: number) => void;
}) {
  const result = entry.result;
  switch (result.kind) {
    case "stat":
      return <StatResult result={result} />;
    case "table":
      return <TableResult result={result} />;
    case "list":
      return <ListResult result={result} />;
    case "help":
      return <HelpBlock intro={result.intro} examples={result.examples} onPick={onPickExample} />;
    case "confirm":
      return (
        <ConfirmResult
          id={entry.id}
          result={result}
          status={entry.writeStatus ?? "previewed"}
          error={entry.writeError}
          simulated={entry.writeSimulated}
          active={active}
          pending={pending}
          onConfirm={onConfirmWrite}
          onCancel={onCancelWrite}
        />
      );
  }
}

function StatResult({ result }: { result: Extract<CommandResult, { kind: "stat" }> }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-2xl text-gold">{result.value}</span>
      <span className="text-[10px] uppercase tracking-wider text-text/50">{result.label}</span>
      {result.detail ? <p className="text-text/70">{result.detail}</p> : null}
    </div>
  );
}

function TableResult({ result }: { result: Extract<CommandResult, { kind: "table" }> }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[10px] uppercase tracking-widest text-text/40">{result.title}</h3>
      {result.rows.length === 0 ? (
        <p className="text-text/60">{EMPTY_MESSAGE}</p>
      ) : (
        <div className="surface-card overflow-x-auto rounded-xl p-3">
          <table role="table" className="w-full text-sm">
            <thead>
              <tr role="row" className="text-left text-[10px] uppercase tracking-wider text-text/40">
                {result.columns.map((col) => (
                  <th role="columnheader" key={col} className="py-2">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-text/10">
              {result.rows.map((row, i) => {
                const href = result.links?.[i];
                return (
                  <tr role="row" key={i}>
                    {row.map((cell, j) => (
                      <td role="cell" key={j} className={j === 0 ? "py-2 text-text/85" : "text-text/70"}>
                        {j === 0 && href ? (
                          <Link href={href} className="text-text hover:text-gold">
                            {cell}
                          </Link>
                        ) : (
                          cell
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ListResult({ result }: { result: Extract<CommandResult, { kind: "list" }> }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[10px] uppercase tracking-widest text-text/40">{result.title}</h3>
      {result.items.length === 0 ? (
        <p className="text-text/60">{EMPTY_MESSAGE}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-text/10">
          {result.items.map((item, i) => (
            <li key={i} className="py-1.5 text-text/80">
              {item.href ? (
                <Link href={item.href} className="text-text hover:text-gold">
                  {item.text}
                </Link>
              ) : (
                item.text
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The confirm-kind renderer (slice 35b-3, spec §6). Card layout mirrors the
 * codebase's existing preview->commit precedent (src/components/invoices/
 * import/ImportWizard.tsx's `preview` panel: a `surface-card` block, a
 * button row using the same gold-primary/bordered-secondary pair as that
 * wizard's Commit/"Start over").
 *
 * Terminal-state rendering differs by HOW the card ended, matching the
 * task's precise language:
 *  - "cancelled" DISCARDS the card entirely (spec: "Cancel -> discard the
 *    confirm card entirely") — summary/details/warning all disappear,
 *    replaced by a single muted line. Nothing worth remembering happened.
 *  - "confirmed" REPLACES only the card's actions (spec: "replace the
 *    card's actions with a success line") — summary/details/warning stay
 *    visible as a small receipt of what was actually done, with "Done."
 *    (plus a simulated note when applicable) where Confirm/Cancel used to
 *    be.
 *  - "failed" shows the delegate's error INSIDE the still-intact card
 *    (spec: "show the returned error inside the card") and — deliberate
 *    choice, see the confirmWrite doc comment above for the single-flight
 *    framing — KEEPS Confirm available for retry, matching every other
 *    write surface in this codebase (PaymentsPanel/SendInvoicePanel/
 *    ImportWizard all leave their form/preview state intact and re-clickable
 *    after a failed action, rather than dead-ending the user). Most guard
 *    rejections here (demo mode, wrong status, forbidden) will keep failing
 *    identically against the same frozen resolvedParams — v1 has no inline
 *    param editing, so a genuine correction means re-asking (spec §8) — but
 *    a transient failure (the catch-all "Couldn't complete that — try
 *    again", or a race like the balance moving between preview and confirm)
 *    can legitimately succeed on a second click, and collapsing the button
 *    away would foreclose that for no benefit.
 *  - "previewed" (the initial state) shows the card with live Confirm/Cancel.
 *
 * Confirm/Cancel only ever render when `active` (this is history[0] — the
 * single-flight gate: an older, still-undecided confirm card that's been
 * superseded by a newer question keeps its summary/details visible as a
 * historical record but loses its buttons, per `ask`'s own doc comment).
 */
function ConfirmResult({
  id,
  result,
  status,
  error,
  simulated,
  active,
  pending,
  onConfirm,
  onCancel,
}: {
  id: number;
  result: ConfirmCommandResult;
  status: WriteStatus;
  error?: string;
  simulated?: boolean;
  active: boolean;
  pending: boolean;
  onConfirm: (id: number, result: ConfirmCommandResult) => void;
  onCancel: (id: number) => void;
}) {
  if (status === "cancelled") {
    return <p className="text-sm text-text/50">Cancelled.</p>;
  }

  return (
    <div className="surface-card flex flex-col gap-3 rounded-xl p-3">
      <p className="text-text">{result.summary}</p>
      <dl className="flex flex-col divide-y divide-text/10">
        {result.details.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-1.5">
            <dt className="text-[10px] uppercase tracking-wider text-text/40">{label}</dt>
            <dd className="text-text/85">{value}</dd>
          </div>
        ))}
      </dl>
      {result.warning ? <p className="text-xs text-warn">{result.warning}</p> : null}

      {status === "confirmed" ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ok">Done.</p>
          {simulated ? (
            <p className="text-sm text-text/70">Simulated — set the relevant key for live changes</p>
          ) : null}
        </div>
      ) : (
        <>
          {status === "failed" ? <FormStatus error={error} /> : null}
          {active ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onConfirm(id, result)}
                disabled={pending}
                className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
              >
                {pending ? "Confirming…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => onCancel(id)}
                disabled={pending}
                className="rounded border border-border px-3 py-2 text-xs uppercase tracking-wider text-text/70 hover:text-text disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function HelpBlock({
  intro,
  examples,
  onPick,
}: {
  intro: string;
  examples: string[];
  onPick: (example: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-text/70">{intro}</p>
      <div className="flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="rounded-full border border-text/20 px-3 py-1 text-xs text-text/70 hover:border-gold/40 hover:text-gold"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
