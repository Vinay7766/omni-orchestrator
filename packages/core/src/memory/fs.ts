/**
 * The file operations project memory needs. Implemented with Node's fs for the MCP server
 * and extension, and with Tauri commands for the desktop app (C9), so the same store logic
 * runs everywhere. Paths are absolute; "/" works as a separator on every platform.
 */
export interface MemoryFs {
  /** File contents, or null if the file does not exist. */
  readText(path: string): Promise<string | null>;
  /** Creates or replaces a file. */
  writeText(path: string, content: string): Promise<void>;
  /** Appends in a single write call; creates the file if missing. */
  appendText(path: string, content: string): Promise<void>;
  /** Creates the file only if it does not exist yet. Returns false if it already existed. */
  createExclusive(path: string, content: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  /** Creates a directory and any missing parents. */
  mkdir(path: string): Promise<void>;
  /** Moves a file, replacing the destination if it exists (atomic on the same volume). */
  rename(from: string, to: string): Promise<void>;
  /** Deletes a file; does nothing if it is already gone. */
  remove(path: string): Promise<void>;
  /** Names of the entries in a directory (not recursive); empty if it does not exist. */
  list(path: string): Promise<string[]>;
}
