import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  it("reports the repository and that it is the project itself", async () => {
    const result = await checkRefs(fs, repo, { commits: [sha] }, createGitCommitChecker());
    expect(result.repository?.root).toBe(normalizePath(repo));
    expect(result.repository?.aboveProject).toBe(false);
  });

  it("flags a repository in a parent folder (a monorepo, or a home folder kept in git)", async () => {
    const sub = join(repo, "packages", "app");
    mkdirSync(sub, { recursive: true });
    const result = await checkRefs(fs, sub, { commits: [sha] }, createGitCommitChecker());
    expect(result.repository?.root).toBe(normalizePath(repo));
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
