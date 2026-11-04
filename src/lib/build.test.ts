// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, PhaseEngine, TaskEngine } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { handInBuild } from "./build";
import { DESKTOP_PERSON } from "./decisions";
import { fakeInvoke, appStoreOptions } from "./testing/fake-invoke";

// Issue C (2026-11-04): when every task is done but no tool handed in the build, the person can.

const node = createNodeFs();
const agent = { kind: "agent" as const, tool: "made-up-agent", model: "m" };
let root: string;
let store: MemoryStore;

async function finish(taskId: string, file: string) {
  const tasks = new TaskEngine(store);
  await tasks.markTrivial(agent, taskId, "small");
  await tasks.start(agent, taskId);
  await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
  const done = await tasks.complete(agent, {
    taskId, summary: `${taskId} done`, skillsUsed: [{ skill: "test-driven-development", evidence: `${taskId}: test first` }],
    tests: { command: "npm test", exitCode: 0, outputTail: "Tests 1 passed (1)" }, refs: { files: [file] },
  });
  if (!done.ok) throw new Error(JSON.stringify(done));
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-app-build-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(node, root, { name: "Orbit", flow: "build", mode: "full", actor: DESKTOP_PERSON }, appStoreOptions());
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  const phases = new PhaseEngine(store);
  for (const phase of ["idea-review", "research", "prd", "architecture"]) {
    await phases.start(agent, phase);
    await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
    await phases.submit(agent, { phase, documents: [".agents/project.json"], skillsUsed: [{ skill: "x", evidence: "y" }], understandingCheck: ".agents/project.json", ...(phase === "architecture" ? { stackAdr: ".agents/project.json" } : {}) });
    await phases.approve(DESKTOP_PERSON, phase);
  }
  await phases.start(DESKTOP_PERSON, "build");
  const tasks = new TaskEngine(store);
  await tasks.create(agent, { taskId: "T-1", title: "Data" });
  await tasks.create(agent, { taskId: "T-2", title: "Screen" });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("handInBuild", () => {
  it("hands in the build as the person, with the files and skill evidence from the finished tasks", async () => {
    await finish("T-1", ".agents/project.json");
    await finish("T-2", ".agents/summary.md");
    const r = await handInBuild(fakeInvoke(), root);
    expect(r).toMatchObject({ ok: true });
    expect((await store.readState()).phases.build?.status).toBe("awaiting_review");
    const submitted = (await store.readEvents()).events.find((e) => e.type === "phase_submitted" && (e.payload as { phase: string }).phase === "build");
    expect(submitted?.actor).toEqual(DESKTOP_PERSON);
    expect((submitted?.payload as { documents: string[] }).documents).toEqual([".agents/project.json", ".agents/summary.md"]);
    expect(JSON.stringify(submitted?.payload)).toContain("T-2: test first");
  });

  it("refuses while a task is not done, and says which", async () => {
    await finish("T-1", ".agents/project.json");
    const r = await handInBuild(fakeInvoke(), root);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/T-2/);
    expect((await store.readState()).phases.build?.status).toBe("in_progress");
  });
});
