import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, PhaseEngine, type CatalogEntry, type SkillSource } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { createTasks, markTaskTrivial, submitDesignNote } from "./task-tools.js";

const fs = createNodeFs();
const actor = { kind: "agent" as const, tool: "made-up-client" };

const entry = (id: string, phases: string[]): CatalogEntry => ({
  id,
  name: `Skill ${id}`,
  description: `A made-up skill called ${id}.`,
  category: "engineering",
  attribution: { name: "Someone", sourceUrl: "https://example.com", verified: true },
  enabled: true,
  isCustom: false,
  license: "MIT",
  phases,
  domains: ["testing"],
});
export const skills: SkillSource = {
  list: async () => ({ ok: true, entries: [entry("made-up-tdd", ["build"]), entry("made-up-review", ["build"]), entry("always", ["all"])] }),
  readContent: async (id) => `# ${id}\nFollow ${id}.\n`,
};

let root: string;
let store: MemoryStore;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-mcp-tasks-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "Orbit planner", flow: "build", mode: "full", actor });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  const started = await new PhaseEngine(store).start(actor, "idea-review");
  if (!started.ok) throw new Error(JSON.stringify(started));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const deps = () => ({ fs, skills, startDir: root });
const eventTypes = async () => (await store.readEvents()).events.map((e) => e.type);
const taskIds = async () => (await store.readState()).tasks.map((t) => t.id);

const note = (taskId: string) => ({
  formatVersion: 1,
  taskId,
  problem: "Parse made-up input",
  constraints: ["inputs up to 1 MB"],
  approaches: [
    { name: "regex", idea: "one pattern", complexity: "O(n)", risks: "hard to read" },
    { name: "tokenizer", idea: "small lexer", complexity: "O(n)", risks: "more code" },
  ],
  chosen: "tokenizer",
  reason: "clearer errors",
  switchIf: "inputs exceed 10 MB",
  edgeCases: ["empty input"],
  generalisationCheck: "no named formats",
  assumptions: [],
});

describe("create_tasks", () => {
  it("creates several tasks in order", async () => {
    const result = await createTasks(deps(), actor, { tasks: [{ taskId: "T-1", title: "Parser" }, { taskId: "T-2", title: "Screens", requirements: ["APP-1"] }] });
    if (!result.ok) throw new Error(result.message);
    expect(result.value.created).toEqual(["T-1", "T-2"]);
    expect(await taskIds()).toEqual(["T-1", "T-2"]);
  });

  it("creates nothing when one id is repeated or already exists", async () => {
    await createTasks(deps(), actor, { tasks: [{ taskId: "T-1", title: "Parser" }] });
    const before = await eventTypes();
    for (const tasks of [
      [{ taskId: "T-2", title: "a" }, { taskId: "T-2", title: "b" }],
      [{ taskId: "T-3", title: "a" }, { taskId: "T-1", title: "again" }],
    ]) {
      const result = await createTasks(deps(), actor, { tasks });
      expect(result.ok).toBe(false);
    }
    expect(await eventTypes()).toEqual(before);
  });

  it("creates nothing when a later task in the batch is malformed", async () => {
    for (const bad of [{ taskId: "has space", title: "x" }, { taskId: "T-9", title: " " }, { taskId: "T-9", title: "t".repeat(301) }]) {
      const result = await createTasks(deps(), actor, { tasks: [{ taskId: "T-1", title: "Fine" }, bad] });
      expect(result.ok, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
    expect(await taskIds()).toEqual([]);
  });

  it("creates nothing while the phase is under review", async () => {
    await store.appendEvent({ type: "memory_updated", actor, payload: { files: [".agents/summary.md"] } });
    await store.appendEvent({ type: "phase_submitted", actor, payload: { phase: "idea-review", documents: ["a.md"], skillsUsed: [{ skill: "x", evidence: "y" }], understandingCheck: "u.md" } });
    const result = await createTasks(deps(), actor, { tasks: [{ taskId: "T-1", title: "Parser" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/under review/);
    expect(await taskIds()).toEqual([]);
  });
});

describe("submit_design_note and mark_task_trivial", () => {
  beforeEach(async () => {
    await createTasks(deps(), actor, { tasks: [{ taskId: "T-1", title: "Parser" }, { taskId: "T-2", title: "Typo" }] });
  });

  it("saves a valid design note and marks the task designed", async () => {
    const result = await submitDesignNote(deps(), actor, { note: note("T-1") });
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toEqual({ taskId: "T-1", status: "designed", notePath: ".agents/design-notes/T-1.json" });
    expect(existsSync(join(root, ".agents", "design-notes", "T-1.json"))).toBe(true);
  });

  it("rejects an invalid note with the problems and writes nothing", async () => {
    const before = await eventTypes();
    const { approaches: _, ...incomplete } = note("T-1");
    const result = await submitDesignNote(deps(), actor, { note: incomplete });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/approaches/);
    expect(await eventTypes()).toEqual(before);
    expect(existsSync(join(root, ".agents", "design-notes", "T-1.json"))).toBe(false);
  });

  it("marks a task trivial with a reason", async () => {
    const result = await markTaskTrivial(deps(), actor, { taskId: "T-2", reason: "One-word typo fix" });
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toEqual({ taskId: "T-2", status: "designed" });
  });

  it("refuses to mark a designed task trivial", async () => {
    await submitDesignNote(deps(), actor, { note: note("T-1") });
    const result = await markTaskTrivial(deps(), actor, { taskId: "T-1", reason: "skip it" });
    expect(result.ok).toBe(false);
  });
});

// --- start_task (SKL-4) and complete_task (SKL-8, HON-4, MEM-3, MEM-4).

import { mkdirSync, writeFileSync } from "node:fs";
import type { CommitChecker } from "@omni/core";
import { completeTask, startTask, type CompleteInput } from "./task-tools.js";

const commits: CommitChecker = { exists: async (_root, sha) => (sha === "abc1234" ? "yes" : "no") };

async function buildPhaseWithTask() {
  // Move to the build phase: approve the planning phases quickly through the store.
  const person = { kind: "human" as const, tool: "made-up-app" };
  const phases = new PhaseEngine(store);
  for (const phase of ["idea-review", "research", "prd", "architecture"]) {
    if (phase !== "idea-review") await phases.start(actor, phase);
    await store.appendEvent({ type: "memory_updated", actor, payload: { files: [".agents/summary.md"] } });
    await phases.submit(actor, { phase, documents: ["a.md"], skillsUsed: [{ skill: "x", evidence: "y" }], understandingCheck: "u.md" });
    const approved = await phases.approve(person, phase);
    if (!approved.ok) throw new Error(JSON.stringify(approved));
  }
  await phases.start(actor, "build");
  await createTasks(deps(), actor, { tasks: [{ taskId: "T-1", title: "Parser" }] });
  await markTaskTrivial(deps(), actor, { taskId: "T-1", reason: "small" });
}
const withCommits = () => ({ ...deps(), commits });
const status = async () => (await store.readState()).tasks.find((t) => t.id === "T-1")?.status;

describe("start_task", () => {
  beforeEach(buildPhaseWithTask);

  it("first returns the declared skills' full text and does not start", async () => {
    const result = await startTask(deps(), actor, { taskId: "T-1" });
    if (!result.ok) throw new Error(result.message);
    expect(result.value.started).toBe(false);
    expect(result.value.declaredSkills).toEqual([
      { id: "made-up-tdd", name: "Skill made-up-tdd", content: "# made-up-tdd\nFollow made-up-tdd.\n" },
      { id: "made-up-review", name: "Skill made-up-review", content: "# made-up-review\nFollow made-up-review.\n" },
    ]);
    expect(result.value.message).toMatch(/acknowledgedSkills/);
    expect(await status()).toBe("designed");
  });

  it("starts once every declared skill is acknowledged, and records them", async () => {
    const result = await startTask(deps(), actor, { taskId: "T-1", acknowledgedSkills: ["made-up-tdd", "made-up-review"] });
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toMatchObject({ started: true, declaredSkills: [{ id: "made-up-tdd" }, { id: "made-up-review" }] });
    expect(await status()).toBe("in_progress");
    const started = (await store.readEvents()).events.at(-1)!;
    expect(started.payload).toEqual({ taskId: "T-1", declaredSkills: ["made-up-tdd", "made-up-review"] });
  });

  it("still does not start with only some skills acknowledged", async () => {
    const result = await startTask(deps(), actor, { taskId: "T-1", acknowledgedSkills: ["made-up-tdd"] });
    if (!result.ok) throw new Error(result.message);
    expect(result.value.started).toBe(false);
    expect(result.value.message).toMatch(/made-up-review/);
    expect(await status()).toBe("designed");
  });

  it("is an error, not a skills list, when the task cannot start anyway", async () => {
    await createTasks(deps(), actor, { tasks: [{ taskId: "T-2", title: "No design" }] });
    const result = await startTask(deps(), actor, { taskId: "T-2" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no design note/);
  });
});

describe("complete_task", () => {
  beforeEach(async () => {
    await buildPhaseWithTask();
    await startTask(deps(), actor, { taskId: "T-1", acknowledgedSkills: ["made-up-tdd", "made-up-review"] });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "parser.ts"), "export {};\n");
  });

  const done = (overrides: Partial<CompleteInput> = {}): CompleteInput => ({
    taskId: "T-1",
    summary: "Parser reads made-up input",
    skillsUsed: [
      { skill: "made-up-tdd", evidence: "failing run, then passing run" },
      { skill: "made-up-review", evidence: "reviewed by the user" },
    ],
    tests: { command: "npm test", exitCode: 0, outputTail: "3 passed" },
    refs: { files: ["src/parser.ts"], commits: ["abc1234"] },
    memoryUpdate: { files: ["src/parser.ts"] },
    ...overrides,
  });

  it("completes the task and says the tests were taken as reported", async () => {
    const result = await completeTask(withCommits(), actor, done());
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toMatchObject({ taskId: "T-1", status: "done" });
    expect(result.value.testsNote).toMatch(/reported by made-up-client.*not re-run/);
    expect(await status()).toBe("done");
    expect((await eventTypes()).slice(-2)).toEqual(["memory_updated", "task_completed"]);
  });

  const rejections: [string, Partial<CompleteInput>, RegExp][] = [
    ["missing evidence for a declared skill", { skillsUsed: [{ skill: "made-up-tdd", evidence: "red then green" }] }, /made-up-review/],
    ["failing tests", { tests: { command: "npm test", exitCode: 1, outputTail: "1 failed" } }, /exit code 1/],
    ["no files or commits", { refs: {} }, /files or commits/],
    ["a file that does not exist", { refs: { files: ["src/nowhere.ts"] } }, /src\/nowhere\.ts: missing/],
    ["a path outside the project", { refs: { files: ["../secret.txt"] } }, /\.\.\/secret\.txt: invalid/],
    ["an unknown commit", { refs: { commits: ["fff0000"] } }, /fff0000: missing/],
    ["no memory update", { memoryUpdate: undefined }, /update the project memory/],
  ];
  for (const [name, overrides, message] of rejections) {
    it(`rejects ${name} and writes nothing`, async () => {
      const before = await eventTypes();
      const result = await completeTask(withCommits(), actor, done(overrides));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(message);
      expect(await eventTypes()).toEqual(before);
      expect(await status()).toBe("in_progress");
    });
  }

  it("accepts commits it cannot verify, with a warning", async () => {
    const result = await completeTask(deps(), actor, done());
    if (!result.ok) throw new Error(result.message);
    expect(result.value.warnings.join(" ")).toMatch(/abc1234/);
  });
});
