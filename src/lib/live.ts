/**
 * Live updates (E7): the project page follows the project's events.jsonl, so a decision or
 * task update recorded elsewhere (the extension, the MCP server, another app window) shows
 * here within about a second. Uses C11's follower over the app's memfs commands, and asks
 * the backend for the log's size and time to notice a change. No sockets.
 */
import { createInvokeChangeTrigger, createInvokeFs, joinPath, MEMORY_DIR, MemoryStore, normalizePath, TASK_UPDATES_FILE, watchEvents, type EventWatch, type Invoke } from "@omni/core";

/**
 * Calls `onChange` each time new events arrive after the first read (which is what the page
 * already shows). `onError` gets a message the page can show when following fails.
 * Returns a function that stops following.
 */
export function watchProject(invoke: Invoke, root: string, onChange: () => void, onError?: (message: string) => void): () => void {
  let stopped = false;
  let watch: EventWatch | null = null;
  const projectRoot = normalizePath(root);

  void (async () => {
    try {
      const opened = await MemoryStore.open(createInvokeFs(invoke), projectRoot);
      if (stopped) return;
      if (!opened.ok) {
        onError?.(`Live updates are off: the project memory could not be opened (${opened.issues.map((i) => i.message).join("; ")}).`);
        return;
      }
      let first = true;
      watch = watchEvents(
        opened.store.follow(),
        createInvokeChangeTrigger(invoke, joinPath(projectRoot, MEMORY_DIR)),
        () => {
          if (first) first = false;
          else onChange();
        },
        { onError: (e) => onError?.(`Live updates could not read the project memory: ${e instanceof Error ? e.message : String(e)}`) },
      );
      if (stopped) watch.stop();
    } catch (e) {
      if (!stopped) onError?.(`Live updates are off: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();

  // Tools without MCP write .agents/task-updates.jsonl instead of events (issue B): a new or changed
  // file means updates to apply, which the page's reload does.
  const updatesFile = joinPath(joinPath(projectRoot, MEMORY_DIR), TASK_UPDATES_FILE);
  let lastUpdates: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const checkUpdates = async () => {
    try {
      const stamp = ((await invoke("memfs_stamp", { path: updatesFile })) as string | null) ?? null;
      if (!stopped && lastUpdates !== undefined && stamp !== null && stamp !== lastUpdates) onChange();
      lastUpdates = stamp;
    } catch {
      // Try again next time.
    }
    if (!stopped) timer = setTimeout(() => void checkUpdates(), 500);
  };
  void checkUpdates();

  return () => {
    stopped = true;
    watch?.stop();
    if (timer) clearTimeout(timer);
  };
}
