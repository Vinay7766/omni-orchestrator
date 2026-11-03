import React, { useId, useState } from "react";
import { FolderPlus } from "lucide-react";
import { projectFolderName, type CreateResult } from "../../lib/planning";
import { NoKeyGuide } from "./NoKeyGuide";

const field =
  "w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500";
const label = "block text-xs font-medium text-zinc-300 mb-1";

/**
 * E5 (PLAN-1): the person types the idea, names the project and chooses where it goes. The
 * project is created with the idea saved in it; the planning phases then run from the project.
 */
/** What the person has typed so far. Kept by the caller, so it survives switching areas. */
export interface IdeaDraft {
  idea: string;
  name: string;
  /** Undefined until the person changes it: the default folder is shown. */
  parent?: string;
}

export const StartFromIdea: React.FC<{
  defaultParent: string;
  providerReady: boolean;
  create: (input: { parent: string; name: string; idea: string }) => Promise<CreateResult>;
  onCreated: (root: string, parent: string) => void;
  onOpenSettings: () => void;
  /** With both, the form's text lives with the caller (tester feedback: it was lost on leaving). */
  draft?: IdeaDraft;
  onDraftChange?: (draft: IdeaDraft) => void;
}> = ({ defaultParent, providerReady, create, onCreated, onOpenSettings, draft, onDraftChange }) => {
  const id = useId();
  const [local, setLocal] = useState<IdeaDraft>({ idea: "", name: "" });
  const current = draft && onDraftChange ? draft : local;
  const update = (change: Partial<IdeaDraft>) => {
    const next = { ...current, ...change };
    if (draft && onDraftChange) onDraftChange(next);
    else setLocal(next);
  };
  const { idea, name } = current;
  const parent = current.parent ?? defaultParent;
  const setIdea = (value: string) => update({ idea: value });
  const setName = (value: string) => update({ name: value });
  const setParent = (value: string) => update({ parent: value });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folder = projectFolderName(name);
  const ready = idea.trim() !== "" && folder !== "" && parent.trim() !== "" && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const p = parent.trim();
    const result = await create({ parent: p, name: name.trim(), idea: idea.trim() });
    setBusy(false);
    if (result.ok) onCreated(result.root, p);
    else setError(result.error);
  };

  return (
    <div className="max-w-3xl mx-auto w-full p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-100">Start from an idea</h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          Describe what you want to build. The app then runs idea review, research, PRD and architecture with your own model, and you approve each one.
        </p>
      </div>

      {!providerReady && <NoKeyGuide onOpenSettings={onOpenSettings} />}

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor={`${id}-idea`} className={label}>
            Your idea
          </label>
          <textarea
            id={`${id}-idea`}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={6}
            placeholder="Who is it for, what problem does it solve, what should it do?"
            className={field}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor={`${id}-name`} className={label}>
              Project name
            </label>
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor={`${id}-parent`} className={label}>
              Parent folder
            </label>
            <input id={`${id}-parent`} value={parent} onChange={(e) => setParent(e.target.value)} className={field} />
          </div>
        </div>
        {folder && (
          <p className="text-xs text-zinc-400">
            Project folder: <code className="text-zinc-200">{`${parent.trim().replace(/[\\/]+$/, "")}/${folder}`}</code>
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!ready}
          className="px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
          {busy ? "Creating..." : "Create project"}
        </button>
      </form>
    </div>
  );
};
