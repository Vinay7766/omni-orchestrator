import { createContext, useContext, useState } from "react";
import { CheckCircle2, Circle, CircleDashed, Clock, Copy, FolderOpen, MessageSquareWarning, SkipForward, type LucideIcon } from "lucide-react";
import type { WorkflowEvent, WorkflowNode } from "@omni/core";
import { statusWords } from "../../lib/phase-status";
import { when, who } from "./PhaseHistory";

/** Status words for gates and tasks; phase statuses use the dashboard's shared words. */
const EXTRA_WORDS: Record<string, string> = {
  not_reached: "not reached",
  waiting: "waiting for your review",
  todo: "to do",
  designed: "designed",
  done: "done",
};
export const nodeStatusWords = (node: WorkflowNode) => EXTRA_WORDS[node.status] ?? statusWords(node.status);

/** Icon and tone per status (status colours only, always with the status in words). */
const STYLE: Record<string, { icon: LucideIcon; tone: string }> = {
  not_started: { icon: Circle, tone: "text-zinc-500" },
  not_reached: { icon: Circle, tone: "text-zinc-500" },
  todo: { icon: Circle, tone: "text-zinc-500" },
  designed: { icon: CircleDashed, tone: "text-sky-300" },
  in_progress: { icon: CircleDashed, tone: "text-sky-300" },
  awaiting_review: { icon: Clock, tone: "text-amber-300" },
  waiting: { icon: Clock, tone: "text-amber-300" },
  changes_requested: { icon: MessageSquareWarning, tone: "text-amber-300" },
  approved: { icon: CheckCircle2, tone: "text-emerald-400" },
  done: { icon: CheckCircle2, tone: "text-emerald-400" },
  skipped: { icon: SkipForward, tone: "text-zinc-400" },
};
export const statusStyle = (status: string) => STYLE[status] ?? STYLE.not_started;

const KIND_WORDS = { phase: "Phase", gate: "Gate", task: "Task" } as const;
/** How a node is named to screen readers and in the list: kind, label, status, next. */
export const nodeName = (node: WorkflowNode) =>
  `${KIND_WORDS[node.kind]} ${node.label}: ${nodeStatusWords(node)}${node.kind === "phase" && node.isNext ? ", next" : ""}`;

const EVENT_WORDS: Record<string, string> = {
  phase_started: "Started",
  phase_submitted: "Handed in",
  changes_requested: "Changes requested",
  phase_approved: "Approved",
  phase_skipped: "Skipped",
  task_created: "Created",
  design_note_submitted: "Design note handed in",
  task_marked_trivial: "Marked as needing no design note",
  task_started: "Started",
  task_completed: "Completed",
  task_reopened: "Reopened",
};

/**
 * What the page lets the person do with a recorded file or commit (VIS-2, P-E8-02): show a file in
 * its folder (the folder is opened by the app's own checked command, never the file itself), copy a
 * commit. Without a provider the references stay text.
 */
export interface RefActions {
  showInFolder?: (path: string) => Promise<void>;
  copy?: (text: string) => Promise<void>;
}
export const RefActionsContext = createContext<RefActions>({});

const action = "ml-1 inline-flex items-center rounded p-0.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 align-middle";

function RefItem({ value, kind }: { value: string; kind: "file" | "commit" }) {
  const { showInFolder, copy } = useContext(RefActionsContext);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const run = async (act: () => Promise<void>) => {
    setProblem(null);
    try {
      await act();
      setDone(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <span className="font-mono text-zinc-300 break-all">{value}</span>
      {kind === "file" && showInFolder && (
        <button type="button" className={action} aria-label={`Show ${value} in its folder`} title="Show in its folder" onClick={() => void run(() => showInFolder(value))}>
          <FolderOpen className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
      {kind === "commit" && copy && (
        <button type="button" className={action} aria-label={`Copy commit ${value}`} title={done ? "Copied" : "Copy"} onClick={() => void run(() => copy(value))}>
          <Copy className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
      {problem && (
        <span role="alert" className="ml-1 text-red-400">
          {problem}
        </span>
      )}
    </>
  );
}

const Refs = ({ items, label, kind }: { items: string[]; label: string; kind: "file" | "commit" }) =>
  items.length === 0 ? null : (
    <p className="mt-0.5">
      {label}: {items.map((x, i) => (
        <span key={x}>
          {i > 0 && ", "}
          <RefItem value={x} kind={kind} />
        </span>
      ))}
    </p>
  );

const Mono = ({ items, label }: { items: string[]; label: string }) =>
  items.length === 0 ? null : (
    <p className="mt-0.5">
      {label}: {items.map((x, i) => (
        <span key={x}>
          {i > 0 && ", "}
          <span className="font-mono text-zinc-300 break-all">{x}</span>
        </span>
      ))}
    </p>
  );

function EventDetail({ event }: { event: WorkflowEvent }) {
  return (
    <li className="text-xs text-zinc-400">
      <p className="text-zinc-200">
        {EVENT_WORDS[event.type] ?? event.type} by {who(event.by)} · {when(event.time)} · <span className="font-mono text-zinc-500">event {event.id}</span>
      </p>
      <Refs label="Produced" items={event.documents ?? []} kind="file" />
      {event.understandingCheck && <Mono label="Understanding check" items={[event.understandingCheck]} />}
      {event.stackAdr && <Mono label="Stack decision record" items={[event.stackAdr]} />}
      {event.skillsUsed && event.skillsUsed.length > 0 && (
        <ul className="mt-0.5 ml-4 list-disc" aria-label="Skills used">
          {event.skillsUsed.map((k) => (
            <li key={k.skill}>
              <span className="text-zinc-300">{k.skill}</span>: {k.evidence}
            </li>
          ))}
        </ul>
      )}
      {event.notes && <p className="mt-0.5 text-amber-300 break-words">Notes: {event.notes}</p>}
      {event.reason && <p className="mt-0.5 break-words">Reason: {event.reason}</p>}
      <Refs label="Files" items={event.files} kind="file" />
      <Refs label="Commits" items={event.commits} kind="commit" />
    </li>
  );
}

/** Everything memory records for one node, oldest first (VIS-2). */
export function NodeEvents({ node }: { node: WorkflowNode }) {
  if (node.events.length === 0) return <p className="text-xs text-zinc-500">Nothing recorded yet.</p>;
  return (
    <ol className="space-y-2" aria-label={`Recorded for ${node.label}`}>
      {node.events.map((e) => (
        <EventDetail key={e.id} event={e} />
      ))}
    </ol>
  );
}
