import React, { useId, useState } from "react";
import { FilePlus2, Upload, X } from "lucide-react";
import { PHASE_IDS, redactText } from "@omni/core";

/** What the app's add_skill command takes (SKL-5, SKL-6). */
export interface NewSkillInput {
  id: string;
  name: string;
  description: string;
  content: string;
  phases: string[];
  author: string;
  sourceUrl: string;
  license: string;
}

/** A SKILL.md's name and description from its header (`---` block), and its whole text. */
export function parseSkillFile(text: string): { name: string; description: string; content: string } {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const field = (key: string) => {
    const line = header?.[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  };
  return { name: field("name"), description: field("description"), content: text };
}

/** The catalog id rule: lowercase letters, digits and dashes. */
const toId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

const PHASES = [...PHASE_IDS, "all"];

const field =
  "w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500";
const label = "block text-xs font-medium text-zinc-300 mb-1";

/**
 * Adds a skill of the person's own (tester feedback 4): typed in, or uploaded as a SKILL.md. It is
 * saved where every AI tool reads skills, so it reaches them too. The author, source and license
 * are required (SKL-6), and a skill carrying a key is refused before it is saved (MEM-6).
 */
export const AddSkillForm: React.FC<{ onAdd: (skill: NewSkillInput) => Promise<void>; onClose: () => void }> = ({ onAdd, onClose }) => {
  const id = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [phases, setPhases] = useState<string[]>([]);
  const [author, setAuthor] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [license, setLicense] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skillId = toId(name);
  const ready =
    !busy && skillId !== "" && description.trim() !== "" && content.trim() !== "" && author.trim() !== "" && sourceUrl.trim() !== "" && license.trim() !== "" && phases.length > 0;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseSkillFile(await file.text());
    setContent(parsed.content);
    if (parsed.name) setName(parsed.name);
    if (parsed.description) setDescription(parsed.description);
  };

  const togglePhase = (phase: string) => setPhases((now) => (now.includes(phase) ? now.filter((p) => p !== phase) : [...now, phase]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const text = [name, description, content, author, sourceUrl].join("\n");
    if (redactText(text).findings.length > 0) {
      setError("This skill contains what looks like a key or secret. Remove it first: skills are read by every AI tool.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd({
        id: skillId,
        name: name.trim(),
        description: description.trim(),
        content,
        phases,
        author: author.trim(),
        sourceUrl: sourceUrl.trim(),
        license: license.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Add a skill" className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
            <FilePlus2 className="w-4 h-4 text-indigo-400" aria-hidden="true" /> Add a skill
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">Write one or upload a SKILL.md. Every AI tool connected to your projects gets it.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the add a skill form" className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800">
          <X className="w-4 h-4" />
        </button>
      </div>

      <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-200 hover:bg-zinc-800 cursor-pointer focus-within:ring-2 focus-within:ring-indigo-500">
        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Upload a SKILL.md</span>
        <input type="file" accept=".md,text/markdown,text/plain" className="sr-only" aria-label="Upload a SKILL.md" onChange={(e) => void upload(e.target.files?.[0])} />
      </label>

      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor={`${id}-name`} className={label}>
              Name
            </label>
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} className={field} />
            {skillId && <p className="mt-1 text-[11px] text-zinc-500 font-mono">id: {skillId}</p>}
          </div>
          <div>
            <label htmlFor={`${id}-description`} className={label}>
              Description (when tools should use it)
            </label>
            <input id={`${id}-description`} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-content`} className={label}>
            Skill text (SKILL.md)
          </label>
          <textarea id={`${id}-content`} rows={10} value={content} onChange={(e) => setContent(e.target.value)} className={`${field} font-mono text-xs`} />
        </div>

        <fieldset>
          <legend className={label}>Phases it is for</legend>
          <div className="flex flex-wrap gap-2">
            {PHASES.map((phase) => (
              <label key={phase} className="inline-flex items-center gap-1.5 text-xs text-zinc-300 px-2 py-1 rounded-lg border border-zinc-800 hover:border-zinc-700 cursor-pointer">
                <input type="checkbox" checked={phases.includes(phase)} onChange={() => togglePhase(phase)} className="accent-indigo-500" />
                {phase}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor={`${id}-author`} className={label}>
              Author
            </label>
            <input id={`${id}-author`} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="You, if you wrote it" className={field} />
          </div>
          <div>
            <label htmlFor={`${id}-source`} className={label}>
              Source link
            </label>
            <input id={`${id}-source`} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." className={field} />
          </div>
          <div>
            <label htmlFor={`${id}-license`} className={label}>
              License
            </label>
            <input id={`${id}-license`} value={license} onChange={(e) => setLicense(e.target.value)} placeholder="MIT, or unverified" className={field} />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-xs text-red-400 break-words">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {busy ? "Adding..." : "Add skill"}
          </button>
        </div>
      </form>
    </section>
  );
};
