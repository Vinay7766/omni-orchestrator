/** Shared by every tool: find and open the project, and resolve its current phase's skills. */
import {
  findProject,
  joinPath,
  MemoryStore,
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
}

export type OpenResult =
  | { ok: true; store: MemoryStore; root: string; linkedFrom?: string }
  | { ok: false; message: string };

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
