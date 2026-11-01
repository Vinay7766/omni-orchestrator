import { MEMORY_DIR } from "../constants.js";
import { validateMemoryFile, type ValidationIssue } from "../validate.js";
import type { MemoryFs } from "./fs.js";
import { joinPath, normalizePath, parentDir } from "./paths.js";

export const LINK_FILE = ".agents-link";

export type FindProjectResult =
  | {
      ok: true;
      /** Folder whose .agents/ holds the project memory (normalized, "/" separators). */
      root: string;
      /** Set when the project was reached through a .agents-link (for example a git worktree). */
      linkedFrom?: string;
    }
  | { ok: false; issues: ValidationIssue[] };

const fail = (message: string): FindProjectResult => ({ ok: false, issues: [{ path: "", message }] });

/**
 * Looks for a valid `.agents/project.json` in `dir`.
 * "absent" also covers a `.agents/` folder that belongs to another tool (no project.json).
 */
async function projectAt(fs: MemoryFs, dir: string): Promise<"found" | "absent" | ValidationIssue[]> {
  const text = await fs.readText(joinPath(dir, `${MEMORY_DIR}/project.json`));
  if (text === null) return "absent";
  try {
    const result = validateMemoryFile("project", JSON.parse(text));
    return result.ok ? "found" : result.issues;
  } catch {
    return [{ path: "", message: "not valid JSON" }];
  }
}

/**
 * Finds the project for a working directory: walks up to the nearest folder with a valid
 * `.agents/project.json`, or follows the nearest `.agents-link` once. Never skips past a
 * broken project file (that could silently pick up a different, outer project).
 */
export async function findProject(
  fs: MemoryFs,
  startDir: string,
  options: { maxDepth?: number } = {},
): Promise<FindProjectResult> {
  const start = normalizePath(startDir);
  let dir: string | null = start;
  for (let depth = 0; dir !== null && depth < (options.maxDepth ?? 256); depth++) {
    const here = await projectAt(fs, dir);
    if (here === "found") return { ok: true, root: dir };
    if (here !== "absent") {
      return fail(`${dir}/${MEMORY_DIR}/project.json is invalid: ${here.map((i) => `${i.path} ${i.message}`).join("; ")}`);
    }
    const link = await fs.readText(joinPath(dir, LINK_FILE));
    if (link !== null) return followLink(fs, dir, link);
    dir = parentDir(dir);
  }
  return fail(`no OmniOrchestrator project found in ${start} or any parent folder`);
}

async function followLink(fs: MemoryFs, linkDir: string, text: string): Promise<FindProjectResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(`${linkDir}/${LINK_FILE} is not valid JSON`);
  }
  const link = validateMemoryFile("agents-link", parsed);
  if (!link.ok) {
    return fail(`${linkDir}/${LINK_FILE} is invalid: ${link.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
  }
  const target = joinPath(linkDir, link.value.projectRoot);
  if ((await fs.readText(joinPath(target, LINK_FILE))) !== null) {
    return fail(`${linkDir}/${LINK_FILE} points at ${target}, which is itself a link; link chains are not followed`);
  }
  const there = await projectAt(fs, target);
  if (there === "found") return { ok: true, root: target, linkedFrom: linkDir };
  return fail(
    there === "absent"
      ? `${linkDir}/${LINK_FILE} points at ${target}, but there is no project there`
      : `${linkDir}/${LINK_FILE} points at ${target}, whose project.json is invalid`,
  );
}
