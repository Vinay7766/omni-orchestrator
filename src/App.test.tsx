import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeInvoke } from "./lib/testing/fake-invoke";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const SETTINGS = { defaultTrack: "track-a", theme: "dark", byok: {}, projectFolders: ["C:/work"] };

// Resolves the Tauri commands App calls on mount; tests override individual commands.
function mockBackend(overrides: Record<string, (args?: unknown) => Promise<unknown>> = {}) {
  const handlers: Record<string, (args?: unknown) => Promise<unknown>> = {
    discover_tools: () => Promise.resolve([]),
    get_skills: () => Promise.resolve([]),
    get_default_project_path: () => Promise.resolve("C:\\Users\\test\\Projects"),
    get_byok_config: () => Promise.resolve({ config: {}, keyStorage: { available: true } }),
    get_app_settings: () => Promise.resolve(SETTINGS),
    find_projects: () => Promise.resolve({ roots: [], errors: [] }),
    ...overrides,
  };
  mockedInvoke.mockImplementation((cmd: string, args?: unknown) =>
    handlers[cmd] ? handlers[cmd](args) : Promise.reject(`Unexpected command: ${cmd}`)
  );
}

// Renders App and lets its mount-time backend calls settle inside act().
async function renderApp() {
  await act(async () => {
    render(<App />);
  });
}

const nav = () => within(screen.getByRole("navigation", { name: "Areas" }));

async function openArea(name: string) {
  await act(async () => {
    fireEvent.click(nav().getByRole("button", { name }));
  });
}

describe("OmniOrchestrator App", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockBackend();
  });

  it("opens on the projects list, marked as the current area", async () => {
    await renderApp();

    expect(screen.getAllByText("OmniOrchestrator")[0]).toBeDefined();
    expect(await screen.findByText(/No projects found in C:\/work/)).toBeDefined();
    expect(nav().getByRole("button", { name: "Projects" }).getAttribute("aria-current")).toBe("page");
  });

  it("reaches every area from the navigation and marks only the open one as current", async () => {
    await renderApp();

    for (const area of ["Start from an idea", "Pitch mode", "Skills", "Settings", "Projects"]) {
      await openArea(area);
      const current = nav()
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-current") === "page")
        .map((b) => b.textContent);
      expect(current).toEqual([area]);
    }
  });

  it("has no track picker and no made-up ledger file name", async () => {
    await renderApp();
    await openArea("Start from an idea");

    expect(screen.queryByLabelText("Select Execution Track")).toBeNull();
    expect(screen.queryByText(/Ledger/)).toBeNull();
    expect(screen.queryByText(/session-state\.json/)).toBeNull();
  });

  it("saves a new project folder from the projects area", async () => {
    const saved: unknown[] = [];
    mockBackend({
      save_app_settings: (args) => {
        saved.push(args);
        return Promise.resolve(null);
      },
    });
    await renderApp();

    expect(await screen.findByText(/No projects found in C:\/work/)).toBeDefined();
    fireEvent.change(screen.getByLabelText("Folder to add"), { target: { value: "D:/more" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add folder/i }));
    });
    expect(saved).toEqual([{ settings: { ...SETTINGS, projectFolders: ["C:/work", "D:/more"] } }]);
  });

  it("Start from an idea is the idea form, with the free options shown when no model is set up", async () => {
    await renderApp();
    await openArea("Start from an idea");

    expect(screen.getByLabelText(/your idea/i)).toBeDefined();
    expect((screen.getByLabelText(/parent folder/i) as HTMLInputElement).value).toBe("C:/Users/test/Projects");
    expect(screen.getByRole("region", { name: /set up an ai model/i })).toBeDefined();
    expect(screen.queryByLabelText("Prompt Input")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    });
    expect(nav().getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
  });

  it("creates a project from an idea, adds its folder to Projects and opens it", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-app-idea-")).replace(/\\/g, "/");
    try {
      const files = fakeInvoke([`${base}/orbit`]);
      const saved: unknown[] = [];
      const passThrough = (cmd: string) => (args?: unknown) => files(cmd, args as Record<string, unknown>);
      mockBackend({
        get_default_project_path: () => Promise.resolve(base),
        get_byok_config: () => Promise.resolve({ config: { ollamaEndpoint: "http://localhost:11434" }, keyStorage: { available: true } }),
        save_app_settings: (args) => {
          saved.push(args);
          return Promise.resolve();
        },
        ...Object.fromEntries(
          ["memfs_read_text", "memfs_write_text", "memfs_append_text", "memfs_create_exclusive", "memfs_exists", "memfs_mkdir", "memfs_rename", "memfs_remove", "memfs_list", "write_planning_document", "read_planning_document"].map((c) => [c, passThrough(c)]),
        ),
      });
      await renderApp();
      await openArea("Start from an idea");
      expect(screen.queryByRole("region", { name: /set up an ai model/i })).toBeNull();

      fireEvent.change(screen.getByLabelText(/your idea/i), { target: { value: "A shared shopping list" } });
      fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: "Orbit" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /create project/i }));
      });

      expect(await screen.findByRole("heading", { name: "Orbit" }, { timeout: 5000 })).toBeDefined();
      expect(readFileSync(`${base}/orbit/docs/planning/idea.md`, "utf8")).toContain("A shared shopping list");
      expect(saved).toEqual([{ settings: { ...SETTINGS, projectFolders: ["C:/work", base] } }]);
      expect(nav().getByRole("button", { name: "Projects" }).getAttribute("aria-current")).toBe("page");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("shows the provider error instead of a fabricated report when a pitch teardown fails", async () => {
    mockBackend({
      execute_strategic_teardown: () => Promise.reject("OpenAI API error 401 Unauthorized: invalid api key"),
    });
    await renderApp();
    await openArea("Pitch mode");

    fireEvent.change(screen.getByLabelText("Prompt Input"), { target: { value: "Notion" } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Submit Prompt"));
    });

    expect(screen.getByText(/OpenAI API error 401 Unauthorized/)).toBeDefined();
    expect(screen.queryByText(/Executive Teardown Complete/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Open Teardown Report/i })).toBeNull();
  });

  it("keeps each area's conversation when switching areas", async () => {
    mockBackend({
      execute_strategic_teardown: () => Promise.reject("provider down"),
    });
    await renderApp();
    await openArea("Pitch mode");
    fireEvent.change(screen.getByLabelText("Prompt Input"), { target: { value: "Notion" } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Submit Prompt"));
    });

    await openArea("Start from an idea");
    expect(screen.queryByText(/provider down/)).toBeNull();
    await openArea("Pitch mode");
    expect(screen.getByText(/provider down/)).toBeDefined();
  });

  it("loads the saved BYOK settings in Settings and saves changes through the credential-store command", async () => {
    const saved: unknown[] = [];
    mockBackend({
      get_byok_config: () =>
        Promise.resolve({ config: { geminiApiKey: "AIza-saved", preferredModel: "made-up-model-7b" }, keyStorage: { available: true } }),
      save_byok_config: (args) => {
        saved.push(args);
        return Promise.resolve({ available: true });
      },
    });
    await renderApp();
    await openArea("Settings");

    expect(screen.getByText("Gemini · made-up-model-7b")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /BYOK Configuration/ }));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "other-model" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save Configuration/ }));
    });
    expect(saved).toEqual([{ byok: { geminiApiKey: "AIza-saved", preferredModel: "other-model" } }]);

    // Pitch mode uses the same saved settings.
    await openArea("Pitch mode");
    expect(screen.getByText("Gemini · other-model")).toBeDefined();
  });

  it("shows the BYOK load error in Settings", async () => {
    mockBackend({ get_byok_config: () => Promise.reject("credential store locked") });
    await renderApp();
    await openArea("Settings");
    fireEvent.click(screen.getByRole("button", { name: /BYOK Configuration/ }));

    expect(screen.getByText(/credential store locked/)).toBeDefined();
  });

  it("lists and filters the skill catalog in the Skills area", async () => {
    const skill = (id: string, name: string, description: string) => ({
      id, name, description, content: "", category: "engineering", enabled: true, isCustom: false, phases: [],
      attribution: { name: "Some Author", sourceUrl: "https://example.org", verified: false },
    });
    mockBackend({
      get_skills: () => Promise.resolve([skill("tdd", "Test-driven development", "Red green refactor"), skill("sec", "Security hardening", "OWASP")]),
    });
    await renderApp();
    await openArea("Skills");

    expect(screen.getByText("Test-driven development")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Search skills"), { target: { value: "owasp" } });
    expect(screen.queryByText("Test-driven development")).toBeNull();
    expect(screen.getByText("Security hardening")).toBeDefined();
  });
});
