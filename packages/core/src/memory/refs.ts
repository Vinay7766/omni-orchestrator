import * as generated from "../generated/validators.js";
import type { MemoryFs } from "./fs.js";
import { joinPath, normalizePath } from "./paths.js";

type Check = (value: unknown) => boolean;
// Exactly the schema's rules for a project-relative path and a commit SHA.
const isProjectRelativePath = generated.commonRelPath as unknown as Check;
const isCommitSha = generated.commonCommitSha as unknown as Check;

/** Result of asking git whether a commit exists. */
export type GitLookup = "yes" | "no" | "ambiguous" | "not-a-repository" | "unavailable";

/**
 * Answers whether a commit exists in a project's git history. Node uses the git CLI
 * (@omni/core/node); the desktop app supplies its own through a Tauri command.
 */
export interface CommitChecker {
  exists(projectRoot: string, sha: string): Promise<GitLookup>;
  /** Root folder of the repository commits are checked against, or null if there is none. */
  repositoryRoot?(projectRoot: string): Promise<string | null>;
}

/** Which repository commits were checked against, so a wrong one is visible. */
export interface RepositoryInfo {
  root: string | null;
  /** True when the repository lives in a parent folder of the project. */
  aboveProject: boolean;
  message?: string;
}

/** Windows drive paths compare case-insensitively; others exactly. */
function samePath(a: string, b: string): boolean {
  const x = normalizePath(a);
  const y = normalizePath(b);
  return /^[A-Za-z]:\//.test(x) ? x.toLowerCase() === y.toLowerCase() : x === y;
}

export type RefStatus = "ok" | "missing" | "outside-project" | "invalid" | "ambiguous" | "unverified";

export interface RefResult {
  kind: "file" | "commit";
  ref: string;
  status: RefStatus;
  message?: string;
}

/** Statuses that mean memory points at something that isn't really there. */
const FAILING: ReadonlySet<RefStatus> = new Set(["missing", "outside-project", "invalid", "ambiguous"]);

/**
 * Checks that referenced files exist inside the project and referenced commits exist in its
 * git history (MEM-4). Commits that cannot be checked (no git, not a repository, no checker
 * in this runtime) are reported as unverified rather than passed or failed.
 */
export async function checkRefs(
  fs: MemoryFs,
  projectRoot: string,
  refs: { files?: string[]; commits?: string[] },
  commits?: CommitChecker,
): Promise<{ ok: boolean; results: RefResult[]; repository?: RepositoryInfo }> {
  const root = normalizePath(projectRoot);
  const results: RefResult[] = [];

  for (const ref of refs.files ?? []) {
    if (!isProjectRelativePath(ref)) {
      results.push({ kind: "file", ref, status: "invalid", message: "not a project-relative path (forward slashes, no '..', not absolute)" });
      continue;
    }
    const full = joinPath(root, ref);
    // Defence in depth: the schema rule already forbids escaping, but confirm the resolved path.
    if (full !== root && !full.startsWith(root.endsWith("/") ? root : `${root}/`)) {
      results.push({ kind: "file", ref, status: "outside-project", message: `resolves outside ${root}` });
      continue;
    }
    results.push({ kind: "file", ref, status: (await fs.exists(full)) ? "ok" : "missing" });
  }

  for (const ref of refs.commits ?? []) {
    if (!isCommitSha(ref)) {
      results.push({ kind: "commit", ref, status: "invalid", message: "not a commit SHA (7-40 lowercase hex characters)" });
      continue;
    }
    if (!commits) {
      results.push({ kind: "commit", ref, status: "unverified", message: "commit checks need git, which is not available here" });
      continue;
    }
    const answer = await commits.exists(root, ref);
    results.push(
      answer === "yes"
        ? { kind: "commit", ref, status: "ok" }
        : answer === "no"
          ? { kind: "commit", ref, status: "missing", message: "no such commit in this repository" }
          : answer === "ambiguous"
            ? { kind: "commit", ref, status: "ambiguous", message: "short SHA matches several objects; use more characters" }
            : answer === "not-a-repository"
              ? { kind: "commit", ref, status: "unverified", message: "the project folder is not a git repository" }
              : { kind: "commit", ref, status: "unverified", message: "git is not available" },
    );
  }

  let repository: RepositoryInfo | undefined;
  if ((refs.commits?.length ?? 0) > 0 && commits?.repositoryRoot) {
    const top = await commits.repositoryRoot(root);
    const aboveProject = top !== null && !samePath(top, root);
    repository = {
      root: top === null ? null : normalizePath(top),
      aboveProject,
      ...(aboveProject
        ? { message: `commits were checked against the repository in a parent folder (${normalizePath(top!)}); fine for a monorepo, but make sure it is the right one` }
        : {}),
    };
  }

  return { ok: !results.some((r) => FAILING.has(r.status)), results, ...(repository ? { repository } : {}) };
}
