import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PhaseHistoryEntry } from "@omni/core";
import { PhaseHistory } from "./PhaseHistory";

const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "made-up-agent", model: "made-up-model" };
const T = "2026-11-02T10:00:00.000Z";

const entry = (over: Partial<PhaseHistoryEntry> & { phase: string }): PhaseHistoryEntry => ({
  status: "not_started",
  isNext: false,
  submissions: [],
  changeRequests: [],
  ...over,
});

const item = (phase: string) => within(screen.getByRole("list", { name: "Phases" })).getByRole("listitem", { name: phase });

describe("PhaseHistory (GATE-5)", () => {
  it("lists every phase in order, each with its status in words", () => {
    render(
      <PhaseHistory
        entries={[
          entry({ phase: "idea-review", status: "approved" }),
          entry({ phase: "research", status: "awaiting_review" }),
          entry({ phase: "prd" }),
        ]}
      />,
    );
    const phases = within(screen.getByRole("list", { name: "Phases" })).getAllByRole("listitem");
    expect(phases.map((li) => li.getAttribute("aria-label"))).toEqual(["idea-review", "research", "prd"]);
    expect(within(item("idea-review")).getByText("approved")).toBeDefined();
    expect(within(item("research")).getByText("review needed")).toBeDefined();
    expect(within(item("prd")).getByText("not started")).toBeDefined();
  });

  it("shows what was handed in: documents, skills with evidence, and who handed it in", () => {
    render(
      <PhaseHistory
        entries={[
          entry({
            phase: "prd",
            status: "awaiting_review",
            submissions: [
              {
                time: T,
                by: agent,
                documents: ["docs/PRD.md"],
                skillsUsed: [{ skill: "spec-driven-development", evidence: "follows the six sections" }],
                understandingCheck: "docs/prd-understanding.md",
              },
            ],
          }),
        ]}
      />,
    );
    const prd = within(item("prd"));
    expect(prd.getByText("docs/PRD.md")).toBeDefined();
    expect(prd.getByText(/spec-driven-development/)).toBeDefined();
    expect(prd.getByText(/follows the six sections/)).toBeDefined();
    expect(prd.getByText(/docs\/prd-understanding\.md/)).toBeDefined();
    expect(prd.getByText(/made-up-agent/)).toBeDefined();
    expect(prd.queryByText(/Stack decision record/)).toBeNull();
  });

  it("shows the stack decision record handed in with an architecture submission (C16)", () => {
    render(
      <PhaseHistory
        entries={[
          entry({
            phase: "architecture",
            status: "awaiting_review",
            submissions: [{ time: T, by: agent, documents: ["docs/ARCHITECTURE.md"], skillsUsed: [], stackAdr: "docs/decisions/ADR-001-stack.md" }],
          }),
        ]}
      />,
    );
    const arch = within(item("architecture"));
    expect(arch.getByText(/Stack decision record/)).toBeDefined();
    expect(arch.getByText("docs/decisions/ADR-001-stack.md")).toBeDefined();
  });

  it("shows change requests and the person's decision", () => {
    render(
      <PhaseHistory
        entries={[
          entry({
            phase: "research",
            status: "approved",
            changeRequests: [{ time: T, by: person, notes: "Add two more competitors" }],
            decision: { kind: "approved", time: T, by: person },
          }),
        ]}
      />,
    );
    const research = within(item("research"));
    expect(research.getByText(/Add two more competitors/)).toBeDefined();
    expect(research.getByText(/Approved by a person/)).toBeDefined();
  });

  it("shows a skipped optional phase with the reason, and the question for one still to decide", () => {
    render(
      <PhaseHistory
        entries={[
          entry({
            phase: "security-pass",
            status: "skipped",
            optionalQuestion: "Run a red-team / blue-team pass?",
            decision: { kind: "skipped", time: T, by: person, reason: "Internal prototype" },
          }),
          entry({ phase: "made-up-optional", isNext: true, optionalQuestion: "Run the made-up optional phase?" }),
        ]}
      />,
    );
    const pass = within(item("security-pass"));
    expect(pass.getByText("skipped")).toBeDefined();
    expect(pass.getByText(/Skipped by a person/)).toBeDefined();
    expect(pass.getByText(/Internal prototype/)).toBeDefined();
    const pending = within(item("made-up-optional"));
    expect(pending.getByText("Run the made-up optional phase?")).toBeDefined();
    expect(pending.getByText(/your decision/i)).toBeDefined();
  });

  it("marks the phase to work on next in words, not only by colour", () => {
    render(<PhaseHistory entries={[entry({ phase: "idea-review", status: "approved" }), entry({ phase: "research", isNext: true })]} />);
    expect(within(item("research")).getByText("Next")).toBeDefined();
    expect(within(item("idea-review")).queryByText("Next")).toBeNull();
  });
});
