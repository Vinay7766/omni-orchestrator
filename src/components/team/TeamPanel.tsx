import React, { useEffect, useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import type { Team, TeamSelection } from "@omni/core";
import type { DiscoveredTool } from "../../lib/types";
import type { HandOffOutcome } from "../../lib/team";
import { HandoffResultView } from "./HandoffResultView";

type Failure = { ok: false; error: string };
type Level = 1 | 2 | 3;

export interface TeamFns {
  discover: () => Promise<{ ok: true; tools: DiscoveredTool[] } | Failure>;
  load: (root: string) => Promise<{ ok: true; team: Team | null } | Failure>;
  save: (root: string, selection: TeamSelection[]) => Promise<{ ok: boolean; message: string }>;
  handOff: (root: string, toolId: string) => Promise<HandOffOutcome>;
}

interface Row {
  id: string;
  name: string;
  found: number | null;
  evidence: string[];
  missing: boolean;
}

const LEVELS: { value: Level; label: string }[] = [
  { value: 3, label: "Level 3: MCP" },
  { value: 2, label: "Level 2: reads instruction files" },
  { value: 1, label: "Level 1: chat only (copy a handoff)" },
];

const foundLabel = (row: Row) => (row.missing ? "not found on this computer now" : row.found ? `level ${row.found}` : "level unknown, please confirm");

/** The models typed for a tool: comma or line separated, trimmed, each once (TOOL-6: free text). */
const parseModels = (text: string) => [...new Set(text.split(/[,\n]/).map((m) => m.trim()).filter(Boolean))].slice(0, 20);

/**
 * Tools for the build (E6, D): the person selects them, confirms levels, says which models they use
 * in each, and saves; the task list is then built around this team. Handing off waits for the
 * approved task list (`handOffReady`), so each tool gets its own tasks.
 */
export const TeamPanel: React.FC<{ root: string; fns: TeamFns; handOffReady?: boolean; onSaved?: () => void }> = ({ root, fns, handOffReady = true, onSaved }) => {
  const [tools, setTools] = useState<DiscoveredTool[] | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, Level | null>>({});
  const [saved, setSaved] = useState<{ ok: boolean; message: string } | null>(null);
  const [models, setModels] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, HandOffOutcome>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    Promise.all([fns.discover(), fns.load(root)]).then(([found, loaded]) => {
      if (!current) return;
      if (!found.ok) setProblem(`Tools could not be looked for: ${found.error}`);
      else if (!loaded.ok) setProblem(loaded.error);
      setTools(found.ok ? found.tools : []);
      const members = loaded.ok ? (loaded.team?.members ?? []) : [];
      setTeam(loaded.ok ? loaded.team : null);
      setChosen(Object.fromEntries(members.map((m) => [m.toolId, m.capability as Level])));
      setModels(Object.fromEntries(members.map((m) => [m.toolId, (m.models ?? []).join(", ")])));
    });
    return () => {
      current = false;
    };
  }, [fns, root]);

  const rows = useMemo<Row[]>(() => {
    const found = (tools ?? []).map((t) => ({ id: t.id, name: t.name, found: t.capability, evidence: t.evidence, missing: false }));
    const gone = (team?.members ?? [])
      .filter((m) => !found.some((t) => t.id === m.toolId))
      .map((m) => ({ id: m.toolId, name: m.name, found: null, evidence: [], missing: true }));
    return [...found, ...gone];
  }, [tools, team]);

  if (!tools) return <p role="status" className="text-sm text-zinc-400">Looking for AI tools on this computer...</p>;

  const selected = rows.filter((r) => r.id in chosen);
  const ready = selected.every((r) => chosen[r.id] !== null);
  const toggle = (row: Row) =>
    setChosen((c) => {
      const next = { ...c };
      if (row.id in next) delete next[row.id];
      else next[row.id] = row.found && row.found >= 1 && row.found <= 3 ? (row.found as Level) : null;
      return next;
    });

  const save = async () => {
    setBusy(true);
    const selection = selected.map((r) => {
      const level = chosen[r.id] as Level;
      const typed = parseModels(models[r.id] ?? "");
      return { toolId: r.id, name: r.name, capability: level, confirmedByPerson: r.found === null || level > r.found, ...(typed.length ? { models: typed } : {}) };
    });
    const result = await fns.save(root, selection);
    setSaved(result);
    const loaded = await fns.load(root);
    if (loaded.ok) setTeam(loaded.team);
    setBusy(false);
    if (result.ok) onSaved?.();
  };

  /** One click for the whole team (D): each tool in turn, each with its own result and steps. */
  const handOffAll = async () => {
    if (!team) return;
    setBusy(true);
    for (const m of team.members) {
      const outcome = await fns.handOff(root, m.toolId);
      setOutcomes((o) => ({ ...o, [m.toolId]: outcome }));
    }
    setBusy(false);
  };

  const handOff = async (toolId: string) => {
    setBusy(true);
    const outcome = await fns.handOff(root, toolId);
    setOutcomes((o) => ({ ...o, [toolId]: outcome }));
    setBusy(false);
  };

  return (
    <section aria-labelledby="team-title" className="border border-zinc-800 rounded-lg p-4 space-y-4 bg-zinc-900">
      <h3 id="team-title" className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
        <Wrench className="w-4 h-4 text-indigo-400" aria-hidden="true" />
        Tools for the build
      </h3>
      {problem && <p role="alert" className="text-sm text-red-400 break-words">{problem}</p>}
      {rows.length === 0 && !problem && <p className="text-sm text-zinc-400">No AI tools were found on this computer.</p>}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="border border-zinc-800 rounded p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className="flex items-center gap-2 text-sm text-zinc-100">
                <input type="checkbox" checked={row.id in chosen} onChange={() => toggle(row)} />
                {row.name}
              </label>
              <span className="text-xs text-zinc-500">{foundLabel(row)}</span>
              {row.id in chosen && (
                <select
                  aria-label={`Level for ${row.name}`}
                  value={chosen[row.id] ?? ""}
                  onChange={(e) => setChosen((c) => ({ ...c, [row.id]: Number(e.target.value) as Level }))}
                  className="bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-200 px-1.5 py-1"
                >
                  <option value="" disabled>
                    Choose a level
                  </option>
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {row.id in chosen && (
              <div className="pt-1">
                <label htmlFor={`models-${row.id}`} className="block text-xs text-zinc-400 mb-1">
                  Models you use in {row.name}
                </label>
                <input
                  id={`models-${row.id}`}
                  value={models[row.id] ?? ""}
                  onChange={(e) => setModels((m) => ({ ...m, [row.id]: e.target.value }))}
                  placeholder="For example the model names your plan includes, separated by commas"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-200 px-2.5 py-1.5 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}
            {row.evidence.length > 0 && (
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer">Why it was found</summary>
                <ul className="list-disc pl-5">
                  {row.evidence.map((e) => (
                    <li key={e} className="break-words">{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={save}
        disabled={busy || !ready}
        className="px-3 py-1.5 rounded bg-indigo-600 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        Save the selection
      </button>
      {saved && <p role={saved.ok ? "status" : "alert"} className={`text-sm break-words ${saved.ok ? "text-emerald-400" : "text-red-400"}`}>{saved.message}</p>}
      {team && team.members.length > 0 && !handOffReady && (
        <p className="text-xs text-zinc-400 border-t border-zinc-800 pt-3">
          Next: the AI writes the task list around these tools and models. You hand the build to them once the task list is approved.
        </p>
      )}
      {team && team.members.length > 0 && handOffReady && (
        <div className="space-y-3 border-t border-zinc-800 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-zinc-300">Hand off the build</h4>
            {team.members.length > 1 && (
              <button
                type="button"
                onClick={() => void handOffAll()}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                Set up and open all
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-500">Each tool gets the whole plan and its own tasks; the steps to start appear under each one.</p>
          {team.members.map((m) => (
            <div key={m.toolId} className="space-y-2">
              <button
                type="button"
                onClick={() => handOff(m.toolId)}
                disabled={busy}
                aria-label={`Set up and open ${m.name}`}
                className="px-3 py-1.5 rounded border border-zinc-700 text-sm text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
              >
                Set up and open {m.name} (level {m.capability})
              </button>
              {outcomes[m.toolId] && <HandoffResultView name={m.name} outcome={outcomes[m.toolId]} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
