import { FLOWS } from "../generated/contract.js";
import type { Event, State } from "../generated/types.js";
import type { MemoryStore } from "./store.js";

type Actor = Event["actor"];

/** One event behind a chart node: who, when, what it produced, and the files and commits it names (VIS-2). */
export interface WorkflowEvent {
  /** The event's id in events.jsonl. */
  id: string;
  type: Event["type"];
  time: string;
  by: Actor;
  /** Files and commits the event refers to (`refs`). */
  files: string[];
  commits: string[];
  /** What was handed in: phase documents, or a task's design note. */
  documents?: string[];
  skillsUsed?: { skill: string; evidence: string }[];
  understandingCheck?: string;
  stackAdr?: string;
  /** Change-request notes. */
  notes?: string;
  /** Skip reason, or why a task needs no design note. */
  reason?: string;
}

/** A gate is the person's review at the end of a phase. */
export type GateStatus = "not_reached" | "waiting" | "approved" | "skipped";

export type WorkflowNode =
  | { id: string; kind: "phase"; label: string; status: State["phases"][string]["status"]; isNext: boolean; events: WorkflowEvent[] }
  | { id: string; kind: "gate"; label: string; phase: string; status: GateStatus; events: WorkflowEvent[] }
  | { id: string; kind: "task"; label: string; status: State["tasks"][number]["status"]; kinds?: string[]; events: WorkflowEvent[] };

export interface Workflow {
  nodes: WorkflowNode[];
  edges: { from: string; to: string }[];
}

const isDone = (status: string | undefined) => status === "approved" || status === "skipped";
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

function detail(event: Event): WorkflowEvent {
  const p = event.payload as Record<string, unknown>;
  const documents = strings(p.documents) ?? (str(p.notePath) ? [p.notePath as string] : undefined);
  const skillsUsed = Array.isArray(p.skillsUsed) ? (p.skillsUsed as { skill: string; evidence: string }[]) : undefined;
  const optional = {
    documents,
    skillsUsed,
    understandingCheck: str(p.understandingCheck),
    stackAdr: str(p.stackAdr),
    notes: str(p.notes),
    reason: str(p.reason),
  };
  return {
    id: event.id,
    type: event.type,
    time: event.time,
    by: event.actor,
    files: event.refs?.files ?? [],
    commits: event.refs?.commits ?? [],
    ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
  };
}

/** The workflow chart (VIS-1): one node per phase, its gate and each task, built only from
 * the snapshot and the event log. Events not tied to a node in this flow add nothing. */
export function buildWorkflow(
  flow: string,
  state: State,
  events: Event[],
  options: { flows?: Readonly<Record<string, readonly string[]>> } = {},
): Workflow {
  const flows: Readonly<Record<string, readonly string[]>> = options.flows ?? FLOWS;
  const order = flows[flow] ?? [];
  const next = order.find((phase) => !isDone(state.phases[phase]?.status)) ?? null;
  const nodes: WorkflowNode[] = [];
  const edges: Workflow["edges"] = [];
  const byId = new Map<string, WorkflowNode>();
  const add = (node: WorkflowNode) => {
    nodes.push(node);
    byId.set(node.id, node);
  };

  order.forEach((phase, i) => {
    const status = state.phases[phase]?.status ?? "not_started";
    const gate: GateStatus = status === "approved" || status === "skipped" ? status : status === "awaiting_review" ? "waiting" : "not_reached";
    add({ id: `phase:${phase}`, kind: "phase", label: phase, status, isNext: phase === next, events: [] });
    add({ id: `gate:${phase}`, kind: "gate", label: `${phase} review`, phase, status: gate, events: [] });
    if (i > 0) edges.push({ from: `gate:${order[i - 1]}`, to: `phase:${phase}` });
    edges.push({ from: `phase:${phase}`, to: `gate:${phase}` });
  });

  for (const task of state.tasks) {
    add({ id: `task:${task.id}`, kind: "task", label: task.title, status: task.status, ...(task.kinds ? { kinds: [...task.kinds] } : {}), events: [] });
    if (order.includes("build")) edges.push({ from: "phase:build", to: `task:${task.id}` });
  }

  for (const event of events) {
    const p = event.payload as Record<string, unknown>;
    let target: string | undefined;
    if (event.type === "phase_approved" || event.type === "phase_skipped") target = `gate:${str(p.phase)}`;
    else if (event.type === "phase_started" || event.type === "phase_submitted" || event.type === "changes_requested") target = `phase:${str(p.phase)}`;
    else if (event.type.startsWith("task_") || event.type === "design_note_submitted") target = `task:${str(p.taskId)}`;
    if (target) byId.get(target)?.events.push(detail(event));
  }
  return { nodes, edges };
}

/** A project's workflow chart, read from its memory. Read-only. */
export async function workflow(store: MemoryStore): Promise<Workflow> {
  const { events } = await store.readEvents();
  return buildWorkflow(store.readProject().flow, await store.readState(), events);
}
