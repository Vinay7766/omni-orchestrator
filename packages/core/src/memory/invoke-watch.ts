import type { Invoke } from "./invoke-fs.js";
import { joinPath } from "./paths.js";
import type { ChangeTrigger } from "./sync.js";

/** The backend command that answers a file's size and change time (src-tauri memory_fs.rs). */
export const STAMP_COMMAND = "memfs_stamp";

export interface InvokeTriggerOptions {
  /** How often to ask the backend whether the log changed (default 500 ms). */
  pollMs?: number;
}

/**
 * Signals changes to <memoryDir>/events.jsonl for the desktop web view (E7), which cannot
 * watch files itself. It asks the backend for the log's size and change time on a timer and
 * signals when the answer differs; reading new events is left to the EventFollower. A failed
 * check is skipped and the next one tries again. Checks never overlap. No sockets.
 */
export function createInvokeChangeTrigger(invoke: Invoke, memoryDir: string, options: InvokeTriggerOptions = {}): ChangeTrigger {
  const path = joinPath(memoryDir, "events.jsonl");
  const pollMs = options.pollMs ?? 500;
  return (notify) => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: string | null | undefined; // undefined: no answer yet (the first is the baseline)

    const check = async () => {
      try {
        const now = ((await invoke(STAMP_COMMAND, { path })) as string | null) ?? null;
        if (!stopped && last !== undefined && now !== last) notify();
        last = now;
      } catch {
        // The backend could not check (for example the drive is busy); try again next time.
      }
      if (!stopped) timer = setTimeout(() => void check(), pollMs);
    };

    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  };
}
