import React, { useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Skill } from "../../lib/types";
import { SkillCard } from "./SkillCard";
import { SkillDetailModal } from "./SkillDetailModal";
import { AddSkillForm, type NewSkillInput } from "./AddSkillForm";

interface SkillCatalogProps {
  skills: Skill[];
  /** Rejects when the change was not saved; the switch then stays where it was. */
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onSave: (skillId: string, newContent: string, newDescription: string) => Promise<void>;
  /** Adds the person's own skill; rejects with the reason when it is refused. */
  onAdd?: (skill: NewSkillInput) => Promise<void>;
}

/** The skill catalog area: search, toggle, view and edit every loaded skill. */
export const SkillCatalog: React.FC<SkillCatalogProps> = ({ skills, onToggle, onSave, onAdd }) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ skill: Skill; mode: "view" | "edit" } | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const toggle = async (id: string, enabled: boolean) => {
    setToggleError(null);
    try {
      await onToggle(id, enabled);
    } catch (error) {
      const name = skills.find((s) => s.id === id)?.name ?? id;
      const reason = error instanceof Error ? error.message : String(error);
      setToggleError(`Could not turn ${name} ${enabled ? "on" : "off"}: ${reason}`);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = q
    ? skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
    : skills;

  return (
    <div className="max-w-4xl mx-auto w-full p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Skill catalog</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {skills.length} skills loaded. Inspect, turn on or off, edit or add skills; every AI tool connected to your projects gets the same ones. Authors are credited on each.
          </p>
        </div>
        {onAdd && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a skill
          </button>
        )}
      </div>

      {onAdd && adding && (
        <AddSkillForm
          onClose={() => setAdding(false)}
          onAdd={async (skill) => {
            await onAdd(skill);
            setAdding(false);
          }}
        />
      )}

      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search skills"
          placeholder="Search by name, description or id"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {toggleError && (
        <p role="alert" className="text-xs text-red-400 break-words">
          {toggleError}
        </p>
      )}

      {skills.length === 0 ? (
        <p role="status" className="text-xs text-zinc-400">No skills were loaded.</p>
      ) : shown.length === 0 ? (
        <p role="status" className="text-xs text-zinc-400">No skill matches "{query}".</p>
      ) : (
        <div className="space-y-3">
          {shown.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onToggle={toggle}
              onView={(s) => setSelected({ skill: s, mode: "view" })}
              onEdit={(s) => setSelected({ skill: s, mode: "edit" })}
            />
          ))}
        </div>
      )}

      {selected && (
        <SkillDetailModal
          skill={selected.skill}
          onClose={() => setSelected(null)}
          onSave={onSave}
          initialEditMode={selected.mode === "edit"}
        />
      )}
    </div>
  );
};
