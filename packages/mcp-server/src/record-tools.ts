/**
 * Record tools (ARCHITECTURE 5; MEM-2, MEM-4, UND-5): decisions, problems and lessons, each
 * pointing at real files or commits. The store validates against the event schema and removes
 * secrets (MEM-6); decisions.md, problems.md, lessons.md and summary.md are refreshed after.
 */
import { refreshMemoryDocs, type Event } from "@omni/core";
import type { ToolResult } from "./phase-tools.js";
import { checkReferences, openProject, type ToolDeps } from "./project.js";

type Actor = Event["actor"];
type Refs = { files?: string[]; commits?: string[] };

export interface Recorded {
  eventId: string;
  type: Event["type"];
  warnings: string[];
}

async function record(
  deps: ToolDeps,
  actor: Actor,
  projectPath: string | undefined,
  entry: { type: Event["type"]; payload: Record<string, unknown>; refs: Refs; refsRequired: boolean; what: string },
): Promise<ToolResult<Recorded>> {
  const files = entry.refs.files ?? [];
  const commits = entry.refs.commits ?? [];
  if (entry.refsRequired && files.length === 0 && commits.length === 0) {
    return { ok: false, message: `A ${entry.what} must point to at least one file or commit it concerns (refs.files / refs.commits).` };
  }
  const opened = await openProject(deps, projectPath);
  if (!opened.ok) return opened;
  const checked = await checkReferences(deps, opened.root, { files, commits }, `recording this ${entry.what}`);
  if (!checked.ok) return checked;

  const refs = { ...(files.length ? { files } : {}), ...(commits.length ? { commits } : {}) };
  const result = await opened.store.appendEvent({
    type: entry.type,
    actor,
    payload: entry.payload,
    ...(files.length || commits.length ? { refs } : {}),
  });
  if (!result.ok) {
    return { ok: false, message: result.issues.map((i) => (i.path ? `${i.path} ${i.message}` : i.message)).join("; ") };
  }
  const warnings = [...checked.warnings];
  try {
    await refreshMemoryDocs(opened.store);
  } catch (error) {
    warnings.push(`recorded, but the memory documents could not be refreshed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: true, value: { eventId: result.event.id, type: entry.type, warnings } };
}

export async function recordDecision(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; title: string; decision: string; reason: string; alternatives?: string[]; refs: Refs },
): Promise<ToolResult<Recorded>> {
  const { projectPath, refs, ...payload } = input;
  return record(deps, actor, projectPath, { type: "decision_recorded", payload, refs, refsRequired: true, what: "decision" });
}

export async function recordProblem(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; title: string; details: string; status: "open" | "resolved" | "wont_fix"; refs: Refs },
): Promise<ToolResult<Recorded & { status: string }>> {
  const { projectPath, refs, ...payload } = input;
  const result = await record(deps, actor, projectPath, { type: "problem_recorded", payload, refs, refsRequired: true, what: "problem" });
  return result.ok ? { ok: true, value: { ...result.value, status: input.status } } : result;
}

/** UND-5: a correction the user made to how the request was understood; served to every tool. */
export async function recordLesson(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; lesson: string; context?: string; refs?: Refs },
): Promise<ToolResult<Recorded>> {
  const { projectPath, refs, ...payload } = input;
  return record(deps, actor, projectPath, { type: "lesson_recorded", payload, refs: refs ?? {}, refsRequired: false, what: "lesson" });
}
