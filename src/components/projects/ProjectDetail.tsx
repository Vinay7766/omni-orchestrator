import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PLANNING_PHASES } from "@omni/core";
import type { ChatMessage, ChatTurn } from "../../lib/idea-chat";
import type { ProjectDetailResult } from "../../lib/projects";
import type { DecisionResult } from "../../lib/decisions";
import { PhaseHistory } from "./PhaseHistory";
import { WorkflowChart } from "./WorkflowChart";
import { RefActionsContext } from "./WorkflowDetails";
import type { PhaseDecisions } from "./PhaseActions";
import { MemoryPanel } from "./MemoryPanel";
import { ProjectDetailsForm } from "./ProjectDetailsForm";
import type { MemoryFilesResult, NewEntry } from "../../lib/memory";
import { PlanningPanel } from "../planning/PlanningPanel";
import { TaskProposalPanel } from "../planning/TaskProposalPanel";
import type { readTaskProposal } from "../../lib/task-proposal";
import { TeamPanel, type TeamFns } from "../team/TeamPanel";
import { FreshSessionPanel, type FreshSessionFns } from "../team/FreshSessionPanel";

/** Planning phases run with the person's own model (E5). */
export interface PlanningFns {
  run: (root: string) => Promise<DecisionResult>;
  providerReady: boolean;
  readDocument: (root: string, name: string) => Promise<string | null>;
  /** The task list (slice 5): written by the person's model, approved or sent back by the person. */
  readProposal: (root: string) => ReturnType<typeof readTaskProposal>;
  propose: (root: string, notes?: string) => Promise<DecisionResult>;
  approveTasks: (root: string) => Promise<DecisionResult>;
  /** C: the next reply in a conversation about a document under review. */
  discuss?: (root: string, phase: string, document: string, messages: ChatMessage[]) => Promise<ChatTurn>;
  /** C: keeps that conversation with the project (docs/planning/<phase>-discussion.md). */
  saveDiscussion?: (root: string, phase: string, messages: ChatMessage[]) => Promise<void>;
}

/** The architecture is approved: the person chooses the tools and models for the build (D). */
function architectureApproved(detail: Extract<ProjectDetailResult, { ok: true }>): boolean {
  return detail.history.find((e) => e.phase === "architecture")?.status === "approved";
}

/**
 * The build is next, no tasks exist yet, and the team is chosen: the task list is written around
 * those tools and models (D). Without a team it waits (the team panel says so).
 */
function wantsTaskList(detail: Extract<ProjectDetailResult, { ok: true }>, teamRequired: boolean): boolean {
  const next = detail.history.find((e) => e.isNext);
  return architectureApproved(detail) && next?.phase === "build" && detail.taskCount === 0 && (!teamRequired || (detail.teamSize ?? 0) > 0);
}

/** The task list exists: the build can be handed to the tools (E6). */
function readyToHandOff(detail: Extract<ProjectDetailResult, { ok: true }>): boolean {
  return architectureApproved(detail) && (detail.taskCount ?? 0) > 0;
}

/** The build is under way, it has tasks, and every one is done (issue C). */
function buildReadyToHandIn(detail: Extract<ProjectDetailResult, { ok: true }>): boolean {
  const build = detail.history.find((e) => e.phase === "build");
  return build?.status === "in_progress" && (detail.taskCount ?? 0) > 0 && detail.tasksDone === detail.taskCount;
}

/** The phase to start fresh: the next one, once an earlier phase is approved (HND-7). */
function freshPhase(detail: Extract<ProjectDetailResult, { ok: true }>): string | null {
  const next = detail.history.find((e) => e.isNext);
  return next && detail.history.some((e) => e.status === "approved") ? next.phase : null;
}

/** How decisions are recorded for a project root (the app passes lib/decisions over invoke). */
export interface DecideFns {
  approve?: (root: string, phase: string) => Promise<DecisionResult>;
  requestChanges?: (root: string, phase: string, notes: string) => Promise<DecisionResult>;
  run?: (root: string, phase: string) => Promise<DecisionResult>;
  skip?: (root: string, phase: string, reason: string) => Promise<DecisionResult>;
  /** Every task is done but no tool handed in the build: the person hands it in (issue C). */
  handInBuild?: (root: string) => Promise<DecisionResult>;
}

interface ProjectDetailProps {
  root: string;
  load: (root: string) => Promise<ProjectDetailResult>;
  onBack: () => void;
  /** When given, the person can decide (approve, request changes, run or skip) here. */
  decide?: DecideFns;
  /** When given, the person can change the project's name and mode (E3 slice 4b). */
  details?: { update: (root: string, changes: { name?: string; mode?: "full" | "simple" }) => Promise<DecisionResult> };
  /** When given, the project's memory files and the person's own entries are shown. */
  memory?: {
    load: (root: string) => Promise<MemoryFilesResult>;
    add: (root: string, entry: NewEntry) => Promise<DecisionResult>;
  };
  /** When given, the next planning phase runs here and its document is shown for review. */
  planning?: PlanningFns;
  /** When given, the person selects the tools for the build and hands it to them (E6). */
  team?: TeamFns;
  /** When given, the next phase can be started in a fresh session after an approval (E11). */
  fresh?: FreshSessionFns;
  /** When given, the page follows the project's memory and reloads on changes made elsewhere (E7). */
  watch?: (root: string, onChange: () => void, onError: (message: string) => void) => () => void;
  /** When given, files in the workflow details open their folder and commits can be copied (P-E8-02). */
  refs?: { showInFolder: (root: string, path: string) => Promise<void>; copy: (text: string) => Promise<void> };
}

const failed = (e: unknown): ProjectDetailResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

/** One project: its phase history, read from its memory, and the person's decisions (E3). */
export const ProjectDetail: React.FC<ProjectDetailProps> = ({ root, load, onBack, decide, details, memory, planning, team, fresh, watch, refs }) => {
  const [detail, setDetail] = useState<ProjectDetailResult | null>(null);
  const [outcome, setOutcome] = useState<DecisionResult | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  /** A planning phase the person just sent back here; its revision starts by itself. */
  const [reviseNow, setReviseNow] = useState<string | null>(null);
  // Bumped on each change seen elsewhere, so the memory panel reloads too.
  const [revision, setRevision] = useState(0);

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

  // A change recorded elsewhere (extension, MCP server): reload, keeping the page on screen.
  useEffect(() => {
    if (!watch) return;
    let current = true;
    setLiveError(null);
    const stop = watch(
      root,
      () => {
        setRevision((r) => r + 1);
        load(root)
          .then((d) => current && setDetail(d))
          .catch((e) => current && setDetail(failed(e)));
      },
      (message) => current && setLiveError(message),
    );
    return () => {
      current = false;
      stop();
    };
  }, [watch, root, load]);

  const reload = useCallback(async () => {
    setDetail(await load(root).catch(failed));
  }, [load, root]);

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
        requestChanges: async (phase, notes) => {
          await record(decide.requestChanges?.(root, phase, notes));
          // A planning phase run in the app is revised straight away (tester feedback).
          if ((PLANNING_PHASES as readonly string[]).includes(phase)) setReviseNow(phase);
        },
        run: (phase) => record(decide.run?.(root, phase)),
        skip: (phase, reason) => record(decide.skip?.(root, phase, reason)),
      },
    [decide, record, root],
  );

  const readDocument = useCallback((name: string) => (planning ? planning.readDocument(root, name) : Promise.resolve(null)), [planning, root]);
  const readProposal = useCallback(
    () => (planning ? planning.readProposal(root) : Promise.resolve({ ok: false as const, error: "Planning is not available here." })),
    [planning, root],
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
      {liveError && (
        <p role="status" className="text-xs text-amber-400 break-words">
          {liveError} Changes made in other tools show after you reopen the project.
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
          {details && (
            <ProjectDetailsForm
              key={`${detail.name}|${detail.mode}`}
              name={detail.name}
              mode={detail.mode}
              onSave={(changes) => record(details.update(root, changes))}
            />
          )}
          {planning && (
            <PlanningPanel
              entry={detail.history.find((e) => e.isNext)}
              providerReady={planning.providerReady}
              run={() => record(planning.run(root))}
              readDocument={readDocument}
              autoRun={reviseNow !== null && reviseNow === detail.history.find((e) => e.isNext)?.phase}
              onAutoRun={() => setReviseNow(null)}
              explain={detail.mode === "simple"}
              persistKey={`discussion:${root}`}
              discuss={
                planning.discuss &&
                ((document, messages) => planning.discuss!(root, detail.history.find((e) => e.isNext)?.phase ?? "", document, messages))
              }
              revise={
                decisions &&
                (async (notes, messages) => {
                  const phase = detail.history.find((e) => e.isNext)?.phase ?? "";
                  await planning.saveDiscussion?.(root, phase, messages);
                  await decisions.requestChanges(phase, notes);
                })
              }
            />
          )}
          {team && architectureApproved(detail) && (
            <TeamPanel key={`${detail.taskCount ?? 0}`} root={root} fns={team} handOffReady={readyToHandOff(detail)} onSaved={reload} />
          )}
          {planning && wantsTaskList(detail, !!team) && (
            <TaskProposalPanel
              providerReady={planning.providerReady}
              read={readProposal}
              propose={(notes) => record(planning.propose(root, notes))}
              approve={() => record(planning.approveTasks(root))}
            />
          )}

          {fresh && freshPhase(detail) && <FreshSessionPanel root={root} phase={freshPhase(detail)!} fns={fresh} />}
          {decide?.handInBuild && buildReadyToHandIn(detail) && (
            <section aria-label="Every task is done" className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 space-y-2">
              <p className="text-sm text-emerald-200">Every task is done, but no tool has handed in the build yet.</p>
              <p className="text-xs text-zinc-400">
                Hand it in for your review with the files and test evidence the tasks recorded. Once you approve it, the review phase comes next.
              </p>
              <button
                type="button"
                onClick={() => void record(decide.handInBuild?.(root))}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Hand in the build for review
              </button>
            </section>
          )}
          {detail.updates && (
            <div role="status" aria-label="Updates from your tools" className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300 space-y-1">
              {detail.updates.applied.length > 0 && (
                <>
                  <p className="text-emerald-300">Applied from your tools:</p>
                  <ul className="ml-4 list-disc">
                    {detail.updates.applied.map((a, i) => (
                      <li key={a + i} className="break-words">
                        {a}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {detail.updates.refused.length > 0 && (
                <p className="text-amber-300">
                  {detail.updates.refused.length === 1 ? "1 update was not applied" : `${detail.updates.refused.length} updates were not applied`}; each is recorded
                  with the reason under Problems in the project memory below.
                </p>
              )}
            </div>
          )}
          {detail.workflow && (
            <RefActionsContext.Provider value={refs ? { showInFolder: (path) => refs.showInFolder(root, path), copy: refs.copy } : {}}>
              <WorkflowChart workflow={detail.workflow} />
            </RefActionsContext.Provider>
          )}
          <PhaseHistory entries={detail.history} decisions={decisions} review={detail.review} />
          {memory && <MemoryPanel root={root} load={memory.load} add={memory.add} revision={revision} />}
        </>
      )}
    </section>
  );
};
