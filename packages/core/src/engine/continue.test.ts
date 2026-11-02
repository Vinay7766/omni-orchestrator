import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/store.js";
import { createNodeFs } from "../memory/node-fs.js";
import { PhaseEngine } from "./phases.js";
import { continueAfterDecision } from "./continue.js";
import { OPTIONAL_PHASES, STACK_ADR_PHASES } from "../generated/contract.js";

// What happens after a person approves or skips a phase, shared by the extension and the app:
// the next phase starts, unless it is optional (only the person decides that, SEC-1).

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "made-up-agent" };

let root: string;
let store: MemoryStore;
let engine: PhaseEngine;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-continue-"));
  const created = await MemoryStore.create(fs, root, { name: "p", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  engine = new PhaseEngine(store);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function approved(phase: string) {
  await engine.start(phase in OPTIONAL_PHASES ? person : agent, phase);
  await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
  const planning = !["build", "review", "security-pass", "release", "handover"].includes(phase);
  await engine.submit(agent, {
    phase,
    documents: ["d.md"],
    skillsUsed: [{ skill: "x", evidence: "y" }],
    ...(planning ? { understandingCheck: "u.md" } : {}),
    ...(STACK_ADR_PHASES.includes(phase as never) ? { stackAdr: "adr.md" } : {}),
  });
  await engine.approve(person, phase);
}

describe("continueAfterDecision", () => {
  it("starts the next phase as the person", async () => {
    await approved("idea-review");
    const result = await continueAfterDecision(store, person);
    expect(result).toEqual({ kind: "started", phase: "research" });
    const { events } = await store.readEvents();
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "phase_started", actor: person }));
  });

  it("never starts an optional phase: it returns the question instead", async () => {
    for (const p of ["idea-review", "research", "prd", "architecture", "build", "review"]) await approved(p);
    const before = (await store.readEvents()).events.length;
    const result = await continueAfterDecision(store, person);
    expect(result).toEqual({ kind: "needs_decision", phase: "security-pass", question: OPTIONAL_PHASES["security-pass"] });
    expect((await store.readEvents()).events.length).toBe(before);
  });

  it("says when every phase is done", async () => {
    for (const p of ["idea-review", "research", "prd", "architecture", "build", "review"]) await approved(p);
    await engine.skip(person, "security-pass");
    for (const p of ["release", "handover"]) await approved(p);
    expect(await continueAfterDecision(store, person)).toEqual({ kind: "done" });
  });

  it("does nothing while the next phase is already under way", async () => {
    await engine.start(agent, "idea-review");
    const before = (await store.readEvents()).events.length;
    expect(await continueAfterDecision(store, person)).toEqual({ kind: "in_progress", phase: "idea-review" });
    expect((await store.readEvents()).events.length).toBe(before);
  });
});
