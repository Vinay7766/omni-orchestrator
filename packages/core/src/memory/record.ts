/**
 * Decisions, problems and lessons (MEM-2, MEM-4, UND-5), each pointing at real files or commits.
 * Shared by the MCP server's record tools and the desktop app. The store validates against the
 * event schema and removes secrets (MEM-6); decisions.md, problems.md, lessons.md and summary.md
 * are refreshed after.
 */
import type { Event } from "../generated/types.js";
import type { MemoryFs } from "./fs.js";
import type { MemoryStore } from "./store.js";
import { checkRefs, type CommitChecker } from "./refs.js";
import { refreshMemoryDocs } from "./docs.js";

type Actor = Event["actor"];
export type Refs = { files?: string[]; commits?: string[] };

/** Where to record: the project's store, the file system it lives on, and its root folder. */
export interface RecordTarget {
  store: MemoryStore;
  fs: MemoryFs;
  root: string;
  /** Checks that referenced commits exist. Without one, commits are recorded as unverified. */
  commits?: CommitChecker;
}

export type ReferenceCheck = { ok: true; warnings: string[] } | { ok: false; message: string };
export type RecordResult = { ok: true; eventId: string; type: Event["type"]; warnings: string[] } | { ok: false; message: string };

/** Missing, outside-project or invalid references refuse; ones that can't be checked warn. */
export async function verifyReferences(fs: MemoryFs, root: string, refs: Refs, what: string, commits?: CommitChecker): Promise<ReferenceCheck> {
  const result = await checkRefs(fs, root, { files: refs.files ?? [], commits: refs.commits ?? [] }, commits);
  const bad = result.results.filter((r) => r.status !== "ok" && r.status !== "unverified");
  if (bad.length > 0) {
    return {
      ok: false,
      message: `Fix these references before ${what}: ${bad.map((r) => `${r.ref}: ${r.status}${r.message ? ` (${r.message})` : ""}`).join("; ")}.`,
    };
  }
  const warnings = result.results
    .filter((r) => r.status === "unverified")
    .map((r) => `${r.ref} could not be verified${r.message ? `: ${r.message}` : ""}`);
  if (result.repository?.message) warnings.push(result.repository.message);
  return { ok: true, warnings };
}

async function record(
  target: RecordTarget,
  actor: Actor,
  entry: { type: Event["type"]; payload: Record<string, unknown>; refs: Refs; refsRequired: boolean; what: string },
): Promise<RecordResult> {
  const files = entry.refs.files ?? [];
  const commits = entry.refs.commits ?? [];
  if (entry.refsRequired && files.length === 0 && commits.length === 0) {
    return { ok: false, message: `A ${entry.what} must point to at least one file or commit it concerns (refs.files / refs.commits).` };
  }
  const checked = await verifyReferences(target.fs, target.root, { files, commits }, `recording this ${entry.what}`, target.commits);
  if (!checked.ok) return checked;

  const refs = { ...(files.length ? { files } : {}), ...(commits.length ? { commits } : {}) };
  const result = await target.store.appendEvent({
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
    await refreshMemoryDocs(target.store);
  } catch (error) {
    warnings.push(`recorded, but the memory documents could not be refreshed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: true, eventId: result.event.id, type: entry.type, warnings };
}

export function recordDecision(
  target: RecordTarget,
  actor: Actor,
  input: { title: string; decision: string; reason: string; alternatives?: string[]; refs: Refs },
): Promise<RecordResult> {
  const { refs, ...payload } = input;
  return record(target, actor, { type: "decision_recorded", payload, refs, refsRequired: true, what: "decision" });
}

export function recordProblem(
  target: RecordTarget,
  actor: Actor,
  input: { title: string; details: string; status: "open" | "resolved" | "wont_fix"; refs: Refs },
): Promise<RecordResult> {
  const { refs, ...payload } = input;
  return record(target, actor, { type: "problem_recorded", payload, refs, refsRequired: true, what: "problem" });
}

/** UND-5: a correction to how the request was understood; served to every tool. */
export function recordLesson(target: RecordTarget, actor: Actor, input: { lesson: string; context?: string; refs?: Refs }): Promise<RecordResult> {
  const { refs, ...payload } = input;
  return record(target, actor, { type: "lesson_recorded", payload, refs: refs ?? {}, refsRequired: false, what: "lesson" });
}
