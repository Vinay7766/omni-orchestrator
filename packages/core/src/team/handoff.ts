/**
 * What a selected tool is given when the build phase is handed to it (PLAN-3). The text is the
 * same for every tool (no tool names): tools that read instruction files get `agentsBlock` inside
 * the managed block of AGENTS.md; chat-only tools get `package`, which also carries the project
 * summary because they cannot read the project's files.
 *
 * Task titles and the project name come from memory written by models and people, and the result
 * is read by other AI tools as instructions, so they are kept to one short line each.
 */
import type { State } from "../generated/types.js";
import { MEMORY_DIR } from "../constants.js";

export type HandoffTask = State["tasks"][number];

/** Where the handoff package is saved, inside .agents/. */
export const HANDOFF_FILE = "handoff/latest.md";

const MAX_LINE_TEXT = 200;

export interface HandoffInput {
  projectName: string;
  state: State;
  /** The text of .agents/summary.md, or null when it does not exist yet. */
  summary: string | null;
}

export interface Handoff {
  nextTask: HandoffTask | null;
  agentsBlock: string;
  package: string;
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_LINE_TEXT ? `${flat.slice(0, MAX_LINE_TEXT - 3)}...` : flat;
}

/** A task already in progress first (work resumes where it stopped), else the first not done. */
function pickNextTask(tasks: State["tasks"]): HandoffTask | null {
  return tasks.find((t) => t.status === "in_progress") ?? tasks.find((t) => t.status !== "done") ?? null;
}

function taskLine(task: HandoffTask | null): string {
  if (!task) return "No task is open. Ask the person what to do next before changing code.";
  const kinds = task.kinds && task.kinds.length > 0 ? ` (${task.kinds.join(", ")})` : "";
  return `${task.id}: ${oneLine(task.title)}${kinds}`;
}

export function buildHandoff({ projectName, state, summary }: HandoffInput): Handoff {
  const nextTask = pickNextTask(state.tasks);
  const name = oneLine(projectName);
  const phase = state.currentPhase ?? "not started";
  const rules = [
    "- Work on one task at a time. A task is done only with the test command you ran and its real output.",
    "- The person approves every phase and the task list. Do not approve, skip or reorder them yourself.",
    "- Record decisions and problems in project memory, each pointing at the files or commits it concerns.",
  ];

  const agentsBlock = [
    `## OmniOrchestrator project: ${name}`,
    "",
    `This project's shared memory is in \`${MEMORY_DIR}/\`. Before changing anything:`,
    "",
    `1. If the OmniOrchestrator MCP server is connected, call \`get_context\` first and use its tools for tasks, decisions and problems.`,
    `2. Otherwise read \`${MEMORY_DIR}/summary.md\` (where the project stands), \`${MEMORY_DIR}/lessons.md\` (corrections from the person) and the approved documents in \`docs/planning/\`.`,
    "",
    `Current phase: ${phase}`,
    `Next task: ${taskLine(nextTask)}`,
    "",
    "Rules:",
    ...rules,
  ].join("\n");

  const pkg = [
    `# Handoff: ${name}`,
    "",
    "Paste this into the AI tool you are handing the build to. It cannot read the project's files, so everything it needs is here.",
    "",
    `Current phase: ${phase}`,
    `Next task: ${taskLine(nextTask)}`,
    "",
    "## Where the project stands",
    "",
    summary?.trim() || "No summary has been written yet.",
    "",
    "## Rules",
    "",
    ...rules,
    "- You cannot write to the project yourself: give the person the changes and the test output, and they record progress.",
    "",
  ].join("\n");

  return { nextTask, agentsBlock, package: pkg };
}
