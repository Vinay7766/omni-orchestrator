import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeInvoke } from "./lib/testing/fake-invoke";
import { MemoryStore, PhaseEngine } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { createProjectFromIdea } from "./lib/planning";

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

    for (const area of ["Start from an idea", "Pitch mode", "Skills", "Setup guide", "Settings", "Projects"]) {
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

  it("runs a planning phase with the person's model, shows its document, and the person approves it", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-app-run-")).replace(/\\/g, "/");
    try {
      const files = fakeInvoke([`${base}/orbit`]);
      const prompts: string[] = [];
      const passThrough = (cmd: string) => (args?: unknown) => files(cmd, args as Record<string, unknown>);
      const ideaSkill = {
        id: "idea-review", name: "Idea review", description: "Reviews ideas honestly", category: "strategy",
        attribution: { name: "Made-up Author", sourceUrl: "https://example.org", verified: true },
        enabled: true, content: "IDEA REVIEW METHOD", isCustom: false, phases: ["idea-review"], license: "MIT",
      };
      mockBackend({
        get_default_project_path: () => Promise.resolve(base),
        get_skills: () => Promise.resolve([ideaSkill]),
        get_byok_config: () => Promise.resolve({ config: { ollamaEndpoint: "http://localhost:11434", preferredModel: "made-up-model" }, keyStorage: { available: true } }),
        save_app_settings: () => Promise.resolve(),
        byok_complete: (args) => {
          prompts.push((args as { request: { prompt: string } }).request.prompt);
          return Promise.resolve({
            text: "# Idea review\n\nVerdict: build it.\n\n## Understanding check\n\nA list families share.\n\n## Skills applied\n\n- idea-review: checked problem and users\n",
            provider: "ollama",
            model: "made-up-model",
          });
        },
        ...Object.fromEntries(
          ["memfs_read_text", "memfs_write_text", "memfs_append_text", "memfs_create_exclusive", "memfs_exists", "memfs_mkdir", "memfs_rename", "memfs_remove", "memfs_list", "write_planning_document", "read_planning_document"].map((c) => [c, passThrough(c)]),
        ),
      });
      await renderApp();
      await openArea("Start from an idea");
      fireEvent.change(screen.getByLabelText(/your idea/i), { target: { value: "A shared shopping list" } });
      fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: "Orbit" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /create project/i }));
      });
      await screen.findByRole("heading", { name: "Orbit" }, { timeout: 10_000 });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /run idea-review/i }));
      });
      expect(await screen.findByText(/Verdict: build it\./, {}, { timeout: 10_000 })).toBeDefined();
      expect(prompts[0]).toContain("IDEA REVIEW METHOD");
      expect(prompts[0]).toContain("A shared shopping list");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /approve/i }));
      });
      expect(await screen.findByText(/"idea-review" approved/, {}, { timeout: 10_000 })).toBeDefined();
      expect(await screen.findByRole("button", { name: /run research/i }, { timeout: 10_000 })).toBeDefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    // Real files for create, run, approve and the next start: about 2 s alone, over 5 s when the
    // full suite runs every package in parallel.
  }, 30_000);

  it("after the architecture is approved, the model writes the task list and the person approves it", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-app-tasklist-")).replace(/\\/g, "/");
    try {
      const files = fakeInvoke([`${base}/orbit`]);
      const created = await createProjectFromIdea(files, { parent: base, name: "Orbit", idea: "A shared shopping list" });
      if (!created.ok) throw new Error(created.error);
      const opened = await MemoryStore.open(createNodeFs(), created.root);
      if (!opened.ok) throw new Error("project did not open");
      const engine = new PhaseEngine(opened.store);
      const writer = { kind: "agent" as const, tool: "omni-desktop", model: "made-up-model" };
      for (const phase of ["idea-review", "research", "prd", "architecture"]) {
        await engine.start(writer, phase);
        await opened.store.appendEvent({ type: "memory_updated", actor: writer, payload: { files: [`docs/planning/${phase}.md`] } });
        await engine.submit(writer, { phase, documents: [`docs/planning/${phase}.md`], skillsUsed: [{ skill: "x", evidence: "y" }], understandingCheck: "docs/planning/u.md", ...(phase === "architecture" ? { stackAdr: "docs/planning/a.md" } : {}) });
        await engine.approve({ kind: "human", tool: "omni-desktop" }, phase);
      }
      await engine.start({ kind: "human", tool: "omni-desktop" }, "build");

      const passThrough = (cmd: string) => (args?: unknown) => files(cmd, args as Record<string, unknown>);
      mockBackend({
        get_byok_config: () => Promise.resolve({ config: { ollamaEndpoint: "http://localhost:11434", preferredModel: "made-up-model" }, keyStorage: { available: true } }),
        get_app_settings: () => Promise.resolve({ ...SETTINGS, projectFolders: [base] }),
        find_projects: () => Promise.resolve({ roots: [created.root], errors: [] }),
        byok_complete: () =>
          Promise.resolve({
            text: '```json\n{"tasks":[{"title":"Data model","requirements":["REQ-1"],"kinds":["backend"]},{"title":"List screen","kinds":["interface","tests"]}]}\n```',
            provider: "ollama",
            model: "made-up-model",
          }),
        ...Object.fromEntries(
          ["memfs_read_text", "memfs_write_text", "memfs_append_text", "memfs_create_exclusive", "memfs_exists", "memfs_mkdir", "memfs_rename", "memfs_remove", "memfs_list", "write_planning_document", "read_planning_document"].map((c) => [c, passThrough(c)]),
        ),
      });
      await renderApp();
      const open = await screen.findByRole("button", { name: /open orbit/i }, { timeout: 10_000 });
      await act(async () => {
        fireEvent.click(open);
      });
      const write = await screen.findByRole("button", { name: /write the task list/i }, { timeout: 10_000 });
      await act(async () => {
        fireEvent.click(write);
      });
      expect(await screen.findByText(/List screen/, {}, { timeout: 10_000 })).toBeDefined();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /approve the task list/i }));
      });
      expect(await screen.findByText(/2 tasks created/, {}, { timeout: 10_000 })).toBeDefined();
      await waitFor(() => expect(screen.queryByRole("region", { name: "Task list" })).toBeNull(), { timeout: 10_000 });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    // Real files: four locked writes on approval; about 2.5 s alone, much slower under the parallel full run.
  }, 30_000);

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

  // P-E4-01 / P-E4-02: a change that was not saved is never shown as saved (NFR-7).
  const madeUpSkill = {
    id: "made-up", name: "Made-up skill", description: "Saved description", content: "Saved content",
    category: "engineering", enabled: true, isCustom: false, phases: [],
    attribution: { name: "Some Author", sourceUrl: "https://example.org", verified: false },
  };
  const toggle = () => screen.getByRole("checkbox", { name: "Toggle Made-up skill" }) as HTMLInputElement;

  it("keeps a skill's switch where it was and shows the real error when turning it off fails", async () => {
    mockBackend({
      get_skills: () => Promise.resolve([madeUpSkill]),
      toggle_skill: () => Promise.reject("could not write the skill settings: disk full"),
    });
    await renderApp();
    await openArea("Skills");

    await act(async () => {
      fireEvent.click(toggle());
    });

    expect(toggle().checked).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/disk full/);
  });

  it("moves a skill's switch once turning it off is saved", async () => {
    mockBackend({ get_skills: () => Promise.resolve([madeUpSkill]), toggle_skill: () => Promise.resolve(null) });
    await renderApp();
    await openArea("Skills");

    await act(async () => {
      fireEvent.click(toggle());
    });

    expect(toggle().checked).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the real error when saving a skill edit fails, keeps the typed text and leaves the list unchanged", async () => {
    mockBackend({
      get_skills: () => Promise.resolve([madeUpSkill]),
      update_skill_content: () => Promise.reject("could not save the skill: permission denied"),
    });
    await renderApp();
    await openArea("Skills");
    fireEvent.click(screen.getByRole("button", { name: "Edit Made-up skill" }));
    fireEvent.change(screen.getByDisplayValue("Saved description"), { target: { value: "Unsaved description" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save Modifications/ }));
    });

    expect(screen.getByRole("alert").textContent).toMatch(/permission denied/);
    expect(screen.getByDisplayValue("Unsaved description")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Saved description")).toBeDefined();
    expect(screen.queryByText("Unsaved description")).toBeNull();
  });
});
