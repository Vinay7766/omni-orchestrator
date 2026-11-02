import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { ProjectDetailResult } from "../../lib/projects";
import type { DecisionResult } from "../../lib/decisions";
import { PhaseHistory } from "./PhaseHistory";
import type { PhaseDecisions } from "./PhaseActions";

/** How decisions are recorded for a project root (the app passes lib/decisions over invoke). */
export interface DecideFns {
  approve?: (root: string, phase: string) => Promise<DecisionResult>;
  requestChanges?: (root: string, phase: string, notes: string) => Promise<DecisionResult>;
  run?: (root: string, phase: string) => Promise<DecisionResult>;
  skip?: (root: string, phase: string, reason: string) => Promise<DecisionResult>;
}

interface ProjectDetailProps {
  root: string;
  load: (root: string) => Promise<ProjectDetailResult>;
  onBack: () => void;
  /** When given, the person can decide (approve, request changes, run or skip) here. */
  decide?: DecideFns;
}

const failed = (e: unknown): ProjectDetailResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

/** One project: its phase history, read from its memory, and the person's decisions (E3). */
export const ProjectDetail: React.FC<ProjectDetailProps> = ({ root, load, onBack, decide }) => {
  const [detail, setDetail] = useState<ProjectDetailResult | null>(null);
  const [outcome, setOutcome] = useState<DecisionResult | null>(null);

  useEffect(() => {
    let current = true;
    setDetail(null);
    setOutcome(null);
    load(root)
      .then((d) => current && setDetail(d))
      .catch((e) => current && setDetail(failed(e)));
    return () => {
      current = false;
    };
  }, [root, load]);

  // After a decision: show its result and reload, keeping the current history on screen meanwhile.
  const record = useCallback(
    async (decision: Promise<DecisionResult> | undefined) => {
      if (!decision) return;
      const result = await decision.catch((e): DecisionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
      setOutcome(result);
      setDetail(await load(root).catch(failed));
    },
    [load, root],
  );

  const decisions = useMemo<PhaseDecisions | undefined>(
    () =>
      decide && {
        approve: (phase) => record(decide.approve?.(root, phase)),
        requestChanges: (phase, notes) => record(decide.requestChanges?.(root, phase, notes)),
        run: (phase) => record(decide.run?.(root, phase)),
        skip: (phase, reason) => record(decide.skip?.(root, phase, reason)),
      },
    [decide, record, root],
  );

  return (
    <section className="w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <button onClick={onBack} className="text-xs text-zinc-400 hover:text-zinc-100 flex items-center gap-1.5">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
        Back to projects
      </button>
      {!detail && (
        <p role="status" className="text-sm text-zinc-400">
          Loading the project...
        </p>
      )}
      {detail && !detail.ok && (
        <p role="alert" className="text-sm text-red-400 break-words">
          The project memory could not be read: {detail.error}
        </p>
      )}
      {outcome && (
        <p role={outcome.ok ? "status" : "alert"} className={`text-sm break-words ${outcome.ok ? "text-emerald-400" : "text-red-400"}`}>
          {outcome.ok ? outcome.message : `Not recorded: ${outcome.message}`}
        </p>
      )}
      {detail && detail.ok && (
        <>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{detail.name}</h2>
            <p className="text-xs font-mono text-zinc-500 break-all">{root}</p>
          </div>
          <PhaseHistory entries={detail.history} decisions={decisions} />
        </>
      )}
    </section>
  );
};
