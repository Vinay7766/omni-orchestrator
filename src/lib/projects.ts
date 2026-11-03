/**
 * The dashboard's projects list (E2, APP-1): Rust finds project folders (find_projects); each
 * project's memory is read through @omni/core over the memfs commands, the same code the MCP
 * server and the extension use, so the app shows real project data only.
 */
import { buildGateReview, buildPhaseHistory, buildWorkflow, readTeam, createInvokeFs, MemoryStore, normalizePath, projectOverview, type GateReview, type Invoke, type PhaseHistoryEntry, type ProjectOverview, type Workflow } from "@omni/core";

export type ProjectRow = { root: string; ok: true; overview: ProjectOverview } | { root: string; ok: false; error: string };

export interface ProjectsResult {
  projects: ProjectRow[];
  /** Configured folders that could not be searched, with the reason. */
  errors: string[];
}

export async function loadProjects(invoke: Invoke, folders: string[]): Promise<ProjectsResult> {
  if (folders.length === 0) return { projects: [], errors: [] };
  const found = (await invoke("find_projects", { folders })) as { roots: string[]; errors: string[] };
  const fs = createInvokeFs(invoke);
  const projects = await Promise.all(
    found.roots.map(async (root): Promise<ProjectRow> => {
      try {
        const opened = await MemoryStore.open(fs, normalizePath(root));
        if (!opened.ok) return { root, ok: false, error: opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ") };
        return { root, ok: true, overview: await projectOverview(opened.store) };
      } catch (error) {
        return { root, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  return { projects, errors: found.errors };
}

/** One project's phase history for the detail screen (E3, GATE-5). */
export type ProjectDetailResult =
  | { ok: true; name: string; flow: string; mode: "full" | "simple"; history: PhaseHistoryEntry[]; taskCount?: number; workflow?: Workflow; /** The phase waiting for the person, summarised for review (C18). */ review?: GateReview; /** How many tools the person selected (D). */ teamSize?: number }
  | { ok: false; error: string };

export async function loadProjectDetail(invoke: Invoke, root: string): Promise<ProjectDetailResult> {
  try {
    const opened = await MemoryStore.open(createInvokeFs(invoke), normalizePath(root));
    if (!opened.ok) return { ok: false, error: opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ") };
    const project = opened.store.readProject();
    const state = await opened.store.readState();
    const { events } = await opened.store.readEvents();
    const waiting = state.currentPhase && state.phases[state.currentPhase]?.status === "awaiting_review" ? state.currentPhase : null;
    const review = waiting ? buildGateReview(events, waiting) : null;
    const team = await readTeam(opened.store);
    return {
      ok: true,
      name: project.name,
      flow: project.flow,
      mode: project.mode,
      history: buildPhaseHistory(project.flow, state, events),
      taskCount: state.tasks.length,
      workflow: buildWorkflow(project.flow, state, events),
      ...(review ? { review } : {}),
      teamSize: team.ok ? (team.team?.members.length ?? 0) : 0,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
