import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Workflow } from "@omni/core";
import { WorkflowChart } from "./WorkflowChart";

// E8 / VIS-1..3: chart of phases, gates and tasks; node details; an equivalent list.

const agent = { kind: "agent" as const, tool: "made-up-agent", model: "made-up-model" };
const person = { kind: "human" as const, tool: "omni-desktop" };

const workflow: Workflow = {
  nodes: [
    {
      id: "phase:prd",
      kind: "phase",
      label: "prd",
      status: "approved",
      isNext: false,
      events: [
        {
          id: "ev-7",
          type: "phase_submitted",
          time: "2026-11-03T10:00:00.000Z",
          by: agent,
          files: ["docs/PRD.md"],
          commits: [],
          documents: ["docs/PRD.md"],
          skillsUsed: [{ skill: "spec-driven-development", evidence: "sections followed" }],
        },
      ],
    },
    {
      id: "gate:prd",
      kind: "gate",
      label: "prd review",
      phase: "prd",
      status: "approved",
      events: [{ id: "ev-8", type: "phase_approved", time: "2026-11-03T11:00:00.000Z", by: person, files: [], commits: ["abc1234"] }],
    },
    { id: "phase:build", kind: "phase", label: "build", status: "in_progress", isNext: true, events: [] },
    { id: "gate:build", kind: "gate", label: "build review", phase: "build", status: "not_reached", events: [] },
    { id: "task:t1", kind: "task", label: "Login form", status: "todo", events: [] },
  ],
  edges: [
    { from: "phase:prd", to: "gate:prd" },
    { from: "gate:prd", to: "phase:build" },
    { from: "phase:build", to: "gate:build" },
    { from: "phase:build", to: "task:t1" },
  ],
};

describe("WorkflowChart", () => {
  it("shows every node as a button naming its kind and status in words", () => {
    render(<WorkflowChart workflow={workflow} />);
    const chart = screen.getByRole("group", { name: "Workflow chart" });
    expect(within(chart).getByRole("button", { name: "Phase prd: approved" })).toBeInTheDocument();
    expect(within(chart).getByRole("button", { name: "Gate prd review: approved" })).toBeInTheDocument();
    expect(within(chart).getByRole("button", { name: "Phase build: in progress, next" })).toBeInTheDocument();
    expect(within(chart).getByRole("button", { name: "Gate build review: not reached" })).toBeInTheDocument();
    expect(within(chart).getByRole("button", { name: "Task Login form: to do" })).toBeInTheDocument();
  });

  it("shows a selected node's details: what, who, when, skills, and the event, file and commit it comes from", () => {
    render(<WorkflowChart workflow={workflow} />);
    fireEvent.click(screen.getByRole("button", { name: "Phase prd: approved" }));
    const details = screen.getByRole("region", { name: "Details: prd" });
    expect(details).toHaveTextContent("Handed in by made-up-agent, made-up-model");
    expect(details).toHaveTextContent("event ev-7");
    expect(details).toHaveTextContent("docs/PRD.md");
    expect(details).toHaveTextContent("spec-driven-development: sections followed");

    fireEvent.click(screen.getByRole("button", { name: "Gate prd review: approved" }));
    const gate = screen.getByRole("region", { name: "Details: prd review" });
    expect(gate).toHaveTextContent("Approved by a person (omni-desktop)");
    expect(gate).toHaveTextContent("abc1234");
    expect(screen.getByRole("button", { name: "Gate prd review: approved" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says when nothing is recorded for a node yet", () => {
    render(<WorkflowChart workflow={workflow} />);
    fireEvent.click(screen.getByRole("button", { name: "Task Login form: to do" }));
    expect(screen.getByRole("region", { name: "Details: Login form" })).toHaveTextContent("Nothing recorded yet.");
  });

  it("offers a list with every node and every detail the chart has", () => {
    render(<WorkflowChart workflow={workflow} />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const list = screen.getByRole("list", { name: "Workflow as a list" });
    for (const text of ["prd", "prd review", "build", "build review", "Login form", "not reached", "event ev-7", "event ev-8", "abc1234", "spec-driven-development: sections followed"]) {
      expect(list).toHaveTextContent(text);
    }
    expect(within(list).getByText(/Task Login form/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Workflow chart" })).toBeNull();
  });

  it("keeps the selected node and shows its new events when memory changes", () => {
    const { rerender } = render(<WorkflowChart workflow={workflow} />);
    fireEvent.click(screen.getByRole("button", { name: "Task Login form: to do" }));
    const later: Workflow = {
      ...workflow,
      nodes: workflow.nodes.map((n) =>
        n.id === "task:t1"
          ? { ...n, status: "in_progress", events: [{ id: "ev-9", type: "task_started", time: "2026-11-03T12:00:00.000Z", by: agent, files: [], commits: [] }] }
          : n,
      ) as Workflow["nodes"],
    };
    rerender(<WorkflowChart workflow={later} />);
    expect(screen.getByRole("button", { name: "Task Login form: in progress" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Details: Login form" })).toHaveTextContent("event ev-9");
  });
});
