import { describe, it, expect } from "vitest";
import type { Event, State } from "../generated/types.js";
import { rebuild } from "./reduce.js";
import { buildWorkflow } from "./workflow.js";

// E8 / VIS-1, VIS-2: the workflow chart's nodes come only from project memory.

const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "made-up-agent", model: "made-up-model" };
const flows = { build: ["requirements", "build"] };

let seq = 0;
function ev(type: Event["type"], actor: Event["actor"], payload: Record<string, unknown>, refs?: Event["refs"]): Event {
  seq += 1;
  return {
    formatVersion: 1,
    id: `ev-${seq}`,
    time: `2026-11-03T10:00:${String(seq).padStart(2, "0")}.000Z`,
    type,
    actor,
    payload,
    ...(refs ? { refs } : {}),
  } as Event;
}

function stateFor(events: Event[]): State {
  return rebuild("build", events);
}

describe("buildWorkflow", () => {
  it("gives every phase a phase node and a gate node, chained in flow order", () => {
    const wf = buildWorkflow("build", stateFor([]), [], { flows });
    expect(wf.nodes.map((n) => n.id)).toEqual(["phase:requirements", "gate:requirements", "phase:build", "gate:build"]);
    expect(wf.edges).toEqual([
      { from: "phase:requirements", to: "gate:requirements" },
      { from: "gate:requirements", to: "phase:build" },
      { from: "phase:build", to: "gate:build" },
    ]);
    expect(wf.nodes.every((n) => n.events.length === 0)).toBe(true);
    expect(wf.nodes.find((n) => n.id === "gate:requirements")?.status).toBe("not_reached");
  });

  it("puts started, submitted and change-request events on the phase, and the decision on its gate", () => {
    const events = [
      ev("phase_started", agent, { phase: "requirements" }),
      ev("phase_submitted", agent, { phase: "requirements", documents: ["docs/PRD.md"], skillsUsed: [{ skill: "spec", evidence: "sections" }] }, { files: ["docs/PRD.md"] }),
      ev("changes_requested", person, { phase: "requirements", notes: "Add limits" }),
      ev("phase_approved", person, { phase: "requirements" }, { commits: ["abc1234"] }),
    ];
    const wf = buildWorkflow("build", stateFor(events), events, { flows });
    const phase = wf.nodes.find((n) => n.id === "phase:requirements")!;
    const gate = wf.nodes.find((n) => n.id === "gate:requirements")!;

    expect(phase.status).toBe("approved");
    expect(phase.events.map((e) => e.type)).toEqual(["phase_started", "phase_submitted", "changes_requested"]);
    expect(phase.events[1]).toMatchObject({ id: "ev-2", by: agent, documents: ["docs/PRD.md"], skillsUsed: [{ skill: "spec", evidence: "sections" }], files: ["docs/PRD.md"] });
    expect(phase.events[2]).toMatchObject({ by: person, notes: "Add limits" });
    expect(gate.status).toBe("approved");
    expect(gate.events).toEqual([expect.objectContaining({ type: "phase_approved", by: person, commits: ["abc1234"] })]);
  });

  it("shows a gate as waiting while its phase awaits the person's review", () => {
    const events = [ev("phase_started", agent, { phase: "requirements" }), ev("phase_submitted", agent, { phase: "requirements", documents: ["docs/PRD.md"] })];
    const wf = buildWorkflow("build", stateFor(events), events, { flows });
    expect(wf.nodes.find((n) => n.id === "gate:requirements")?.status).toBe("waiting");
  });

  it("records a skip and its reason on the gate", () => {
    const events = [ev("phase_skipped", person, { phase: "requirements", reason: "Already written" })];
    const wf = buildWorkflow("build", stateFor(events), events, { flows });
    expect(wf.nodes.find((n) => n.id === "gate:requirements")).toMatchObject({ status: "skipped", events: [expect.objectContaining({ reason: "Already written" })] });
  });

  it("adds each task from memory under the build phase, with its status and events", () => {
    const events = [
      ev("task_created", agent, { taskId: "t1", title: "Login form" }),
      ev("design_note_submitted", agent, { taskId: "t1", notePath: ".agents/designs/t1.md" }, { files: [".agents/designs/t1.md"] }),
      ev("task_started", agent, { taskId: "t1" }),
      ev("task_created", agent, { taskId: "t2", title: "Logout" }),
    ];
    const wf = buildWorkflow("build", stateFor(events), events, { flows });
    const t1 = wf.nodes.find((n) => n.id === "task:t1")!;
    expect(t1).toMatchObject({ kind: "task", label: "Login form", status: "in_progress" });
    expect(t1.events.map((e) => e.type)).toEqual(["task_created", "design_note_submitted", "task_started"]);
    expect(t1.events[1]).toMatchObject({ documents: [".agents/designs/t1.md"] });
    expect(wf.nodes.find((n) => n.id === "task:t2")?.status).toBe("todo");
    expect(wf.edges).toContainEqual({ from: "phase:build", to: "task:t1" });
    expect(wf.edges).toContainEqual({ from: "phase:build", to: "task:t2" });
  });

  it("makes no node for an event memory does not tie to a phase or task in this flow", () => {
    const events = [
      ev("phase_started", agent, { phase: "made-up-phase" }),
      ev("task_started", agent, { taskId: "never-created" }),
      ev("lesson_recorded", agent, { text: "x" }),
    ];
    const wf = buildWorkflow("build", stateFor(events), events, { flows });
    expect(wf.nodes).toHaveLength(4);
    expect(wf.nodes.every((n) => n.events.length === 0)).toBe(true);
  });

  it("does not link tasks to a build phase the flow does not have", () => {
    const events = [ev("task_created", agent, { taskId: "t1", title: "x" })];
    const wf = buildWorkflow("build", stateFor(events), events, { flows: { build: ["requirements"] } });
    expect(wf.nodes.find((n) => n.id === "task:t1")).toBeDefined();
    expect(wf.edges.some((e) => e.to === "task:t1")).toBe(false);
  });
});
