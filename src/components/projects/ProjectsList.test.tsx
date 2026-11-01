import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ProjectOverview } from "@omni/core";
import { ProjectsList, timeAgo } from "./ProjectsList";
import type { ProjectsResult } from "../../lib/projects";

const overview = (over: Partial<ProjectOverview> = {}): ProjectOverview => ({
  name: "Orbit planner",
  flow: "build",
  mode: "full",
  phase: { id: "research", status: "awaiting_review" },
  tasks: { total: 4, done: 1, inProgress: ["T-2"], next: "T-3" },
  lastActivity: { time: "2026-11-02T10:00:00.000Z", type: "phase_submitted", actor: { kind: "agent", tool: "made-up-agent" } },
  issues: 0,
  ...over,
});
const NOW = Date.parse("2026-11-02T10:05:00.000Z");

function setup(folders: string[], result: ProjectsResult | Promise<ProjectsResult>) {
  const load = vi.fn(() => Promise.resolve(result));
  const onFoldersChange = vi.fn();
  render(<ProjectsList folders={folders} onFoldersChange={onFoldersChange} load={load} now={() => NOW} />);
  return { load, onFoldersChange };
}

describe("ProjectsList", () => {
  it("explains what to do when no folder is configured, without loading anything", () => {
    const { load } = setup([], { projects: [], errors: [] });
    expect(screen.getByText(/add a folder that contains your projects/i)).toBeDefined();
    expect(load).not.toHaveBeenCalled();
  });

  it("shows loading, then each project's real overview", async () => {
    let resolve!: (r: ProjectsResult) => void;
    setup(["C:/work"], new Promise<ProjectsResult>((r) => (resolve = r)));
    expect(screen.getByRole("status").textContent).toMatch(/looking for projects/i);
    resolve({ projects: [{ root: "C:/work/orbit", ok: true, overview: overview() }], errors: [] });
    const row = within(await screen.findByRole("list", { name: "Projects" })).getByRole("listitem");
    const r = within(row);
    expect(r.getByText("Orbit planner")).toBeDefined();
    expect(r.getByText("C:/work/orbit")).toBeDefined();
    expect(r.getByText(/research · review needed/)).toBeDefined();
    expect(r.getByText("1 of 4 tasks done · T-2 in progress")).toBeDefined();
    expect(r.getByText(/5 min ago · phase submitted · made-up-agent/)).toBeDefined();
  });

  it("says where it looked when there are no projects", async () => {
    setup(["C:/work", "D:/other"], { projects: [], errors: [] });
    expect(await screen.findByText(/no projects found in C:\/work, D:\/other/i)).toBeDefined();
  });

  it("shows a project it cannot read as an error row, never with invented values", async () => {
    setup(["C:/work"], { projects: [{ root: "C:/work/broken", ok: false, error: "project.json is not valid JSON" }], errors: [] });
    const row = within(await screen.findByRole("list", { name: "Projects" })).getByRole("listitem");
    expect(within(row).getByText("C:/work/broken")).toBeDefined();
    expect(within(row).getByText(/project\.json is not valid JSON/)).toBeDefined();
    expect(within(row).queryByText(/tasks done/)).toBeNull();
  });

  it("reports configured folders that could not be searched", async () => {
    setup(["relative"], { projects: [], errors: ['"relative" is not an absolute folder path.'] });
    expect((await screen.findByRole("alert")).textContent).toMatch(/not an absolute folder path/);
  });

  it("adds and removes folders", async () => {
    const { onFoldersChange } = setup(["C:/work"], { projects: [], errors: [] });
    await screen.findByText(/no projects found/i);
    fireEvent.change(screen.getByLabelText("Folder to add"), { target: { value: "  D:/more  " } });
    fireEvent.click(screen.getByRole("button", { name: /add folder/i }));
    expect(onFoldersChange).toHaveBeenLastCalledWith(["C:/work", "D:/more"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove C:/work" }));
    expect(onFoldersChange).toHaveBeenLastCalledWith([]);
  });

  it("does not add a blank or repeated folder", async () => {
    const { onFoldersChange } = setup(["C:/work"], { projects: [], errors: [] });
    await screen.findByText(/no projects found/i);
    for (const value of ["   ", "C:/work"]) {
      fireEvent.change(screen.getByLabelText("Folder to add"), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: /add folder/i }));
    }
    expect(onFoldersChange).not.toHaveBeenCalled();
  });

  it("loads again on refresh", async () => {
    const { load } = setup(["C:/work"], { projects: [], errors: [] });
    await screen.findByText(/no projects found/i);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});

describe("timeAgo", () => {
  it("says how long ago, in plain words", () => {
    const at = (iso: string) => timeAgo(iso, NOW);
    expect(at("2026-11-02T10:04:30.000Z")).toBe("just now");
    expect(at("2026-11-02T10:00:00.000Z")).toBe("5 min ago");
    expect(at("2026-11-02T07:05:00.000Z")).toBe("3 h ago");
    expect(at("2026-10-30T10:05:00.000Z")).toBe("3 days ago");
    expect(at("2026-11-01T10:05:00.000Z")).toBe("1 day ago");
  });
});
