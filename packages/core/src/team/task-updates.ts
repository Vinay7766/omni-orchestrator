/**
 * Task progress from tools without MCP (owner's v0.1 issues B and C, 2026-11-04). Such a tool
 * appends one JSON line per step to .agents/task-updates.jsonl, with the same fields as the MCP
 * tools; the app applies them with the same rules (TaskEngine, PhaseEngine), as that tool, and
 * records any line the rules refuse, or that cannot be read, as a problem with the reason, so
 * nothing a tool reports is silently lost or turned into a status it did not earn.
 */
import type { Event } from "../generated/types.js";
import type { MemoryStore } from "../memory/store.js";
import { PhaseEngine } from "../engine/phases.js";
import { TaskEngine } from "../engine/tasks.js";
import { MEMORY_DIR } from "../constants.js";

export const TASK_UPDATES_FILE = "task-updates.jsonl";

export interface ImportResult {
  /** One short line per update applied, in order. */
  applied: string[];
  refused: { line: string; reason: string }[];
}

type Line = Record<string, unknown>;
type Outcome = { ok: true } | { ok: false; issues: { message: string }[] };

const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function actorOf(line: Line): Event["actor"] {
  const model = text(line.model);
  return { kind: "agent", tool: text(line.tool) ?? "a tool without MCP", ...(model ? { model } : {}) };
}

/** Records the memory files the tool says it updated, before the step that needs it (GATE-3, MEM-3). */
async function memoryUpdate(store: MemoryStore, actor: Event["actor"], line: Line): Promise<Outcome> {
  const files = (line.memoryUpdate as { files?: unknown } | undefined)?.files;
  if (!Array.isArray(files) || files.length === 0) return { ok: true };
  return store.appendEvent({ type: "memory_updated", actor, payload: { files } });
}

async function applyLine(store: MemoryStore, line: Line): Promise<Outcome | { ok: false; reason: string }> {
  const actor = actorOf(line);
  const tasks = new TaskEngine(store);
  const task = text(line.task) ?? "";
  switch (line.action) {
    case "design":
      return tasks.submitDesignNote(actor, line.note);
    case "trivial":
      return tasks.markTrivial(actor, task, text(line.reason, 500) ?? "");
    case "start":
      return tasks.start(actor, task);
    case "complete": {
      const recorded = await memoryUpdate(store, actor, line);
      if (!recorded.ok) return recorded;
      return tasks.complete(actor, {
        taskId: task,
        summary: text(line.summary, 2000) ?? "",
        skillsUsed: (line.skillsUsed as never) ?? [],
        tests: line.tests as never,
        refs: (line.refs as never) ?? {},
      });
    }
    case "submit_phase": {
      const recorded = await memoryUpdate(store, actor, line);
      if (!recorded.ok) return recorded;
      return new PhaseEngine(store).submit(actor, {
        phase: text(line.phase) ?? "",
        documents: (line.documents as string[]) ?? [],
        skillsUsed: (line.skillsUsed as never) ?? [],
      } as never);
    }
    default:
      return { ok: false, reason: `unknown action "${String(line.action)}" (use design, trivial, start, complete or submit_phase)` };
  }
}

function describe(line: Line): string {
  const who = text(line.tool) ?? "a tool";
  return line.action === "submit_phase" ? `${who}: handed in ${text(line.phase) ?? "a phase"}` : `${who}: ${String(line.action)} ${text(line.task) ?? ""}`.trim();
}

/** Applies every update tools have written since the last time, in order; see the module note. */
export async function importTaskUpdates(store: MemoryStore): Promise<ImportResult> {
  const raw = await store.takeFile(TASK_UPDATES_FILE);
  const result: ImportResult = { applied: [], refused: [] };
  if (raw === null) return result;
  for (const lineText of raw.split(/\r?\n/).filter((l) => l.trim())) {
    let line: Line;
    let outcome: Awaited<ReturnType<typeof applyLine>>;
    try {
      line = JSON.parse(lineText) as Line;
      outcome = line && typeof line === "object" ? await applyLine(store, line) : { ok: false, reason: "not a JSON object" };
    } catch (error) {
      line = {};
      outcome = { ok: false, reason: `not valid JSON (${error instanceof Error ? error.message : String(error)})` };
    }
    if (outcome.ok) {
      result.applied.push(describe(line));
      continue;
    }
    const reason = "reason" in outcome ? outcome.reason : outcome.issues.map((i) => i.message).join("; ");
    result.refused.push({ line: lineText.slice(0, 500), reason });
    await store.appendEvent({
      type: "problem_recorded",
      actor: actorOf(line),
      payload: {
        title: `Update not applied${text(line.task) ? ` for ${text(line.task)}` : ""}`,
        details: `${reason}. The line in ${MEMORY_DIR}/${TASK_UPDATES_FILE} was: ${lineText.slice(0, 500)}`,
        status: "open",
      },
      refs: { files: [`${MEMORY_DIR}/${TASK_UPDATES_FILE}`] },
    });
  }
  return result;
}
