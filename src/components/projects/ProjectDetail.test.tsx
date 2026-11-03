import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ProjectDetail } from "./ProjectDetail";
import type { ProjectDetailResult } from "../../lib/projects";

const detail: ProjectDetailResult = {
  ok: true,
  name: "Orbit",
  flow: "build",
  mode: "full",
  history: [{ phase: "idea-review", status: "in_progress", isNext: true, submissions: [], changeRequests: [], sessions: [] }],
};

describe("ProjectDetail", () => {
  it("shows loading, then the project's name and phase history", async () => {
    let resolve!: (r: ProjectDetailResult) => void;
    const load = vi.fn(() => new Promise<ProjectDetailResult>((r) => (resolve = r)));
    render(<ProjectDetail root="C:/work/orbit" load={load} onBack={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/loading/i);
    expect(load).toHaveBeenCalledWith("C:/work/orbit");
    resolve(detail);
    expect(await screen.findByRole("heading", { name: "Orbit" })).toBeDefined();
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
    await screen.findByRole("heading", { name: "Orbit" });
    fireEvent.click(screen.getByRole("button", { name: /back to projects/i }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("ProjectDetail: decisions (E3 slice 3)", () => {
  const awaiting: ProjectDetailResult = {
    ok: true,
    name: "Orbit planner",
    flow: "build",
    mode: "full",
    history: [{ phase: "prd", status: "awaiting_review", isNext: true, submissions: [], changeRequests: [], sessions: [] }],
  };
  const approved: ProjectDetailResult = {
    ...awaiting,
    history: [{ phase: "prd", status: "approved", isNext: false, submissions: [], changeRequests: [], sessions: [] }],
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

describe("ProjectDetail: project details (E3 slice 4b)", () => {
  it("saves a new name, announces it and shows the renamed project", async () => {
    const renamed = { ...detail, name: "Orbit planner" } as ProjectDetailResult;
    const load = vi.fn().mockResolvedValueOnce(detail).mockResolvedValueOnce(renamed);
    const update = vi.fn(() => Promise.resolve({ ok: true, message: "Project details saved." }));
    render(<ProjectDetail root="C:/work/orbit" load={load} onBack={vi.fn()} details={{ update }} />);
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Orbit planner" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Project details saved/);
    expect(update).toHaveBeenCalledWith("C:/work/orbit", { name: "Orbit planner" });
    expect(await screen.findByRole("heading", { name: "Orbit planner" })).toBeDefined();
  });
});

describe("ProjectDetail: the details form after a save (E3 slice 4b)", () => {
  it("shows the saved values, which may differ from what was typed", async () => {
    const saved = { ...detail, name: "Orbit [REDACTED]" } as ProjectDetailResult;
    const load = vi.fn().mockResolvedValueOnce(detail).mockResolvedValueOnce(saved);
    const update = vi.fn(() => Promise.resolve({ ok: true, message: "Project details saved." }));
    render(<ProjectDetail root="C:/work/orbit" load={load} onBack={vi.fn()} details={{ update }} />);
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Orbit sk-not-a-real-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await screen.findByRole("heading", { name: "Orbit [REDACTED]" });
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("Orbit [REDACTED]");
  });
});

describe("ProjectDetail: the task list (E5 slice 5)", () => {
  const afterArchitecture = (taskCount: number): ProjectDetailResult => ({
    ok: true,
    name: "Orbit",
    flow: "build",
    mode: "full",
    taskCount,
    history: [
      { phase: "architecture", status: "approved", isNext: false, submissions: [], changeRequests: [], sessions: [] },
      { phase: "build", status: "in_progress", isNext: true, submissions: [], changeRequests: [], sessions: [] },
    ],
  });
  const planning = {
    run: vi.fn(),
    providerReady: true,
    readDocument: vi.fn(),
    readProposal: vi.fn().mockResolvedValue({ ok: false, error: "No task list has been proposed yet." }),
    propose: vi.fn(),
    approveTasks: vi.fn(),
  };

  it("offers the task list once the architecture is approved and there are no tasks", async () => {
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(afterArchitecture(0))} onBack={vi.fn()} planning={planning} />);
    expect(await screen.findByRole("region", { name: "Task list" })).toBeDefined();
  });

  it("does not offer it once the project has tasks", async () => {
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(afterArchitecture(3))} onBack={vi.fn()} planning={planning} />);
    await screen.findByRole("heading", { name: "Orbit" });
    expect(screen.queryByRole("region", { name: "Task list" })).toBeNull();
  });
});

describe("ProjectDetail: tools for the build (E6)", () => {
  const withTasks = (taskCount: number, architecture: "approved" | "awaiting_review"): ProjectDetailResult => ({
    ok: true,
    name: "Orbit",
    flow: "build",
    mode: "full",
    taskCount,
    history: [
      { phase: "architecture", status: architecture, isNext: architecture !== "approved", submissions: [], changeRequests: [], sessions: [] },
      { phase: "build", status: "in_progress", isNext: architecture === "approved", submissions: [], changeRequests: [], sessions: [] },
    ],
  });
  const team = {
    discover: vi.fn().mockResolvedValue({ ok: true, tools: [] }),
    load: vi.fn().mockResolvedValue({ ok: true, team: null }),
    save: vi.fn(),
    handOff: vi.fn(),
  };

  it("shows the tools once the architecture is approved and the task list exists", async () => {
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(withTasks(2, "approved"))} onBack={vi.fn()} team={team} />);
    expect(await screen.findByRole("region", { name: "Tools for the build" })).toBeDefined();
  });

  it("asks for the tools as soon as the architecture is approved, before the task list (D), and never earlier", async () => {
    const { unmount } = render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(withTasks(0, "approved"))} onBack={vi.fn()} team={team} />);
    await screen.findByRole("heading", { name: "Orbit" });
    expect(await screen.findByRole("region", { name: "Tools for the build" })).toBeDefined();
    unmount();
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(withTasks(2, "awaiting_review"))} onBack={vi.fn()} team={team} />);
    await screen.findByRole("heading", { name: "Orbit" });
    expect(screen.queryByRole("region", { name: "Tools for the build" })).toBeNull();
  });
});

describe("ProjectDetail: fresh session per phase (E11)", () => {
  const team = { formatVersion: 1 as const, updatedAt: "2026-11-03T10:00:00Z", members: [{ toolId: "made-up-cli", name: "Made-up CLI", capability: 2, confirmedByPerson: true, addedAt: "2026-11-03T10:00:00Z" }] };
  const fresh = { loadTeam: () => Promise.resolve({ ok: true as const, team }), start: vi.fn() };
  const withHistory = (first: "approved" | "awaiting_review"): ProjectDetailResult => ({
    ...detail,
    history: [
      { phase: "prd", status: first, isNext: first !== "approved", submissions: [], changeRequests: [], sessions: [] },
      { phase: "architecture", status: "not_started", isNext: first === "approved", submissions: [], changeRequests: [], sessions: [] },
    ],
  });

  it("offers the next phase in a fresh session once a phase is approved", async () => {
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(withHistory("approved"))} onBack={vi.fn()} fresh={fresh} />);
    expect(await screen.findByRole("button", { name: "Start architecture in a fresh session" })).toBeDefined();
  });

  it("does not offer it while nothing is approved yet", async () => {
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(withHistory("awaiting_review"))} onBack={vi.fn()} fresh={fresh} />);
    await screen.findByRole("heading", { name: "Orbit" });
    expect(screen.queryByRole("heading", { name: "Next phase in a fresh session" })).toBeNull();
  });
});

describe("ProjectDetail: live updates (E7)", () => {
  it("reloads when the project's memory changes elsewhere, keeping the page on screen (E7)", async () => {
    const later: ProjectDetailResult = { ...detail, history: [{ ...detail.history[0], status: "awaiting_review" }] };
    const load = vi.fn().mockResolvedValueOnce(detail).mockResolvedValue(later);
    let changed!: () => void;
    const stop = vi.fn();
    const watch = vi.fn((_root: string, onChange: () => void) => {
      changed = onChange;
      return stop;
    });
    const { unmount } = render(<ProjectDetail root="C:/work/orbit" load={load} onBack={vi.fn()} watch={watch} />);
    await screen.findByRole("heading", { name: "Orbit" });
    expect(watch).toHaveBeenCalledWith("C:/work/orbit", expect.any(Function), expect.any(Function));
    act(() => changed());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { name: "Orbit" })).toBeDefined();
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("shows the workflow chart and updates it when memory changes elsewhere (E8, VIS-3)", async () => {
    const phase = (status: "in_progress" | "awaiting_review") => ({ id: "phase:idea-review", kind: "phase" as const, label: "idea-review", status, isNext: true, events: [] });
    const withChart = (status: "in_progress" | "awaiting_review"): ProjectDetailResult => ({ ...detail, workflow: { nodes: [phase(status)], edges: [] } });
    const load = vi.fn().mockResolvedValueOnce(withChart("in_progress")).mockResolvedValue(withChart("awaiting_review"));
    let changed!: () => void;
    const watch = (_root: string, onChange: () => void) => {
      changed = onChange;
      return () => {};
    };
    render(<ProjectDetail root="C:/work/orbit" load={load} onBack={vi.fn()} watch={watch} />);
    expect(await screen.findByRole("button", { name: "Phase idea-review: in progress, next" })).toBeDefined();
    act(() => changed());
    expect(await screen.findByRole("button", { name: "Phase idea-review: review needed, next" })).toBeDefined();
  });

  it("says so when live updates stop working", async () => {
    const watch = (_root: string, _onChange: () => void, onError: (message: string) => void) => {
      onError("Live updates are off: disk unavailable");
      return () => {};
    };
    render(<ProjectDetail root="C:/work/orbit" load={() => Promise.resolve(detail)} onBack={vi.fn()} watch={watch} />);
    expect((await screen.findByText(/live updates are off/i)).textContent).toMatch(/disk unavailable/);
  });
});
