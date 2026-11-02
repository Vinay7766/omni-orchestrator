import React, { useId, useState } from "react";
import { Plus } from "lucide-react";
import type { NewEntry } from "../../lib/memory";

type Kind = NewEntry["kind"];
type Status = "open" | "resolved" | "wont_fix";

const field =
  "w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500";
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * The person adds a decision, a problem or a lesson (MEM-2, UND-5). Decisions and problems must
 * point at a file or commit they concern (MEM-4); the recorder checks the files exist.
 */
export const MemoryEntryForm: React.FC<{ onSubmit: (entry: NewEntry) => Promise<void> }> = ({ onSubmit }) => {
  const id = useId();
  const [kind, setKind] = useState<Kind>("decision");
  const [title, setTitle] = useState("");
  const [text, setText] = useState(""); // decision / details / lesson
  const [extra, setExtra] = useState(""); // reason / context
  const [status, setStatus] = useState<Status>("open");
  const [files, setFiles] = useState("");
  const [commits, setCommits] = useState("");
  const [busy, setBusy] = useState(false);

  const hasRefs = lines(files).length + lines(commits).length > 0;
  const ready =
    kind === "lesson"
      ? text.trim() !== ""
      : title.trim() !== "" && text.trim() !== "" && (kind === "problem" || extra.trim() !== "") && hasRefs;

  const entry = (): NewEntry => {
    if (kind === "decision") return { kind, title: title.trim(), decision: text.trim(), reason: extra.trim(), files: lines(files), commits: lines(commits) };
    if (kind === "problem") return { kind, title: title.trim(), details: text.trim(), status, files: lines(files), commits: lines(commits) };
    return { kind, lesson: text.trim(), ...(extra.trim() ? { context: extra.trim() } : {}) };
  };

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(entry());
    } finally {
      setBusy(false);
    }
  };

  const input = (key: string, label: string, value: string, set: (v: string) => void, rows?: number) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${key}`} className="block text-xs text-zinc-400">
        {label}
      </label>
      {rows ? (
        <textarea id={`${id}-${key}`} rows={rows} value={value} onChange={(e) => set(e.target.value)} className={field} />
      ) : (
        <input id={`${id}-${key}`} value={value} onChange={(e) => set(e.target.value)} className={field} />
      )}
    </div>
  );

  return (
    <div className="space-y-2 rounded-xl border border-zinc-800 p-3">
      <div className="space-y-1">
        <label htmlFor={`${id}-kind`} className="block text-xs text-zinc-400">
          Kind
        </label>
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(e) => {
            // The text boxes mean different things per kind: start them empty.
            setKind(e.target.value as Kind);
            setText("");
            setExtra("");
          }}
          className={field}
        >
          <option value="decision">Decision</option>
          <option value="problem">Problem</option>
          <option value="lesson">Lesson (a correction to how the request was understood)</option>
        </select>
      </div>
      {kind !== "lesson" && input("title", "Title", title, setTitle)}
      {kind === "decision" && input("text", "Decision", text, setText, 2)}
      {kind === "decision" && input("extra", "Reason", extra, setExtra, 2)}
      {kind === "problem" && input("text", "Details", text, setText, 3)}
      {kind === "problem" && (
        <div className="space-y-1">
          <label htmlFor={`${id}-status`} className="block text-xs text-zinc-400">
            Status
          </label>
          <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as Status)} className={field}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="wont_fix">Won't fix</option>
          </select>
        </div>
      )}
      {kind === "lesson" && input("text", "Lesson", text, setText, 2)}
      {kind === "lesson" && input("extra", "Context (optional)", extra, setExtra)}
      {kind !== "lesson" && input("files", "Files it concerns (one per line)", files, setFiles, 2)}
      {kind !== "lesson" && input("commits", "Commits it concerns (one per line)", commits, setCommits, 1)}
      {kind !== "lesson" && !hasRefs && <p className="text-xs text-zinc-500">Point at least one file or commit it concerns.</p>}
      <button
        onClick={() => void submit()}
        disabled={!ready || busy}
        className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        Record
      </button>
    </div>
  );
};
