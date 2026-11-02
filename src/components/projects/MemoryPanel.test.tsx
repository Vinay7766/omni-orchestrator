import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryFiles } from "./MemoryFiles";
import { MemoryEntryForm } from "./MemoryEntryForm";
import { MemoryPanel } from "./MemoryPanel";
import type { MemoryFile } from "../../lib/memory";

const files: MemoryFile[] = [
  { name: "summary.md", content: "# Orbit\n\n## Where we are" },
  { name: "decisions.md", content: "# Decisions\n\n- Use SQLite" },
  { name: "problems.md", content: null },
  { name: "lessons.md", content: "# Lessons" },
  { name: "project.json", content: '{ "name": "Orbit" }' },
  { name: "state.json", content: "{}" },
];

describe("MemoryFiles (E3 slice 4a)", () => {
  it("shows the summary first, and another file when chosen", () => {
    render(<MemoryFiles files={files} />);
    expect(screen.getByLabelText("summary.md").textContent).toContain("# Orbit");
    fireEvent.click(screen.getByRole("button", { name: "decisions.md" }));
    expect(screen.getByLabelText("decisions.md").textContent).toContain("Use SQLite");
    expect(screen.getByRole("button", { name: "decisions.md" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("explains that the files are generated and read-only", () => {
    render(<MemoryFiles files={files} />);
    expect(screen.getByText(/generated from the project's event log/i)).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says when a file has not been written yet", () => {
    render(<MemoryFiles files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "problems.md" }));
    expect(screen.getByText(/not been written yet/i)).toBeDefined();
  });
});

describe("MemoryEntryForm (E3 slice 4a)", () => {
  it("records a decision with its references once the required fields are filled", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<MemoryEntryForm onSubmit={onSubmit} />);
    const record = () => screen.getByRole("button", { name: "Record" }) as HTMLButtonElement;
    expect(record().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Use SQLite" } });
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "Store tasks in SQLite" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Single user" } });
    expect(record().disabled).toBe(true); // a decision must point at a file or commit
    fireEvent.change(screen.getByLabelText("Files it concerns (one per line)"), { target: { value: "docs/ARCHITECTURE.md\n\n docs/PRD.md " } });
    expect(record().disabled).toBe(false);
    await act(async () => fireEvent.click(record()));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "decision",
      title: "Use SQLite",
      decision: "Store tasks in SQLite",
      reason: "Single user",
      files: ["docs/ARCHITECTURE.md", "docs/PRD.md"],
      commits: [],
    });
  });

  it("records a problem with its status", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<MemoryEntryForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "problem" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Slow start" } });
    fireEvent.change(screen.getByLabelText("Details"), { target: { value: "4 s" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "resolved" } });
    fireEvent.change(screen.getByLabelText("Commits it concerns (one per line)"), { target: { value: "a1b2c3d" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record" })));
    expect(onSubmit).toHaveBeenCalledWith({ kind: "problem", title: "Slow start", details: "4 s", status: "resolved", files: [], commits: ["a1b2c3d"] });
  });

  it("clears the typed text when the kind changes, so it does not carry over", () => {
    render(<MemoryEntryForm onSubmit={vi.fn(() => Promise.resolve())} />);
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "Store tasks in SQLite" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "lesson" } });
    expect((screen.getByLabelText("Lesson") as HTMLTextAreaElement).value).toBe("");
  });

  it("records a lesson without references", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<MemoryEntryForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "lesson" } });
    fireEvent.change(screen.getByLabelText("Lesson"), { target: { value: "Named tools are examples" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record" })));
    expect(onSubmit).toHaveBeenCalledWith({ kind: "lesson", lesson: "Named tools are examples" });
  });
});

describe("MemoryPanel (E3 slice 4a)", () => {
  it("loads the files, records an entry, announces the result and reloads", async () => {
    const before = { ok: true as const, files };
    const after = { ok: true as const, files: files.map((f) => (f.name === "lessons.md" ? { ...f, content: "# Lessons\n\n- Named tools are examples" } : f)) };
    const load = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const add = vi.fn(() => Promise.resolve({ ok: true, message: "Recorded." }));
    render(<MemoryPanel root="C:/work/orbit" load={load} add={add} />);
    await screen.findByLabelText("summary.md");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "lesson" } });
    fireEvent.change(screen.getByLabelText("Lesson"), { target: { value: "Named tools are examples" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record" })));
    expect(add).toHaveBeenCalledWith("C:/work/orbit", { kind: "lesson", lesson: "Named tools are examples" });
    expect((await screen.findByRole("status")).textContent).toMatch(/Recorded/);
    expect(load).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "lessons.md" }));
    expect(screen.getByLabelText("lessons.md").textContent).toContain("Named tools are examples");
  });

  it("shows why an entry was not recorded", async () => {
    const add = vi.fn(() => Promise.resolve({ ok: false, message: "Fix these references before recording this decision: docs/NOPE.md: missing." }));
    render(<MemoryPanel root="C:/work/orbit" load={() => Promise.resolve({ ok: true as const, files })} add={add} />);
    await screen.findByLabelText("summary.md");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "t" } });
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "r" } });
    fireEvent.change(screen.getByLabelText("Files it concerns (one per line)"), { target: { value: "docs/NOPE.md" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record" })));
    expect((await screen.findByRole("alert")).textContent).toMatch(/docs\/NOPE\.md: missing/);
  });

  it("shows the real error when the memory cannot be read", async () => {
    render(<MemoryPanel root="C:/work/orbit" load={() => Promise.resolve({ ok: false as const, error: "access denied" })} add={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/access denied/);
  });
});
