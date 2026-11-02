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
