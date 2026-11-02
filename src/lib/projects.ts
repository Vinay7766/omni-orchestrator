/**
 * The dashboard's projects list (E2, APP-1): Rust finds project folders (find_projects); each
 * project's memory is read through @omni/core over the memfs commands, the same code the MCP
 * server and the extension use, so the app shows real project data only.
 */
import { createInvokeFs, MemoryStore, normalizePath, phaseHistory, projectOverview, type Invoke, type PhaseHistoryEntry, type ProjectOverview } from "@omni/core";

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
  | { ok: true; name: string; flow: string; mode: "full" | "simple"; history: PhaseHistoryEntry[] }
  | { ok: false; error: string };

export async function loadProjectDetail(invoke: Invoke, root: string): Promise<ProjectDetailResult> {
  try {
    const opened = await MemoryStore.open(createInvokeFs(invoke), normalizePath(root));
    if (!opened.ok) return { ok: false, error: opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ") };
    const project = opened.store.readProject();
    return { ok: true, name: project.name, flow: project.flow, mode: project.mode, history: await phaseHistory(opened.store) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
