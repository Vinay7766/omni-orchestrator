import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { createNodeChangeTrigger } from "./node-watch.js";
import { watchEvents, type ChangeTrigger, type SyncUpdate } from "./sync.js";

const human = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "a-tool-nobody-named" };
const fs = createNodeFs();

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omni-sync-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const eventsFile = () => join(root, ".agents", "events.jsonl");

async function created() {
  const result = await MemoryStore.create(fs, root, { name: "Sync test", flow: "build", mode: "full", actor: human });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.store;
}
async function startPhase(store: MemoryStore, phase = "idea-review") {
  const result = await store.appendEvent({ type: "phase_started", actor: agent, payload: { phase } });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.event;
}

/** A trigger the test fires by hand. */
function manualTrigger() {
  let listener: (() => void) | null = null;
  const trigger: ChangeTrigger = (notify) => {
    listener = notify;
    return () => {
      listener = null;
    };
  };
  return { trigger, fire: () => listener?.(), isListening: () => listener !== null };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeoutMs: number): Promise<number> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`condition not met within ${timeoutMs} ms`);
    await sleep(10);
  }
  return Date.now() - start;
}

describe("EventFollower", () => {
  it("first poll returns every event, with the same state a rebuild gives", async () => {
    const store = await created();
    await startPhase(store);
    const update = await store.follow().poll();
    expect(update?.reset).toBe(true);
    expect(update?.events.map((e) => e.type)).toEqual(["project_created", "phase_started"]);
    expect(update?.state).toEqual(await store.rebuildState());
  });

  it("later polls return only the new events, and nothing when nothing changed", async () => {
    const store = await created();
    const follower = store.follow();
    await follower.poll();
    expect(await follower.poll()).toBeNull();
    const started = await startPhase(store);
    const update = await follower.poll();
    expect(update?.reset).toBe(false);
    expect(update?.events.map((e) => e.id)).toEqual([started.id]);
    expect(update?.state).toEqual(await store.rebuildState());
    expect(await follower.poll()).toBeNull();
  });

  it("checks only the new lines, not the whole log again", async () => {
    const store = await created();
    for (const phase of ["idea-review", "prd"]) await startPhase(store, phase);
    const follower = store.follow();
    await follower.poll();
    expect(follower.linesChecked).toBe(3);
    await startPhase(store, "architecture");
    await follower.poll();
    expect(follower.linesChecked).toBe(4);
  });

  it("holds back a half-written last line until it is complete", async () => {
    const store = await created();
    const follower = store.follow();
    await follower.poll();
    const line = readFileSync(eventsFile(), "utf8").trim().replace(/"project_created"/, '"memory_updated"').replace(/"payload":\{[^}]*\}/, '"payload":{"files":[".agents/summary.md"]}').replace(/"id":"[^"]+"/, '"id":"evt-half-written-0001"');
    appendFileSync(eventsFile(), line.slice(0, 40));
    expect(await follower.poll()).toBeNull();
    appendFileSync(eventsFile(), line.slice(40) + "\n");
    const update = await follower.poll();
    expect(update?.issues).toEqual([]);
    expect(update?.events.map((e) => e.id)).toEqual(["evt-half-written-0001"]);
  });

  it("reports a broken line once, with its line number, and keeps going", async () => {
    const store = await created();
    const follower = store.follow();
    await follower.poll();
    appendFileSync(eventsFile(), "{ not json\n");
    const first = await follower.poll();
    expect(first?.issues).toEqual([{ line: 2, message: "not valid JSON" }]);
    expect(first?.events).toEqual([]);
    const started = await startPhase(store);
    const second = await follower.poll();
    expect(second?.issues).toEqual([]);
    expect(second?.events.map((e) => e.id)).toEqual([started.id]);
  });

  it("starts over when the log was replaced or shortened", async () => {
    const store = await created();
    await startPhase(store);
    const follower = store.follow();
    await follower.poll();
    const firstLine = readFileSync(eventsFile(), "utf8").split("\n")[0] + "\n";
    writeFileSync(eventsFile(), firstLine); // for example restored from an older copy
    const update = await follower.poll();
    expect(update?.reset).toBe(true);
    expect(update?.events.map((e) => e.type)).toEqual(["project_created"]);
    expect(update?.state.currentPhase).toBeNull();
  });

  it("starts over when the log was replaced by one of the same length or longer", async () => {
    const store = await created();
    await startPhase(store, "idea-review");
    const follower = store.follow();
    await follower.poll();
    const text = readFileSync(eventsFile(), "utf8");
    writeFileSync(eventsFile(), text.replace('"idea-review"', '"architecture"')); // edited, now longer
    const update = await follower.poll();
    expect(update?.reset).toBe(true);
    expect(update?.state.currentPhase).toBe("architecture");
  });
});

describe("watchEvents", () => {
  it("delivers the current events at once, then each change", async () => {
    const store = await created();
    const { trigger, fire } = manualTrigger();
    const updates: SyncUpdate[] = [];
    const watch = watchEvents(store.follow(), trigger, (u) => updates.push(u), { debounceMs: 5 });
    await watch.ready;
    expect(updates).toHaveLength(1);
    await startPhase(store);
    fire();
    await until(() => updates.length === 2, 1000);
    expect(updates[1].events[0].type).toBe("phase_started");
    watch.stop();
  });

  it("turns a burst of change signals into one check", async () => {
    const store = await created();
    const follower = store.follow();
    const { trigger, fire } = manualTrigger();
    let polls = 0;
    const original = follower.poll.bind(follower);
    follower.poll = () => {
      polls++;
      return original();
    };
    const watch = watchEvents(follower, trigger, () => {}, { debounceMs: 30 });
    await watch.ready;
    polls = 0;
    for (let i = 0; i < 10; i++) fire();
    await sleep(120);
    expect(polls).toBe(1);
    watch.stop();
  });

  it("never runs two checks at once, and checks again for a change that arrived during one", async () => {
    const store = await created();
    const follower = store.follow();
    const { trigger, fire } = manualTrigger();
    let running = 0;
    let overlapped = false;
    let polls = 0;
    const original = follower.poll.bind(follower);
    follower.poll = async () => {
      polls++;
      running++;
      if (running > 1) overlapped = true;
      if (polls === 2) fire(); // a change arrives while this check runs
      await sleep(40);
      try {
        return await original();
      } finally {
        running--;
      }
    };
    const watch = watchEvents(follower, trigger, () => {}, { debounceMs: 1 });
    await watch.ready;
    fire();
    await sleep(300);
    expect(overlapped).toBe(false);
    expect(polls).toBe(3);
    watch.stop();
  });

  it("reports errors and keeps watching", async () => {
    const store = await created();
    const follower = store.follow();
    const { trigger, fire } = manualTrigger();
    const errors: unknown[] = [];
    let fail = true;
    const original = follower.poll.bind(follower);
    follower.poll = () => (fail ? Promise.reject(new Error("disk unavailable")) : original());
    const updates: SyncUpdate[] = [];
    const watch = watchEvents(follower, trigger, (u) => updates.push(u), { debounceMs: 1, onError: (e) => errors.push(e) });
    await watch.ready;
    expect(errors).toHaveLength(1);
    fail = false;
    fire();
    await until(() => updates.length === 1, 1000);
    watch.stop();
  });

  it("stop() ends watching and releases the trigger", async () => {
    const store = await created();
    const { trigger, fire, isListening } = manualTrigger();
    const updates: SyncUpdate[] = [];
    const watch = watchEvents(store.follow(), trigger, (u) => updates.push(u), { debounceMs: 1 });
    await watch.ready;
    watch.stop();
    expect(isListening()).toBe(false);
    await startPhase(store);
    fire();
    await sleep(50);
    expect(updates).toHaveLength(1);
  });
});

describe("Node change trigger", () => {
  it("a change written by another process is seen within 2 seconds", async () => {
    const store = await created();
    // A valid event line for the other process to write.
    const scratchRoot = mkdtempSync(join(tmpdir(), "omni-sync-src-"));
    const scratch = await MemoryStore.create(fs, scratchRoot, { name: "Source", flow: "build", mode: "full", actor: human });
    if (!scratch.ok) throw new Error("scratch");
    const line = JSON.stringify((await startPhase(scratch.store, "prd"))) + "\n";
    rmSync(scratchRoot, { recursive: true, force: true });

    const updates: SyncUpdate[] = [];
    const watch = watchEvents(store.follow(), createNodeChangeTrigger(store.dir), (u) => updates.push(u));
    await watch.ready;
    const writtenAt = Date.now();
    const child = spawn(process.execPath, ["-e", "require('fs').appendFileSync(process.argv[1], process.argv[2])", eventsFile(), line]);
    await new Promise((resolve) => child.on("exit", resolve));
    await until(() => updates.length === 2, 2000);
    expect(Date.now() - writtenAt).toBeLessThan(2000);
    expect(updates[1].state.currentPhase).toBe("prd");
    watch.stop();
  });

  it("falls back to checking the file regularly when change signals are missed", async () => {
    const store = await created();
    const updates: SyncUpdate[] = [];
    const trigger = createNodeChangeTrigger(store.dir, { pollMs: 50, useWatch: false });
    const watch = watchEvents(store.follow(), trigger, (u) => updates.push(u), { debounceMs: 1 });
    await watch.ready;
    await startPhase(store);
    await until(() => updates.length === 2, 1000);
    watch.stop();
  });

  it("opens no network connections", () => {
    for (const file of ["sync.ts", "node-watch.ts"]) {
      const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8");
      expect(code).not.toMatch(/node:(net|http|https|dgram|tls)|WebSocket|fetch\(/);
    }
  });
});
