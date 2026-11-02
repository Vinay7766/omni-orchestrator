import type { PhaseHistoryEntry } from "@omni/core";

/** How each phase status is worded in the dashboard (one list for every screen). */
export const STATUS_WORDS: Record<PhaseHistoryEntry["status"], string> = {
  not_started: "not started",
  in_progress: "in progress",
  awaiting_review: "review needed",
  changes_requested: "changes requested",
  approved: "approved",
  skipped: "skipped",
};

export const statusWords = (status: string): string => STATUS_WORDS[status as PhaseHistoryEntry["status"]] ?? status;
