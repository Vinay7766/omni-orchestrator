import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

// Resolves the Tauri commands App calls on mount; tests override individual commands.
function mockBackend(overrides: Record<string, () => Promise<unknown>> = {}) {
  const handlers: Record<string, () => Promise<unknown>> = {
    discover_tools: () => Promise.resolve([]),
    get_skills: () => Promise.resolve([]),
    get_default_project_path: () => Promise.resolve("C:\\Users\\test\\Projects"),
    ...overrides,
  };
  mockedInvoke.mockImplementation((cmd: string) =>
    handlers[cmd] ? handlers[cmd]() : Promise.reject(`Unexpected command: ${cmd}`)
  );
}

// Renders App and lets its mount-time backend calls settle inside act().
async function renderApp() {
  await act(async () => {
    render(<App />);
  });
}

describe("OmniOrchestrator App", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockBackend();
  });

  it("renders navbar branding and target tool indicator", async () => {
    await renderApp();

    expect(screen.getAllByText("OmniOrchestrator")[0]).toBeDefined();
    expect(screen.getByText("Apache 2.0")).toBeDefined();
    expect(screen.getByText(".agents/session-state.json")).toBeDefined();
    // No tool name is assumed when discovery found nothing.
    expect(screen.getByText("None found")).toBeDefined();
  });

  it("renders the prompt input bar with inline track dropdown", async () => {
    await renderApp();

    const promptInput = screen.getByLabelText("Prompt Input");
    expect(promptInput).toBeDefined();

    const trackButton = screen.getByLabelText("Select Execution Track");
    expect(trackButton).toBeDefined();
    expect(screen.getByText(/Track A: Autonomous Builder/i)).toBeDefined();
  });

  it("opens skills modal when Skills button is clicked", async () => {
    await renderApp();

    const skillsBtn = screen.getByRole("button", { name: /Open Skill Catalog/i });
    fireEvent.click(skillsBtn);

    expect(screen.getByText(/Engineering Skill Catalog/i)).toBeDefined();
  });

  it("opens the projects list with the saved folders and saves a new folder", async () => {
    const saved: unknown[] = [];
    const settings = { defaultTrack: "track-a", theme: "dark", byok: {}, projectFolders: ["C:/work"] };
    mockedInvoke.mockImplementation((cmd: string, args?: unknown) => {
      const handlers: Record<string, () => Promise<unknown>> = {
        discover_tools: () => Promise.resolve([]),
        get_skills: () => Promise.resolve([]),
        get_default_project_path: () => Promise.resolve("C:\\Users\\test\\Projects"),
        get_app_settings: () => Promise.resolve(settings),
        save_app_settings: () => {
          saved.push(args);
          return Promise.resolve(null);
        },
        find_projects: () => Promise.resolve({ roots: [], errors: [] }),
      };
      return handlers[cmd] ? handlers[cmd]() : Promise.reject(`Unexpected command: ${cmd}`);
    });
    await renderApp();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Projects$/ }));
    });
    expect(await screen.findByText(/No projects found in C:\/work/)).toBeDefined();

    fireEvent.change(screen.getByLabelText("Folder to add"), { target: { value: "D:/more" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add folder/i }));
    });
    expect(saved).toEqual([{ settings: { ...settings, projectFolders: ["C:/work", "D:/more"] } }]);

    // Back to the workspace view.
    fireEvent.click(screen.getByRole("button", { name: /^Workspace$/ }));
    expect(screen.getByRole("button", { name: /^Projects$/ })).toBeDefined();
  });

  it("shows the backend error instead of a fabricated brief when Track A fails", async () => {
    mockBackend({
      generate_project_brief: () => Promise.reject("Failed to write brief: access denied"),
    });
    await renderApp();

    fireEvent.change(screen.getByLabelText("Prompt Input"), { target: { value: "Todo app" } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Submit Prompt"));
    });

    expect(screen.getByText(/Failed to write brief: access denied/)).toBeDefined();
    expect(screen.queryByText(/Brief Initialized/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Configure & Stage Run/i })).toBeNull();
  });

  it("shows the provider error instead of a fabricated report when a teardown fails", async () => {
    mockBackend({
      execute_strategic_teardown: () =>
        Promise.reject("OpenAI API error 401 Unauthorized: invalid api key"),
    });
    await renderApp();

    fireEvent.click(screen.getByLabelText("Select Execution Track"));
    fireEvent.click(screen.getByText(/Track B • Strategic Flywheel/));
    fireEvent.change(screen.getByLabelText("Prompt Input"), { target: { value: "Notion" } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Submit Prompt"));
    });

    expect(screen.getByText(/OpenAI API error 401 Unauthorized/)).toBeDefined();
    expect(screen.queryByText(/Executive Teardown Complete/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Teardown Report/i })).toBeNull();
  });
});
