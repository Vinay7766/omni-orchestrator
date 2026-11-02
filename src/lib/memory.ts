/**
 * Project memory in the desktop app (E3 slice 4a, APP-2, MEM-5): every memory file shown
 * read-only, and the person's own decisions, problems and lessons recorded through @omni/core's
 * recorder (the same rules as the MCP tools). The generated files are never hand-edited: they are
 * rebuilt from the event log, so an entry added here appears in them.
 */
import {
  createInvokeFs,
  MemoryStore,
  normalizePath,
  recordDecision,
  recordLesson,
  recordProblem,
  type Invoke,
  type RecordResult,
  type RecordTarget,
} from "@omni/core";
import { DESKTOP_PERSON, type DecisionResult } from "./decisions";

/** The memory files the dashboard shows, in this order. */
export const MEMORY_FILES = ["summary.md", "decisions.md", "problems.md", "lessons.md", "project.json", "state.json"] as const;

export type MemoryFile = { name: (typeof MEMORY_FILES)[number]; content: string | null };
export type MemoryFilesResult = { ok: true; files: MemoryFile[] } | { ok: false; error: string };

export type NewEntry =
  | { kind: "decision"; title: string; decision: string; reason: string; files: string[]; commits: string[] }
  | { kind: "problem"; title: string; details: string; status: "open" | "resolved" | "wont_fix"; files: string[]; commits: string[] }
  | { kind: "lesson"; lesson: string; context?: string };

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function open(invoke: Invoke, root: string): Promise<RecordTarget> {
  const fs = createInvokeFs(invoke);
  const projectRoot = normalizePath(root);
  const opened = await MemoryStore.open(fs, projectRoot);
  if (!opened.ok) throw new Error(opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; "));
  // No commit checker in the app: commits are recorded as unverified, with a warning.
  return { store: opened.store, fs, root: projectRoot };
}

export async function loadMemoryFiles(invoke: Invoke, root: string): Promise<MemoryFilesResult> {
  try {
    const { store } = await open(invoke, root);
    const files = await Promise.all(MEMORY_FILES.map(async (name) => ({ name, content: await store.readFile(name) })));
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

const refs = (files: string[], commits: string[]) => ({ ...(files.length ? { files } : {}), ...(commits.length ? { commits } : {}) });

/** Records the person's entry; the message carries any warning (for example, an unchecked commit). */
export async function addEntry(invoke: Invoke, root: string, entry: NewEntry): Promise<DecisionResult> {
  try {
    const target = await open(invoke, root);
    let result: RecordResult;
    if (entry.kind === "decision") {
      result = await recordDecision(target, DESKTOP_PERSON, { title: entry.title, decision: entry.decision, reason: entry.reason, refs: refs(entry.files, entry.commits) });
    } else if (entry.kind === "problem") {
      result = await recordProblem(target, DESKTOP_PERSON, { title: entry.title, details: entry.details, status: entry.status, refs: refs(entry.files, entry.commits) });
    } else {
      result = await recordLesson(target, DESKTOP_PERSON, { lesson: entry.lesson, ...(entry.context ? { context: entry.context } : {}) });
    }
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: ["Recorded.", ...result.warnings].join(" ") };
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
}
