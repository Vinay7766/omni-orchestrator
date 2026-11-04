import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { TeamPanel } from "./TeamPanel";

// E6 slice 4: the person sees every tool found, with its level and evidence, selects the tools
// for this project (nothing is selected for them), confirms a level discovery could not find,
// saves, and hands the build to each selected tool.

const EDITOR = { id: "example-editor", name: "Example Editor", category: "editor", capability: 3, evidence: ["MCP config at ~/.example/mcp.json"], needsConfirmation: false };
const CLI = { id: "zeta", name: "Zeta", category: "command-line", capability: null, evidence: ["zeta on PATH"], needsConfirmation: true };
const SAVED = {
  formatVersion: 1 as const,
  updatedAt: "2026-11-03T10:00:00Z",
  members: [{ toolId: "example-editor", name: "Example Editor", capability: 3 as const, confirmedByPerson: false, addedAt: "2026-11-03T10:00:00Z" }],
};
const RESULT = { toolId: "example-editor", level: 3, files: ["AGENTS.md created."], mcp: null, mcpProblem: "The MCP server is not built yet.", launched: true, message: "Example Editor was opened with the project." };

async function setup(over: Record<string, unknown> = {}, props: { handOffReady?: boolean } = {}) {
  const fns = {
    discover: vi.fn().mockResolvedValue({ ok: true, tools: [EDITOR, CLI] }),
    load: vi.fn().mockResolvedValue({ ok: true, team: null }),
    save: vi.fn().mockResolvedValue({ ok: true, message: "1 tool selected for this project." }),
    handOff: vi.fn().mockResolvedValue({ ok: true, result: RESULT, buildStarted: true }),
    ...over,
  };
  await act(async () => {
    render(<TeamPanel root="/p" fns={fns} {...props} />);
  });
  return fns;
}

const checkbox = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("TeamPanel", () => {
  it("shows every tool found with its level and evidence, and selects none for the person", async () => {
    await setup();
    expect(checkbox(/Example Editor/).checked).toBe(false);
    expect(checkbox(/Zeta/).checked).toBe(false);
    expect(screen.getByText(/MCP config at ~\/.example\/mcp.json/)).toBeTruthy();
    expect(screen.getByText(/level 3/i)).toBeTruthy();
    expect(screen.getByText(/level unknown/i)).toBeTruthy();
  });

  it("saves the selected tools with their levels", async () => {
    const fns = await setup();
    fireEvent.click(checkbox(/Example Editor/));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });
    expect(fns.save).toHaveBeenCalledWith("/p", [{ toolId: "example-editor", name: "Example Editor", capability: 3, confirmedByPerson: false }]);
    expect(screen.getByRole("status").textContent).toMatch(/1 tool selected/);
  });

  it("needs the person to pick a level for a tool discovery could not place, and records it as confirmed", async () => {
    const fns = await setup();
    fireEvent.click(checkbox(/Zeta/));
    const save = screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: /level for Zeta/i }), { target: { value: "2" } });
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(fns.save).toHaveBeenCalledWith("/p", [{ toolId: "zeta", name: "Zeta", capability: 2, confirmedByPerson: true }]);
  });

  it("shows the saved team ticked and hands the build to a member, with what happened", async () => {
    const fns = await setup({ load: vi.fn().mockResolvedValue({ ok: true, team: SAVED }) });
    expect(checkbox(/Example Editor/).checked).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set up and open Example Editor/i }));
    });
    expect(fns.handOff).toHaveBeenCalledWith("/p", "example-editor");
    const result = screen.getByRole("region", { name: /Example Editor/ });
    expect(within(result).getByText(/AGENTS.md created/)).toBeTruthy();
    expect(within(result).getByText(/not built yet/)).toBeTruthy();
    expect(within(result).getByText(/opened with the project/)).toBeTruthy();
  });

  it("shows the handoff package for a chat-only tool so it can be copied", async () => {
    const chat = { ...SAVED, members: [{ ...SAVED.members[0], toolId: "zeta", name: "Zeta", capability: 1 as const, confirmedByPerson: true }] };
    await setup({
      load: vi.fn().mockResolvedValue({ ok: true, team: chat }),
      handOff: vi.fn().mockResolvedValue({ ok: true, result: { ...RESULT, toolId: "zeta", level: 1, files: [], mcpProblem: null }, handoffPackage: "# Handoff: Orbit", buildStarted: false }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set up and open Zeta/i }));
    });
    expect((screen.getByRole("textbox", { name: /handoff package/i }) as HTMLTextAreaElement).value).toBe("# Handoff: Orbit");
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
  });

  it("announces a refused handoff with its real reason", async () => {
    await setup({
      load: vi.fn().mockResolvedValue({ ok: true, team: SAVED }),
      handOff: vi.fn().mockResolvedValue({ ok: false, error: "AGENTS.md is a link to another file, so it was not changed." }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set up and open Example Editor/i }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/is a link/);
  });

  it("says when the build phase could not be started after a handoff", async () => {
    await setup({
      load: vi.fn().mockResolvedValue({ ok: true, team: SAVED }),
      handOff: vi.fn().mockResolvedValue({ ok: true, result: RESULT, buildStarted: false, buildProblem: "The build phase could not be started: locked" }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set up and open Example Editor/i }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/could not be started: locked/);
  });

  it("says so when discovery fails instead of showing an empty list", async () => {
    await setup({ discover: vi.fn().mockResolvedValue({ ok: false, error: "registry unreadable" }) });
    expect(screen.getByRole("alert").textContent).toMatch(/registry unreadable/);
  });

  // D: the tools and the models used in each come first; the task list is built around them.
  it("saves the models the person uses in each selected tool", async () => {
    const fns = await setup();
    fireEvent.click(checkbox(/Example Editor/));
    fireEvent.change(screen.getByLabelText("Models you use in Example Editor"), { target: { value: "made-up-large, made-up-fast, made-up-large" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save the selection/i }));
    });
    expect(fns.save).toHaveBeenCalledWith("/p", [
      { toolId: "example-editor", name: "Example Editor", capability: 3, confirmedByPerson: false, models: ["made-up-large", "made-up-fast"] },
    ]);
  });

  it("shows the saved models again", async () => {
    await setup({ load: vi.fn().mockResolvedValue({ ok: true, team: { ...SAVED, members: [{ ...SAVED.members[0], models: ["made-up-large"] }] } }) });
    expect((screen.getByLabelText("Models you use in Example Editor") as HTMLInputElement).value).toBe("made-up-large");
  });

  it("waits for the approved task list before handing off, and says so", async () => {
    await setup({ load: vi.fn().mockResolvedValue({ ok: true, team: SAVED }) }, { handOffReady: false });
    expect(screen.queryByRole("button", { name: /set up and open example editor/i })).toBeNull();
    expect(screen.getByText(/once the task list is approved/i)).toBeDefined();
  });

  it("sets up and opens every tool in the team with one click, each with its own result (D)", async () => {
    const two = { ...SAVED, members: [...SAVED.members, { toolId: "zeta", name: "Zeta", capability: 2 as const, confirmedByPerson: true, addedAt: "2026-11-03T10:00:00Z" }] };
    const fns = await setup({ load: vi.fn().mockResolvedValue({ ok: true, team: two }) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set up and open all/i }));
    });
    expect(fns.handOff.mock.calls.map((c: unknown[]) => c[1])).toEqual(["example-editor", "zeta"]);
    expect(screen.getByRole("region", { name: "Handoff to Zeta" })).toBeDefined();
  });

  it("looks for tools again only when the person asks (issue A)", async () => {
    const fns = await setup();
    expect(fns.discover).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /look for tools again/i }));
    });
    expect(fns.discover).toHaveBeenLastCalledWith(true);
  });
});
