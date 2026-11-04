import React, { useId, useState } from "react";
import { ArrowUp, CheckCircle2, FolderPlus } from "lucide-react";
import { ChatLog } from "./ChatLog";
import { projectFolderName, type CreateResult } from "../../lib/planning";
import type { ChatMessage, ChatTurn } from "../../lib/idea-chat";
import { NoKeyGuide } from "./NoKeyGuide";

const field =
  "w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition-colors";
const label = "block text-xs font-medium text-zinc-300 mb-1";

/** What the person has typed so far. Kept by the caller, so it survives switching areas. */
export interface IdeaDraft {
  /** The message being written (the idea itself, before the conversation starts). */
  idea: string;
  name: string;
  /** Only ever what the person typed (retest bug 3): the app never makes one up. */
  parent?: string;
  /** The conversation so far (C). */
  messages?: ChatMessage[];
  /** The idea in one sentence, once the AI said it had understood it. */
  summary?: string | null;
}

type CreateInput = { parent: string; name: string; idea: string; conversation: ChatMessage[]; summary: string | null };

/**
 * PLAN-1 and C (owner decision 2026-11-03): the person talks the idea through with their own model,
 * like a chat assistant, until they are satisfied or the AI says it has understood; then they name
 * the project and start the phases, which each still wait for their approval. Without a model the
 * idea can still start the phases directly. Replies are model text, shown as plain text only.
 */
export const StartFromIdea: React.FC<{
  providerReady: boolean;
  create: (input: CreateInput) => Promise<CreateResult>;
  onCreated: (root: string, parent: string) => void;
  onOpenSettings: () => void;
  /** The next reply from the person's model; without it the screen is a plain idea form. */
  chat?: (messages: ChatMessage[]) => Promise<ChatTurn>;
  /** With both, the form's text lives with the caller (tester feedback: it was lost on leaving). */
  draft?: IdeaDraft;
  onDraftChange?: (draft: IdeaDraft) => void;
  /** Shown above the conversation, for example the computer check (G). */
  notice?: React.ReactNode;
}> = ({ providerReady, create, onCreated, onOpenSettings, chat, draft, onDraftChange, notice }) => {
  const id = useId();
  const [local, setLocal] = useState<IdeaDraft>({ idea: "", name: "" });
  const current = draft && onDraftChange ? draft : local;
  const update = (change: Partial<IdeaDraft>) => {
    const next = { ...current, ...change };
    if (draft && onDraftChange) onDraftChange(next);
    else setLocal(next);
  };
  const { idea, name } = current;
  const messages = current.messages ?? [];
  const summary = current.summary ?? null;
  const parent = current.parent ?? "";
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const talking = messages.length > 0;
  const folder = projectFolderName(name);
  const firstIdea = messages.find((m) => m.role === "person")?.text ?? idea.trim();
  const ready = firstIdea.trim() !== "" && folder !== "" && parent.trim() !== "" && !busy && !thinking;
  const canSend = !!chat && providerReady && idea.trim() !== "" && !thinking && !busy;

  const sendMessage = async () => {
    if (!chat || !canSend) return;
    const text = idea.trim();
    const next: ChatMessage[] = [...messages, { role: "person", text }];
    setError(null);
    setThinking(true);
    update({ messages: next, idea: "" });
    const turn = await chat(next);
    setThinking(false);
    if (turn.ok) {
      update({ messages: [...next, { role: "assistant", text: turn.reply }], idea: "", summary: turn.ready ?? summary });
    } else {
      // Nothing is lost: the message goes back in the box to send again.
      update({ messages, idea: text });
      setError(turn.error);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const p = parent.trim();
    const conversation = idea.trim() && talking ? [...messages, { role: "person" as const, text: idea.trim() }] : messages;
    const result = await create({ parent: p, name: name.trim(), idea: firstIdea.trim(), conversation, summary });
    setBusy(false);
    if (result.ok) onCreated(result.root, p);
    else setError(result.error);
  };

  const onComposerKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && chat) {
      event.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full p-4 sm:p-6 space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-100">Start from an idea</h2>
        <p className="text-sm text-zinc-400 leading-relaxed">
          {chat
            ? "Tell the AI what you want to build and talk it through until it has understood. Then start the phases: idea review, research, PRD and architecture, each waiting for your approval."
            : "Describe what you want to build. The app then runs idea review, research, PRD and architecture with your own model, and you approve each one."}
        </p>
      </header>

      {notice}
      {!providerReady && <NoKeyGuide onOpenSettings={onOpenSettings} />}

      {talking && <ChatLog label="Conversation" messages={messages} thinking={thinking} className="max-h-[55vh]" />}

      {summary && (
        <div role="status" aria-label="The AI has understood your idea" className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3 flex gap-2.5">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
          <div className="text-sm">
            <p className="text-emerald-200 font-medium">The AI has understood your idea</p>
            <p className="text-zinc-300 mt-0.5">{summary}</p>
            <p className="text-xs text-zinc-400 mt-1">Name the project below and start the phases, or keep talking to change anything.</p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="relative">
          <label htmlFor={`${id}-idea`} className={talking ? "sr-only" : label}>
            {talking ? "Your reply" : "Your idea"}
          </label>
          <textarea
            id={`${id}-idea`}
            value={idea}
            onChange={(e) => update({ idea: e.target.value })}
            onKeyDown={onComposerKey}
            rows={talking ? 2 : 5}
            placeholder={talking ? "Answer the AI, or add anything it missed..." : "Who is it for, what problem does it solve, what should it do?"}
            className={`${field} ${chat ? "pr-12" : ""} resize-none`}
          />
          {chat && (
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!canSend}
              aria-label="Send to the AI"
              className="absolute right-2 bottom-2 w-8 h-8 rounded-lg grid place-items-center bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <ArrowUp className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {chat && <p className="mt-1 text-[11px] text-zinc-500">Enter sends, Shift+Enter adds a new line.</p>}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-name`} className={label}>
                Project name
              </label>
              <input id={`${id}-name`} value={name} onChange={(e) => update({ name: e.target.value })} className={field} />
            </div>
            <div>
              <label htmlFor={`${id}-parent`} className={label}>
                Parent folder
              </label>
              <input
                id={`${id}-parent`}
                value={parent}
                onChange={(e) => update({ parent: e.target.value })}
                placeholder="The folder that will hold the project, for example D:\Projects"
                className={field}
              />
            </div>
          </div>
          {folder && (
            <p className="text-xs text-zinc-400">
              Project folder: <code className="text-zinc-200">{`${parent.trim().replace(/[\\/]+$/, "")}/${folder}`}</code>
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-red-400 break-words">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!ready}
            className="px-3.5 py-2 text-sm font-medium rounded-xl flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-950 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <FolderPlus className="w-4 h-4" aria-hidden="true" />
            {busy ? "Creating..." : "Create project and start the phases"}
          </button>
        </div>
      </form>
    </div>
  );
};
