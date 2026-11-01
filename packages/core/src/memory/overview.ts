import type { Event, Project, State } from "../generated/types.js";
import type { MemoryStore } from "./store.js";

/** One project at a glance (APP-1): what the dashboard's projects list and status displays show. */
export interface ProjectOverview {
  name: string;
  flow: Project["flow"];
  mode: Project["mode"];
  phase: { id: string | null; status: State["phases"][string]["status"] | null };
  tasks: { total: number; done: number; inProgress: string[]; next: string | null };
  /** The latest event; null only for an empty log. */
  lastActivity: { time: string; type: Event["type"]; actor: Event["actor"] } | null;
  /** Lines in events.jsonl that are not valid events (shown, never hidden). */
  issues: number;
}

/** Reads a project's overview from its memory. Read-only. */
export async function projectOverview(store: MemoryStore): Promise<ProjectOverview> {
  const project = store.readProject();
  const state = await store.readState();
  const { events, issues } = await store.readEvents();
  const phase = state.currentPhase;
  const last = events.at(-1);
  return {
    name: project.name,
    flow: project.flow,
    mode: project.mode,
    phase: { id: phase, status: phase === null ? null : (state.phases[phase]?.status ?? null) },
    tasks: {
      total: state.tasks.length,
      done: state.tasks.filter((t) => t.status === "done").length,
      inProgress: state.tasks.filter((t) => t.status === "in_progress").map((t) => t.id),
      next: state.tasks.find((t) => t.status === "todo" || t.status === "designed")?.id ?? null,
    },
    lastActivity: last ? { time: last.time, type: last.type, actor: last.actor } : null,
    issues: issues.length,
  };
}
