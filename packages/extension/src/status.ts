import { MEMORY_DIR, type State } from "@omni/core";

/** Text shown in the status bar when no project memory is open yet. */
export function idleStatusText(): string {
  return `Omni: no ${MEMORY_DIR} project`;
}

const STATUS_WORDS: Record<string, string> = {
  not_started: "not started",
  in_progress: "in progress",
  awaiting_review: "review needed",
  changes_requested: "changes requested",
  approved: "approved",
};

/** One line for the status bar: phase, its status, and the task in progress if any. */
export function statusText(state: State): string {
  const phase = state.currentPhase;
  if (!phase) return "Omni: no phase started";
  const status = STATUS_WORDS[state.phases[phase]?.status ?? "not_started"] ?? "unknown";
  const task = state.tasks.find((t) => t.status === "in_progress");
  return `Omni: ${phase} · ${status}${task ? ` · ${task.id}` : ""}`;
}
