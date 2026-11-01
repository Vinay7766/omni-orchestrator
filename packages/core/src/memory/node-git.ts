import { execFile } from "node:child_process";
import type { CommitChecker, GitLookup } from "./refs.js";

/** Maps git's exit code and error output to a lookup result. */
export function interpretGitResult(exitCode: number, stderr: string): Exclude<GitLookup, "unavailable"> {
  if (exitCode === 0) return "yes";
  if (/ambiguous/i.test(stderr)) return "ambiguous";
  if (/not a git repository/i.test(stderr)) return "not-a-repository";
  return "no";
}

/**
 * CommitChecker backed by the git CLI. Safe to call with untrusted input only after the SHA
 * has been validated (checkRefs does this): git is started with an argument array, never
 * through a shell, inside the project folder, with a timeout.
 */
export function createGitCommitChecker(
  options: {
    gitPath?: string;
    timeoutMs?: number;
    /**
     * Folders git must not search above (git's GIT_CEILING_DIRECTORIES). Without it, a project
     * with no repository of its own is checked against any repository in a parent folder,
     * such as a home folder kept in git. Not set by default, so projects inside a larger
     * repository (monorepos) still work.
     */
    ceilingDirectories?: string[];
  } = {},
): CommitChecker {
  const gitPath = options.gitPath ?? "git";
  const timeout = options.timeoutMs ?? 5000;
  const env = options.ceilingDirectories
    ? { ...process.env, GIT_CEILING_DIRECTORIES: options.ceilingDirectories.join(process.platform === "win32" ? ";" : ":") }
    : undefined;
  return {
    exists(projectRoot, sha) {
      return new Promise<GitLookup>((resolve) => {
        execFile(
          gitPath,
          ["cat-file", "-e", `${sha}^{commit}`],
          { cwd: projectRoot, timeout, windowsHide: true, env },
          (error, _stdout, stderr) => {
            if (!error) return resolve("yes");
            const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
            // Spawn failure (git not installed) or a timeout: we simply don't know.
            if (typeof code !== "number" || error.killed) return resolve("unavailable");
            resolve(interpretGitResult(code, String(stderr)));
          },
        );
      });
    },
  };
}
