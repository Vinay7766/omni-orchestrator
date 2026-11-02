import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { checkRefs, type CommitChecker } from "./refs.js";
import { normalizePath } from "./paths.js";
import { createNodeFs } from "./node-fs.js";
import { createGitCommitChecker, interpretGitResult } from "./node-git.js";

const fs = createNodeFs();

let repo: string;
let notRepo: string;
let sha: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "omni-refs-"));
  notRepo = mkdtempSync(join(tmpdir(), "omni-norepo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "PRD.md"), "# PRD\n");
  git("add", ".");
  git("commit", "-q", "-m", "initial");
  sha = git("rev-parse", "HEAD");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(notRepo, { recursive: true, force: true });
});

const status = (results: { ref: string; status: string }[], ref: string) => results.find((r) => r.ref === ref)?.status;

describe("checkRefs: files", () => {
  it("accepts files and folders that exist inside the project", async () => {
    const { ok, results } = await checkRefs(fs, repo, { files: ["docs/PRD.md", "docs"] });
    expect(ok).toBe(true);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
  });

  it("reports a missing file", async () => {
    const { ok, results } = await checkRefs(fs, repo, { files: ["docs/missing.md"] });
    expect(ok).toBe(false);
    expect(status(results, "docs/missing.md")).toBe("missing");
  });

  it("rejects paths that are absolute, use backslashes or leave the project, without touching the disk", async () => {
    for (const bad of ["/etc/passwd", "C:/Windows/win.ini", "docs\\PRD.md", "../outside.md", "docs/../../x"]) {
      const { ok, results } = await checkRefs(fs, repo, { files: [bad] });
      expect(ok, bad).toBe(false);
      expect(status(results, bad), bad).toBe("invalid");
    }
  });
});

describe("checkRefs: commits with real git", () => {
  const git = createGitCommitChecker();

  it("accepts a full and a short commit SHA that exist", async () => {
    const { ok, results } = await checkRefs(fs, repo, { commits: [sha, sha.slice(0, 7)] }, git);
    expect(ok).toBe(true);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
  });

  it("reports a commit that does not exist", async () => {
    const fake = "0".repeat(40);
    const { ok, results } = await checkRefs(fs, repo, { commits: [fake] }, git);
    expect(ok).toBe(false);
    expect(status(results, fake)).toBe("missing");
  });

  it("rejects a value that is not a commit SHA without running git", async () => {
    let called = false;
    const spy: CommitChecker = { exists: async () => ((called = true), "yes") };
    const { ok, results } = await checkRefs(fs, repo, { commits: ["--upload-pack=evil", "HEAD", "abc"] }, spy);
    expect(ok).toBe(false);
    expect(results.every((r) => r.status === "invalid")).toBe(true);
    expect(called).toBe(false);
  });

  it("marks commits unverified (not missing) when the folder is not a git repository", async () => {
    // Stop git at the temp folder so a repository in a parent folder (for example a home
    // folder kept in git) cannot be picked up.
    const isolated = createGitCommitChecker({ ceilingDirectories: [dirname(notRepo)] });
    const { ok, results } = await checkRefs(fs, notRepo, { commits: [sha] }, isolated);
    expect(ok).toBe(true);
    expect(results[0].status).toBe("unverified");
    expect(results[0].message).toMatch(/not a git repository/);
  });

  it("marks commits unverified when git is not installed", async () => {
    const noGit = createGitCommitChecker({ gitPath: "definitely-not-an-installed-git-binary" });
    const { ok, results } = await checkRefs(fs, repo, { commits: [sha] }, noGit);
    expect(ok).toBe(true);
    expect(results[0].status).toBe("unverified");
  });

  it("marks commits unverified when no commit checker is available (for example in the web view)", async () => {
    const { results } = await checkRefs(fs, repo, { commits: [sha] });
    expect(results[0].status).toBe("unverified");
  });
});

describe("checkRefs: which repository was used", () => {
  // git reports the real path: macOS temp folders sit under a /var -> /private/var link,
  // and Windows temp paths can use short 8.3 names (C:/Users/RUNNER~1). Compare real paths.
  const realRepo = () => normalizePath(realpathSync.native(repo));

  it("reports the repository and that it is the project itself", async () => {
    const result = await checkRefs(fs, repo, { commits: [sha] }, createGitCommitChecker());
    expect(result.repository?.root).toBe(realRepo());
    expect(result.repository?.aboveProject).toBe(false);
  });

  it("decides 'parent folder' from the project's place in the repository, not by comparing path spellings", async () => {
    const checker: CommitChecker = {
      exists: async () => "yes",
      locateRepository: async () => ({ root: "/private/var/folders/x/project", prefix: "" }),
    };
    const result = await checkRefs(fs, repo, { commits: [sha] }, checker);
    expect(result.repository).toEqual({ root: "/private/var/folders/x/project", aboveProject: false });
  });

  it("does not flag a project opened through a link to the repository folder", async () => {
    const link = join(notRepo, "linked-project");
    symlinkSync(repo, link, process.platform === "win32" ? "junction" : "dir");
    try {
      const result = await checkRefs(fs, link, { commits: [sha] }, createGitCommitChecker());
      expect(result.repository?.aboveProject).toBe(false);
      expect(result.repository?.message).toBeUndefined();
    } finally {
      rmSync(link, { recursive: true, force: true });
    }
  });

  it("flags a repository in a parent folder (a monorepo, or a home folder kept in git)", async () => {
    const sub = join(repo, "packages", "app");
    mkdirSync(sub, { recursive: true });
    const result = await checkRefs(fs, sub, { commits: [sha] }, createGitCommitChecker());
    expect(result.repository?.root).toBe(realRepo());
    expect(result.repository?.aboveProject).toBe(true);
    expect(result.repository?.message).toMatch(/parent folder/);
  });

  it("reports no repository when the folder is not in one", async () => {
    const isolated = createGitCommitChecker({ ceilingDirectories: [dirname(notRepo)] });
    const result = await checkRefs(fs, notRepo, { commits: [sha] }, isolated);
    expect(result.repository?.root).toBeNull();
  });

  it("omits repository details when no commits are checked or no checker can tell", async () => {
    expect((await checkRefs(fs, repo, { files: ["docs/PRD.md"] }, createGitCommitChecker())).repository).toBeUndefined();
    expect((await checkRefs(fs, repo, { commits: [sha] })).repository).toBeUndefined();
  });
});

describe("interpretGitResult", () => {
  it.each([
    [0, "", "yes"],
    [128, "fatal: Not a valid object name 0000000", "no"],
    [1, "", "no"],
    [128, "error: short object ID abc1234 is ambiguous\nhint: The candidates are:", "ambiguous"],
    [128, "fatal: not a git repository (or any of the parent directories): .git", "not-a-repository"],
  ])("exit %s with %j means %s", (code, stderr, expected) => {
    expect(interpretGitResult(code, stderr)).toBe(expected);
  });

  it("maps an ambiguous short SHA to the ambiguous status", async () => {
    const ambiguous: CommitChecker = { exists: async () => "ambiguous" };
    const { ok, results } = await checkRefs(fs, repo, { commits: ["abc1234"] }, ambiguous);
    expect(ok).toBe(false);
    expect(results[0].status).toBe("ambiguous");
  });
});
