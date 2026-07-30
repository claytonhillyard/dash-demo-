"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import {
  draftEmail,
  sendDraft,
  saveDraftingPrefs,
  saveCustomerStyleNote,
} from "@/lib/drafting/actions";
import { DRAFT_INTENTS, type DraftIntent } from "@/lib/drafting/types";

const INTENT_LABEL: Record<DraftIntent, string> = {
  follow_up: "Follow up",
  payment_reminder: "Payment reminder",
  thank_you: "Thank you",
};

/**
 * Customer edit-page AI drafting panel (spec §7, slice 37-3). Conventions
 * mirrored from SendInvoicePanel/PaymentsPanel (src/components/invoices/):
 * one useTransition per independent action, inline `role="alert"` errors via
 * FormStatus, router.refresh() to pick up server-recomputed state, plain
 * divs/buttons throughout (no `<form>` element).
 *
 * Four independent async actions live in this one panel (generate, send,
 * save voice prefs, save style note) — each gets its OWN pending/error state
 * rather than one shared transition, since e.g. generating a new draft must
 * not be blocked by an in-flight prefs save (or vice versa).
 *
 * Props are primitives only (no Date/Db types) — the customer edit page
 * server-loads the org's drafting prefs and this customer's style note and
 * passes them down read-only; this component never fetches on its own.
 *
 * router.refresh() after a send (real or simulated) AND after a style-note
 * save, but deliberately NOT after a prefs save: both `sendDraft` and
 * `saveCustomerStyleNote` (src/lib/drafting/actions.ts) record an audit row
 * against THIS customer, which would show up in the edit page's own Activity
 * section on the next server render — worth refreshing for. `sendDraft`
 * audits on success even when `simulated` (unlike sendInvoice, whose
 * simulated path stamps nothing) — so refresh happens for BOTH send outcomes
 * here, not just the real one; that's a deliberate divergence from
 * SendInvoicePanel's simulated-skips-refresh behavior, driven by what the
 * server actually persists, not by copying that panel's shape blindly.
 * `saveDraftingPrefs` audits against the ORG, not this customer, so it never
 * shows up in this page's customer-scoped Activity list — nothing to
 * refresh for.
 */
export function DraftEmailPanel({
  customerId,
  customerName,
  hasEmail,
  styleNote,
  prefsTone,
  prefsSignature,
}: {
  customerId: number;
  customerName: string;
  hasEmail: boolean;
  styleNote: string | null;
  prefsTone: string | null;
  prefsSignature: string | null;
}) {
  const router = useRouter();

  // --- Compose ---------------------------------------------------------
  const [intent, setIntent] = useState<DraftIntent>(DRAFT_INTENTS[0]);
  const [instruction, setInstruction] = useState("");
  const [genPending, startGen] = useTransition();
  const [genError, setGenError] = useState<string | null>(null);

  // --- Draft area (populated once a generate call returns ok:true) -----
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [draftSimulated, setDraftSimulated] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");

  // --- Send --------------------------------------------------------------
  const [sendPending, startSend] = useTransition();
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ simulated: boolean } | null>(null);

  // --- Voice section (collapsed by default — no house disclosure
  // component exists yet to match, so a plain useState toggle) -----------
  const [voiceOpen, setVoiceOpen] = useState(false);

  const [tone, setTone] = useState(prefsTone ?? "");
  const [signature, setSignature] = useState(prefsSignature ?? "");
  const [prefsPending, startPrefs] = useTransition();
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const [note, setNote] = useState(styleNote ?? "");
  const [notePending, startNote] = useTransition();
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);

  function doGenerate() {
    setGenError(null);
    setSendError(null);
    setSendResult(null);
    startGen(async () => {
      const res = await draftEmail({
        customerId,
        intent,
        instruction: instruction.trim() || undefined,
      });
      if (res.ok) {
        setSubject(res.subject);
        setBody(res.body);
        setDraftSimulated(res.simulated);
        setCopyState("idle");
      } else {
        setGenError(res.error);
      }
    });
  }

  // Async + try/catch (rather than .then/.catch) so both "no Clipboard API
  // at all" (navigator.clipboard undefined — the jsdom/older-browser case)
  // and "writeText exists but rejects" (permission denied, etc.) collapse to
  // the same graceful fallback rather than an unhandled rejection.
  async function doCopy() {
    if (subject === null || body === null) return;
    const text = `${subject}\n\n${body}`;
    try {
      if (!navigator.clipboard?.writeText) {
        setCopyState("unavailable");
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("unavailable");
    }
  }

  function doSend() {
    if (subject === null || body === null) return;
    setSendError(null);
    setSendResult(null);
    startSend(async () => {
      const res = await sendDraft({ customerId, subject, body });
      if (res.ok) {
        setSendResult({ simulated: Boolean(res.simulated) });
        // Both outcomes audit against this customer — see doc comment above.
        router.refresh();
      } else {
        setSendError(res.error);
      }
    });
  }

  function doSavePrefs() {
    setPrefsError(null);
    setPrefsSaved(false);
    startPrefs(async () => {
      const res = await saveDraftingPrefs({
        tone: tone.trim() || undefined,
        signature: signature.trim() || undefined,
      });
      if (res.ok) {
        setPrefsSaved(true);
      } else {
        setPrefsError(res.error);
      }
    });
  }

  function doSaveNote() {
    setNoteError(null);
    setNoteSaved(false);
    startNote(async () => {
      // Unlike tone/signature above, styleNote is a required (non-optional)
      // field on saveCustomerStyleNoteInput — an empty string is how the
      // caller asks the server to clear an existing note to NULL, so it's
      // sent as "" rather than undefined (src/lib/drafting/actions.ts).
      const res = await saveCustomerStyleNote({ customerId, styleNote: note.trim() });
      if (res.ok) {
        setNoteSaved(true);
        router.refresh();
      } else {
        setNoteError(res.error);
      }
    });
  }

  return (
    <div
      data-testid="draft-email-panel"
      className="surface-card flex flex-col gap-3 rounded-xl p-4 text-sm"
    >
      <h2 className="text-[10px] uppercase tracking-widest text-text/40">Draft email</h2>

      <div className="flex flex-col gap-2">
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Intent
          <select
            aria-label="draft intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value as DraftIntent)}
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          >
            {DRAFT_INTENTS.map((i) => (
              <option key={i} value={i}>
                {INTENT_LABEL[i]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
          Instruction (optional)
          <input
            aria-label="draft instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            maxLength={300}
            placeholder="Anything specific to mention?"
            className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
          />
        </label>
        <div>
          <button
            type="button"
            onClick={doGenerate}
            disabled={genPending}
            className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
          >
            {genPending ? "Generating…" : "Generate"}
          </button>
        </div>
        <FormStatus error={genError} />
      </div>

      {subject !== null && body !== null ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
            Subject
            <input
              aria-label="draft subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
            />
          </label>
          <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
            Body
            <textarea
              aria-label="draft body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
            />
          </label>
          {draftSimulated ? (
            <p className="text-text/70 text-sm">
              Simulated draft — set AI_GATEWAY_API_KEY for live drafting
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={doCopy}
              className="rounded border border-text/20 px-3 py-2 text-xs uppercase tracking-wider text-text/80"
            >
              {copyState === "copied" ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={doSend}
              disabled={sendPending || !hasEmail}
              className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
            >
              {sendPending ? "Sending…" : "Send"}
            </button>
            {!hasEmail ? <span className="text-text/50 text-xs">No email on file</span> : null}
          </div>
          {copyState === "unavailable" ? (
            <p className="text-text/50 text-xs">Copy unavailable — select the text manually</p>
          ) : null}
          {sendResult ? (
            <p className="text-ok text-sm">
              {sendResult.simulated ? "Simulated — set RESEND_API_KEY for live sends" : "Sent."}
            </p>
          ) : null}
          <FormStatus error={sendError} />
        </div>
      ) : null}

      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setVoiceOpen((v) => !v)}
          aria-expanded={voiceOpen}
          className="text-xs uppercase tracking-wider text-text/60 hover:text-text"
        >
          {voiceOpen ? "Hide voice settings" : "Voice settings"}
        </button>
        {voiceOpen ? (
          <div className="mt-3 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h3 className="text-[10px] uppercase tracking-widest text-text/40">Org voice</h3>
              <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
                Tone
                <input
                  aria-label="org tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  maxLength={500}
                  className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
                />
              </label>
              <label className="flex flex-col text-xs uppercase tracking-wider text-text/60">
                Signature
                <input
                  aria-label="org signature"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  maxLength={200}
                  className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
                />
              </label>
              <div>
                <button
                  type="button"
                  onClick={doSavePrefs}
                  disabled={prefsPending}
                  className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
                >
                  {prefsPending ? "Saving…" : "Save voice"}
                </button>
              </div>
              <FormStatus error={prefsError} ok={prefsSaved} />
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-[10px] uppercase tracking-widest text-text/40">
                Style note for {customerName}
              </h3>
              <textarea
                aria-label="customer style note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                rows={3}
                className="mt-1 bg-bg p-2 text-sm text-text normal-case tracking-normal"
              />
              <div>
                <button
                  type="button"
                  onClick={doSaveNote}
                  disabled={notePending}
                  className="rounded bg-gold px-3 py-2 text-xs uppercase tracking-wider text-black disabled:opacity-50"
                >
                  {notePending ? "Saving…" : "Save note"}
                </button>
              </div>
              <FormStatus error={noteError} ok={noteSaved} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
