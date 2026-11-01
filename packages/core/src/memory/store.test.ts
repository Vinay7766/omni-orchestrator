import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, appendFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { validateMemoryFile } from "../validate.js";

const human = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "a-tool-nobody-named", model: "some-model" };
const fs = createNodeFs();

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omni-store-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const agentsFile = (name: string) => join(root, ".agents", name);
const eventLines = () => readFileSync(agentsFile("events.jsonl"), "utf8").split("\n").filter(Boolean);
const newProject = () => MemoryStore.create(fs, root, { name: "Clinic scheduler", flow: "build", mode: "full", actor: human });

async function created() {
  const result = await newProject();
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.store;
}

describe("MemoryStore.create", () => {
  it("creates .agents with a valid project, event log and state", async () => {
    await created();
    expect(validateMemoryFile("project", JSON.parse(readFileSync(agentsFile("project.json"), "utf8"))).ok).toBe(true);
    expect(validateMemoryFile("state", JSON.parse(readFileSync(agentsFile("state.json"), "utf8"))).ok).toBe(true);
    const lines = eventLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).type).toBe("project_created");
  });

  it("refuses to overwrite an existing project", async () => {
    await created();
    const again = await newProject();
    expect(again.ok).toBe(false);
    expect(eventLines()).toHaveLength(1);
  });
});

describe("MemoryStore.open", () => {
  it("opens an existing project", async () => {
    await created();
    const opened = await MemoryStore.open(fs, root);
    expect(opened.ok && (await opened.store.readState()).flow).toBe("build");
  });

  it("reports a missing project instead of throwing", async () => {
    const opened = await MemoryStore.open(fs, root);
    expect(opened.ok).toBe(false);
  });

  it("rebuilds state.json from the event log when it is missing", async () => {
    const store = await created();
    await store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "idea-review" } });
    const before = await store.readState();
    unlinkSync(agentsFile("state.json"));
    const opened = await MemoryStore.open(fs, root);
    expect(opened.ok && (await opened.store.readState())).toEqual(before);
  });
});

describe("appendEvent", () => {
  it("adds id and time, appends one line and updates state", async () => {
    const store = await created();
    const result = await store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "idea-review" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.id).toMatch(/^evt-/);
    expect(eventLines()).toHaveLength(2);
    const state = await store.readState();
    expect(state.currentPhase).toBe("idea-review");
    expect(state.phases["idea-review"].status).toBe("in_progress");
    expect(state.lastEventId).toBe(result.event.id);
  });

  it("rejects an invalid event and writes nothing", async () => {
    const store = await created();
    const result = await store.appendEvent({ type: "phase_approved", actor: agent, payload: { phase: "idea-review" } });
    expect(result.ok).toBe(false);
    expect(eventLines()).toHaveLength(1);
  });

  it("rejects an event naming an unknown phase", async () => {
    const store = await created();
    const result = await store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "made-up-phase" } });
    expect(result.ok).toBe(false);
  });

  it("runs a guard inside the lock and writes nothing when it reports issues", async () => {
    const store = await created();
    let seen: { events: number; lastEventId: string | null } | undefined;
    const result = await store.appendEvent(
      { type: "phase_started", actor: agent, payload: { phase: "idea-review" } },
      (state, events) => {
        seen = { events: events.length, lastEventId: state.lastEventId };
        return [{ path: "", message: "not allowed right now" }];
      },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0].message).toBe("not allowed right now");
    expect(seen?.events).toBe(1);
    expect(seen?.lastEventId).not.toBeNull();
    expect(eventLines()).toHaveLength(1);
  });

  it("redacts secrets before writing and reports how many", async () => {
    const store = await created();
    const secret = "sk" + "-proj-" + "aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zAbCdEfGh";
    const result = await store.appendEvent({
      type: "lesson_recorded",
      actor: human,
      payload: { lesson: `Never paste keys like ${secret} into chat` },
    });
    expect(result.ok && result.redactions).toBe(1);
    expect(readFileSync(agentsFile("events.jsonl"), "utf8")).not.toContain(secret);
  });
});

describe("state follows the event log", () => {
  it("tracks a phase from start to approval", async () => {
    const store = await created();
    await store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "prd" } });
    await store.appendEvent({
      type: "phase_submitted",
      actor: agent,
      payload: { phase: "prd", documents: ["docs/PRD.md"], skillsUsed: [{ skill: "spec-driven-development", evidence: "sections follow the skill" }] },
    });
    expect((await store.readState()).phases.prd.status).toBe("awaiting_review");
    await store.appendEvent({ type: "changes_requested", actor: human, payload: { phase: "prd", notes: "add tool discovery" } });
    expect((await store.readState()).phases.prd.status).toBe("changes_requested");
    await store.appendEvent({ type: "phase_approved", actor: human, payload: { phase: "prd" } });
    const prd = (await store.readState()).phases.prd;
    expect(prd.status).toBe("approved");
    expect(prd.decidedAt).toBeDefined();
  });

  it("tracks a task through design, work, completion and reopening", async () => {
    const store = await created();
    const tests = { command: "npm test", exitCode: 0, outputTail: "ok" };
    const skillsUsed = [{ skill: "test-driven-development", evidence: "red run recorded first" }];
    await store.appendEvent({ type: "task_created", actor: agent, payload: { taskId: "T-1", title: "Memory store" } });
    expect((await store.readState()).tasks[0].status).toBe("todo");
    await store.appendEvent({ type: "design_note_submitted", actor: agent, payload: { taskId: "T-1", notePath: ".agents/design-notes/T-1.json" } });
    expect((await store.readState()).tasks[0]).toMatchObject({ status: "designed", designNote: ".agents/design-notes/T-1.json" });
    await store.appendEvent({ type: "task_started", actor: agent, payload: { taskId: "T-1" } });
    expect((await store.readState()).tasks[0].status).toBe("in_progress");
    await store.appendEvent({ type: "task_completed", actor: agent, payload: { taskId: "T-1", summary: "done", skillsUsed, tests } });
    expect((await store.readState()).tasks[0].status).toBe("done");
    await store.appendEvent({ type: "task_reopened", actor: human, payload: { taskId: "T-1", reason: "approach was wrong" } });
    expect((await store.readState()).tasks[0].status).toBe("todo");
  });

  it("records a trivial task with its reason", async () => {
    const store = await created();
    await store.appendEvent({ type: "task_created", actor: agent, payload: { taskId: "T-2", title: "Fix typo" } });
    await store.appendEvent({ type: "task_marked_trivial", actor: agent, payload: { taskId: "T-2", reason: "one-word text change" } });
    expect((await store.readState()).tasks[0]).toMatchObject({ status: "designed", trivialReason: "one-word text change" });
  });

  it("produces the same state by full rebuild as by incremental updates", async () => {
    const store = await created();
    await store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "build" } });
    await store.appendEvent({ type: "task_created", actor: agent, payload: { taskId: "T-1", title: "A" } });
    await store.appendEvent({ type: "task_created", actor: agent, payload: { taskId: "T-2", title: "B" } });
    await store.appendEvent({ type: "task_started", actor: agent, payload: { taskId: "T-2" } });
    const incremental = await store.readState();
    expect(await store.rebuildState()).toEqual(incremental);
  });
});

describe("readEvents", () => {
  it("reports a broken line with its number and still reads the others", async () => {
    const store = await created();
    appendFileSync(agentsFile("events.jsonl"), '{"broken": \n');
    await store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "idea-review" } });
    const { events, issues } = await store.readEvents();
    expect(events.map((e) => e.type)).toEqual(["project_created", "phase_started"]);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(2);
  });
});

describe("concurrent writers", () => {
  it("never interleaves or loses events when two stores append at once", async () => {
    await created();
    const [a, b] = await Promise.all([MemoryStore.open(fs, root), MemoryStore.open(fs, root)]);
    if (!a.ok || !b.ok) throw new Error("open failed");
    const writes = Array.from({ length: 25 }, (_, i) => [
      a.store.appendEvent({ type: "lesson_recorded", actor: human, payload: { lesson: `a-${i}` } }),
      b.store.appendEvent({ type: "lesson_recorded", actor: human, payload: { lesson: `b-${i}` } }),
    ]).flat();
    const results = await Promise.all(writes);
    expect(results.every((r) => r.ok)).toBe(true);

    const lines = eventLines();
    expect(lines).toHaveLength(51);
    const events = lines.map((l) => JSON.parse(l));
    expect(new Set(events.map((e) => e.id)).size).toBe(51);
    for (const e of events) expect(validateMemoryFile("event", e).ok).toBe(true);
    const state = JSON.parse(readFileSync(agentsFile("state.json"), "utf8"));
    expect(state.lastEventId).toBe(events[events.length - 1].id);
  });
});

describe("locking", () => {
  it("takes over a stale lock left by a crashed writer", async () => {
    const store = await created();
    writeFileSync(agentsFile(".lock"), JSON.stringify({ owner: "crashed", since: Date.now() - 10 * 60_000 }));
    const result = await store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "idea-review" } });
    expect(result.ok).toBe(true);
    expect(existsSync(agentsFile(".lock"))).toBe(false);
  });

  it("gives up with a clear error while another writer holds a fresh lock, writing nothing", async () => {
    const opened = await newProject();
    if (!opened.ok) throw new Error("create failed");
    const store = (await MemoryStore.open(fs, root, { lockTimeoutMs: 200 })) as { ok: true; store: MemoryStore };
    writeFileSync(agentsFile(".lock"), JSON.stringify({ owner: "busy", since: Date.now() }));
    const result = await store.store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "idea-review" } });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0].message).toMatch(/lock/i);
    expect(eventLines()).toHaveLength(1);
  });
});
