import React, { useId, useState } from "react";
import { Save } from "lucide-react";

type Mode = "full" | "simple";

const field =
  "w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500";

/** The person changes the project's name or mode (E3 slice 4b). Only changed fields are sent. */
export const ProjectDetailsForm: React.FC<{
  name: string;
  mode: Mode;
  onSave: (changes: { name?: string; mode?: Mode }) => Promise<void>;
}> = ({ name, mode, onSave }) => {
  const id = useId();
  const [draftName, setDraftName] = useState(name);
  const [draftMode, setDraftMode] = useState<Mode>(mode);
  const [busy, setBusy] = useState(false);
  // The drafts start from the props once. The parent re-creates this form (key) when the saved
  // name or mode changes; resetting them in an effect could overwrite what the person just typed
  // if the effect ran late (seen as a timing failure in the clean-checkout check).

  const changes = {
    ...(draftName.trim() !== name ? { name: draftName.trim() } : {}),
    ...(draftMode !== mode ? { mode: draftMode } : {}),
  };
  const ready = Object.keys(changes).length > 0 && draftName.trim() !== "";

  const save = async () => {
    setBusy(true);
    try {
      await onSave(changes);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-zinc-800 p-3">
      <div className="space-y-1">
        <label htmlFor={`${id}-name`} className="block text-xs text-zinc-400">
          Project name
        </label>
        <input id={`${id}-name`} value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={200} className={field} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-mode`} className="block text-xs text-zinc-400">
          Mode
        </label>
        <select id={`${id}-mode`} value={draftMode} onChange={(e) => setDraftMode(e.target.value as Mode)} className={field}>
          <option value="full">Full</option>
          <option value="simple">Simple</option>
        </select>
        <p className="text-xs text-zinc-500">Simple mode: one tool, plain-language errors. Full mode: every phase gate and tool.</p>
      </div>
      <button
        onClick={() => void save()}
        disabled={!ready || busy}
        aria-label="Save details"
        className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Save className="w-3.5 h-3.5" aria-hidden="true" />
        Save
      </button>
    </div>
  );
};
