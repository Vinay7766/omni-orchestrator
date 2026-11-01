import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { renderSummary, renderDecisions, renderProblems, renderLessons, refreshMemoryDocs } from "./docs.js";
import { PhaseEngine } from "../engine/phases.js";
import { TaskEngine } from "../engine/tasks.js";

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "any-ai-tool" };
const skillsUsed = [{ skill: "idea-review", evidence: "reviewed with sources" }];

let root: string;
let store: MemoryStore;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-docs-"));
  const created = await MemoryStore.create(fs, root, { name: "Clinic scheduler", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const render = async () => {
  const { events } = await store.readEvents();
  return { project: store.readProject(), state: await store.readState(), events };
};
const record = (type: "decision_recorded" | "problem_recorded" | "lesson_recorded", payload: Record<string, unknown>, refs?: object) =>
  store.appendEvent({ type, actor: agent, payload, ...(refs ? { refs } : {}) });

describe("renderSummary", () => {
  it("tells a brand-new project what to do first", async () => {
    const { project, state, events } = await render();
    const md = renderSummary(project, state, events);
    expect(md).toMatch(/^# Clinic scheduler/);
    expect(md).toMatch(/build flow/);
    expect(md).toMatch(/Next: start "idea-review"/);
  });

  it("says a person must review a submitted phase, and lists the phase table", async () => {
    const phases = new PhaseEngine(store);
    await phases.start(agent, "idea-review");
    await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
    await phases.submit(agent, { phase: "idea-review", documents: ["docs/IDEA.md"], skillsUsed, understandingCheck: "docs/u.md" });
    const { project, state, events } = await render();
    const md = renderSummary(project, state, events);
    expect(md).toMatch(/"idea-review" is waiting for a person to review it/);
    expect(md).toMatch(/\| idea-review \| awaiting_review \|/);
  });

  it("lists open tasks with their status and design note", async () => {
    await new PhaseEngine(store).start(agent, "idea-review");
    const tasks = new TaskEngine(store);
    await tasks.create(agent, { taskId: "T-1", title: "Memory store" });
    await tasks.create(agent, { taskId: "T-2", title: "Fix typo" });
    await tasks.markTrivial(agent, "T-2", "one word");
    const { project, state, events } = await render();
    const md = renderSummary(project, state, events);
    expect(md).toMatch(/\| T-1 \| Memory store \| todo \|/);
    expect(md).toMatch(/\| T-2 \| Fix typo \| designed \|/);
  });

  it("lists recently completed tasks with their tests, marked as reported by the tool (HON-4)", async () => {
    await new PhaseEngine(store).start(agent, "idea-review");
    const tasks = new TaskEngine(store);
    for (let i = 1; i <= 6; i++) {
      const taskId = `T-${i}`;
      await tasks.create(agent, { taskId, title: `Task ${i}` });
      await tasks.markTrivial(agent, taskId, "small");
      await tasks.start(agent, taskId);
      await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
      const done = await tasks.complete(agent, {
        taskId,
        summary: `Did ${i}`,
        skillsUsed: [{ skill: "made-up-skill", evidence: "red then green" }],
        tests: { command: `npm test -- part${i}`, exitCode: 0, outputTail: "ok" },
        refs: { files: ["src/a.ts"] },
      });
      expect(done.ok).toBe(true);
    }
    const { project, state, events } = await render();
    const recent = renderSummary(project, state, events).split("## Recently completed")[1]?.split("\n## ")[0] ?? "";
    expect(recent).toContain(`T-6 Task 6: Did 6. Tests: \`npm test -- part6\` exit 0, reported by ${agent.tool} (not re-run)`);
    expect(recent).toContain("T-2 Task 2");
    expect(recent).not.toContain("T-1 Task 1");
    expect(recent.indexOf("T-6")).toBeLessThan(recent.indexOf("T-2"));
  });

  it("keeps the summary short: 5 latest decisions and 10 latest events", async () => {
    for (let i = 1; i <= 8; i++) await record("decision_recorded", { title: `Decision ${i}`, decision: "d", reason: "r" });
    for (let i = 1; i <= 15; i++) await record("lesson_recorded", { lesson: `Lesson ${i}` });
    const { project, state, events } = await render();
    const md = renderSummary(project, state, events);
    expect(md).toContain("Decision 8");
    expect(md).toContain("Decision 4");
    expect(md).not.toContain("Decision 3");
    const activity = md.split("## Recent activity")[1];
    expect(activity.trim().split("\n").filter((l) => l.startsWith("- "))).toHaveLength(10);
  });

  it("shows only open problems, using each problem's latest status", async () => {
    await record("problem_recorded", { title: "Lock contention", details: "slow", status: "open" });
    await record("problem_recorded", { title: "Flaky test", details: "windows", status: "open" });
    await record("problem_recorded", { title: "Flaky test", details: "fixed by retry", status: "resolved" });
    const { project, state, events } = await render();
    const md = renderSummary(project, state, events);
    expect(md).toContain("Lock contention");
    expect(md.split("## Open problems")[1].split("##")[0]).not.toContain("Flaky test");
  });

  it("keeps table layout intact when text contains pipes or line breaks", async () => {
    await new PhaseEngine(store).start(agent, "idea-review");
    await new TaskEngine(store).create(agent, { taskId: "T-1", title: "Parse a | b\nand more" });
    const { project, state, events } = await render();
    const row = renderSummary(project, state, events).split("\n").find((l) => l.startsWith("| T-1"));
    expect(row).toBe("| T-1 | Parse a \\| b and more | todo |  |");
  });
});

describe("dedicated documents", () => {
  it("lists every decision with its reason and references, newest first", async () => {
    await record("decision_recorded", { title: "Use plain files", decision: "events.jsonl", reason: "hand-editable" }, { files: ["ARCHITECTURE.md"] });
    await record("decision_recorded", { title: "Lock file", decision: "exclusive create", reason: "works in every runtime" });
    const { events } = await render();
    const md = renderDecisions(events);
    expect(md.indexOf("Lock file")).toBeLessThan(md.indexOf("Use plain files"));
    expect(md).toContain("hand-editable");
    expect(md).toContain("ARCHITECTURE.md");
  });

  it("groups problems by latest status", async () => {
    await record("problem_recorded", { title: "Flaky test", details: "windows", status: "open" });
    await record("problem_recorded", { title: "Flaky test", details: "fixed", status: "resolved" });
    const { events } = await render();
    expect(renderProblems(events)).toMatch(/## Resolved[\s\S]*Flaky test/);
  });

  it("lists lessons newest first so every tool sees corrections (UND-5)", async () => {
    await record("lesson_recorded", { lesson: "Named tools are examples of a category" });
    await record("lesson_recorded", { lesson: "Ask before generalising scope" });
    const { events } = await render();
    const md = renderLessons(events);
    expect(md.indexOf("Ask before")).toBeLessThan(md.indexOf("Named tools"));
  });
});

describe("refreshMemoryDocs and automatic refresh", () => {
  it("writes all four documents into .agents", async () => {
    await refreshMemoryDocs(store);
    for (const name of ["summary.md", "decisions.md", "problems.md", "lessons.md"]) {
      expect(existsSync(join(root, ".agents", name)), name).toBe(true);
    }
  });

  it("keeps the action and returns a warning when the documents cannot be refreshed", async () => {
    // A file system that refuses to replace summary.md (for example, a full or locked disk).
    const failing = { ...fs, rename: async (from: string, to: string) => (to.endsWith("summary.md") ? Promise.reject(new Error("disk is locked")) : fs.rename(from, to)) };
    const opened = await MemoryStore.open(failing, root);
    if (!opened.ok) throw new Error("open failed");
    const result = await new PhaseEngine(opened.store).start(agent, "idea-review");
    expect(result.ok).toBe(true);
    expect(result.ok && result.warning).toMatch(/disk is locked/);
    expect((await opened.store.readState()).phases["idea-review"].status).toBe("in_progress");
  });

  it("refreshes the documents after engine actions without recording a memory update", async () => {
    await new PhaseEngine(store).start(agent, "idea-review");
    expect(readFileSync(join(root, ".agents", "summary.md"), "utf8")).toMatch(/"idea-review" is in progress/);
    const types = (await store.readEvents()).events.map((e) => e.type);
    expect(types).not.toContain("memory_updated");
  });
});
