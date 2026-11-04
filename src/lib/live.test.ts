// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, PhaseEngine } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { watchProject } from "./live";
import { fakeInvoke } from "./testing/fake-invoke";

const node = createNodeFs();
const human = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "made-up-agent" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omni-app-live-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function created() {
  const result = await MemoryStore.create(node, root, { name: "Live", flow: "build", mode: "full", actor: human });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.store;
}

describe("watchProject", () => {
  it("calls back within 2 seconds when another process records an event, and not before", async () => {
    const writer = await created();
    let changes = 0;
    const stop = watchProject(fakeInvoke(), root, () => changes++);
    await sleep(700); // the first read and a few checks with nothing new
    expect(changes).toBe(0);

    const startedAt = Date.now();
    await new PhaseEngine(writer).start(agent, "idea-review"); // as the MCP server or extension would
    while (changes === 0 && Date.now() - startedAt < 2000) await sleep(10);
    stop();
    expect(changes).toBeGreaterThan(0);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("calls back within 2 seconds when a tool without MCP writes a task update (issue B)", async () => {
    await created();
    let changes = 0;
    const stop = watchProject(fakeInvoke(), root, () => changes++);
    await sleep(700);
    expect(changes).toBe(0);
    const startedAt = Date.now();
    writeFileSync(join(root, ".agents", "task-updates.jsonl"), '{"tool":"Made-up Editor","task":"T-1","action":"start"}\n');
    while (changes === 0 && Date.now() - startedAt < 2000) await sleep(10);
    stop();
    expect(changes).toBeGreaterThan(0);
  });

  it("stops calling back once stopped", async () => {
    const writer = await created();
    let changes = 0;
    const stop = watchProject(fakeInvoke(), root, () => changes++);
    await sleep(100);
    stop();
    await new PhaseEngine(writer).start(agent, "idea-review");
    await sleep(1200);
    expect(changes).toBe(0);
  });

  it("reports when the project memory cannot be opened", async () => {
    const errors: string[] = [];
    const stop = watchProject(fakeInvoke(), join(root, "not-a-project"), () => {}, (message) => errors.push(message));
    while (errors.length === 0) await sleep(10);
    stop();
    expect(errors[0]).toMatch(/live updates/i);
  });
});
