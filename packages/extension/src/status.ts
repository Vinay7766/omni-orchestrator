import { MEMORY_DIR } from "@omni/core";

/** Text shown in the status bar when no project memory is open yet. */
export function idleStatusText(): string {
  return `Omni: no ${MEMORY_DIR} project`;
}
