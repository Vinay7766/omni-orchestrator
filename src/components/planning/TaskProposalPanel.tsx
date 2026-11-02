import React, { useCallback, useEffect, useId, useState } from "react";
import { Check, ListChecks, MessageSquareWarning, Send } from "lucide-react";
import type { ProposedTask } from "../../lib/task-proposal";

type Proposal = { ok: true; model: string; tasks: ProposedTask[] } | { ok: false; error: string };

const button =
  "px-2.5 py-1.5 text-xs rounded-lg flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const primary = `${button} font-medium bg-indigo-600 hover:bg-indigo-500 text-white`;
const secondary = `${button} text-zinc-300 border border-zinc-800 hover:bg-zinc-800`;

/**
 * E5 slice 5 (owner decision 2026-11-02): the task list is written by the AI set up in the app,
 * never by hand. The person reads it here and approves it (the tasks are created) or asks for
 * changes (the AI rewrites it with their notes).
 */
export const TaskProposalPanel: React.FC<{
  providerReady: boolean;
  read: () => Promise<Proposal>;
  propose: (notes?: string) => Promise<void>;
  approve: () => Promise<void>;
}> = ({ providerReady, read, propose, approve }) => {
  const id = useId();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const reload = useCallback(() => read().then(setProposal, (e) => setProposal({ ok: false, error: String(e) })), [read]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    try {
      await work();
      await reload();
    } finally {
      setBusy(null);
    }
  };
  const ask = (n?: string) =>
    act("Your model is writing the task list. This can take a few minutes.", async () => {
      await propose(n);
      setNotes("");
      setNotesOpen(false);
    });

  const none = proposal && !proposal.ok;
  return (
    <section aria-label="Task list" className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
        <ListChecks className="w-4 h-4" aria-hidden="true" /> Next: the task list
      </h3>
      {none && (
        <>
          <p className="text-xs text-zinc-400">
            The architecture is approved. Your model now breaks the build into tasks, each tagged with the kinds of work it involves; you review the list here.
          </p>
          {!/not been proposed/.test(proposal.error) && <p className="text-xs text-red-400">{proposal.error}</p>}
          {!providerReady && <p className="text-xs text-amber-400">Set up a model in Settings first.</p>}
          <button type="button" className={primary} disabled={!providerReady || busy !== null} onClick={() => void ask(undefined)}>
            <Send className="w-3.5 h-3.5" aria-hidden="true" /> Write the task list
          </button>
        </>
      )}
      {proposal?.ok && (
        <>
          <p className="text-xs text-zinc-400">
            Proposed by {proposal.model}. Saved in docs/planning/tasks.md. Approving creates these {proposal.tasks.length} tasks.
          </p>
          <ol className="space-y-1.5">
            {proposal.tasks.map((t) => (
              <li key={t.taskId} className="text-xs text-zinc-200 border border-zinc-800 rounded-lg px-3 py-2">
                <span className="font-mono text-zinc-400">{t.taskId}</span> {t.title}
                <div className="mt-1 text-zinc-500">
                  {t.requirements && <span>Requirements: {t.requirements.join(", ")}. </span>}
                  <span>Kinds: {t.kinds.join(", ")}</span>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy !== null} onClick={() => void act("Creating the tasks...", approve)}>
              <Check className="w-3.5 h-3.5" aria-hidden="true" /> Approve the task list
            </button>
            <button type="button" className={secondary} disabled={busy !== null} onClick={() => setNotesOpen((o) => !o)} aria-expanded={notesOpen}>
              <MessageSquareWarning className="w-3.5 h-3.5" aria-hidden="true" /> Request changes
            </button>
          </div>
          {notesOpen && (
            <div className="space-y-2">
              <label htmlFor={`${id}-notes`} className="block text-xs text-zinc-300">
                What should change?
              </label>
              <textarea
                id={`${id}-notes`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
              />
              <button type="button" className={secondary} disabled={!notes.trim() || !providerReady || busy !== null} onClick={() => void ask(notes.trim())}>
                <Send className="w-3.5 h-3.5" aria-hidden="true" /> Rewrite the list
              </button>
            </div>
          )}
        </>
      )}
      {busy && (
        <p role="status" className="text-xs text-zinc-400">
          {busy}
        </p>
      )}
    </section>
  );
};
