/**
 * Record tools (ARCHITECTURE 5; MEM-2, MEM-4, UND-5): decisions, problems and lessons, each
 * pointing at real files or commits. The store validates against the event schema and removes
 * secrets (MEM-6); decisions.md, problems.md, lessons.md and summary.md are refreshed after.
 */
import {
  recordDecision as coreRecordDecision,
  recordLesson as coreRecordLesson,
  recordProblem as coreRecordProblem,
  type Event,
  type RecordResult,
  type RecordTarget,
} from "@omni/core";
import type { ToolResult } from "./phase-tools.js";
import { openProject, type ToolDeps } from "./project.js";

type Actor = Event["actor"];
type Refs = { files?: string[]; commits?: string[] };

export interface Recorded {
  eventId: string;
  type: Event["type"];
  warnings: string[];
}

/** Opens the project, then records through core (the same code the desktop app uses). */
async function record(
  deps: ToolDeps,
  projectPath: string | undefined,
  write: (target: RecordTarget) => Promise<RecordResult>,
): Promise<ToolResult<Recorded>> {
  const opened = await openProject(deps, projectPath);
  if (!opened.ok) return opened;
  const result = await write({ store: opened.store, fs: deps.fs, root: opened.root, commits: deps.commits });
  return result.ok ? { ok: true, value: { eventId: result.eventId, type: result.type, warnings: result.warnings } } : result;
}

export async function recordDecision(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; title: string; decision: string; reason: string; alternatives?: string[]; refs: Refs },
): Promise<ToolResult<Recorded>> {
  const { projectPath, ...entry } = input;
  return record(deps, projectPath, (target) => coreRecordDecision(target, actor, entry));
}

export async function recordProblem(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; title: string; details: string; status: "open" | "resolved" | "wont_fix"; refs: Refs },
): Promise<ToolResult<Recorded & { status: string }>> {
  const { projectPath, ...entry } = input;
  const result = await record(deps, projectPath, (target) => coreRecordProblem(target, actor, entry));
  return result.ok ? { ok: true, value: { ...result.value, status: input.status } } : result;
}

/** UND-5: a correction the user made to how the request was understood; served to every tool. */
export async function recordLesson(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; lesson: string; context?: string; refs?: Refs },
): Promise<ToolResult<Recorded>> {
  const { projectPath, ...entry } = input;
  return record(deps, projectPath, (target) => coreRecordLesson(target, actor, entry));
}
