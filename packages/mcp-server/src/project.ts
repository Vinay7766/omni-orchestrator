/** Shared by every tool: find and open the project, and resolve its current phase's skills. */
import {
  findProject,
  isAbsolutePath,
  joinPath,
  MemoryStore,
  normalizePath,
  resolvePhaseSkills,
  validateMemoryFile,
  verifyReferences,
  type CommitChecker,
  type MemoryFs,
  type ReferenceCheck,
  type ResolvedSkill,
  type SkillSource,
} from "@omni/core";

export interface ToolDeps {
  fs: MemoryFs;
  skills: SkillSource;
  /** Where the server was started; the default place to look for the project. */
  startDir: string;
  /** Checks that referenced commits exist (git in Node). Without it, commits are reported unverified. */
  commits?: CommitChecker;
  /**
   * The projects the person registered in the app (their project folders, RT-14/RT-15). Besides
   * the project the server was started in, only these can be opened, by projectPath or a link.
   */
  registeredProjects?: () => Promise<string[]>;
}

export type OpenResult =
  | { ok: true; store: MemoryStore; root: string; linkedFrom?: string }
  | { ok: false; message: string };

/** Windows paths compare without case; others exactly. */
function samePath(a: string, b: string): boolean {
  const x = normalizePath(a);
  const y = normalizePath(b);
  return /^[A-Za-z]:/.test(x) ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * The server serves the project it was started in, and the projects the person registered in the
 * app; nothing else (T1.5, RT-14). A project reached through a .agents-link counts only when its
 * target is registered, so a cloned repository cannot redirect writes elsewhere (RT-15).
 */
async function allowed(deps: ToolDeps, found: { root: string; linkedFrom?: string }): Promise<string | null> {
  const registered = deps.registeredProjects ? await deps.registeredProjects().catch(() => []) : [];
  if (registered.some((r) => samePath(r, found.root))) return null;
  const refusal = `${found.root} is not a project this server may use. Register it in the OmniOrchestrator app (add its folder to your projects) and try again.`;
  if (found.linkedFrom) return refusal;
  const home = await findProject(deps.fs, deps.startDir);
  if (home.ok && !home.linkedFrom && samePath(home.root, found.root)) return null;
  return refusal;
}

/** Finds the project from projectPath (absolute or relative to startDir) or startDir, and opens it. */
export async function openProject(deps: ToolDeps, projectPath: string | undefined): Promise<OpenResult> {
  const startDir = projectPath ? joinPath(deps.startDir, projectPath) : deps.startDir;
  const found = await findProject(deps.fs, startDir);
  if (!found.ok) {
    return {
      ok: false,
      message: `${found.issues.map((i) => i.message).join("; ")}. Create a project in the OmniOrchestrator app, or pass projectPath with the project's folder.`,
    };
  }
  const refused = await allowed(deps, found);
  if (refused) return { ok: false, message: refused };
  const opened = await MemoryStore.open(deps.fs, found.root);
  if (!opened.ok) return { ok: false, message: opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ") };
  return { ok: true, store: opened.store, root: found.root, ...(found.linkedFrom ? { linkedFrom: found.linkedFrom } : {}) };
}

/**
 * The phase's skills from the catalog with the project's skills.json overrides (SKL-2, SKL-3).
 * Problems that should not stop the agent are added to `warnings`.
 */
export async function currentSkills(
  source: SkillSource,
  store: MemoryStore,
  phase: string,
  warnings: string[],
): Promise<ResolvedSkill[]> {
  const catalog = await source.list();
  if (!catalog.ok) {
    warnings.push(`Skill catalog could not be read: ${catalog.issues.map((i) => i.message).join("; ")}`);
    return [];
  }
  const resolved = resolvePhaseSkills(catalog.entries, await readOverrides(store, warnings), phase);
  warnings.push(...resolved.warnings);
  return resolved.skills;
}

async function readOverrides(store: MemoryStore, warnings: string[]) {
  const raw = await store.readFile("skills.json");
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push("skills.json is not valid JSON; the catalog's default skills are used.");
    return null;
  }
  const valid = validateMemoryFile("skills-config", parsed);
  if (!valid.ok) {
    warnings.push(`skills.json is invalid (${valid.issues.map((i) => `${i.path} ${i.message}`).join("; ")}); the catalog's default skills are used.`);
    return null;
  }
  return valid.value;
}

export type { ReferenceCheck };

/**
 * MEM-4: files must exist inside the project and commits must exist in its git history. Commits
 * that cannot be checked here (no git, not a repository) are accepted with a warning.
 */
export async function checkReferences(
  deps: ToolDeps,
  root: string,
  refs: { files?: string[]; commits?: string[] },
  what: string,
): Promise<ReferenceCheck> {
  return verifyReferences(deps.fs, root, refs, what, deps.commits);
}

/**
 * Reads the app's list of registered projects (`projects.json` in its data folder, written each
 * time the app lists the person's projects): `{ "formatVersion": 1, "roots": [absolute folders] }`.
 * Anything missing or malformed counts as no registered projects, so it can only narrow access.
 */
export function registeredProjectsFrom(fs: MemoryFs, file: string): () => Promise<string[]> {
  return async () => {
    const text = await fs.readText(file).catch(() => null);
    if (text === null) return [];
    try {
      const parsed = JSON.parse(text) as { formatVersion?: unknown; roots?: unknown };
      if (parsed.formatVersion !== 1 || !Array.isArray(parsed.roots)) return [];
      return parsed.roots.filter((r): r is string => typeof r === "string" && isAbsolutePath(r)).map(normalizePath);
    } catch {
      return [];
    }
  };
}
