/**
 * The task list (E5 slice 5, owner decision 2026-11-02): after the architecture is approved, the
 * AI set up in the app (the person's own model) writes the task list, each task tagged with the
 * kinds of work it involves so team mode can later give it to the tool that fits best. The
 * proposal is saved to docs/planning/tasks.md, readable text plus the exact list as JSON, so what
 * the person approves is exactly what they saw. The person approves it (each task is created,
 * and their approval is recorded as a decision) or asks for changes (the AI rewrites it). The
 * person never edits the list by hand, and the app never makes one up.
 */
import { createInvokeFs, MemoryStore, normalizePath, recordDecision, TaskEngine, type Invoke } from "@omni/core";
import type { BYOKConfig, Skill } from "./types";
import { DESKTOP_PERSON } from "./decisions";
import { phaseSkills, PLANNING_AGENT_TOOL, readDoc } from "./phase-runner";

export interface ProposedTask {
  taskId: string;
  title: string;
  requirements?: string[];
  kinds: string[];
}

type Failure = { ok: false; error: string };
export type ProposalResult = { ok: true; tasks: ProposedTask[] } | Failure;

const MAX_TASKS = 60;
const TAG = /^[a-z][a-z0-9-]*$/;
const PROPOSAL_FILE = "tasks.md";
const PROPOSAL_PATH = `docs/planning/${PROPOSAL_FILE}`;

const reason = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : String(error));
const fail = (error: string): Failure => ({ ok: false, error });
const invalid = (what: string) =>
  fail(`The model's task list could not be used: ${what}. Ask for the list again, or choose a stronger model in Settings.`);

/** The last ```json block in `text`, parsed. */
function lastJsonBlock(text: string): unknown {
  const blocks = [...text.matchAll(/```json[ \t]*\r?\n([\s\S]*?)```/g)];
  if (blocks.length === 0) return undefined;
  return JSON.parse(blocks[blocks.length - 1][1]);
}

/** Checks the list item by item; numbers the tasks T-1, T-2, ... in the model's order. */
function checkTasks(raw: unknown): ProposalResult {
  const list = (raw as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(list) || list.length === 0) return invalid("it has no tasks");
  if (list.length > MAX_TASKS) return invalid(`it has ${list.length} tasks; the limit is ${MAX_TASKS}`);
  const tasks: ProposedTask[] = [];
  for (const [index, item] of list.entries()) {
    const n = index + 1;
    const { title, requirements, kinds } = (item ?? {}) as { title?: unknown; requirements?: unknown; kinds?: unknown };
    if (typeof title !== "string" || !title.trim() || title.trim().length > 300) return invalid(`task ${n} has no title (or one over 300 characters)`);
    if (!Array.isArray(kinds) || kinds.length === 0 || kinds.length > 8) return invalid(`task ${n} needs 1 to 8 kinds of work`);
    const tags = [...new Set(kinds.map((k) => (typeof k === "string" ? k.trim().toLowerCase() : "")))];
    const bad = tags.find((k) => !TAG.test(k) || k.length > 40);
    if (bad !== undefined) return invalid(`task ${n} has a kind that is not a short tag ("${bad}"); use lowercase words joined by '-'`);
    const reqs = Array.isArray(requirements) ? requirements.filter((r): r is string => typeof r === "string" && r.trim() !== "").map((r) => r.trim()) : [];
    tasks.push({ taskId: `T-${n}`, title: title.trim(), ...(reqs.length ? { requirements: reqs } : {}), kinds: tags });
  }
  return { ok: true, tasks };
}

export function parseTaskProposal(text: string): ProposalResult {
  try {
    const raw = lastJsonBlock(text);
    return raw === undefined ? invalid("it has no ```json block") : checkTasks(raw);
  } catch {
    return invalid("its ```json block is not valid JSON");
  }
}

function proposalMarkdown(model: string, tasks: ProposedTask[]): string {
  const lines = tasks.map(
    (t, i) => `${i + 1}. **${t.taskId}** ${t.title}${t.requirements ? `. Requirements: ${t.requirements.join(", ")}` : ""}. Kinds: ${t.kinds.join(", ")}.`,
  );
  return [
    `# Task list (proposed by ${model})`,
    "",
    "Proposed for the person's review in the desktop app: approving it creates these tasks; requesting changes has the model rewrite it.",
    "",
    ...lines,
    "",
    "The exact list under review (the app creates the tasks from this block):",
    "",
    "```json",
    JSON.stringify({ model, tasks }, null, 2),
    "```",
    "",
  ].join("\n");
}

/** The proposal saved in docs/planning/tasks.md, checked again (the file could have been edited). */
export async function readTaskProposal(invoke: Invoke, root: string): Promise<({ ok: true; model: string } & { tasks: ProposedTask[] }) | Failure> {
  try {
    const text = await readDoc(invoke, normalizePath(root), PROPOSAL_FILE);
    if (text === null) return fail("No task list has been proposed yet.");
    const raw = lastJsonBlock(text) as { model?: unknown } | undefined;
    const checked = raw === undefined ? invalid("docs/planning/tasks.md has no ```json block") : checkTasks(raw);
    if (!checked.ok) return checked;
    return { ok: true, model: typeof raw?.model === "string" && raw.model ? raw.model.slice(0, 200) : "unknown model", tasks: checked.tasks };
  } catch (error) {
    return fail(`docs/planning/tasks.md could not be read: ${reason(error)}`);
  }
}

async function openReady(invoke: Invoke, root: string) {
  const opened = await MemoryStore.open(createInvokeFs(invoke), root);
  if (!opened.ok) return fail(opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; "));
  const state = await opened.store.readState();
  if (state.phases.architecture?.status !== "approved") return fail("The architecture must be approved before the task list is written.");
  if (state.tasks.length > 0) return fail(`This project already has ${state.tasks.length} tasks; the task list is only proposed once.`);
  return { ok: true as const, store: opened.store };
}

export async function proposeTasks(
  invoke: Invoke,
  rootIn: string,
  options: { byok: BYOKConfig; skills: Skill[]; notes?: string },
): Promise<{ ok: true; tasks: ProposedTask[]; model: string } | Failure> {
  const root = normalizePath(rootIn);
  try {
    const ready = await openReady(invoke, root);
    if (!ready.ok) return ready;
    const skills = await phaseSkills(ready.store, options.skills, "architecture");
    const docs: string[] = [];
    for (const name of ["prd.md", "architecture.md", "architecture-stack-adr.md"]) {
      const text = await readDoc(invoke, root, name);
      if (text) docs.push(`### docs/planning/${name}\n\n${text}`);
    }
    const previous = options.notes ? await readDoc(invoke, root, PROPOSAL_FILE) : null;
    const prompt = [
      `You are the planning agent for the project "${ready.store.readProject().name}". Its PRD and architecture are approved. Break the build into tasks.`,
      [
        "## Rules",
        "",
        "- Each task is small enough to build and review in one sitting, and has a clear result.",
        "- Order the tasks so each one only depends on tasks before it.",
        "- Give each task the PRD requirement ids it serves (for example REQ-3), when there are any.",
        '- Give each task 1 to 4 "kinds": short lowercase tags for the kinds of work it involves, for example interface, backend, data, tests, security, documentation, infrastructure. Use the words that fit; there is no fixed list.',
        '- Answer with a short note, then exactly one ```json block holding {"tasks": [{"title": "...", "requirements": ["REQ-1"], "kinds": ["backend", "tests"]}]}.',
      ].join("\n"),
      `## Approved documents\n\n${docs.join("\n\n") || "(None found in docs/planning.)"}`,
      ...(skills.length ? [`## Skills for breaking down the work\n\n${skills.map((s) => `### ${s.id}: ${s.name}\n\n${s.content}`).join("\n\n")}`] : []),
      ...(options.notes ? [`## Changes the person asked for\n\n${options.notes}`, ...(previous ? [`## The list they reviewed\n\n${previous}`] : [])] : []),
    ].join("\n\n");

    const reply = (await invoke("byok_complete", { request: { prompt, byok: options.byok } })) as { text: string; model: string };
    const parsed = parseTaskProposal(reply.text);
    if (!parsed.ok) return parsed;
    await invoke("write_planning_document", { root, name: PROPOSAL_FILE, content: proposalMarkdown(reply.model, parsed.tasks) });
    return { ok: true, tasks: parsed.tasks, model: reply.model };
  } catch (error) {
    return fail(reason(error));
  }
}

/** The person approves the proposed list: each task is created, then the approval is recorded. */
export async function approveTaskList(invoke: Invoke, rootIn: string): Promise<{ ok: true; message: string } | Failure> {
  const root = normalizePath(rootIn);
  try {
    const ready = await openReady(invoke, root);
    if (!ready.ok) return ready;
    const proposal = await readTaskProposal(invoke, root);
    if (!proposal.ok) return proposal;
    const writer = { kind: "agent" as const, tool: PLANNING_AGENT_TOOL, model: proposal.model };
    const engine = new TaskEngine(ready.store);
    const created: string[] = [];
    for (const task of proposal.tasks) {
      const r = await engine.create(writer, task);
      if (!r.ok) {
        const done = created.length ? `Created ${created.join(", ")}; ` : "";
        return fail(`${done}${task.taskId} could not be created: ${r.issues.map((i) => i.message).join("; ")}`);
      }
      created.push(task.taskId);
    }
    const first = created[0];
    const last = created[created.length - 1];
    const recorded = await recordDecision({ store: ready.store, fs: createInvokeFs(invoke), root }, DESKTOP_PERSON, {
      title: "Task list approved",
      decision: `Approved ${created.length} tasks (${first} to ${last}) as proposed by ${proposal.model}.`,
      reason: "Reviewed in the desktop app; approved as written.",
      refs: { files: [PROPOSAL_PATH] },
    });
    if (!recorded.ok) return fail(`The tasks were created, but the approval could not be recorded: ${recorded.message}`);
    return { ok: true, message: `${created.length} tasks created (${first} to ${last}). The build can start.` };
  } catch (error) {
    return fail(reason(error));
  }
}
