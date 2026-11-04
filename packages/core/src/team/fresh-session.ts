/**
 * The prompt a fresh session starts from when the next phase begins (HND-7). It is built from
 * memory only, so the new session carries nothing over from the long one before it.
 *
 * The prompt is saved in .agents/ (FRESH_SESSION_FILE); a command-line agent is started with
 * FRESH_SESSION_LAUNCH_TEXT, a fixed sentence pointing at that file, so no text from memory ever
 * reaches a command line. Text from memory is kept to one short line each (see handoff.ts).
 */
import { FLOWS } from "../generated/contract.js";
import type { State } from "../generated/types.js";
import { MEMORY_DIR } from "../constants.js";
import { nextPhase } from "../engine/phases.js";
import { NO_AI_ATTRIBUTION_RULE, PROGRESS_RULES } from "./handoff.js";

/** Where the prompt is saved, inside .agents/. */
export const FRESH_SESSION_FILE = "handoff/next-session.md";

/** The only text a command-line agent is started with. */
export const FRESH_SESSION_LAUNCH_TEXT = `Read ${MEMORY_DIR}/${FRESH_SESSION_FILE} and follow it.`;

const MAX_LINE_TEXT = 200;
const oneLine = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_LINE_TEXT ? `${flat.slice(0, MAX_LINE_TEXT - 3)}...` : flat;
};

export interface FreshSessionInput {
  projectName: string;
  flow: string;
  state: State;
  flows?: Readonly<Record<string, readonly string[]>>;
}

export interface FreshSession {
  /** The phase the new session works on; null when every phase is done. */
  phase: string | null;
  prompt: string;
}

export function buildFreshSession({ projectName, flow, state, flows = FLOWS }: FreshSessionInput): FreshSession {
  const phase = nextPhase(flow, state, flows);
  const task = state.tasks.find((t) => t.status === "in_progress") ?? state.tasks.find((t) => t.status !== "done");
  const where = phase
    ? [`Phase: ${phase}`, ...(phase === "build" && task ? [`Next task: ${task.id}: ${oneLine(task.title)}`] : [])]
    : ["Every phase is done. Ask the person what they want next before changing anything."];

  const prompt = [
    `# Fresh session: ${oneLine(projectName)}`,
    "",
    "This is a new session with no earlier conversation. Everything you need is in the project's memory; do not assume anything from elsewhere.",
    "",
    ...where,
    "",
    "1. If the OmniOrchestrator MCP server is connected, call `get_context` first.",
    `   Otherwise read \`${MEMORY_DIR}/summary.md\`, \`${MEMORY_DIR}/lessons.md\` and the approved documents in \`docs/planning/\`.`,
    "2. Before doing anything else, state in three short lines, from memory alone: the project's goal, the current phase, and the next step.",
    "3. Then work on that phase only. The person approves every phase: do not approve, skip or reorder phases yourself.",
    `4. ${NO_AI_ATTRIBUTION_RULE}`,
    ...(phase === "build" ? ["", ...PROGRESS_RULES] : []),
    "",
  ].join("\n");
  return { phase, prompt };
}
