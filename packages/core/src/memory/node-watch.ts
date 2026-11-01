import { watch, stat, statSync, type FSWatcher, type Stats } from "node:fs";
import { join } from "node:path";
import type { ChangeTrigger } from "./sync.js";

export interface NodeTriggerOptions {
  /** How often to check the log's size and time as a fallback (default 1000 ms). */
  pollMs?: number;
  /** Use operating-system change signals (default true). */
  useWatch?: boolean;
}

/**
 * Signals changes to <memoryDir>/events.jsonl using operating-system file watching, plus a
 * regular size-and-time check, because file watching misses changes on some network and
 * virtual drives. Timers do not keep the process alive. No network is used.
 */
export function createNodeChangeTrigger(memoryDir: string, options: NodeTriggerOptions = {}): ChangeTrigger {
  const file = join(memoryDir, "events.jsonl");
  return (notify) => {
    let watcher: FSWatcher | null = null;
    if (options.useWatch ?? true) {
      try {
        watcher = watch(memoryDir, (_kind, name) => {
          if (name === null || name === "events.jsonl") notify();
        });
        watcher.on("error", () => {
          watcher?.close();
          watcher = null; // the regular check keeps working
        });
      } catch {
        watcher = null;
      }
    }
    const reading = (info: Stats | undefined) => (info ? `${info.size}:${info.mtimeMs}` : "missing");
    // Baseline taken now, so a change made before the first tick is not mistaken for it.
    let last = reading(statSync(file, { throwIfNoEntry: false }));
    const timer = setInterval(() => {
      stat(file, (error, info) => {
        const now = reading(error ? undefined : info);
        if (now !== last) notify();
        last = now;
      });
    }, options.pollMs ?? 1000);
    timer.unref();
    return () => {
      clearInterval(timer);
      watcher?.close();
    };
  };
}
