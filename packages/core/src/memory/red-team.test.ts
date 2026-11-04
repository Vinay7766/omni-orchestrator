/**
 * Red-team tests (security pass dry run, 2026-11-02; report: docs/security/red-team-2026-11-02.md).
 * Each test performs one abuse case from docs/threat-model.md against local code and asserts the
 * SAFE outcome. Tests marked `it.fails` are open findings (the attack works today); when the fix
 * lands they start passing, Vitest reports them, and the marker must be removed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { PhaseEngine } from "../engine/phases.js";

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "any-ai-tool", model: "any-model" };
const skillsUsed = [{ skill: "spec-driven-development", evidence: "PRD follows the skill's sections" }];

let root: string;
let store: MemoryStore;
let engine: PhaseEngine;

const events = () => join(root, ".agents", "events.jsonl");
const statePath = () => join(root, ".agents", "state.json");
const lines = () => readFileSync(events(), "utf8").split("\n").filter((l) => l.trim() !== "");

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-red-team-"));
  const created = await MemoryStore.create(fs, root, { name: "p", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  engine = new PhaseEngine(store);
  // The agent does the first phase honestly up to the review: idea-review is awaiting_review.
  expect((await engine.start(agent, "idea-review")).ok).toBe(true);
  await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
  const submitted = await engine.submit(agent, {
    phase: "idea-review",
    documents: ["docs/IDEA.md"],
    skillsUsed,
    understandingCheck: "docs/understanding.md",
  });
  expect(submitted.ok).toBe(true);
  expect((await store.readState()).phases["idea-review"].status).toBe("awaiting_review");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Reopens the project the way any tool does on its next start. */
async function reopen(): Promise<{ store: MemoryStore; engine: PhaseEngine }> {
  const opened = await MemoryStore.open(fs, root);
  if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
  return { store: opened.store, engine: new PhaseEngine(opened.store) };
}

/** A well-formed event line, built from a real one so it passes schema validation. */
function forgedApproval(): string {
  const template = JSON.parse(lines()[lines().length - 1]);
  return JSON.stringify({
    ...template,
    id: template.id.replace(/.{6}$/, "f0rged"),
    time: new Date().toISOString(),
    type: "phase_approved",
    actor: { kind: "human", tool: "omni-desktop" },
    payload: { phase: "idea-review" },
  });
}

describe("red team: forged human approvals (T2)", () => {
  // RT-1 (T2.1): an agent, or any program running as the user, appends a hand-written human
  // approval to events.jsonl, bypassing the app and the MCP server. Planned fix: C17.
  it.fails("RT-1 (T2.1): a hand-written human approval appended to events.jsonl is not accepted", async () => {
    appendFileSync(events(), forgedApproval() + "\n");
    unlinkSync(statePath()); // makes every tool rebuild from the log on its next open
    const next = await reopen();

    const state = await next.store.readState();
    expect(state.phases["idea-review"].status).not.toBe("approved");
    const started = await next.engine.start(agent, "research");
    expect(started.ok).toBe(false);
  });

  // RT-2 (T2.2): instead of adding a line, an earlier event is rewritten in place. A person's
  // "changes requested" decision is turned into an approval; the line count does not change.
  it.fails("RT-2 (T2.2): an earlier event edited from changes_requested into phase_approved is detected", async () => {
    expect((await engine.requestChanges(person, "idea-review", "tighten the scope")).ok).toBe(true);
    await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
    expect(
      (await engine.submit(agent, { phase: "idea-review", documents: ["docs/IDEA.md"], skillsUsed, understandingCheck: "docs/u.md" })).ok,
    ).toBe(true);
    // The person's decision is the only human event after creation; rewrite it, then append
    // nothing. Both the person's notes and the re-submission vanish into an approval.
    const all = lines();
    const index = all.findIndex((l) => JSON.parse(l).type === "changes_requested");
    const edited = JSON.parse(all[index]);
    all[index] = JSON.stringify({ ...edited, type: "phase_approved", payload: { phase: "idea-review" } });
    // Drop the later events so the edited approval is the phase's last word.
    writeFileSync(events(), all.slice(0, index + 1).join("\n") + "\n");
    unlinkSync(statePath());
    const next = await reopen();

    const { issues } = await next.store.readEvents();
    const state = await next.store.readState();
    // Safe outcome: the edit is flagged, or at least does not count as an approval.
    expect(issues.length > 0 || state.phases["idea-review"].status !== "approved").toBe(true);
  });

  // RT-3 (T2.5): the agent does not touch the log at all; it edits the state.json snapshot,
  // which phase gates read whenever it is valid.
  it("RT-3 (T2.5): a state.json edited to mark a phase approved does not open the next gate", async () => {
    const snapshot = JSON.parse(readFileSync(statePath(), "utf8"));
    snapshot.phases["idea-review"] = { ...snapshot.phases["idea-review"], status: "approved", decidedAt: new Date().toISOString() };
    writeFileSync(statePath(), JSON.stringify(snapshot, null, 2) + "\n");

    // No phase_approved event exists anywhere in the log.
    expect(lines().some((l) => JSON.parse(l).type === "phase_approved")).toBe(false);
    const next = await reopen();
    const started = await next.engine.start(agent, "research");
    expect(started.ok).toBe(false);
  });

  // Control check: the same approval through the engine with an agent actor is refused (GATE-2).
  it("control: the phase engine refuses an approval from an agent actor", async () => {
    const result = await engine.approve(agent, "idea-review");
    expect(result.ok).toBe(false);
    expect((await store.readState()).phases["idea-review"].status).toBe("awaiting_review");
  });
});
