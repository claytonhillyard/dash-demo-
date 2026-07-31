"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { FormStatus } from "@/components/company/FormStatus";
import { runCommand } from "@/lib/command/actions";
import type { CommandResult } from "@/lib/command/registry";

type HistoryEntry = { question: string; result: CommandResult };

const MAX_HISTORY = 3;

const EMPTY_MESSAGE = "Nothing to show for that";

/**
 * Read-only AI command palette (slice 35a-3, spec §6). Client component —
 * receives `helpExamples` as a page prop (static strings only, from
 * `HELP_EXAMPLES` — src/app/(admin)/command/page.tsx is the only place in the
 * client-facing tree that imports src/lib/command/registry.ts) and calls the
 * `runCommand` server action on submit. Only `CommandResult` is imported here
 * from that module, and only as a TYPE (`import type`) — same convention
 * PaymentsPanel/SendInvoicePanel already use for `@/db/invoices`/`@/db/payments`
 * — so it's erased at compile time and the db graph registry.ts pulls in
 * never reaches the client bundle (verified structurally by `npx next build`,
 * per the task's client-bundle check).
 *
 * Router-free by design (no next/navigation) — every result comes back
 * inline from the action's response, so there's never anything to refresh.
 *
 * History keeps the last MAX_HISTORY successful Q->result pairs, most-recent
 * first, in local state only (no persistence). A failed submission
 * (`{ok:false}`) shows a transient alert instead of joining history — there's
 * no CommandResult to store for it, and it mirrors every other panel's
 * inline-error convention (PaymentsPanel/SendInvoicePanel/DraftEmailPanel).
 */
export function CommandPalette({ helpExamples }: { helpExamples: string[] }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await runCommand({ question: trimmed });
      if (res.ok) {
        setHistory((prev) => [{ question: trimmed, result: res.result }, ...prev].slice(0, MAX_HISTORY));
      } else {
        setError(res.error);
      }
    });
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
            <div key={i} className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-widest text-text/40">{entry.question}</p>
              <CommandResultView result={entry.result} onPickExample={pickExample} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommandResultView({
  result,
  onPickExample,
}: {
  result: CommandResult;
  onPickExample: (example: string) => void;
}) {
  switch (result.kind) {
    case "stat":
      return <StatResult result={result} />;
    case "table":
      return <TableResult result={result} />;
    case "list":
      return <ListResult result={result} />;
    case "help":
      return <HelpBlock intro={result.intro} examples={result.examples} onPick={onPickExample} />;
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
