import React, { useCallback, useEffect, useId, useState } from "react";
import { AlertTriangle, FolderOpen, Plus, RefreshCw, X } from "lucide-react";
import type { ProjectOverview } from "@omni/core";
import type { ProjectRow, ProjectsResult } from "../../lib/projects";
import { statusWords } from "../../lib/phase-status";

interface ProjectsListProps {
  /** Folders to look in (AppSettings.projectFolders). */
  folders: string[];
  onFoldersChange: (folders: string[]) => void;
  /** Opens the system's folder picker; the chosen folder, or null when cancelled (issue D). */
  pickFolder?: () => Promise<string | null>;
  load: (folders: string[]) => Promise<ProjectsResult>;
  /** Opens a project's phase history (E3). */
  onOpen?: (root: string) => void;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/** "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function phaseLine(o: ProjectOverview): string {
  if (!o.phase.id) return "No phase started";
  return `${o.phase.id} · ${statusWords(o.phase.status ?? "not_started")}`;
}

function tasksLine(o: ProjectOverview): string {
  if (o.tasks.total === 0) return "No tasks yet";
  const doing = o.tasks.inProgress.length ? ` · ${o.tasks.inProgress.join(", ")} in progress` : "";
  return `${o.tasks.done} of ${o.tasks.total} tasks done${doing}`;
}

function Row({ row, now, onOpen }: { row: ProjectRow; now: number; onOpen?: (root: string) => void }) {
  if (!row.ok) {
    return (
      <li className="px-4 py-3 border-b border-zinc-800 last:border-b-0">
        <div className="flex items-center gap-2 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Project memory could not be read</span>
        </div>
        <p className="mt-1 text-xs font-mono text-zinc-500 break-all">{row.root}</p>
        <p className="mt-1 text-xs text-zinc-400 break-words">{row.error}</p>
      </li>
    );
  }
  const o = row.overview;
  const review = o.phase.status === "awaiting_review";
  const last = o.lastActivity;
  return (
    <li className="px-4 py-3 border-b border-zinc-800 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        {onOpen ? (
          <button
            onClick={() => onOpen(row.root)}
            aria-label={`Open ${o.name}`}
            className="text-sm font-medium text-zinc-100 truncate hover:text-indigo-300 hover:underline text-left"
          >
            {o.name}
          </button>
        ) : (
          <span className="text-sm font-medium text-zinc-100 truncate">{o.name}</span>
        )}
        <span className={`text-xs shrink-0 ${review ? "text-amber-300" : "text-zinc-400"}`}>{phaseLine(o)}</span>
      </div>
      <p className="mt-0.5 text-xs font-mono text-zinc-500 break-all">{row.root}</p>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-zinc-400">
        <span>{tasksLine(o)}</span>
        {last && (
          <span title={new Date(last.time).toLocaleString()}>
            {timeAgo(last.time, now)} · {last.type.replace(/_/g, " ")} · {last.actor.tool}
          </span>
        )}
      </div>
      {o.issues > 0 && (
        <p className="mt-1 text-xs text-amber-300">
          {o.issues} line{o.issues === 1 ? "" : "s"} in events.jsonl could not be read.
        </p>
      )}
    </li>
  );
}

export const ProjectsList: React.FC<ProjectsListProps> = ({ folders, onFoldersChange, load, onOpen, now = Date.now, pickFolder }) => {
  const inputId = useId();
  const [result, setResult] = useState<ProjectsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const refresh = useCallback(async () => {
    if (folders.length === 0) {
      setResult(null);
      return;
    }
    setLoading(true);
    setFailure(null);
    try {
      setResult(await load(folders));
    } catch (error) {
      setResult(null);
      setFailure(typeof error === "string" ? error : error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [folders, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addFolder = async () => {
    // With the box empty, the system's folder picker chooses it (issue D); a typed path still works.
    const folder = draft.trim() || (pickFolder ? ((await pickFolder()) ?? "").trim() : "");
    if (!folder || folders.includes(folder)) return;
    onFoldersChange([...folders, folder]);
    setDraft("");
  };

  return (
    <section className="w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-4" aria-labelledby={`${inputId}-title`}>
      <div className="flex items-center justify-between gap-4">
        <h2 id={`${inputId}-title`} className="text-base font-semibold text-zinc-100">
          Projects
        </h2>
        <button
          onClick={() => void refresh()}
          disabled={loading || folders.length === 0}
          className="px-2.5 py-1.5 text-xs text-zinc-300 border border-zinc-800 rounded-lg hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        <label htmlFor={inputId} className="block text-xs font-medium text-zinc-400">
          Folder to add
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addFolder()}
            placeholder="C:\Users\you\Projects"
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => void addFolder()}
            className="px-3 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            Add folder
          </button>
        </div>
        {folders.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Folders searched">
            {folders.map((folder) => (
              <li key={folder} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300">
                <FolderOpen className="w-3 h-3 text-zinc-500" aria-hidden="true" />
                <span className="break-all">{folder}</span>
                <button
                  onClick={() => onFoldersChange(folders.filter((f) => f !== folder))}
                  aria-label={`Remove ${folder}`}
                  className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {folders.length === 0 && (
        <p className="text-sm text-zinc-400">
          Add a folder that contains your projects. OmniOrchestrator lists every project (a folder with .agents/project.json)
          in it and up to two levels below.
        </p>
      )}

      {loading && (
        <p role="status" className="text-sm text-zinc-400">
          Looking for projects...
        </p>
      )}

      {failure && (
        <p role="alert" className="text-sm text-red-400 break-words">
          Could not list projects: {failure}
        </p>
      )}

      {result && result.errors.length > 0 && (
        <div role="alert" className="text-xs text-amber-300 space-y-1">
          {result.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      {result && !loading && result.projects.length === 0 && folders.length > 0 && (
        <p className="text-sm text-zinc-400">No projects found in {folders.join(", ")}.</p>
      )}

      {result && result.projects.length > 0 && (
        <ul className="rounded-xl border border-zinc-800 bg-zinc-900/40" aria-label="Projects">
          {result.projects.map((row) => (
            <Row key={row.root} row={row} now={now()} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
};
