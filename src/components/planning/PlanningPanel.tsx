import React, { useEffect, useId, useState } from "react";
import { ArrowUp, FileText, Play, Wand2 } from "lucide-react";
import { discussionNotes, type ChatMessage, type ChatTurn } from "../../lib/idea-chat";
import { ChatLog } from "./ChatLog";
import { PLANNING_PHASES, STACK_ADR_PHASES, type PhaseHistoryEntry } from "@omni/core";

const RUNNABLE = ["not_started", "in_progress", "changes_requested"];

/** The documents a phase hands in: its own, plus the stack decision record where one is required. */
const documentsOf = (phase: string) => [`${phase}.md`, ...((STACK_ADR_PHASES as readonly string[]).includes(phase) ? [`${phase}-stack-adr.md`] : [])];

/**
 * C (owner decision 2026-11-03): the person answers the document's open questions in a
 * conversation with their AI, then "Generate final document" revises it from that conversation
 * (sent as change notes, so the gate rules are the same), and they approve the new version.
 */
const DocumentDiscussion: React.FC<{
  phase: string;
  document: string;
  providerReady: boolean;
  discuss: (document: string, messages: ChatMessage[]) => Promise<ChatTurn>;
  revise: (notes: string, messages: ChatMessage[]) => Promise<void>;
}> = ({ phase, document, providerReady, discuss, revise }) => {
  const id = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = providerReady && text.trim() !== "" && !thinking && !generating;

  const send = async () => {
    if (!canSend) return;
    const next: ChatMessage[] = [...messages, { role: "person", text: text.trim() }];
    setMessages(next);
    setText("");
    setError(null);
    setThinking(true);
    const turn = await discuss(document, next);
    setThinking(false);
    if (turn.ok) setMessages([...next, { role: "assistant", text: turn.reply }]);
    else {
      setMessages(messages);
      setText(next[next.length - 1].text);
      setError(turn.error);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await revise(discussionNotes(messages), messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-2 pt-2 border-t border-zinc-800">
      <p className="text-xs text-zinc-400">
        Questions in it, or something to change? Talk it through with the AI, then press Generate final document. Or approve it as it is in the phase history below.
      </p>
      {messages.length > 0 && <ChatLog label={`Conversation about ${phase}`} messages={messages} thinking={thinking} className="max-h-80" />}
      <div className="relative">
        <label htmlFor={`${id}-say`} className="sr-only">
          Talk about this document
        </label>
        <textarea
          id={`${id}-say`}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Answer its questions, or ask about the document..."
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 pr-12 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          aria-label="Send to the AI"
          className="absolute right-2 bottom-2 w-8 h-8 rounded-lg grid place-items-center bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <ArrowUp className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-400 break-words">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void generate()}
        disabled={!messages.some((m) => m.role === "person") || thinking || generating || !providerReady}
        className="px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <Wand2 className="w-3.5 h-3.5" aria-hidden="true" /> {generating ? "Generating..." : "Generate final document"}
      </button>
    </div>
  );
};

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
  /** Set right after the person requests changes here: the revision starts without another click. */
  autoRun?: boolean;
  /** Called when an automatic revision starts, so it runs once. */
  onAutoRun?: () => void;
  /** With both, the person can talk about a document under review and have it revised (C). */
  discuss?: (document: string, messages: ChatMessage[]) => Promise<ChatTurn>;
  revise?: (notes: string, messages: ChatMessage[]) => Promise<void>;
}> = ({ entry, providerReady, run, readDocument, autoRun = false, onAutoRun, discuss, revise }) => {
  const [running, setRunning] = useState(false);
  const [revising, setRevising] = useState(false);
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

  const start = async (revision = false) => {
    setRunning(true);
    setRevising(revision);
    try {
      await run();
    } finally {
      setRunning(false);
      setRevising(false);
    }
  };

  // Tester feedback: after "Request changes" the person had to find and press Run again to get
  // the revised document. A request made here now starts the revision straight away.
  const changesRequested = entry?.status === "changes_requested";
  useEffect(() => {
    if (!autoRun || !changesRequested || !providerReady || running) return;
    onAutoRun?.();
    void start(true);
    // start is recreated each render; the guard values above decide when it runs.
  }, [autoRun, changesRequested, providerReady, running]);

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
        {discuss && revise && documents && documents[0]?.text && (
          <DocumentDiscussion phase={phase} document={documents.map((d) => d.text ?? "").join("\n\n")} providerReady={providerReady} discuss={discuss} revise={revise} />
        )}
      </section>
    );
  }

  if (!RUNNABLE.includes(entry.status)) return null;

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
          {revising ? `Revising ${phase} with your change notes.` : `Running ${phase} with your model.`} A long document can take several minutes, more on a local model.
        </p>
      )}
    </section>
  );
};
