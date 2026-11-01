/** Task tools (ARCHITECTURE 5; DSN-1..3, HON-4, MEM-3, SKL-4, SKL-8). Rules live in @omni/core. */
import { checkRefs, checkTaskAction, designNotePath, TaskEngine, type Event } from "@omni/core";
import type { ToolResult } from "./phase-tools.js";
import { currentSkills, openProject, type ToolDeps } from "./project.js";

type Actor = Event["actor"];
const messages = (issues: { path: string; message: string }[]) =>
  issues.map((i) => (i.path ? `${i.path} ${i.message}` : i.message)).join("; ");

/** Same rules as the schemas' id and task title, checked up front so a batch is all or nothing. */
const TASK_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export interface NewTask {
  taskId: string;
  title: string;
  requirements?: string[];
}

/** Creates tasks in order. The whole batch is checked first, so a rejected batch creates nothing. */
export async function createTasks(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; tasks: NewTask[] },
): Promise<ToolResult<{ created: string[] }>> {
  const opened = await openProject(deps, input.projectPath);
  if (!opened.ok) return opened;
  const { store } = opened;

  const state = await store.readState();
  const { events } = await store.readEvents();
  const planned = { ...state, tasks: [...state.tasks] };
  for (const task of input.tasks) {
    if (!TASK_ID.test(task.taskId)) {
      return { ok: false, message: `"${task.taskId}" is not a valid task id (letters, digits, . _ : - only; nothing was created)` };
    }
    if (task.title.trim() === "" || task.title.length > 300) {
      return { ok: false, message: `task "${task.taskId}" needs a title of 1 to 300 characters (nothing was created)` };
    }
    const check = checkTaskAction(planned, events, { kind: "create", ...task });
    if (!check.ok) return { ok: false, message: `${messages(check.issues)} (nothing was created)` };
    planned.tasks.push({ id: task.taskId, title: task.title, status: "todo" });
  }

  const engine = new TaskEngine(store);
  const created: string[] = [];
  for (const task of input.tasks) {
    const result = await engine.create(actor, task);
    if (!result.ok) {
      // Only another tool acting at the same moment can get here: report exactly what happened.
      return { ok: false, message: `created ${created.join(", ") || "none"}; stopped at "${task.taskId}": ${messages(result.issues)}` };
    }
    created.push(task.taskId);
  }
  return { ok: true, value: { created } };
}

/** Validates the design note (core's schema, with redaction), saves it and marks the task designed. */
export async function submitDesignNote(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; note: unknown },
): Promise<ToolResult<{ taskId: string; status: "designed"; notePath: string }>> {
  const opened = await openProject(deps, input.projectPath);
  if (!opened.ok) return opened;
  const result = await new TaskEngine(opened.store).submitDesignNote(actor, input.note);
  if (!result.ok) return { ok: false, message: `The design note was not saved: ${messages(result.issues)}` };
  const taskId = (result.event.payload as { taskId: string }).taskId;
  return { ok: true, value: { taskId, status: "designed", notePath: designNotePath(taskId) } };
}

/** Lets a genuinely trivial task start without a design note, with the reason recorded (DSN). */
export async function markTaskTrivial(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; taskId: string; reason: string },
): Promise<ToolResult<{ taskId: string; status: "designed" }>> {
  const opened = await openProject(deps, input.projectPath);
  if (!opened.ok) return opened;
  const result = await new TaskEngine(opened.store).markTrivial(actor, input.taskId, input.reason);
  if (!result.ok) return { ok: false, message: messages(result.issues) };
  return { ok: true, value: { taskId: input.taskId, status: "designed" } };
}

export interface StartedTask {
  taskId: string;
  started: boolean;
  /** The task's declared skills (the current phase's own skills); full text until the task starts. */
  declaredSkills: { id: string; name: string; content?: string }[];
  message: string;
  warnings: string[];
}

/**
 * SKL-4, in two calls: without every declared skill acknowledged, returns their full text and does
 * not start; called again with acknowledgedSkills listing them all, starts the task.
 */
export async function startTask(
  deps: ToolDeps,
  actor: Actor,
  input: { projectPath?: string; taskId: string; acknowledgedSkills?: string[] },
): Promise<ToolResult<StartedTask>> {
  const opened = await openProject(deps, input.projectPath);
  if (!opened.ok) return opened;
  const { store } = opened;
  const state = await store.readState();
  const { events } = await store.readEvents();
  const warnings: string[] = [];
  const declared = state.currentPhase
    ? (await currentSkills(deps.skills, store, state.currentPhase, warnings)).filter((s) => s.reason === "phase")
    : [];
  const ids = declared.map((s) => s.id);

  // Any reason other than missing acknowledgements is a real error, not a reading list.
  const startable = checkTaskAction(state, events, { kind: "start", taskId: input.taskId, declaredSkills: ids, acknowledgedSkills: ids });
  if (!startable.ok) return { ok: false, message: messages(startable.issues) };

  const acknowledged = new Set(input.acknowledgedSkills ?? []);
  const missing = ids.filter((id) => !acknowledged.has(id));
  if (missing.length > 0) {
    const skills: StartedTask["declaredSkills"] = [];
    for (const s of declared) {
      const content = await deps.skills.readContent(s.id);
      if (content === null) warnings.push(`The text of skill "${s.id}" could not be read; acknowledge it after reading its description.`);
      skills.push({ id: s.id, name: s.name, content: content ?? s.description });
    }
    return {
      ok: true,
      value: {
        taskId: input.taskId,
        started: false,
        declaredSkills: skills,
        message:
          `Task "${input.taskId}" has not started. Read and follow these skills, then call start_task again with ` +
          `acknowledgedSkills: [${ids.map((id) => `"${id}"`).join(", ")}]. Not yet acknowledged: ${missing.join(", ")}.`,
        warnings,
      },
    };
  }

  const result = await new TaskEngine(store).start(actor, input.taskId, { declared: ids, acknowledged: [...acknowledged] });
  if (!result.ok) return { ok: false, message: messages(result.issues) };
  return {
    ok: true,
    value: {
      taskId: input.taskId,
      started: true,
      declaredSkills: declared.map((s) => ({ id: s.id, name: s.name })),
      message: `Task "${input.taskId}" started. Completing it needs evidence for each declared skill.`,
      warnings,
    },
  };
}

export interface CompleteInput {
  projectPath?: string;
  taskId: string;
  summary: string;
  skillsUsed: { skill: string; evidence: string }[];
  /** As run by the agent; recorded as agent-reported (the server does not re-run tests in v0.1). */
  tests: { command: string; exitCode: number; outputTail: string };
  refs: { files?: string[]; commits?: string[] };
  memoryUpdate?: { files: string[] };
}

export interface CompletedTask {
  taskId: string;
  status: "done";
  eventId: string;
  testsNote: string;
  warnings: string[];
}

/**
 * Completes a task. Files and commits are checked (checkRefs), then core's rules with the would-be
 * memory update; only then is anything written, so a rejected completion writes nothing.
 */
export async function completeTask(deps: ToolDeps, actor: Actor, input: CompleteInput): Promise<ToolResult<CompletedTask>> {
  const opened = await openProject(deps, input.projectPath);
  if (!opened.ok) return opened;
  const { store, root } = opened;

  const files = [...new Set([...(input.refs.files ?? []), ...(input.memoryUpdate?.files ?? [])])];
  const refs = await checkRefs(deps.fs, root, { files, commits: input.refs.commits ?? [] }, deps.commits);
  const bad = refs.results.filter((r) => r.status !== "ok" && r.status !== "unverified");
  if (bad.length > 0) {
    return {
      ok: false,
      message: `Fix these references before completing: ${bad.map((r) => `${r.ref}: ${r.status}${r.message ? ` (${r.message})` : ""}`).join("; ")}.`,
    };
  }
  const warnings = refs.results
    .filter((r) => r.status === "unverified")
    .map((r) => `${r.ref} could not be verified${r.message ? `: ${r.message}` : ""}`);
  if (refs.repository?.message) warnings.push(refs.repository.message);

  const completion = { taskId: input.taskId, summary: input.summary, skillsUsed: input.skillsUsed, tests: input.tests, refs: input.refs };
  const state = await store.readState();
  const { events } = await store.readEvents();
  const wouldBe = input.memoryUpdate
    ? [...events, { type: "memory_updated", actor, payload: { files: input.memoryUpdate.files } } as unknown as Event]
    : events;
  const rules = checkTaskAction(state, wouldBe, { kind: "complete", ...completion });
  if (!rules.ok) return { ok: false, message: messages(rules.issues) };

  if (input.memoryUpdate) {
    const recorded = await store.appendEvent({ type: "memory_updated", actor, payload: { files: input.memoryUpdate.files } });
    if (!recorded.ok) return { ok: false, message: messages(recorded.issues) };
  }
  const result = await new TaskEngine(store).complete(actor, completion);
  if (!result.ok) return { ok: false, message: messages(result.issues) };
  if (result.warning) warnings.push(result.warning);
  return {
    ok: true,
    value: {
      taskId: input.taskId,
      status: "done",
      eventId: result.event.id,
      testsNote: `Test result recorded as reported by ${actor.tool}; the server did not re-run the tests.`,
      warnings,
    },
  };
}
