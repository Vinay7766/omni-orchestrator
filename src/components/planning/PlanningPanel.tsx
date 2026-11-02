import React, { useEffect, useState } from "react";
import { FileText, Play } from "lucide-react";
import { PLANNING_PHASES, STACK_ADR_PHASES, type PhaseHistoryEntry } from "@omni/core";

const RUNNABLE = ["not_started", "in_progress", "changes_requested"];

/** The documents a phase hands in: its own, plus the stack decision record where one is required. */
const documentsOf = (phase: string) => [`${phase}.md`, ...((STACK_ADR_PHASES as readonly string[]).includes(phase) ? [`${phase}-stack-adr.md`] : [])];

/**
 * E5 (PLAN-1, PLAN-2, GATE-2): the next planning phase of a project. It runs with the person's
 * own model; once handed in, its document is shown here so the person reads it before they
 * approve or request changes in the phase history. The document is model output: it is shown
 * as plain text, never as HTML.
 */
export const PlanningPanel: React.FC<{
  entry: PhaseHistoryEntry | undefined;
  providerReady: boolean;
  run: () => Promise<void>;
  readDocument: (name: string) => Promise<string | null>;
}> = ({ entry, providerReady, run, readDocument }) => {
  const [running, setRunning] = useState(false);
  const [documents, setDocuments] = useState<{ name: string; text: string | null }[] | null>(null);
  const phase = entry?.phase ?? "";
  const awaiting = entry?.status === "awaiting_review";

  useEffect(() => {
    let current = true;
    setDocuments(null);
    if (awaiting) {
      Promise.all(documentsOf(phase).map((name) => readDocument(name).then((text) => ({ name, text }), () => ({ name, text: null }))))
        .then((docs) => current && setDocuments(docs));
    }
    return () => {
      current = false;
    };
  }, [phase, awaiting, readDocument]);

  if (!entry || !(PLANNING_PHASES as readonly string[]).includes(phase)) return null;

  if (awaiting) {
    return (
      <section aria-label="Planning document" className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
          <FileText className="w-4 h-4" aria-hidden="true" /> Ready for your review: {phase}
        </h3>
        <p className="text-xs text-zinc-400">Read it, then approve it or request changes in the phase history below.</p>
        {documents?.map(({ name, text }) =>
          text ? (
            <div key={name} className="space-y-1">
              <p className="text-xs font-mono text-zinc-500">docs/planning/{name}</p>
              <pre className="whitespace-pre-wrap break-words text-xs text-zinc-200 bg-zinc-950 border border-zinc-800 rounded-lg p-3 max-h-96 overflow-y-auto font-sans">
                {text}
              </pre>
            </div>
          ) : (
            <p key={name} className="text-xs text-red-400">
              docs/planning/{name} was not found in the project.
            </p>
          ),
        )}
      </section>
    );
  }

  if (!RUNNABLE.includes(entry.status)) return null;

  const start = async () => {
    setRunning(true);
    try {
      await run();
    } finally {
      setRunning(false);
    }
  };

  return (
    <section aria-label="Next planning step" className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-zinc-100">Next planning step: {phase}</h3>
      <p className="text-xs text-zinc-400">
        Your model writes the {phase} document with this phase's skills; you then review it here.
        {entry.status === "changes_requested" && " Your change notes and the version you reviewed are sent with it."}
      </p>
      {!providerReady && <p className="text-xs text-amber-400">Set up a model in Settings first.</p>}
      <button
        type="button"
        onClick={() => void start()}
        disabled={!providerReady || running}
        className="px-2.5 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Play className="w-3.5 h-3.5" aria-hidden="true" /> Run {phase}
      </button>
      {running && (
        <p role="status" className="text-xs text-zinc-400">
          Running {phase} with your model. A long document can take several minutes, more on a local model.
        </p>
      )}
    </section>
  );
};
