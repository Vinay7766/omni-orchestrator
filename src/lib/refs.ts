/**
 * P-E8-02: what the workflow details can do with a recorded file or commit. A file's folder is
 * opened by the app's own open_folder command (absolute, existing, not a link: checked in Rust);
 * the path must stay inside the project. The file itself is never opened or run.
 */
import { joinPath, normalizePath, parentDir, type Invoke } from "@omni/core";

export function folderOfRef(root: string, rel: string): string {
  const clean = normalizePath(rel);
  if (!rel.trim() || clean === "." || clean.startsWith("/") || /^[A-Za-z]:/.test(clean) || clean.split("/").some((p) => p === "..")) {
    throw new Error(`${rel} is not a path inside the project, so it was not opened.`);
  }
  const dir = parentDir(clean);
  return dir && dir !== "." ? joinPath(root, dir) : normalizePath(root);
}

export const showRefInFolder = (invoke: Invoke, root: string, rel: string) => invoke("open_folder", { path: folderOfRef(root, rel) }).then(() => undefined);
