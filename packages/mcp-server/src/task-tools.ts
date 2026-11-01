/** Task tools (ARCHITECTURE 5; DSN-1..3, HON-4, MEM-3, SKL-4, SKL-8). Rules live in @omni/core. */
import { checkTaskAction, designNotePath, TaskEngine, type Event } from "@omni/core";
import type { ToolResult } from "./phase-tools.js";
import { openProject, type ToolDeps } from "./project.js";

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
