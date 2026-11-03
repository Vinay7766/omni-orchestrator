import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { SetupGuide, type SetupChecks } from "./SetupGuide";
import type { DiscoveredTool } from "../../lib/types";

// E9 / NTU-4: a setup guide a non-technical person can follow, checking what can be checked.

const tool = { id: "made-up-editor", name: "Made-up Editor", category: "editor", capability: 2, evidence: [], needsConfirmation: false } as unknown as DiscoveredTool;

const checks = (over: Partial<SetupChecks> = {}): SetupChecks => ({
  gitVersion: () => Promise.resolve("2.47.1"),
  tools: () => Promise.resolve({ ok: true, tools: [tool] }),
  projectFolders: () => Promise.resolve(["C:/Users/me/Projects"]),
  openFolder: vi.fn(() => Promise.resolve()),
  ...over,
});

const step = (name: string) => screen.getByRole("listitem", { name });

describe("SetupGuide", () => {
  it("lists the steps in order: AI tool, Git, project folder, GitHub account, first push, running the app", async () => {
    render(<SetupGuide checks={checks()} onGoToProjects={vi.fn()} />);
    const steps = within(screen.getByRole("list", { name: "Setup steps" })).getAllByRole("listitem").filter((li) => li.parentElement?.getAttribute("aria-label") === "Setup steps");
    expect(steps.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Install an AI coding tool",
      "Install Git",
      "Choose where your projects live",
      "Create a GitHub account",
      "Put a project on GitHub (first push)",
      "Open OmniOrchestrator",
    ]);
    await act(async () => {});
  });

  it("checks what it can on this computer and says so in words", async () => {
    render(<SetupGuide checks={checks()} onGoToProjects={vi.fn()} />);
    expect(await within(step("Install Git")).findByText("Done: Git 2.47.1 is installed")).toBeDefined();
    expect(within(step("Install an AI coding tool")).getByText("Done: found Made-up Editor")).toBeDefined();
    expect(within(step("Choose where your projects live")).getByText("Done: 1 project folder")).toBeDefined();
    expect(within(step("Create a GitHub account")).getByText("Not checked: this happens on github.com")).toBeDefined();
  });

  it("says what is missing and checks again when asked", async () => {
    const gitVersion = vi.fn().mockResolvedValueOnce(null).mockResolvedValue("2.47.1");
    render(<SetupGuide checks={checks({ gitVersion, tools: () => Promise.resolve({ ok: true, tools: [] }), projectFolders: () => Promise.resolve([]) })} onGoToProjects={vi.fn()} />);
    expect(await within(step("Install Git")).findByText("Not yet: Git was not found")).toBeDefined();
    expect(within(step("Install an AI coding tool")).getByText("Not yet: no AI tool was found")).toBeDefined();
    expect(within(step("Choose where your projects live")).getByText("Not yet: no project folder")).toBeDefined();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check again" })));
    expect(within(step("Install Git")).getByText("Done: Git 2.47.1 is installed")).toBeDefined();
  });

  it("opens a project folder in the file manager and reports a failure honestly", async () => {
    const openFolder = vi.fn().mockRejectedValueOnce("C:/Users/me/Projects does not exist.").mockResolvedValue(undefined);
    render(<SetupGuide checks={checks({ openFolder })} onGoToProjects={vi.fn()} />);
    const button = await within(step("Choose where your projects live")).findByRole("button", { name: "Open C:/Users/me/Projects" });
    await act(async () => fireEvent.click(button));
    expect(openFolder).toHaveBeenCalledWith("C:/Users/me/Projects");
    expect(within(step("Choose where your projects live")).getByRole("alert").textContent).toContain("does not exist");
  });

  it("shows the first-push commands to copy, and leaves the website steps to the person", async () => {
    render(<SetupGuide checks={checks()} onGoToProjects={vi.fn()} />);
    const push = step("Put a project on GitHub (first push)");
    expect(push.textContent).toContain("git push -u origin main");
    expect(push.textContent).toContain("github.com/new");
    expect(screen.queryAllByRole("link")).toEqual([]);
    await act(async () => {});
  });

  it("reports a check that failed instead of showing it as missing", async () => {
    render(<SetupGuide checks={checks({ tools: () => Promise.resolve({ ok: false, error: "discovery failed: access denied" }) })} onGoToProjects={vi.fn()} />);
    expect(await within(step("Install an AI coding tool")).findByText("Could not check: discovery failed: access denied")).toBeDefined();
  });
});
