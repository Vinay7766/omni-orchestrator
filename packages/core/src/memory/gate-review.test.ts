import { describe, it, expect } from "vitest";
import type { Event } from "../generated/types.js";
import { buildGateReview, findBatchApprovals, gateReviewText } from "./gate-review.js";
import { buildPhaseHistory } from "./history.js";

// C18 / GATE-6: what a person sees at a gate, built only from memory; and the batch safeguard.

const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "made-up-agent", model: "made-up-model" };
let n = 0;
const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 10, 3, 9, minute, second)).toISOString();
function ev(type: Event["type"], minute: number, payload: Record<string, unknown>, extra: Partial<Event> = {}, second = 0): Event {
  n += 1;
  return { formatVersion: 1, id: `evt_${String(n).padStart(4, "0")}`, time: at(minute, second), type, actor: agent, payload, ...extra };
}

const submitted = (phase: string, minute: number, over: Record<string, unknown> = {}) =>
  ev("phase_submitted", minute, { phase, documents: [`docs/planning/${phase}.md`], skillsUsed: [{ skill: "idea-review", evidence: "checked the users" }], ...over });
const approved = (phase: string, minute: number, second = 0) => ev("phase_approved", minute, { phase }, { actor: person }, second);

describe("buildGateReview", () => {
  it("summarises the latest submission of the phase under review", () => {
    const events = [
      ev("phase_started", 1, { phase: "prd" }),
      submitted("prd", 5, { understandingCheck: "docs/planning/understanding.md" }),
    ];
    const review = buildGateReview(events, "prd");
    expect(review?.submission).toMatchObject({
      by: agent,
      time: at(5),
      documents: ["docs/planning/prd.md"],
      skillsUsed: [{ skill: "idea-review", evidence: "checked the users" }],
      understandingCheck: "docs/planning/understanding.md",
    });
  });

  it("returns nothing for a phase that was never submitted", () => {
    expect(buildGateReview([ev("phase_started", 1, { phase: "prd" })], "prd")).toBeNull();
  });

  it("lists what was recorded since the last gate decision, with each file and commit once", () => {
    const events = [
      approved("research", 0),
      ev("decision_recorded", 2, { title: "Store notes locally", decision: "d", reason: "r" }, { refs: { files: ["src/a.ts"], commits: ["abc1234"] } }),
      ev("task_created", 3, { taskId: "T-1", title: "Write the PRD" }),
      ev("problem_recorded", 4, { title: "Pricing unknown", details: "d", status: "open" }, { refs: { files: ["src/a.ts", "docs/b.md"] } }),
      submitted("prd", 5),
    ];
    const review = buildGateReview(events, "prd");
    expect(review?.since.from).toBe(at(0));
    expect(review?.since.items.map((i) => i.text)).toEqual([
      "Decision recorded: Store notes locally",
      "Task created: T-1 Write the PRD",
      "Problem recorded: Pricing unknown",
    ]);
    expect(review?.since.files).toEqual(["src/a.ts", "docs/b.md", "docs/planning/prd.md"]);
    expect(review?.since.commits).toEqual(["abc1234"]);
  });

  it("starts from the project's beginning when there was no earlier gate", () => {
    const review = buildGateReview([ev("phase_started", 1, { phase: "idea-review" }), submitted("idea-review", 2)], "idea-review");
    expect(review?.since.from).toBeNull();
  });

  it("after changes were requested, shows the earlier notes and counts from that request", () => {
    const events = [
      approved("research", 0),
      submitted("prd", 5),
      ev("changes_requested", 6, { phase: "prd", notes: "Add the pricing section" }, { actor: person }),
      ev("lesson_recorded", 7, { lesson: "Pricing matters to clinics" }),
      submitted("prd", 9),
    ];
    const review = buildGateReview(events, "prd");
    expect(review?.earlierChangeRequests).toEqual([{ time: at(6), notes: "Add the pricing section" }]);
    expect(review?.since.from).toBe(at(6));
    expect(review?.since.items.map((i) => i.text)).toEqual(["Lesson recorded: Pricing matters to clinics"]);
    expect(review?.submission.time).toBe(at(9));
  });
});

describe("gateReviewText", () => {
  it("writes the review as plain text and says so when nothing else was recorded", () => {
    const review = buildGateReview([approved("research", 0), submitted("prd", 5)], "prd");
    const text = gateReviewText(review!);
    expect(text).toContain("Submitted by made-up-agent (made-up-model)");
    expect(text).toContain("docs/planning/prd.md");
    expect(text).toContain("idea-review: checked the users");
    expect(text).toMatch(/Since the last gate .*: nothing else was recorded\./);
  });

  it("lists earlier change requests so the person can check they were addressed", () => {
    const events = [submitted("prd", 5), ev("changes_requested", 6, { phase: "prd", notes: "Add pricing" }, { actor: person }), submitted("prd", 9)];
    expect(gateReviewText(buildGateReview(events, "prd")!)).toContain("You asked for changes before: Add pricing");
  });
});

describe("findBatchApprovals (GATE-6 safeguard)", () => {
  it("finds no batch when each approval came long after the one before", () => {
    expect(findBatchApprovals([approved("idea-review", 0), approved("research", 20), approved("prd", 45)])).toEqual([]);
  });

  it("groups approvals of different phases made within a minute of each other", () => {
    const events = [approved("idea-review", 0), approved("made-up-a", 10, 0), approved("made-up-b", 10, 30), approved("made-up-c", 11, 10)];
    expect(findBatchApprovals(events)).toEqual([{ phases: ["made-up-a", "made-up-b", "made-up-c"], from: at(10, 0), to: at(11, 10) }]);
  });

  it("marks each phase of a batch in the phase history with every phase in it", () => {
    const flows = { made: ["made-up-a", "made-up-b"] };
    const events = [approved("made-up-a", 10, 0), approved("made-up-b", 10, 5)];
    const state = { formatVersion: 1 as const, flow: "made", currentPhase: null, phases: { "made-up-a": { status: "approved" as const }, "made-up-b": { status: "approved" as const } }, tasks: [], lastEventId: null };
    const history = buildPhaseHistory("made", state, events, { flows, optional: {} });
    expect(history.map((h) => h.decision?.batch)).toEqual([["made-up-a", "made-up-b"], ["made-up-a", "made-up-b"]]);
  });
});

describe("after an approval is withdrawn (issue D)", () => {
  it("the phase history no longer says the phase is approved", () => {
    const flows = { made: ["made-up-a", "made-up-b"] };
    const events = [approved("made-up-a", 10), ev("approval_withdrawn", 11, { phase: "made-up-a" }, { actor: person })];
    const state = { formatVersion: 1 as const, flow: "made", currentPhase: "made-up-a", phases: { "made-up-a": { status: "awaiting_review" as const } }, tasks: [], lastEventId: null };
    expect(buildPhaseHistory("made", state, events, { flows, optional: {} })[0].decision).toBeUndefined();
  });
});
