import React, { useId, useState } from "react";
import { Check, MessageSquareWarning, Play, Send, SkipForward, Undo2 } from "lucide-react";
import type { PhaseHistoryEntry } from "@omni/core";

/** The person's decisions on one phase. Each resolves when the decision has been handled. */
export interface PhaseDecisions {
  approve: (phase: string) => Promise<void>;
  requestChanges: (phase: string, notes: string) => Promise<void>;
  run: (phase: string) => Promise<void>;
  skip: (phase: string, reason: string) => Promise<void>;
  /** Takes back an approval while nothing has happened since it (issue D). */
  withdraw?: (phase: string) => Promise<void>;
}

const button =
  "px-2.5 py-1.5 text-xs rounded-lg flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const primary = `${button} font-medium bg-indigo-600 hover:bg-indigo-500 text-white`;
const secondary = `${button} text-zinc-300 border border-zinc-800 hover:bg-zinc-800`;
const field =
  "w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500";

/**
 * Only the decisions that apply to this phase (GATE-2, SEC-1): approve or request changes when it
 * awaits review; run or skip when it is an optional phase waiting for the person. Nothing else.
 */
export const PhaseActions: React.FC<{ entry: PhaseHistoryEntry; decisions: PhaseDecisions; latestApproval?: boolean }> = ({ entry, decisions, latestApproval = false }) => {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const { phase } = entry;

  const run = async (decision: () => Promise<void>) => {
    setBusy(true);
    try {
      await decision();
    } finally {
      setBusy(false);
    }
  };

  if (entry.status === "awaiting_review") {
    return (
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button className={primary} disabled={busy} onClick={() => setConfirming(true)} aria-label={`Approve "${phase}"`}>
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            Approve
          </button>
          <button className={secondary} disabled={busy} onClick={() => setNotesOpen(!notesOpen)} aria-expanded={notesOpen}>
            <MessageSquareWarning className="w-3.5 h-3.5" aria-hidden="true" />
            Request changes
          </button>
        </div>
        {confirming && (
          <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="rounded-lg border border-indigo-900/60 bg-indigo-950/20 p-3 space-y-2">
            <p id={`${id}-confirm`} className="text-xs text-zinc-200">
              Approve "{phase}"? The next phase can start after this. You can undo it until work starts in the next phase.
            </p>
            <div className="flex gap-2">
              <button
                className={primary}
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  void run(() => decisions.approve(phase));
                }}
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                Yes, approve
              </button>
              <button className={secondary} disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {notesOpen && (
          <div className="space-y-2">
            <label htmlFor={`${id}-notes`} className="block text-xs text-zinc-400">
              What should change?
            </label>
            <textarea id={`${id}-notes`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
            <button
              className={secondary}
              disabled={busy || notes.trim() === ""}
              onClick={() => void run(() => decisions.requestChanges(phase, notes.trim()))}
              aria-label="Send the changes"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              Send
            </button>
          </div>
        )}
      </div>
    );
  }

  if (entry.status === "approved" && latestApproval && decisions.withdraw) {
    const withdraw = decisions.withdraw;
    return (
      <div className="mt-2">
        <button className={secondary} disabled={busy} onClick={() => void run(() => withdraw(phase))} aria-label={`Undo approval of "${phase}"`}>
          <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
          Undo approval
        </button>
      </div>
    );
  }

  if (entry.optionalQuestion && entry.isNext && entry.status === "not_started") {
    return (
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button className={primary} disabled={busy} onClick={() => void run(() => decisions.run(phase))} aria-label={`Run "${phase}"`}>
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            Run it
          </button>
          <button className={secondary} disabled={busy} onClick={() => void run(() => decisions.skip(phase, reason.trim()))} aria-label={`Skip "${phase}"`}>
            <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
            Skip it
          </button>
        </div>
        <label htmlFor={`${id}-reason`} className="block text-xs text-zinc-400">
          Reason for skipping (optional)
        </label>
        <input id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
      </div>
    );
  }

  return null;
};
