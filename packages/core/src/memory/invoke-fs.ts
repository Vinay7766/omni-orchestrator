import type { MemoryFs } from "./fs.js";

/** Calls a backend command; in the desktop app this is Tauri's `invoke`. */
export type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/** The backend commands this adapter uses (registered in src-tauri/src/lib.rs). */
export const MEMORY_FS_COMMANDS = [
  "memfs_read_text",
  "memfs_write_text",
  "memfs_append_text",
  "memfs_create_exclusive",
  "memfs_exists",
  "memfs_mkdir",
  "memfs_rename",
  "memfs_remove",
  "memfs_list",
] as const;

type Command = (typeof MEMORY_FS_COMMANDS)[number];

/**
 * MemoryFs backed by backend commands, for the desktop web view (which has no file access of
 * its own). The backend decides what is allowed (only paths inside a real .agents folder for
 * writes); a refusal arrives here as an error. No dependency on Tauri itself: pass `invoke`.
 */
export function createInvokeFs(invoke: Invoke): MemoryFs {
  const call = async <T>(command: Command, args: Record<string, unknown>): Promise<T> => {
    try {
      return (await invoke(command, args)) as T;
    } catch (error) {
      // Tauri commands reject with the backend's error string.
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
  return {
    readText: (path) => call<string | null>("memfs_read_text", { path }),
    writeText: (path, content) => call<void>("memfs_write_text", { path, content }),
    appendText: (path, content) => call<void>("memfs_append_text", { path, content }),
    createExclusive: (path, content) => call<boolean>("memfs_create_exclusive", { path, content }),
    exists: (path) => call<boolean>("memfs_exists", { path }),
    mkdir: (path) => call<void>("memfs_mkdir", { path }),
    rename: (from, to) => call<void>("memfs_rename", { from, to }),
    remove: (path) => call<void>("memfs_remove", { path }),
    list: (path) => call<string[]>("memfs_list", { path }),
  };
}
