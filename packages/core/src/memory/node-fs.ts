import { promises as fsp } from "node:fs";
import type { MemoryFs } from "./fs.js";

const isCode = (error: unknown, code: string) =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === code;

const onWindows = process.platform === "win32";

/**
 * Windows briefly refuses to create a file whose previous copy is still being deleted
 * (EPERM, "delete pending"), and refuses to replace a file another process has open
 * (EPERM/EBUSY/EACCES). Both clear within milliseconds; elsewhere these codes mean a real
 * permission problem and are surfaced.
 */
const isTransientWindowsLock = (error: unknown) =>
  onWindows && (isCode(error, "EPERM") || isCode(error, "EBUSY") || isCode(error, "EACCES"));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** MemoryFs backed by Node's file system (MCP server, extension, tests). */
export function createNodeFs(): MemoryFs {
  return {
    async readText(path) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fsp.readFile(path, "utf8");
        } catch (error) {
          if (isCode(error, "ENOENT")) return null;
          // A file being deleted on Windows answers EPERM until the delete completes;
          // retry so it resolves to "not found", while a real permission error still throws.
          if (!isTransientWindowsLock(error) || attempt >= 20) throw error;
          await sleep(5 + attempt * 5);
        }
      }
    },
    writeText: (path, content) => fsp.writeFile(path, content, "utf8"),
    appendText: (path, content) => fsp.appendFile(path, content, "utf8"),
    async createExclusive(path, content) {
      try {
        await fsp.writeFile(path, content, { encoding: "utf8", flag: "wx" });
        return true;
      } catch (error) {
        // Treat a delete-pending lock on Windows like an existing one: the caller retries.
        if (isCode(error, "EEXIST") || isTransientWindowsLock(error)) return false;
        throw error;
      }
    },
    async exists(path) {
      try {
        await fsp.access(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path) => {
      await fsp.mkdir(path, { recursive: true });
    },
    async rename(from, to) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fsp.rename(from, to);
        } catch (error) {
          if (!isTransientWindowsLock(error) || attempt >= 20) throw error;
          await sleep(5 + attempt * 5);
        }
      }
    },
    async remove(path) {
      try {
        await fsp.unlink(path);
      } catch (error) {
        if (!isCode(error, "ENOENT")) throw error;
      }
    },
  };
}
