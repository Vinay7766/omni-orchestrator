import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCiJobs, jobsToRun, toLocalCommand, jobEnv, verifiedMarker } from "./ci-check.mjs";

// Vitest runs from the repository root.
const realCi = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

describe("readCiJobs: CI's steps come from ci.yml itself, so the check cannot drift", () => {
  it("reads the real workflow's jobs and run steps in order", () => {
    const jobs = readCiJobs(realCi, "Linux");
    expect(jobs.map((j) => j.id)).toEqual(["test-frontend", "test-rust-backend"]);
    expect(jobs[0].runs).toEqual(["npm ci", "npm run build", "npm test"]);
    expect(jobs[1].runs[0]).toMatch(/^sudo apt-get update\nsudo apt-get install -y libwebkit2gtk-4\.1-dev/);
    expect(jobs[1].runs.slice(1)).toEqual([
      "cargo check --manifest-path src-tauri/Cargo.toml",
      "cargo test --manifest-path src-tauri/Cargo.toml --all",
    ]);
  });

  it("skips steps whose runner.os condition does not match this machine", () => {
    const rust = readCiJobs(realCi, "Windows").find((j) => j.id === "test-rust-backend");
    expect(rust.runs).toEqual([
      "cargo check --manifest-path src-tauri/Cargo.toml",
      "cargo test --manifest-path src-tauri/Cargo.toml --all",
    ]);
  });

  it("refuses a condition it cannot evaluate instead of guessing", () => {
    const yml = ["jobs:", "  a:", "    steps:", "      - name: x", "        if: github.event_name == 'push'", "        run: echo hi", ""].join("\n");
    expect(() => readCiJobs(yml, "Linux")).toThrow(/cannot evaluate/);
  });

  it("reads a made-up workflow with a multi-line run block", () => {
    const yml = [
      "jobs:",
      "  made-up-job:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - name: two lines",
      "        run: |",
      "          echo one",
      "          echo two",
      "      - run: echo three",
      "",
    ].join("\n");
    expect(readCiJobs(yml, "Linux")).toEqual([{ id: "made-up-job", runs: ["echo one\necho two", "echo three"] }]);
  });
});

describe("jobsToRun: which CI jobs a push needs", () => {
  it("skips documentation-only pushes", () => {
    expect(jobsToRun(["docs/design-notes/x.md", "README.md"])).toEqual([]);
  });

  it("runs the frontend job for app, package and npm changes", () => {
    expect(jobsToRun(["src/App.tsx"])).toEqual(["test-frontend"]);
    expect(jobsToRun(["packages/core/src/memory/refs.ts"])).toEqual(["test-frontend"]);
    expect(jobsToRun(["package-lock.json"])).toEqual(["test-frontend"]);
  });

  it("runs the Rust job for src-tauri changes", () => {
    expect(jobsToRun(["src-tauri/Cargo.lock"])).toEqual(["test-rust-backend"]);
    expect(jobsToRun(["src-tauri/src/storage/store.rs"])).toEqual(["test-rust-backend"]);
  });

  it("runs both for shared inputs: CI files, schemas, skills (embedded by Rust, tested by TypeScript), scripts", () => {
    for (const file of [".github/workflows/ci.yml", "schemas/phases.json", "skills/catalog.json", "scripts/ci-check.mjs"]) {
      expect(jobsToRun([file])).toEqual(["test-frontend", "test-rust-backend"]);
    }
  });
});

describe("toLocalCommand", () => {
  it("runs cargo through the MSVC-environment script on Windows", () => {
    expect(toLocalCommand("cargo test --manifest-path src-tauri/Cargo.toml --all", "win32", "C:/wt")).toEqual({
      command: "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:/wt/scripts/cargo-dev.ps1", "test", "--manifest-path", "src-tauri/Cargo.toml", "--all"],
    });
  });

  it("runs everything else through the shell, as CI does", () => {
    expect(toLocalCommand("npm ci", "win32", "C:/wt")).toEqual({ command: "npm ci", args: [], shell: true });
    expect(toLocalCommand("cargo check", "linux", "/wt")).toEqual({ command: "cargo check", args: [], shell: true });
  });
});

describe("jobEnv", () => {
  it("builds Rust inside each clean checkout: no shared target folder carries over between runs", () => {
    const env = jobEnv({ PATH: "x", CARGO_TARGET_DIR: "C:/shared/target" });
    expect(env.CARGO_TARGET_DIR).toBeUndefined();
    expect(env.PATH).toBe("x");
  });
});

describe("verifiedMarker: a commit checked once on this OS is not checked again at push time", () => {
  it("is specific to the exact commit and the OS", () => {
    const a = verifiedMarker("/repo/.git/ci-check-passed", "abc123", "Windows");
    expect(a).toBe("/repo/.git/ci-check-passed/abc123.Windows");
    expect(verifiedMarker("/repo/.git/ci-check-passed", "abc124", "Windows")).not.toBe(a);
    expect(verifiedMarker("/repo/.git/ci-check-passed", "abc123", "Linux")).not.toBe(a);
  });
});
