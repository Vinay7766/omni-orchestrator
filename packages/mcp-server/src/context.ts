/**
 * get_context (ARCHITECTURE 5; MEM-2, SKL-2): everything an AI tool needs to continue a
 * project, in one read. All rules live in @omni/core; this only gathers and shapes.
 */
import { renderSummary, type Event, type State } from "@omni/core";
import { currentSkills, openProject, type ToolDeps } from "./project.js";

export type ContextDeps = ToolDeps;

type Task = State["tasks"][number];

export interface ProjectContext {
  project: { id: string; name: string; flow: string; mode: string; root: string; linkedFrom?: string };
  phase: { id: string | null; status: string | null };
  tasks: { inProgress: Task[]; next: Task | null; done: number; total: number };
  summary: string;
  recentDecisions: { title: string; decision: string; reason: string; time: string }[];
  lessons: string[];
  skills: { id: string; name: string; description: string; reason: "phase" | "all-phases" }[];
  warnings: string[];
}

export type ContextResult = { ok: true; context: ProjectContext } | { ok: false; message: string };

const RECENT_DECISIONS = 5;

const payload = (e: Event) => e.payload as Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");

export async function buildContext(deps: ContextDeps, input: { projectPath?: string }): Promise<ContextResult> {
  const opened = await openProject(deps, input.projectPath);
  if (!opened.ok) return opened;
  const { store } = opened;

  const project = store.readProject();
  const state = await store.readState();
  const { events, issues } = await store.readEvents();
  const warnings: string[] = issues.map((i) => `events.jsonl line ${i.line}: ${i.message}`);

  const phaseId = state.currentPhase;
  const skills =
    phaseId === null
      ? []
      : (await currentSkills(deps.skills, store, phaseId, warnings)).map(({ id, name, description, reason }) => ({ id, name, description, reason }));
  if (phaseId === null) warnings.push("No phase has started yet; skills are served once a phase starts.");

  const decisions = events.filter((e) => e.type === "decision_recorded").slice(-RECENT_DECISIONS).reverse();
  return {
    ok: true,
    context: {
      project: {
        id: project.id,
        name: project.name,
        flow: project.flow,
        mode: project.mode,
        root: opened.root,
        ...(opened.linkedFrom ? { linkedFrom: opened.linkedFrom } : {}),
      },
      phase: { id: phaseId, status: phaseId === null ? null : (state.phases[phaseId]?.status ?? null) },
      tasks: {
        inProgress: state.tasks.filter((t) => t.status === "in_progress"),
        next: state.tasks.find((t) => t.status === "todo" || t.status === "designed") ?? null,
        done: state.tasks.filter((t) => t.status === "done").length,
        total: state.tasks.length,
      },
      summary: (await store.readFile("summary.md")) ?? renderSummary(project, state, events),
      recentDecisions: decisions.map((e) => ({
        title: text(payload(e).title),
        decision: text(payload(e).decision),
        reason: text(payload(e).reason),
        time: e.time,
      })),
      lessons: events.filter((e) => e.type === "lesson_recorded").map((e) => text(payload(e).lesson)),
      skills,
      warnings,
    },
  };
}
