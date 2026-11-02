import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { PhaseEngine } from "../engine/phases.js";
import { FLOWS, OPTIONAL_PHASES, STACK_ADR_PHASES } from "../generated/contract.js";
import { phaseHistory } from "./history.js";

// E3 / GATE-5: for every phase, what was produced and what the person decided.

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "made-up-agent", model: "made-up-model" };
const skillsUsed = [{ skill: "spec-driven-development", evidence: "PRD follows the skill's sections" }];

let root: string;
let store: MemoryStore;
let engine: PhaseEngine;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-history-"));
  const created = await MemoryStore.create(fs, root, { name: "p", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  engine = new PhaseEngine(store);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const memoryUpdate = () => store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });

async function submit(phase: string, documents: string[]) {
  await memoryUpdate();
  const planning = !["build", "review", "security-pass", "release", "handover"].includes(phase);
  const r = await engine.submit(agent, {
    phase,
    documents,
    skillsUsed,
    ...(planning ? { understandingCheck: `docs/${phase}-u.md` } : {}),
    ...(STACK_ADR_PHASES.includes(phase as never) ? { stackAdr: `docs/decisions/ADR-001-${phase}.md` } : {}),
  });
  if (!r.ok) throw new Error(JSON.stringify(r));
}

async function approvedThrough(phases: string[]) {
  for (const phase of phases) {
    await engine.start(phase in OPTIONAL_PHASES ? person : agent, phase);
    await submit(phase, [`docs/${phase}.md`]);
    await engine.approve(person, phase);
  }
}

describe("phaseHistory", () => {
  it("lists every phase of the flow in order, all not started, with the first one next", async () => {
    const history = await phaseHistory(store);
    expect(history.map((h) => h.phase)).toEqual([...FLOWS.build]);
    expect(history.every((h) => h.status === "not_started")).toBe(true);
    expect(history.filter((h) => h.isNext).map((h) => h.phase)).toEqual(["idea-review"]);
  });

  it("carries the question for an optional phase, and no question for the others", async () => {
    const history = await phaseHistory(store);
    expect(history.find((h) => h.phase === "security-pass")!.optionalQuestion).toBe(OPTIONAL_PHASES["security-pass"]);
    expect(history.find((h) => h.phase === "review")!.optionalQuestion).toBeUndefined();
  });

  it("records who started a phase, every submission, every change request, and the approval", async () => {
    await engine.start(agent, "idea-review");
    await submit("idea-review", ["docs/IDEA.md"]);
    await engine.requestChanges(person, "idea-review", "Add the competitors section");
    await submit("idea-review", ["docs/IDEA.md", "docs/COMPETITORS.md"]);
    await engine.approve(person, "idea-review");

    const entry = (await phaseHistory(store)).find((h) => h.phase === "idea-review")!;
    expect(entry.status).toBe("approved");
    expect(entry.started?.by).toEqual(agent);
    expect(entry.submissions.map((s) => s.documents)).toEqual([["docs/IDEA.md"], ["docs/IDEA.md", "docs/COMPETITORS.md"]]);
    expect(entry.submissions[0].skillsUsed).toEqual(skillsUsed);
    expect(entry.submissions[0].understandingCheck).toBe("docs/idea-review-u.md");
    expect(entry.changeRequests).toEqual([expect.objectContaining({ notes: "Add the competitors section", by: person })]);
    expect(entry.decision).toEqual(expect.objectContaining({ kind: "approved", by: person }));
    expect(Date.parse(entry.decision!.time)).not.toBeNaN();
  });

  it("shows the stack ADR referenced by the architecture submission, and none elsewhere (C16)", async () => {
    await approvedThrough(["idea-review", "research", "prd", "architecture"]);
    const history = await phaseHistory(store);
    expect(history.find((h) => h.phase === "architecture")!.submissions[0].stackAdr).toBe("docs/decisions/ADR-001-architecture.md");
    expect(history.find((h) => h.phase === "prd")!.submissions[0].stackAdr).toBeUndefined();
  });

  it("records a person's skip of an optional phase with the reason, and moves 'next' past it", async () => {
    await approvedThrough(["idea-review", "research", "prd", "architecture", "build", "review"]);
    await engine.skip(person, "security-pass", "Internal prototype");
    const history = await phaseHistory(store);
    const pass = history.find((h) => h.phase === "security-pass")!;
    expect(pass.status).toBe("skipped");
    expect(pass.decision).toEqual(expect.objectContaining({ kind: "skipped", by: person, reason: "Internal prototype" }));
    expect(history.filter((h) => h.isNext).map((h) => h.phase)).toEqual(["release"]);
  });

  it("marks nothing as next once every phase is done", async () => {
    await approvedThrough(["idea-review", "research", "prd", "architecture", "build", "review"]);
    await engine.skip(person, "security-pass");
    await approvedThrough(["release", "handover"]);
    expect((await phaseHistory(store)).some((h) => h.isNext)).toBe(false);
  });
});
