#!/usr/bin/env node
/**
 * Runs CI's steps before a push, in clean checkouts, so "green here" means "green from a
 * clean start" (git-workflow-and-versioning skill, "Verify the Way CI Does").
 *
 * - The steps are read from .github/workflows/ci.yml itself, so this check cannot drift.
 * - One fresh `git worktree` per CI job, as CI gives each job its own checkout: leftovers
 *   from one job (for example dist/ from the frontend build) can't hide a failure in another.
 * - Only this machine's OS is run; other platforms are still CI's job.
 * - Rust builds inside each checkout and is deleted with it. No shared cache: an interrupted
 *   build once left a shared cache's debug-symbol files damaged (MSVC LNK1318), which then
 *   blocked every later push although the code was fine.
 *
 * Usage: `npm run ci:check` (checks HEAD), or as the pre-push hook (scripts/hooks/pre-push).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FRONTEND = "test-frontend";
const RUST = "test-rust-backend";
const RUNNER_OS = { win32: "Windows", darwin: "macOS", linux: "Linux" };
const ZERO_SHA = /^0+$/;

/** Evaluates a step's `if:`. Only `runner.os == / != '<OS>'` is understood; anything else throws. */
function conditionHolds(expression, runnerOs) {
  const match = /^runner\.os\s*(==|!=)\s*'([^']+)'$/.exec(expression.trim());
  if (!match) throw new Error(`ci-check: cannot evaluate the step condition "${expression}"; extend conditionHolds()`);
  return match[1] === "==" ? match[2] === runnerOs : match[2] !== runnerOs;
}

/**
 * The jobs in a GitHub Actions workflow and, for each, the `run:` commands that apply on
 * `runnerOs` ("Windows", "macOS", "Linux"), in order. Reads the layout used by ci.yml
 * (jobs at 2 spaces, step items at 6, step keys at 8).
 */
export function readCiJobs(text, runnerOs) {
  const lines = text.split(/\r?\n/);
  const jobs = [];
  let inJobs = false;
  let job = null;
  let step = null;

  const finishStep = () => {
    if (job && step?.run !== undefined && (step.if === undefined || conditionHolds(step.if, runnerOs))) {
      job.runs.push(step.run);
    }
    step = null;
  };

  const setKey = (key, value, index) => {
    if (key !== "run" && key !== "if") return index;
    if (key === "run" && /^[|>]-?$/.test(value)) {
      const block = [];
      let i = index + 1;
      while (i < lines.length && (lines[i].trim() === "" || /^ {9,}/.test(lines[i]))) block.push(lines[i++]);
      while (block.length && block[block.length - 1].trim() === "") block.pop();
      const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
      step.run = block.map((l) => l.slice(indent)).join("\n");
      return i - 1;
    }
    step[key] = value.replace(/^(['"])(.*)\1$/, "$2");
    return index;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (/^\S/.test(line)) {
      finishStep();
      inJobs = /^jobs:\s*$/.test(line);
      continue;
    }
    if (!inJobs) continue;
    let m;
    if ((m = /^ {2}([\w-]+):\s*$/.exec(line))) {
      finishStep();
      job = { id: m[1], runs: [] };
      jobs.push(job);
    } else if (job && (m = /^ {6}- (?:([\w-]+):\s?(.*))?$/.exec(line))) {
      finishStep();
      step = {};
      if (m[1]) i = setKey(m[1], m[2].trim(), i);
    } else if (step && (m = /^ {8}([\w-]+):\s?(.*)$/.exec(line))) {
      i = setKey(m[1], m[2].trim(), i);
    }
  }
  finishStep();
  return jobs;
}

/** Which CI jobs a set of changed files needs (docs-only changes need none). */
export function jobsToRun(files) {
  const needed = new Set();
  for (const file of files) {
    if (/^(docs\/|[^/]+\.md$|LICENSE$)/.test(file)) continue;
    if (/^(\.github\/|schemas\/|skills\/|scripts\/)/.test(file)) {
      needed.add(FRONTEND);
      needed.add(RUST);
    } else if (file.startsWith("src-tauri/")) {
      needed.add(RUST);
    } else {
      needed.add(FRONTEND);
    }
  }
  return [FRONTEND, RUST].filter((id) => needed.has(id));
}

/** How to run one CI command here. On Windows cargo needs the MSVC environment script. */
export function toLocalCommand(run, platform, worktree) {
  if (platform === "win32" && /^cargo\s/.test(run)) {
    return {
      command: "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `${worktree}/scripts/cargo-dev.ps1`, ...run.split(/\s+/).slice(1)],
    };
  }
  return { command: run, args: [], shell: true };
}

/**
 * Where a pass is recorded: one empty file per commit and OS. The same commit on the same OS
 * gives the same result, so a push of an already-verified commit, or a retried push, does not
 * repeat the check. Routine: `npm run ci:check`, then `git push`.
 */
export function verifiedMarker(markerDir, sha, runnerOs) {
  return `${markerDir.replace(/\\/g, "/")}/${sha}.${runnerOs}`;
}

/** The environment for CI steps: Rust builds in the checkout's own target folder. */
export function jobEnv(baseEnv) {
  const env = { ...baseEnv };
  delete env.CARGO_TARGET_DIR;
  return env;
}

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** The commits to check: from the pre-push hook's stdin, or HEAD for a manual run. */
function pushedRanges(repo, prePush) {
  const ranges = [];
  // Same line format git gives the hook: <local ref> <local sha> <remote ref> <remote sha>.
  // A manual run checks HEAD against origin/main ("0" = nothing pushed yet).
  const input = prePush ? readFileSync(0, "utf8") : `HEAD ${git(["rev-parse", "HEAD"], repo)} - 0`;
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(" ");
    if (ZERO_SHA.test(localSha)) continue; // deleting a branch
    let base = remoteSha && !ZERO_SHA.test(remoteSha) ? remoteSha : null;
    if (!base) {
      try {
        base = git(["merge-base", localSha, "origin/main"], repo);
      } catch {
        base = null; // no common history: check everything
      }
    }
    const files = base ? git(["diff", "--name-only", base, localSha], repo).split(/\r?\n/).filter(Boolean) : ["(all)"];
    ranges.push({ sha: localSha, files });
  }
  return ranges;
}

function runJob(repo, sha, job) {
  const worktree = mkdtempSync(join(tmpdir(), "omni-ci-check-"));
  const env = jobEnv(process.env);
  git(["worktree", "add", "--detach", worktree, sha], repo);
  try {
    for (const run of job.runs) {
      const title = run.split("\n")[0];
      if (/^sudo\s/.test(run)) {
        console.log(`[ci-check] ${job.id}: skipped "${title}" (installs system packages; CI does this)`);
        continue;
      }
      console.log(`[ci-check] ${job.id}: ${title}`);
      const { command, args, shell } = toLocalCommand(run, process.platform, worktree.replace(/\\/g, "/"));
      const result = spawnSync(command, args, { cwd: worktree, stdio: "inherit", shell: shell ?? false, env });
      if (result.status !== 0) return `${job.id} failed at "${title}"`;
    }
    return null;
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    git(["worktree", "prune"], repo);
  }
}

function main() {
  const prePush = process.argv.includes("--pre-push");
  const repo = git(["rev-parse", "--show-toplevel"]);
  const runnerOs = RUNNER_OS[process.platform];
  if (!runnerOs) throw new Error(`ci-check: unsupported platform ${process.platform}`);

  const markerDir = git(["rev-parse", "--path-format=absolute", "--git-path", "ci-check-passed"], repo);
  for (const { sha, files } of pushedRanges(repo, prePush)) {
    const needed = files[0] === "(all)" ? [FRONTEND, RUST] : jobsToRun(files);
    if (needed.length === 0) {
      console.log(`[ci-check] ${sha.slice(0, 7)}: documentation only, no CI steps needed`);
      continue;
    }
    const marker = verifiedMarker(markerDir, sha, runnerOs);
    if (existsSync(marker)) {
      console.log(`[ci-check] ${sha.slice(0, 7)}: already verified on ${runnerOs} by an earlier run of this check; not repeated`);
      continue;
    }
    const workflow = git(["show", `${sha}:.github/workflows/ci.yml`], repo);
    const jobs = readCiJobs(workflow, runnerOs).filter((j) => needed.includes(j.id));
    console.log(`[ci-check] ${sha.slice(0, 7)}: running ${jobs.map((j) => j.id).join(", ")} on ${runnerOs} in clean checkouts`);
    for (const job of jobs) {
      const failure = runJob(repo, sha, job);
      if (failure) {
        console.error(`\n[ci-check] BLOCKED: ${failure}. Fix it, commit, and push again.`);
        process.exit(1);
      }
    }
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(marker, "");
    console.log(`[ci-check] ${sha.slice(0, 7)}: all CI steps passed on ${runnerOs}. Other platforms are checked by CI after the push.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
