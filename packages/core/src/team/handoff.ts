/**
 * What a selected tool is given when the build phase is handed to it (PLAN-3). The text is the
 * same for every tool (no tool names): tools that read instruction files get `agentsBlock` inside
 * the managed block of AGENTS.md; chat-only tools get `package`, which also carries the project
 * summary because they cannot read the project's files.
 *
 * Task titles and the project name come from memory written by models and people, and the result
 * is read by other AI tools as instructions, so they are kept to one short line each.
 */
import type { State, Team } from "../generated/types.js";
import { MEMORY_DIR } from "../constants.js";

export type HandoffTask = State["tasks"][number];

/** Where the handoff package is saved, inside .agents/. */
export const HANDOFF_FILE = "handoff/latest.md";

const MAX_LINE_TEXT = 200;

/**
 * Every text the app writes for AI tools in a person's project carries this rule (C19): the work is
 * the person's. It names no tool or vendor (TOOL-0). The Rust pointer in tools' own instruction
 * files (`handoff.rs`) carries the same sentence.
 */
export const NO_AI_ATTRIBUTION_RULE =
  'Do not add AI attribution to commits, pull requests or release notes: no AI co-author trailers, no "generated with" lines, no AI author name or email. Commits are authored by the person.';

export interface HandoffInput {
  projectName: string;
  state: State;
  /** The text of .agents/summary.md, or null when it does not exist yet. */
  summary: string | null;
  /** The person's tools (D): with tasks assigned to them, each tool is pointed at its own. */
  team?: Team["members"];
  /** The tool this handoff is for (D). */
  toolId?: string;
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

/** Who does what (D): every task given to a tool, as one short line each. */
function splitLines(tasks: State["tasks"], team: Team["members"]): string[] {
  const name = (id: string) => oneLine(team.find((m) => m.toolId === id)?.name ?? id);
  return tasks
    .filter((t) => t.assignedTool)
    .map((t) => `- ${t.id}: ${oneLine(t.title)}: ${name(t.assignedTool!)}${t.assignedModel ? `, with ${oneLine(t.assignedModel)}` : ""}${t.status === "done" ? " (done)" : ""}`);
}

/**
 * How the person starts work in a tool, step by step (D, NTU-1), by what the tool can do. No tool
 * is named in the steps beyond the one the person chose.
 */
export function startSteps(level: 1 | 2 | 3, toolName: string, model?: string): string[] {
  const tool = oneLine(toolName);
  const pick = model ? `Choose the model ${oneLine(model)} in ${tool}'s model picker.` : `Choose the model you want to use in ${tool}.`;
  if (level === 3) {
    return [
      `Open the project folder in ${tool} (it may already be open).`,
      `Open ${tool}'s AI chat or agent panel. If ${tool} asks to allow an MCP server whose name starts with "omni-orchestrator", allow it; if it does not list one, restart ${tool}.`,
      pick,
      `Type: "Call get_context from omni-orchestrator, then start my next task." The AI loads the project memory and its task.`,
      "When it says the task is done, come back here: the task list and the phase history update by themselves.",
    ];
  }
  if (level === 2) {
    return [
      `Open the project folder in ${tool} (it may already be open).`,
      `Open ${tool}'s AI chat or agent panel.`,
      pick,
      `Type: "Read AGENTS.md and start the next task given to ${tool}." The AI reads the project memory from the files.`,
      "When it is done, ask it to record the result in the project memory as AGENTS.md says, then check it here.",
    ];
  }
  return [
    `Open ${tool} and start a new chat.`,
    pick,
    "Copy the handoff package below and paste it into the chat as your first message.",
    `${tool} cannot change the project's files: copy its changes into your project (or ask a tool that can), and paste the test output back.`,
    "Record what was done here, or with a tool connected to the project.",
  ];
}

function taskLine(task: HandoffTask | null): string {
  if (!task) return "No task is open. Ask the person what to do next before changing code.";
  const kinds = task.kinds && task.kinds.length > 0 ? ` (${task.kinds.join(", ")})` : "";
  return `${task.id}: ${oneLine(task.title)}${kinds}`;
}

export function buildHandoff({ projectName, state, summary, team = [], toolId }: HandoffInput): Handoff {
  const assigned = state.tasks.some((t) => t.assignedTool);
  const mine = assigned && toolId ? state.tasks.filter((t) => t.assignedTool === toolId) : state.tasks;
  const nextTask = pickNextTask(mine);
  const split = assigned ? splitLines(state.tasks, team) : [];
  const name = oneLine(projectName);
  const phase = state.currentPhase ?? "not started";
  const rules = [
    "- Work on one task at a time. A task is done only with the test command you ran and its real output.",
    "- The person approves every phase and the task list. Do not approve, skip or reorder them yourself.",
    "- Record decisions and problems in project memory, each pointing at the files or commits it concerns.",
    `- ${NO_AI_ATTRIBUTION_RULE}`,
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
    // AGENTS.md is shared by every tool: with tasks given to tools it lists the whole split, and
    // each tool finds its own tasks there (D).
    ...(split.length
      ? ["", "Who does what (work only on the tasks given to your tool; if you are not sure which tool you are, ask the person):", ...split]
      : [`Next task: ${taskLine(nextTask)}`]),
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
    ...(assigned && toolId ? [`Your tasks: ${mine.map((t) => t.id).join(", ") || "none yet"}`] : []),
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
