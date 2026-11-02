import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/store.js";
import { createNodeFs } from "../memory/node-fs.js";
import { PhaseEngine, checkPhaseAction, nextPhase, REVIEW_QUESTION } from "./phases.js";
import { initialState } from "../memory/reduce.js";
import { FLOWS, OPTIONAL_PHASES } from "../generated/contract.js";

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "any-ai-tool", model: "any-model" };
const skillsUsed = [{ skill: "spec-driven-development", evidence: "PRD follows the skill's sections" }];

let root: string;
let store: MemoryStore;
let engine: PhaseEngine;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-phases-"));
  const created = await MemoryStore.create(fs, root, { name: "p", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  engine = new PhaseEngine(store);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const memoryUpdate = () => store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
const submitIdeaReview = () =>
  engine.submit(agent, { phase: "idea-review", documents: ["docs/IDEA.md"], skillsUsed, understandingCheck: "docs/understanding.md" });
const messages = (r: { ok: boolean; issues?: { message: string }[] }) => (r.ok ? "" : r.issues!.map((i) => i.message).join(" | "));

async function approvedThrough(phases: string[]) {
  for (const phase of phases) {
    // Optional phases (security pass) can only be started by a person (C15).
    expect((await engine.start(phase in OPTIONAL_PHASES ? person : agent, phase)).ok).toBe(true);
    await memoryUpdate();
    const planning = !["build", "review", "security-pass", "release", "handover"].includes(phase);
    const submitted = await engine.submit(agent, {
      phase,
      documents: [`docs/${phase}.md`],
      skillsUsed,
      ...(planning ? { understandingCheck: `docs/${phase}-understanding.md` } : {}),
    });
    expect(submitted.ok, messages(submitted)).toBe(true);
    expect((await engine.approve(person, phase)).ok).toBe(true);
  }
}

describe("starting phases", () => {
  it("starts the first phase of the flow", async () => {
    const result = await engine.start(agent, "idea-review");
    expect(result.ok).toBe(true);
    const state = await store.readState();
    expect(state.currentPhase).toBe("idea-review");
    expect(state.phases["idea-review"].status).toBe("in_progress");
  });

  it("refuses to skip ahead and names the phase that must be approved first", async () => {
    const result = await engine.start(agent, "prd");
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/"research" must be approved/);
  });

  it("refuses a phase that is not part of this project's flow", async () => {
    const result = await engine.start(agent, "outreach");
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/not part of the build flow/);
  });

  it("refuses to start a phase twice", async () => {
    await engine.start(agent, "idea-review");
    const again = await engine.start(agent, "idea-review");
    expect(again.ok).toBe(false);
    expect(messages(again)).toMatch(/already in_progress/);
  });

  it("lets only one of two tools start the same phase at the same moment", async () => {
    const results = await Promise.all([engine.start(agent, "idea-review"), new PhaseEngine(store).start(agent, "idea-review")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const started = (await store.readEvents()).events.filter((e) => e.type === "phase_started");
    expect(started).toHaveLength(1);
  });

  it("starts the next phase once the previous one is approved", async () => {
    await approvedThrough(["idea-review"]);
    expect((await engine.start(agent, "research")).ok).toBe(true);
  });
});

describe("submitting phases", () => {
  it("refuses to submit a phase that was never started", async () => {
    const result = await submitIdeaReview();
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/start it first/);
  });

  it("requires a memory update since the phase started (GATE-3)", async () => {
    await engine.start(agent, "idea-review");
    const result = await submitIdeaReview();
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/memory/);
  });

  it("requires an understanding check for planning phases (UND-1)", async () => {
    await engine.start(agent, "idea-review");
    await memoryUpdate();
    const result = await engine.submit(agent, { phase: "idea-review", documents: ["docs/IDEA.md"], skillsUsed });
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/Understanding check/);
  });

  it("does not require an understanding check outside planning phases", async () => {
    await approvedThrough(["idea-review", "research", "prd", "architecture"]);
    await engine.start(agent, "build");
    await memoryUpdate();
    const result = await engine.submit(agent, { phase: "build", documents: ["src/index.ts"], skillsUsed });
    expect(result.ok, messages(result)).toBe(true);
  });

  it("requires evidence for every skill used (schema rule)", async () => {
    await engine.start(agent, "idea-review");
    await memoryUpdate();
    const result = await engine.submit(agent, {
      phase: "idea-review",
      documents: ["docs/IDEA.md"],
      skillsUsed: [{ skill: "idea-review" } as { skill: string; evidence: string }],
      understandingCheck: "docs/u.md",
    });
    expect(result.ok).toBe(false);
  });

  it("moves the phase to awaiting review and returns the review question", async () => {
    await engine.start(agent, "idea-review");
    await memoryUpdate();
    const result = await submitIdeaReview();
    expect(result.ok && result.reviewQuestion).toBe(REVIEW_QUESTION);
    expect((await store.readState()).phases["idea-review"].status).toBe("awaiting_review");
  });
});

describe("review by a person", () => {
  beforeEach(async () => {
    await engine.start(agent, "idea-review");
    await memoryUpdate();
    await submitIdeaReview();
  });

  it("refuses approval from an AI agent with a message saying who can approve", async () => {
    const result = await engine.approve(agent, "idea-review");
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/only a person/i);
    expect((await store.readState()).phases["idea-review"].status).toBe("awaiting_review");
  });

  it("refuses change requests from an AI agent", async () => {
    expect((await engine.requestChanges(agent, "idea-review", "redo it")).ok).toBe(false);
  });

  it("approves when a person approves", async () => {
    expect((await engine.approve(person, "idea-review")).ok).toBe(true);
    expect((await store.readState()).phases["idea-review"].status).toBe("approved");
  });

  it("reopens the phase on a change request and needs a new memory update before resubmitting", async () => {
    expect((await engine.requestChanges(person, "idea-review", "add competitor evidence")).ok).toBe(true);
    expect((await store.readState()).phases["idea-review"].status).toBe("changes_requested");
    const tooSoon = await submitIdeaReview();
    expect(tooSoon.ok).toBe(false);
    expect(messages(tooSoon)).toMatch(/memory/);
    await memoryUpdate();
    expect((await submitIdeaReview()).ok).toBe(true);
  });

  it("refuses to approve a phase that is not awaiting review", async () => {
    await engine.approve(person, "idea-review");
    const again = await engine.approve(person, "idea-review");
    expect(again.ok).toBe(false);
    expect(messages(again)).toMatch(/not awaiting review/);
  });
});

describe("pure helpers", () => {
  it("works with any flow definition, including made-up ones", () => {
    const flows = { custom: ["alpha", "beta"] };
    const state = { ...initialState("build"), phases: {} };
    const skip = checkPhaseAction({ state, events: [], flow: "custom", flows, planning: [] }, { kind: "start", phase: "beta" }, agent);
    expect(skip.ok).toBe(false);
    const first = checkPhaseAction({ state, events: [], flow: "custom", flows, planning: [] }, { kind: "start", phase: "alpha" }, agent);
    expect(first.ok).toBe(true);
  });

  it("names the next phase, or null at the end of the flow", () => {
    const state = initialState("build");
    expect(nextPhase("build", state)).toBe("idea-review");
    const done = { ...state, phases: Object.fromEntries(["idea-review", "research", "prd", "architecture", "build", "review", "security-pass", "release", "handover"].map((p) => [p, { status: "approved" as const }])) };
    expect(nextPhase("build", done)).toBeNull();
    // A skipped optional phase counts as done too.
    const skippedPass = { ...done, phases: { ...done.phases, "security-pass": { status: "skipped" as const } } };
    expect(nextPhase("build", skippedPass)).toBeNull();
  });
});

// C15 (SEC-1, GATE-1, REL-1): optional phases. Only a person can agree to run one (by
// starting it) or decline it (by skipping it); either way it is recorded.
describe("optional phases (security pass)", () => {
  const throughReview = ["idea-review", "research", "prd", "architecture", "build", "review"];

  it("puts the security pass and release between review and handover", () => {
    expect(FLOWS.build.slice(-4)).toEqual(["review", "security-pass", "release", "handover"]);
    expect(Object.keys(OPTIONAL_PHASES)).toEqual(["security-pass"]);
    expect(OPTIONAL_PHASES["security-pass"]).toMatch(/ready to deploy.*red-team \/ blue-team pass/);
  });

  it("does not let an agent start an optional phase, and gives it the question to ask", async () => {
    await approvedThrough(throughReview);
    const result = await engine.start(agent, "security-pass");
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/Only a person can decide/);
    expect(messages(result)).toContain(OPTIONAL_PHASES["security-pass"]);
  });

  it("lets a person agree to it by starting it", async () => {
    await approvedThrough(throughReview);
    expect((await engine.start(person, "security-pass")).ok).toBe(true);
    expect((await store.readState()).phases["security-pass"].status).toBe("in_progress");
  });

  it("does not let an agent skip it", async () => {
    await approvedThrough(throughReview);
    const result = await engine.skip(agent, "security-pass");
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/Only a person can/);
  });

  it("records a person's decision to skip it, and the flow continues", async () => {
    await approvedThrough(throughReview);
    const skipped = await engine.skip(person, "security-pass", "Internal prototype, not deployed publicly");
    expect(skipped.ok, messages(skipped)).toBe(true);
    const state = await store.readState();
    expect(state.phases["security-pass"].status).toBe("skipped");
    expect(state.phases["security-pass"].decidedAt).toBeDefined();
    const { events } = await store.readEvents();
    const last = events[events.length - 1];
    expect(last.type).toBe("phase_skipped");
    expect(last.actor.kind).toBe("human");
    expect(nextPhase("build", state)).toBe("release");
    expect((await engine.start(agent, "release")).ok).toBe(true);
  });

  it("only skips an optional phase", async () => {
    await approvedThrough(["idea-review", "research", "prd", "architecture", "build"]);
    const result = await engine.skip(person, "review");
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/"review" is not optional/);
  });

  it("only skips it when it is its turn", async () => {
    const result = await engine.skip(person, "security-pass");
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/"review" must be approved/);
  });

  it("does not skip a security pass that has already started", async () => {
    await approvedThrough(throughReview);
    await engine.start(person, "security-pass");
    const result = await engine.skip(person, "security-pass");
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/already in_progress/);
  });

  it("keeps an existing project working: the new phases are simply not started", async () => {
    // A project whose review was approved before these phases existed: same event log.
    await approvedThrough(throughReview);
    const state = await store.readState();
    expect(state.phases["security-pass"]).toBeUndefined();
    expect(nextPhase("build", state)).toBe("security-pass");
  });

  it("says in the summary that a person must decide", async () => {
    await approvedThrough(throughReview);
    const summary = await readFile(join(root, ".agents", "summary.md"), "utf8");
    expect(summary).toContain('"security-pass" needs a decision from a person');
    expect(summary).toContain(OPTIONAL_PHASES["security-pass"]);
  });
});
