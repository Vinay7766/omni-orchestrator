import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Team } from "@omni/core";
import { FreshSessionPanel, type FreshSessionFns } from "./FreshSessionPanel";
import type { FreshSessionOutcome } from "../../lib/fresh-session";

// E11 / HND-7: after an approval the person starts the next phase in a fresh session, in one click.

const team: Team = {
  formatVersion: 1,
  updatedAt: "2026-11-03T10:00:00Z",
  members: [
    { toolId: "made-up-cli", name: "Made-up CLI", capability: 2, confirmedByPerson: true, addedAt: "2026-11-03T10:00:00Z" },
    { toolId: "made-up-editor", name: "Made-up Editor", capability: 3, confirmedByPerson: false, addedAt: "2026-11-03T10:00:00Z" },
  ],
};

const outcome = (promptPassed: boolean): FreshSessionOutcome => ({
  ok: true,
  prompt: "# Fresh session: Orbit\n\nPhase: prd\n",
  sessionRecorded: true,
  result: { toolId: "made-up-editor", toolName: "Made-up Editor", launched: true, promptPassed, message: "Made-up Editor was opened with the project. Paste the prompt into a new chat there." },
});

const fns = (start: FreshSessionFns["start"]): FreshSessionFns => ({ loadTeam: () => Promise.resolve({ ok: true, team }), start });

describe("FreshSessionPanel", () => {
  it("offers the project's tools and starts the chosen one for the next phase", async () => {
    const start = vi.fn(() => Promise.resolve(outcome(true)));
    render(<FreshSessionPanel root="C:/work/orbit" phase="prd" fns={fns(start)} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Made-up Editor" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start prd in a fresh session" })));
    expect(start).toHaveBeenCalledWith("C:/work/orbit", "made-up-editor");
    expect(screen.getByRole("status").textContent).toContain("Made-up Editor was opened with the project");
    expect(screen.queryByRole("textbox", { name: "Prompt for the new session" })).toBeNull();
  });

  it("shows the prompt with a copy button when the tool could not be given it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<FreshSessionPanel root="C:/work/orbit" phase="prd" fns={fns(() => Promise.resolve(outcome(false)))} />);
    await screen.findByRole("radio", { name: "Made-up CLI" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start prd in a fresh session" })));
    expect((screen.getByRole("textbox", { name: "Prompt for the new session" }) as HTMLTextAreaElement).value).toContain("Phase: prd");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy the prompt" })));
    expect(writeText).toHaveBeenCalledWith("# Fresh session: Orbit\n\nPhase: prd\n");
    expect(screen.getByText("Copied. Paste it into a new chat in the tool.")).toBeDefined();
  });

  it("shows the real error when the session could not be started", async () => {
    render(<FreshSessionPanel root="C:/work/orbit" phase="prd" fns={fns(() => Promise.resolve({ ok: false, error: "\"made-up-cli\" was not found on this computer any more." }))} />);
    await screen.findByRole("radio", { name: "Made-up CLI" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start prd in a fresh session" })));
    expect(screen.getByRole("alert").textContent).toContain("was not found on this computer any more");
  });

  it("shows nothing when no tools are selected for the project", async () => {
    const empty: FreshSessionFns = { loadTeam: () => Promise.resolve({ ok: true, team: null }), start: vi.fn() };
    const { container } = render(<FreshSessionPanel root="C:/work/orbit" phase="prd" fns={empty} />);
    await act(async () => {});
    expect(container.textContent).toBe("");
  });
});
