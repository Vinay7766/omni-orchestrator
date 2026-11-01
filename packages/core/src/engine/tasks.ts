import type { Event, State, DesignNote } from "../generated/types.js";
import type { MemoryStore, EventInput } from "../memory/store.js";
import { redactJson } from "../redact.js";
import { validateMemoryFile, type ValidationIssue } from "../validate.js";
import type { CheckResult } from "./phases.js";

type Actor = Event["actor"];
type SkillUse = { skill: string; evidence: string };
type TestEvidence = { command: string; exitCode: number; outputTail: string };
type Refs = { files?: string[]; commits?: string[] };

export type TaskAction =
  | { kind: "create"; taskId: string; title: string; requirements?: string[] }
  | { kind: "design"; taskId: string }
  | { kind: "trivial"; taskId: string; reason: string }
  | { kind: "start"; taskId: string }
  | { kind: "complete"; taskId: string; summary: string; skillsUsed: SkillUse[]; tests: TestEvidence; refs: Refs }
  | { kind: "reopen"; taskId: string; reason: string };

const problem = (message: string): CheckResult => ({ ok: false, issues: [{ path: "", message }] });

/** Where a task's design note lives, relative to the project root. ":" is encoded for Windows. */
export function designNotePath(taskId: string): string {
  return `.agents/design-notes/${taskId.replace(/:/g, "%3A")}.json`;
}

/** Work on tasks only happens while the current phase is open (not under review). */
function phaseOpen(state: State): CheckResult {
  const phase = state.currentPhase;
  const status = phase ? state.phases[phase]?.status : undefined;
  if (!phase || !status) return problem("no phase is in progress; start a phase first");
  if (status === "awaiting_review") {
    return problem(`"${phase}" is under review; wait for the person's decision before working on tasks`);
  }
  if (status !== "in_progress" && status !== "changes_requested") {
    return problem(`"${phase}" is ${status}; start the next phase before working on tasks`);
  }
  return { ok: true };
}

/** Pure rule check for one task action (DSN-1..3, HON-4, MEM-3). Used inside the store's lock. */
export function checkTaskAction(state: State, events: Event[], action: TaskAction): CheckResult {
  const task = state.tasks.find((t) => t.id === action.taskId);

  if (action.kind === "create") {
    const open = phaseOpen(state);
    if (!open.ok) return open;
    return task ? problem(`task "${action.taskId}" already exists`) : { ok: true };
  }
  if (!task) return problem(`no task "${action.taskId}"; create it first`);

  switch (action.kind) {
    case "design":
      return task.status === "todo" || task.status === "designed"
        ? { ok: true }
        : problem(`task "${task.id}" is ${task.status}; reopen it to change its design`);
    case "trivial":
      return task.status === "todo" ? { ok: true } : problem(`task "${task.id}" is ${task.status}; only a new task can be marked trivial`);
    case "start": {
      const open = phaseOpen(state);
      if (!open.ok) return open;
      if (task.status === "todo") {
        return problem(`task ${task.id} has no design note. Call submit_design_note first (or mark it trivial with a reason).`);
      }
      return task.status === "designed" ? { ok: true } : problem(`task "${task.id}" is already ${task.status}`);
    }
    case "complete": {
      if (task.status !== "in_progress") return problem(`task "${task.id}" is ${task.status}, not in progress`);
      const startedAt = findLastIndex(
        events,
        (e) => e.type === "task_started" && (e.payload as { taskId?: string }).taskId === task.id,
      );
      if (!events.slice(startedAt + 1).some((e) => e.type === "memory_updated")) {
        return problem(`update the project memory (a memory_updated event) after working on task "${task.id}", then complete it`);
      }
      if (!(action.refs.files?.length || action.refs.commits?.length)) {
        return problem(`list the files or commits touched by task "${task.id}" (refs.files / refs.commits)`);
      }
      if (action.tests.exitCode !== 0) {
        return problem(
          `tests failed (exit code ${action.tests.exitCode}); task "${task.id}" stays in progress. Fix the failures, or reopen the task if the approach was wrong.`,
        );
      }
      return { ok: true };
    }
    case "reopen":
      return task.status === "todo" ? problem(`task "${task.id}" is already todo`) : { ok: true };
  }
}

function findLastIndex<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return i;
  return -1;
}

function toEventInput(action: TaskAction, actor: Actor): EventInput {
  switch (action.kind) {
    case "create":
      return {
        type: "task_created",
        actor,
        payload: { taskId: action.taskId, title: action.title, ...(action.requirements ? { requirements: action.requirements } : {}) },
      };
    case "design":
      return { type: "design_note_submitted", actor, payload: { taskId: action.taskId, notePath: designNotePath(action.taskId) } };
    case "trivial":
      return { type: "task_marked_trivial", actor, payload: { taskId: action.taskId, reason: action.reason } };
    case "start":
      return { type: "task_started", actor, payload: { taskId: action.taskId } };
    case "complete":
      return {
        type: "task_completed",
        actor,
        payload: { taskId: action.taskId, summary: action.summary, skillsUsed: action.skillsUsed, tests: action.tests },
        refs: action.refs,
      };
    case "reopen":
      return { type: "task_reopened", actor, payload: { taskId: action.taskId, reason: action.reason } };
  }
}

export type TaskResult = { ok: true; event: Event } | { ok: false; issues: ValidationIssue[] };

/** Applies task actions to a project's memory, enforcing the rules atomically. */
export class TaskEngine {
  constructor(private readonly store: MemoryStore) {}

  create(actor: Actor, task: { taskId: string; title: string; requirements?: string[] }): Promise<TaskResult> {
    return this.act(actor, { kind: "create", ...task });
  }

  /** Validates the design note, then saves it and records it in one atomic step. */
  async submitDesignNote(actor: Actor, note: unknown): Promise<TaskResult> {
    const clean = redactJson(note).value;
    const valid = validateMemoryFile("design-note", clean);
    if (!valid.ok) return valid;
    const value: DesignNote = valid.value;
    const name = designNotePath(value.taskId).slice(".agents/".length);
    return this.act(actor, { kind: "design", taskId: value.taskId }, () =>
      this.store.writeFile(name, JSON.stringify(value, null, 2) + "\n"),
    );
  }

  markTrivial(actor: Actor, taskId: string, reason: string): Promise<TaskResult> {
    return this.act(actor, { kind: "trivial", taskId, reason });
  }

  start(actor: Actor, taskId: string): Promise<TaskResult> {
    return this.act(actor, { kind: "start", taskId });
  }

  complete(
    actor: Actor,
    completion: { taskId: string; summary: string; skillsUsed: SkillUse[]; tests: TestEvidence; refs: Refs },
  ): Promise<TaskResult> {
    return this.act(actor, { kind: "complete", ...completion });
  }

  reopen(actor: Actor, taskId: string, reason: string): Promise<TaskResult> {
    return this.act(actor, { kind: "reopen", taskId, reason });
  }

  private async act(actor: Actor, action: TaskAction, effect?: () => Promise<void>): Promise<TaskResult> {
    // Early check for a clear message, then the same check inside the lock (atomic).
    const early = checkTaskAction(await this.store.readState(), (await this.store.readEvents()).events, action);
    if (!early.ok) return early;
    return this.store.appendEvent(
      toEventInput(action, actor),
      (state, events) => {
        const atomic = checkTaskAction(state, events, action);
        return atomic.ok ? [] : atomic.issues;
      },
      effect,
    );
  }
}
