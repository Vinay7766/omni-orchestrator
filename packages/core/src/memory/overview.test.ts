import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { PhaseEngine } from "../engine/phases.js";
import { projectOverview } from "./overview.js";

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "made-up-app" };
const agent = { kind: "agent" as const, tool: "made-up-agent", model: "made-up-model" };

let root: string;
let store: MemoryStore;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-overview-"));
  const created = await MemoryStore.create(fs, root, { name: "Orbit planner", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const task = async (taskId: string, title: string, steps: ("trivial" | "start" | "done")[]) => {
  await store.appendEvent({ type: "task_created", actor: agent, payload: { taskId, title } });
  for (const step of steps) {
    if (step === "trivial") await store.appendEvent({ type: "task_marked_trivial", actor: agent, payload: { taskId, reason: "small" } });
    if (step === "start") await store.appendEvent({ type: "task_started", actor: agent, payload: { taskId } });
    if (step === "done") {
      await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
      const r = await store.appendEvent({
        type: "task_completed",
        actor: agent,
        payload: { taskId, summary: "done", skillsUsed: [{ skill: "x", evidence: "y" }], tests: { command: "t", exitCode: 0, outputTail: "ok" } },
        refs: { files: ["a.ts"] },
      });
      if (!r.ok) throw new Error(JSON.stringify(r));
    }
  }
};

describe("projectOverview", () => {
  it("describes a brand-new project", async () => {
    const o = await projectOverview(store);
    expect(o).toMatchObject({
      name: "Orbit planner",
      flow: "build",
      mode: "full",
      phase: { id: null, status: null },
      tasks: { total: 0, done: 0, inProgress: [], next: null },
      issues: 0,
    });
    expect(o.lastActivity).toMatchObject({ type: "project_created", actor: person });
    expect(Number.isNaN(Date.parse(o.lastActivity!.time))).toBe(false);
  });

  it("gives the phase, task progress and the latest activity", async () => {
    await new PhaseEngine(store).start(agent, "idea-review");
    await task("T-1", "Schema", ["trivial", "start", "done"]);
    await task("T-2", "Parser", ["trivial", "start"]);
    await task("T-3", "Screens", []);
    const o = await projectOverview(store);
    expect(o.phase).toEqual({ id: "idea-review", status: "in_progress" });
    expect(o.tasks).toEqual({ total: 3, done: 1, inProgress: ["T-2"], next: "T-3" });
    expect(o.lastActivity).toMatchObject({ type: "task_created", actor: agent }); // T-3, the latest event
  });

  it("counts event lines it could not read, instead of hiding them", async () => {
    appendFileSync(join(root, ".agents", "events.jsonl"), "{ not an event\n");
    expect((await projectOverview(store)).issues).toBe(1);
  });
});
