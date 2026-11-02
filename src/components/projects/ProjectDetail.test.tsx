import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectDetail } from "./ProjectDetail";
import type { ProjectDetailResult } from "../../lib/projects";

const detail: ProjectDetailResult = {
  ok: true,
  name: "Orbit planner",
  flow: "build",
  history: [{ phase: "idea-review", status: "in_progress", isNext: true, submissions: [], changeRequests: [] }],
};

describe("ProjectDetail", () => {
  it("shows loading, then the project's name and phase history", async () => {
    let resolve!: (r: ProjectDetailResult) => void;
    const load = vi.fn(() => new Promise<ProjectDetailResult>((r) => (resolve = r)));
    render(<ProjectDetail root="C:/work/orbit" load={load} onBack={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/loading/i);
    expect(load).toHaveBeenCalledWith("C:/work/orbit");
    resolve(detail);
    expect(await screen.findByRole("heading", { name: "Orbit planner" })).toBeDefined();
    expect(screen.getByRole("list", { name: "Phases" })).toBeDefined();
  });

  it("shows the real error when the memory cannot be read", async () => {
    const load = vi.fn(() => Promise.resolve<ProjectDetailResult>({ ok: false, error: "events.jsonl: access denied" }));
    render(<ProjectDetail root="C:/work/orbit" load={load} onBack={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/access denied/);
  });

  it("goes back to the projects list", async () => {
    const onBack = vi.fn();
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(detail)} onBack={onBack} />);
    await screen.findByRole("heading", { name: "Orbit planner" });
    fireEvent.click(screen.getByRole("button", { name: /back to projects/i }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("ProjectDetail: decisions (E3 slice 3)", () => {
  const awaiting: ProjectDetailResult = {
    ok: true,
    name: "Orbit planner",
    flow: "build",
    history: [{ phase: "prd", status: "awaiting_review", isNext: true, submissions: [], changeRequests: [] }],
  };
  const approved: ProjectDetailResult = {
    ...awaiting,
    history: [{ phase: "prd", status: "approved", isNext: false, submissions: [], changeRequests: [] }],
  } as ProjectDetailResult;

  it("records a decision, announces the result, and reloads the history", async () => {
    const load = vi.fn().mockResolvedValueOnce(awaiting).mockResolvedValueOnce(approved);
    const decide = { approve: vi.fn(() => Promise.resolve({ ok: true, message: '"prd" approved. "architecture" has started.' })) };
    render(<ProjectDetail root="C:/work/orbit" load={load} onBack={vi.fn()} decide={decide} />);
    fireEvent.click(await screen.findByRole("button", { name: 'Approve "prd"' }));
    expect((await screen.findByRole("status")).textContent).toMatch(/"architecture" has started/);
    expect(decide.approve).toHaveBeenCalledWith("C:/work/orbit", "prd");
    expect(load).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("approved")).toBeDefined();
  });

  it("shows the reason when a decision is refused", async () => {
    const decide = { approve: vi.fn(() => Promise.resolve({ ok: false, message: '"prd" is not awaiting review (it is approved)' })) };
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(awaiting)} onBack={vi.fn()} decide={decide} />);
    fireEvent.click(await screen.findByRole("button", { name: 'Approve "prd"' }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not awaiting review/);
  });
});

describe("ProjectDetail: project memory (E3 slice 4a)", () => {
  it("shows the project memory below the phases when it can be read", async () => {
    const memory = {
      load: vi.fn(() => Promise.resolve({ ok: true as const, files: [{ name: "summary.md" as const, content: "# Orbit" }] })),
      add: vi.fn(),
    };
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(detail)} onBack={vi.fn()} memory={memory} />);
    expect(await screen.findByRole("heading", { name: "Project memory" })).toBeDefined();
    expect((await screen.findByLabelText("summary.md")).textContent).toContain("# Orbit");
    expect(memory.load).toHaveBeenCalledWith("C:/work/orbit");
  });
});
