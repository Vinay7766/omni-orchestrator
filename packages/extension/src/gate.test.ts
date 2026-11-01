import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, PhaseEngine } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { approvePhase, requestChanges, type GateUi } from "./gate.js";
import { statusText } from "./status.js";

const fs = createNodeFs();
const agent = { kind: "agent" as const, tool: "made-up-agent" };
const person = { kind: "human" as const, tool: "Made-up Editor" };

let root: string;
let store: MemoryStore;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-ext-gate-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "Orbit planner", flow: "build", mode: "full", actor: agent });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Starts `phase` and hands it in, as an agent would. */
async function submitted(phase: string) {
  const phases = new PhaseEngine(store);
  const started = await phases.start(agent, phase);
  if (!started.ok) throw new Error(JSON.stringify(started));
  await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
  const r = await phases.submit(agent, { phase, documents: ["docs/idea.md"], skillsUsed: [{ skill: "x", evidence: "y" }], understandingCheck: "docs/u.md" });
  if (!r.ok) throw new Error(JSON.stringify(r));
}

/** A person at the keyboard: answers are scripted, everything shown is recorded. */
function fakeUi(answers: { confirm?: boolean; notes?: string | undefined } = {}) {
  const shown: string[] = [];
  const asked: { message: string; detail: string }[] = [];
  const ui: GateUi = {
    confirm: async (message, detail) => {
      asked.push({ message, detail });
      return answers.confirm ?? true;
    },
    askNotes: async () => answers.notes,
    show: (message) => void shown.push(message),
  };
  return { ui, shown, asked };
}
const types = async () => (await store.readEvents()).events.map((e) => e.type);

describe("approvePhase", () => {
  it("approves the phase under review and starts the next one, as the person", async () => {
    await submitted("idea-review");
    const { ui, asked, shown } = fakeUi();
    await approvePhase(store, person, ui);
    expect(asked[0].message).toMatch(/Approve "idea-review"/);
    expect(asked[0].detail).toMatch(/docs\/idea\.md/);
    expect(asked[0].detail).toMatch(/Have you reviewed this\?/);
    const events = (await store.readEvents()).events.slice(-2);
    expect(events.map((e) => [e.type, (e.payload as { phase: string }).phase])).toEqual([
      ["phase_approved", "idea-review"],
      ["phase_started", "research"],
    ]);
    for (const e of events) {
      expect(e.actor).toEqual(person);
      expect(Number.isNaN(Date.parse(e.time))).toBe(false);
    }
    const state = await store.readState();
    expect(state.phases["idea-review"].status).toBe("approved");
    expect(state.currentPhase).toBe("research");
    expect(shown.join(" ")).toMatch(/"research" has started/);
  });

  it("approves the last phase without starting anything", async () => {
    const order = ["idea-review", "research", "prd", "architecture", "build", "review", "handover"];
    for (const phase of order.slice(0, -1)) {
      await submitted(phase);
      await new PhaseEngine(store).approve(person, phase);
    }
    await submitted("handover");
    const { ui, shown } = fakeUi();
    await approvePhase(store, person, ui);
    expect((await types()).at(-1)).toBe("phase_approved");
    expect(shown.join(" ")).toMatch(/every phase is approved/i);
  });

  it("writes nothing when the person does not confirm", async () => {
    await submitted("idea-review");
    const before = await types();
    await approvePhase(store, person, fakeUi({ confirm: false }).ui);
    expect(await types()).toEqual(before);
  });

  it("says there is nothing to review when no phase awaits review", async () => {
    await new PhaseEngine(store).start(agent, "idea-review");
    const before = await types();
    const { ui, shown, asked } = fakeUi();
    await approvePhase(store, person, ui);
    expect(asked).toEqual([]);
    expect(shown.join(" ")).toMatch(/nothing is waiting for review/i);
    expect(await types()).toEqual(before);
  });
});

describe("requestChanges", () => {
  it("records the notes and reopens the phase", async () => {
    await submitted("idea-review");
    await requestChanges(store, person, fakeUi({ notes: "Name the user groups explicitly" }).ui);
    const last = (await store.readEvents()).events.at(-1)!;
    expect(last.type).toBe("changes_requested");
    expect(last.payload).toEqual({ phase: "idea-review", notes: "Name the user groups explicitly" });
    expect(last.actor).toEqual(person);
    expect((await store.readState()).phases["idea-review"].status).toBe("changes_requested");
  });

  it("writes nothing without notes", async () => {
    await submitted("idea-review");
    const before = await types();
    for (const notes of [undefined, "   "]) {
      const { ui, shown } = fakeUi({ notes });
      await requestChanges(store, person, ui);
      expect(shown, "cancelling is not an error").toEqual([]);
    }
    expect(await types()).toEqual(before);
  });
});

describe("statusText", () => {
  it("shows the phase, its status and the task in progress", async () => {
    expect(statusText(await store.readState())).toBe("Omni: no phase started");
    await new PhaseEngine(store).start(agent, "idea-review");
    expect(statusText(await store.readState())).toBe("Omni: idea-review · in progress");
    await store.appendEvent({ type: "task_created", actor: agent, payload: { taskId: "T-1", title: "Parser" } });
    await store.appendEvent({ type: "task_marked_trivial", actor: agent, payload: { taskId: "T-1", reason: "small" } });
    await store.appendEvent({ type: "task_started", actor: agent, payload: { taskId: "T-1" } });
    expect(statusText(await store.readState())).toBe("Omni: idea-review · in progress · T-1");
  });

  it("asks for review when a phase is waiting", async () => {
    await submitted("idea-review");
    expect(statusText(await store.readState())).toBe("Omni: idea-review · review needed");
  });
});
