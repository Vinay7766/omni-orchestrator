import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/store.js";
import { createNodeFs } from "../memory/node-fs.js";
import { PhaseEngine } from "../engine/phases.js";
import { TaskEngine } from "../engine/tasks.js";
import { importTaskUpdates, TASK_UPDATES_FILE } from "./task-updates.js";

// Issue B/C (2026-11-04): a tool without MCP records its task progress as lines in
// .agents/task-updates.jsonl; the app applies them with the same rules as the MCP tools.

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "omni-desktop", model: "m" };
let root: string;
let store: MemoryStore;

const note = {
  formatVersion: 1, taskId: "T-1", problem: "Store notes", constraints: ["local only"],
  approaches: [{ name: "files", idea: "one file per note", complexity: "O(1)", risks: "many files" }],
  chosen: "files", reason: "simple", switchIf: "over 10k notes", edgeCases: ["empty note"],
  generalisationCheck: "no named examples", assumptions: [], singleApproachReason: "only one fits",
};
const done = {
  tool: "Made-up Editor", model: "made-up-model", task: "T-1", action: "complete",
  summary: "Notes are stored", skillsUsed: [{ skill: "test-driven-development", evidence: "test written first, failed, then passed" }], tests: { command: "npm test", exitCode: 0, outputTail: "Tests 3 passed (3)" },
  refs: { files: ["src/notes.ts"] },
  memoryUpdate: { files: [".agents/summary.md"] },
};
const write = (...lines: unknown[]) => appendFileSync(join(root, ".agents", TASK_UPDATES_FILE), lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
const task = async (id: string) => (await store.readState()).tasks.find((t) => t.id === id);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-task-updates-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "Notes", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  const phases = new PhaseEngine(store);
  for (const phase of ["idea-review", "research", "prd", "architecture"]) {
    await phases.start(agent, phase);
    await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
    await phases.submit(agent, { phase, documents: [".agents/project.json"], skillsUsed: [{ skill: "x", evidence: "y" }], understandingCheck: ".agents/project.json", ...(phase === "architecture" ? { stackAdr: ".agents/project.json" } : {}) });
    await phases.approve(person, phase);
  }
  await phases.start(person, "build");
  await new TaskEngine(store).create(agent, { taskId: "T-1", title: "Store notes" });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("importTaskUpdates", () => {
  it("does nothing when no tool has written updates", async () => {
    expect(await importTaskUpdates(store)).toEqual({ applied: [], refused: [] });
  });

  it("applies a tool's design note, start and completion, in order, as that tool", async () => {
    write({ tool: "Made-up Editor", task: "T-1", action: "design", note }, { tool: "Made-up Editor", task: "T-1", action: "start" }, done);
    const result = await importTaskUpdates(store);
    expect(result.refused).toEqual([]);
    expect(result.applied).toHaveLength(3);
    expect((await task("T-1"))?.status).toBe("done");
    const completed = (await store.readEvents()).events.find((e) => e.type === "task_completed");
    expect(completed?.actor).toEqual({ kind: "agent", tool: "Made-up Editor", model: "made-up-model" });
    expect(existsSync(join(root, ".agents", TASK_UPDATES_FILE))).toBe(false);
  });

  it("refuses an update the rules do not allow, records why as a problem, and changes nothing", async () => {
    write({ ...done, tests: { command: "npm test", exitCode: 1, outputTail: "1 failed" } });
    const result = await importTaskUpdates(store);
    expect(result.applied).toEqual([]);
    expect(result.refused[0].reason).toMatch(/./);
    expect((await task("T-1"))?.status).toBe("todo");
    const problem = (await store.readEvents()).events.find((e) => e.type === "problem_recorded");
    expect(JSON.stringify(problem?.payload)).toContain("T-1");
  });

  it("records a line it cannot read as a problem instead of dropping it", async () => {
    write("this is not json");
    const result = await importTaskUpdates(store);
    expect(result.refused).toHaveLength(1);
    expect(JSON.stringify((await store.readEvents()).events.at(-1)?.payload)).toContain("this is not json");
  });

  it("hands in the build phase for review when the tool says the build is done", async () => {
    write(
      { tool: "Made-up Editor", task: "T-1", action: "trivial", reason: "one line" },
      { tool: "Made-up Editor", task: "T-1", action: "start" },
      done,
      { tool: "Made-up Editor", action: "submit_phase", phase: "build", documents: ["src/notes.ts"], skillsUsed: [{ skill: "test-driven-development", evidence: "tests first" }], memoryUpdate: { files: [".agents/summary.md"] } },
    );
    const result = await importTaskUpdates(store);
    expect(result.refused).toEqual([]);
    expect((await store.readState()).phases.build?.status).toBe("awaiting_review");
  });

  it("applies updates written while it was working the next time, never losing them", async () => {
    write({ tool: "Made-up Editor", task: "T-1", action: "trivial", reason: "one line" });
    await importTaskUpdates(store);
    write({ tool: "Made-up Editor", task: "T-1", action: "start" });
    expect((await importTaskUpdates(store)).applied).toHaveLength(1);
    expect((await task("T-1"))?.status).toBe("in_progress");
    expect(readFileSync(join(root, ".agents", "events.jsonl"), "utf8")).toContain("task_started");
  });
});
