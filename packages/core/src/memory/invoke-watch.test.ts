import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { createInvokeChangeTrigger, STAMP_COMMAND } from "./invoke-watch.js";
import { watchEvents, type SyncUpdate } from "./sync.js";
import type { Invoke } from "./invoke-fs.js";

const human = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "a-tool-nobody-named" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeoutMs: number): Promise<number> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`condition not met within ${timeoutMs} ms`);
    await sleep(10);
  }
  return Date.now() - start;
}

/** What the Rust memfs_stamp command answers, done here with Node so the test runs anywhere. */
const stampInvoke: Invoke = async (command, args) => {
  if (command !== STAMP_COMMAND) throw new Error(`unexpected command ${command}`);
  const info = statSync(String(args.path), { throwIfNoEntry: false });
  return info ? `${info.size}:${info.mtimeMs}` : null;
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omni-invoke-watch-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createInvokeChangeTrigger", () => {
  it("asks the backend about events.jsonl inside the memory folder", async () => {
    const asked: unknown[] = [];
    const invoke: Invoke = async (command, args) => {
      asked.push([command, args.path]);
      return "1:1";
    };
    const stop = createInvokeChangeTrigger(invoke, "C:/p/.agents", { pollMs: 10 })(() => {});
    await until(() => asked.length >= 2, 1000);
    stop();
    expect(asked[0]).toEqual([STAMP_COMMAND, "C:/p/.agents/events.jsonl"]);
  });

  it("signals once per change, not on every check", async () => {
    let stamp: string | null = "10:1";
    let signals = 0;
    const stop = createInvokeChangeTrigger(async () => stamp, "/p/.agents", { pollMs: 10 })(() => signals++);
    await sleep(80);
    expect(signals).toBe(0);
    stamp = "20:2";
    await until(() => signals === 1, 1000);
    await sleep(80);
    expect(signals).toBe(1);
    stamp = null; // the log was removed
    await until(() => signals === 2, 1000);
    stop();
  });

  it("keeps checking after the backend fails, and stops when asked", async () => {
    let calls = 0;
    let signals = 0;
    const invoke: Invoke = async () => {
      calls++;
      if (calls === 2) throw new Error("disk not ready");
      return calls < 4 ? "1:1" : "2:2";
    };
    const stop = createInvokeChangeTrigger(invoke, "/p/.agents", { pollMs: 10 })(() => signals++);
    await until(() => signals === 1, 1000);
    stop();
    const after = calls;
    await sleep(60);
    expect(calls).toBe(after);
  });

  it("never runs two checks at once when the backend is slow", async () => {
    let running = 0;
    let most = 0;
    const invoke: Invoke = async () => {
      running++;
      most = Math.max(most, running);
      await sleep(40);
      running--;
      return "1:1";
    };
    const stop = createInvokeChangeTrigger(invoke, "/p/.agents", { pollMs: 5 })(() => {});
    await sleep(150);
    stop();
    expect(most).toBe(1);
  });

  it("with watchEvents, another writer's event reaches the reader within 2 seconds (E7)", async () => {
    const fs = createNodeFs();
    const created = await MemoryStore.create(fs, root, { name: "Live", flow: "build", mode: "full", actor: human });
    if (!created.ok) throw new Error(JSON.stringify(created.issues));
    const reader = created.store;
    const updates: SyncUpdate[] = [];
    const watch = watchEvents(reader.follow(), createInvokeChangeTrigger(stampInvoke, join(root, ".agents")), (u) => updates.push(u));
    await watch.ready;

    const opened = await MemoryStore.open(fs, root); // a second writer, as the extension or MCP server is
    if (!opened.ok) throw new Error("open failed");
    const appended = await opened.store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "idea-review" } });
    if (!appended.ok) throw new Error("append failed");
    const took = await until(() => updates.some((u) => u.events.some((e) => e.id === appended.event.id)), 2000);
    watch.stop();
    expect(took).toBeLessThan(2000);
  });
});
