// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, OPTIONAL_PHASES, PhaseEngine, STACK_ADR_PHASES } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { approve, requestChanges, runOptional, skipOptional, DESKTOP_PERSON } from "./decisions";
import { fakeInvoke } from "./testing/fake-invoke";

// E3 slice 3: the person's decisions in the desktop app, through the same engine and the same
// "what comes next" rule as the extension (GATE-2, SEC-1).

const node = createNodeFs();
const agent = { kind: "agent" as const, tool: "made-up-agent" };
let base: string;
let root: string;
let store: MemoryStore;

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "omni-app-decisions-"));
  root = join(base, "orbit").replace(/\\/g, "/");
  mkdirSync(root);
  const created = await MemoryStore.create(node, root, { name: "Orbit", flow: "build", mode: "full", actor: agent });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

async function submitted(phase: string) {
  const engine = new PhaseEngine(store);
  await engine.start(phase in OPTIONAL_PHASES ? DESKTOP_PERSON : agent, phase);
  await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
  const planning = !["build", "review", "security-pass", "release", "handover"].includes(phase);
  const r = await engine.submit(agent, { phase, documents: ["d.md"], skillsUsed: [{ skill: "x", evidence: "y" }], ...(planning ? { understandingCheck: "u.md" } : {}), ...(STACK_ADR_PHASES.includes(phase as never) ? { stackAdr: "adr.md" } : {}) });
  if (!r.ok) throw new Error(JSON.stringify(r));
}
async function approvedThroughBuild() {
  for (const p of ["idea-review", "research", "prd", "architecture", "build"]) {
    await submitted(p);
    await new PhaseEngine(store).approve(DESKTOP_PERSON, p);
  }
}
const lastEvent = async () => (await store.readEvents()).events.at(-1)!;
const status = async (phase: string) => (await store.readState()).phases[phase]?.status;

describe("desktop decisions", () => {
  it("approves as the person and starts the next phase", async () => {
    await submitted("idea-review");
    const result = await approve(fakeInvoke(), root, "idea-review");
    expect(result).toEqual({ ok: true, message: '"idea-review" approved. "research" has started.' });
    expect(await status("idea-review")).toBe("approved");
    expect(await lastEvent()).toEqual(expect.objectContaining({ type: "phase_started", actor: DESKTOP_PERSON }));
  });

  it("never starts the security pass after approving review: it asks instead", async () => {
    await approvedThroughBuild();
    await submitted("review");
    const result = await approve(fakeInvoke(), root, "review");
    expect(result.ok).toBe(true);
    expect(result.message).toContain(OPTIONAL_PHASES["security-pass"]);
    expect(await status("security-pass")).toBeUndefined();
  });

  it("runs the optional phase when the person chooses to", async () => {
    await approvedThroughBuild();
    await submitted("review");
    await approve(fakeInvoke(), root, "review");
    expect(await runOptional(fakeInvoke(), root, "security-pass")).toEqual({ ok: true, message: '"security-pass" has started.' });
    expect(await lastEvent()).toEqual(expect.objectContaining({ type: "phase_started", actor: DESKTOP_PERSON }));
  });

  it("records the person's skip with the reason, then starts the next phase", async () => {
    await approvedThroughBuild();
    await submitted("review");
    await approve(fakeInvoke(), root, "review");
    const result = await skipOptional(fakeInvoke(), root, "security-pass", "Internal prototype");
    expect(result).toEqual({ ok: true, message: '"security-pass" skipped. "release" has started.' });
    const { events } = await store.readEvents();
    expect(events.find((e) => e.type === "phase_skipped")).toEqual(
      expect.objectContaining({ actor: DESKTOP_PERSON, payload: { phase: "security-pass", reason: "Internal prototype" } }),
    );
  });

  it("sends a phase back with the person's notes", async () => {
    await submitted("idea-review");
    const result = await requestChanges(fakeInvoke(), root, "idea-review", "Add the competitors section");
    expect(result).toEqual({ ok: true, message: 'Changes requested for "idea-review".' });
    expect(await lastEvent()).toEqual(
      expect.objectContaining({ type: "changes_requested", actor: DESKTOP_PERSON, payload: { phase: "idea-review", notes: "Add the competitors section" } }),
    );
  });

  it("reports the engine's reason when an action is not allowed", async () => {
    const result = await approve(fakeInvoke(), root, "idea-review");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not awaiting review/);
  });
});
