import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/store.js";
import { createNodeFs } from "../memory/node-fs.js";
import { PhaseEngine } from "./phases.js";
import { TaskEngine, designNotePath } from "./tasks.js";
import { validateMemoryFile } from "../validate.js";

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "any-ai-tool" };
const skillsUsed = [{ skill: "test-driven-development", evidence: "failing run recorded before the code" }];
const passing = { command: "npm test", exitCode: 0, outputTail: "Tests 12 passed (12)" };

const note = (taskId: string, overrides: Record<string, unknown> = {}) => ({
  formatVersion: 1,
  taskId,
  problem: "Append events safely from several tools",
  constraints: ["several writers"],
  approaches: [
    { name: "lock-file", idea: "exclusive lock", complexity: "O(1)", risks: "stale lock" },
    { name: "sqlite", idea: "database", complexity: "O(log n)", risks: "not hand-editable" },
  ],
  chosen: "lock-file",
  reason: "keeps files editable",
  switchIf: "contention above 50 ms",
  edgeCases: ["crash while holding the lock"],
  generalisationCheck: "works for any number of tools; no tool names in code",
  assumptions: [],
  ...overrides,
});

let root: string;
let store: MemoryStore;
let tasks: TaskEngine;
let phases: PhaseEngine;

const memoryUpdate = () => store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
const msg = (r: { ok: boolean; issues?: { message: string }[] }) => (r.ok ? "" : r.issues!.map((i) => i.message).join(" | "));
const status = async (id: string) => (await store.readState()).tasks.find((t) => t.id === id)?.status;
const complete = (taskId: string, overrides: Record<string, unknown> = {}) =>
  tasks.complete(agent, { taskId, summary: "done", skillsUsed, tests: passing, refs: { files: ["src/a.ts"] }, ...overrides });

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-tasks-"));
  const created = await MemoryStore.create(fs, root, { name: "p", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  tasks = new TaskEngine(store);
  phases = new PhaseEngine(store);
  await phases.start(agent, "idea-review");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function designedTask(id = "T-1") {
  expect((await tasks.create(agent, { taskId: id, title: "Memory store" })).ok).toBe(true);
  const submitted = await tasks.submitDesignNote(agent, note(id));
  expect(submitted.ok, msg(submitted)).toBe(true);
}

describe("creating tasks", () => {
  it("creates a task while a phase is in progress", async () => {
    expect((await tasks.create(agent, { taskId: "T-1", title: "Memory store" })).ok).toBe(true);
    expect(await status("T-1")).toBe("todo");
  });

  it("keeps the kinds of work a task involves, for later assignment to tools (E5)", async () => {
    expect((await tasks.create(agent, { taskId: "T-1", title: "List screen", requirements: ["REQ-2"], kinds: ["interface", "tests"] })).ok).toBe(true);
    expect((await store.readState()).tasks[0]).toEqual({ id: "T-1", title: "List screen", status: "todo", kinds: ["interface", "tests"] });
  });

  it("keeps the tool and model a task is given to, with the reason (D)", async () => {
    const created = await tasks.create(agent, {
      taskId: "T-1", title: "List screen", kinds: ["interface"],
      assignedTool: "made-up-editor", assignedModel: "made-up-model-large", assignmentReason: "Strong at interface work",
    });
    expect(created.ok).toBe(true);
    expect((await store.readState()).tasks[0]).toEqual({
      id: "T-1", title: "List screen", status: "todo", kinds: ["interface"], assignedTool: "made-up-editor", assignedModel: "made-up-model-large",
    });
    const event = (await store.readEvents()).events.find((e) => e.type === "task_created");
    expect(event?.payload).toMatchObject({ assignmentReason: "Strong at interface work" });
  });

  it("refuses kinds that are not short lowercase tags", async () => {
    const result = await tasks.create(agent, { taskId: "T-1", title: "List screen", kinds: ["User Interface!"] });
    expect(result.ok).toBe(false);
  });

  it("refuses a duplicate task id", async () => {
    await tasks.create(agent, { taskId: "T-1", title: "A" });
    const again = await tasks.create(agent, { taskId: "T-1", title: "B" });
    expect(again.ok).toBe(false);
    expect(msg(again)).toMatch(/already exists/);
  });

  it("refuses to create tasks while no phase is in progress", async () => {
    await memoryUpdate();
    await phases.submit(agent, { phase: "idea-review", documents: ["docs/i.md"], skillsUsed, understandingCheck: "docs/u.md" });
    const result = await tasks.create(agent, { taskId: "T-9", title: "x" });
    expect(result.ok).toBe(false);
    expect(msg(result)).toMatch(/under review|in progress/);
  });
});

describe("design before code", () => {
  it("refuses to start a task without a design note, saying what to do", async () => {
    await tasks.create(agent, { taskId: "T-1", title: "Memory store" });
    const result = await tasks.start(agent, "T-1");
    expect(result.ok).toBe(false);
    expect(msg(result)).toMatch(/T-1 has no design note.*submit_design_note/);
  });

  it("saves a valid design note to .agents/design-notes and marks the task designed", async () => {
    await designedTask();
    const file = join(root, ".agents", "design-notes", "T-1.json");
    expect(validateMemoryFile("design-note", JSON.parse(readFileSync(file, "utf8"))).ok).toBe(true);
    const task = (await store.readState()).tasks[0];
    expect(task.status).toBe("designed");
    expect(task.designNote).toBe(".agents/design-notes/T-1.json");
  });

  it("rejects an invalid design note and writes no file and no event", async () => {
    await tasks.create(agent, { taskId: "T-1", title: "Memory store" });
    const before = (await store.readEvents()).events.length;
    for (const bad of [
      note("T-1", { approaches: [note("T-1").approaches[0]] }),
      note("T-1", { generalisationCheck: undefined }),
      note("T-1", { chosen: "not-an-approach" }),
    ]) {
      const result = await tasks.submitDesignNote(agent, JSON.parse(JSON.stringify(bad)));
      expect(result.ok).toBe(false);
    }
    expect(existsSync(join(root, ".agents", "design-notes"))).toBe(false);
    expect((await store.readEvents()).events.length).toBe(before);
  });

  it("rejects a design note that names a different task", async () => {
    await tasks.create(agent, { taskId: "T-1", title: "Memory store" });
    const result = await tasks.submitDesignNote(agent, note("T-2"));
    expect(result.ok).toBe(false);
    expect(msg(result)).toMatch(/no task "T-2"/);
    // The note is only written once the rules allow it (inside the lock).
    expect(existsSync(join(root, ".agents", "design-notes"))).toBe(false);
  });

  it("encodes characters that are not allowed in Windows file names", async () => {
    await designedTask("epic:T-7");
    expect(designNotePath("epic:T-7")).toBe(".agents/design-notes/epic%3AT-7.json");
    expect(readdirSync(join(root, ".agents", "design-notes"))).toEqual(["epic%3AT-7.json"]);
  });

  it("lets a trivial task start with a stated reason instead of a design note", async () => {
    await tasks.create(agent, { taskId: "T-2", title: "Fix typo" });
    expect((await tasks.markTrivial(agent, "T-2", "one-word text change")).ok).toBe(true);
    expect((await tasks.start(agent, "T-2")).ok).toBe(true);
  });
});

describe("completing tasks", () => {
  beforeEach(async () => {
    await designedTask();
    expect((await tasks.start(agent, "T-1")).ok).toBe(true);
  });

  it("refuses completion without a memory update since the task started", async () => {
    const result = await complete("T-1");
    expect(result.ok).toBe(false);
    expect(msg(result)).toMatch(/memory/);
  });

  it("refuses completion when the tests failed, reporting the exit code", async () => {
    await memoryUpdate();
    const result = await complete("T-1", { tests: { command: "npm test", exitCode: 1, outputTail: "1 failed" } });
    expect(result.ok).toBe(false);
    expect(msg(result)).toMatch(/exit code 1/);
    expect(await status("T-1")).toBe("in_progress");
  });

  it("refuses completion without any file or commit touched", async () => {
    await memoryUpdate();
    const result = await complete("T-1", { refs: {} });
    expect(result.ok).toBe(false);
    expect(msg(result)).toMatch(/files or commits/);
  });

  it("completes with summary, skills evidence, refs and passing tests", async () => {
    await memoryUpdate();
    const result = await complete("T-1");
    expect(result.ok, msg(result)).toBe(true);
    expect(await status("T-1")).toBe("done");
  });
});

describe("reopening and phase discipline", () => {
  it("sends a reopened task back to todo, so it needs a new design before starting", async () => {
    await designedTask();
    await tasks.start(agent, "T-1");
    await memoryUpdate();
    await complete("T-1");
    expect((await tasks.reopen(person, "T-1", "approach was wrong")).ok).toBe(true);
    expect(await status("T-1")).toBe("todo");
    expect((await tasks.start(agent, "T-1")).ok).toBe(false);
  });

  it("refuses to start work while the phase is under review", async () => {
    await designedTask();
    await memoryUpdate();
    await phases.submit(agent, { phase: "idea-review", documents: ["docs/i.md"], skillsUsed, understandingCheck: "docs/u.md" });
    const result = await tasks.start(agent, "T-1");
    expect(result.ok).toBe(false);
    expect(msg(result)).toMatch(/under review/);
  });

  it("lets only one of two tools start the same task at the same moment", async () => {
    await designedTask();
    const results = await Promise.all([tasks.start(agent, "T-1"), new TaskEngine(store).start(agent, "T-1")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("reports an unknown task clearly", async () => {
    const result = await tasks.start(agent, "T-404");
    expect(msg(result)).toMatch(/no task "T-404"/);
  });
});

describe("declared skills (SKL-4, SKL-8)", () => {
  const declared = ["made-up-tdd", "made-up-review"];

  it("refuses to start until every declared skill is acknowledged, naming the missing ones", async () => {
    await designedTask();
    const result = await tasks.start(agent, "T-1", { declared, acknowledged: ["made-up-tdd"] });
    expect(result.ok).toBe(false);
    expect(msg(result)).toMatch(/acknowledge.*made-up-review/);
    expect(msg(result)).not.toMatch(/made-up-tdd/);
    expect(await status("T-1")).toBe("designed");
  });

  it("starts once all are acknowledged and records the declared skills", async () => {
    await designedTask();
    const result = await tasks.start(agent, "T-1", { declared, acknowledged: [...declared, "extra-one"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.payload).toEqual({ taskId: "T-1", declaredSkills: declared });
  });

  it("refuses completion when a declared skill has no evidence, naming it", async () => {
    await designedTask();
    await tasks.start(agent, "T-1", { declared, acknowledged: declared });
    await memoryUpdate();
    const result = await complete("T-1", { skillsUsed: [{ skill: "made-up-tdd", evidence: "red run before the code" }] });
    expect(result.ok).toBe(false);
    expect(msg(result)).toMatch(/evidence.*made-up-review/);
    expect(await status("T-1")).toBe("in_progress");
  });

  it("completes when every declared skill has evidence, extra skills allowed", async () => {
    await designedTask();
    await tasks.start(agent, "T-1", { declared, acknowledged: declared });
    await memoryUpdate();
    const evidence = [...declared, "extra-one"].map((skill) => ({ skill, evidence: `how ${skill} was followed` }));
    expect((await complete("T-1", { skillsUsed: evidence })).ok).toBe(true);
  });

  it("uses the skills declared at the latest start after a reopen", async () => {
    await designedTask();
    await tasks.start(agent, "T-1", { declared, acknowledged: declared });
    await tasks.reopen(agent, "T-1", "approach was wrong");
    await tasks.markTrivial(agent, "T-1", "now a one-line change");
    await tasks.start(agent, "T-1", { declared: ["made-up-tdd"], acknowledged: ["made-up-tdd"] });
    await memoryUpdate();
    expect((await complete("T-1", { skillsUsed: [{ skill: "made-up-tdd", evidence: "red then green" }] })).ok).toBe(true);
  });

  it("keeps working for tasks started without declared skills (older logs)", async () => {
    await designedTask();
    expect((await tasks.start(agent, "T-1")).ok).toBe(true);
    await memoryUpdate();
    expect((await complete("T-1")).ok).toBe(true);
  });
});
