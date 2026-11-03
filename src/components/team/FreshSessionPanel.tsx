import React, { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import type { Team } from "@omni/core";
import type { FreshSessionOutcome } from "../../lib/fresh-session";

export interface FreshSessionFns {
  loadTeam: (root: string) => Promise<{ ok: true; team: Team | null } | { ok: false; error: string }>;
  start: (root: string, toolId: string) => Promise<FreshSessionOutcome>;
}

/** After an approval: start the next phase in a new session that loads context from memory (E11, HND-7). */
export const FreshSessionPanel: React.FC<{ root: string; phase: string; fns: FreshSessionFns }> = ({ root, phase, fns }) => {
  const [members, setMembers] = useState<Team["members"] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<FreshSessionOutcome | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fns
      .loadTeam(root)
      .then((r) => current && setMembers(r.ok ? (r.team?.members ?? []) : []))
      .catch(() => current && setMembers([]));
    return () => {
      current = false;
    };
  }, [fns, root]);

  if (!members || members.length === 0) return null;
  const toolId = chosen ?? members[0].toolId;

  const start = async () => {
    setBusy(true);
    setCopied(null);
    setOutcome(await fns.start(root, toolId).catch((e): FreshSessionOutcome => ({ ok: false, error: e instanceof Error ? e.message : String(e) })));
    setBusy(false);
  };

  const copy = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("Copied. Paste it into a new chat in the tool.");
    } catch {
      setCopied("The prompt could not be copied here: select the text above and copy it yourself.");
    }
  };

  return (
    <section aria-labelledby="fresh-session-heading" className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <h3 id="fresh-session-heading" className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
        <RefreshCcw className="w-4 h-4 text-indigo-400" aria-hidden="true" />
        Next phase in a fresh session
      </h3>
      <p className="text-xs text-zinc-400">
        Start <span className="text-zinc-200">{phase}</span> in a new session that reads the project from its memory, so nothing carries over from a long chat.
      </p>
      <fieldset className="space-y-1">
        <legend className="sr-only">Tool for the new session</legend>
        {members.map((m) => (
          <label key={m.toolId} className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="radio" name="fresh-session-tool" value={m.toolId} checked={toolId === m.toolId} onChange={() => setChosen(m.toolId)} />
            {m.name}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? "Starting..." : `Start ${phase} in a fresh session`}
      </button>
      {outcome && !outcome.ok && (
        <p role="alert" className="text-xs text-red-400 break-words">
          Not started: {outcome.error}
        </p>
      )}
      {outcome && outcome.ok && (
        <div className="space-y-2">
          <p role="status" className="text-xs text-zinc-300 break-words">
            {outcome.result.message}
            {outcome.sessionProblem ? ` ${outcome.sessionProblem}` : ""}
          </p>
          {!outcome.result.promptPassed && (
            <>
              <textarea
                readOnly
                aria-label="Prompt for the new session"
                value={outcome.prompt}
                rows={8}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs text-zinc-200"
              />
              <button type="button" onClick={() => void copy(outcome.prompt)} className="px-3 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-200 hover:border-zinc-500">
                Copy the prompt
              </button>
              {copied && <p className="text-xs text-zinc-400">{copied}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
};
