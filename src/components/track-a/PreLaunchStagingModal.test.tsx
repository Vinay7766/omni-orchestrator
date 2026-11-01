import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreLaunchStagingModal } from "./PreLaunchStagingModal";
import { DiscoveredTool, Skill } from "../../lib/types";

describe("PreLaunchStagingModal Component", () => {
  // Made-up tools: the app must work with whatever discovery finds, never a fixed list.
  const mockTools: DiscoveredTool[] = [
    {
      id: "nebula",
      name: "Nebula Editor",
      category: "editor",
      capability: 3,
      evidence: ["editor product.json"],
      needsConfirmation: false,
      launch: { program: "C:\Programs\Nebula\bin\nebula.cmd", args: [] },
    },
    {
      id: "zeta",
      name: "zeta",
      category: "command-line",
      capability: null,
      evidence: ["global package"],
      needsConfirmation: true,
      executable: "C:\bin\zeta.cmd",
    },
  ];

  const mockSkills: Skill[] = [
    {
      id: "spec-driven-development",
      name: "Spec-Driven Development",
      description: "PRD before code",
      category: "architecture",
      attribution: {
        name: "Addy Osmani",
        sourceUrl: "https://github.com/addyosmani/agent-skills",
        verified: true,
      },
      enabled: true,
      content: "# Spec",
      isCustom: false,
    },
  ];

  it("renders staging modal with detected tools and launches build", async () => {
    const handleLaunch = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <PreLaunchStagingModal
        isOpen={true}
        onClose={handleClose}
        projectName="TestCRM"
        projectPath="C:\\Projects\\TestCRM"
        detectedTools={mockTools}
        initialSkills={mockSkills}
        onLaunch={handleLaunch}
      />
    );

    expect(screen.getByText("Nebula Editor")).toBeDefined();
    expect(screen.getByText("zeta")).toBeDefined();
    expect(screen.getByText("Opens directly")).toBeDefined();
    expect(screen.getByText("Please confirm")).toBeDefined();
    expect(screen.getByText("Spec-Driven Development")).toBeDefined();

    const launchBtn = screen.getByTestId("launch-and-build-btn");
    fireEvent.click(launchBtn);

    expect(handleLaunch).toHaveBeenCalledWith("nebula", expect.any(Array), expect.any(String));
  });

  it("shows an honest empty state and cannot launch when no tools were found", () => {
    const handleLaunch = vi.fn();
    render(
      <PreLaunchStagingModal
        isOpen={true}
        onClose={vi.fn()}
        projectName="TestCRM"
        projectPath="C:\Projects\TestCRM"
        detectedTools={[]}
        initialSkills={mockSkills}
        onLaunch={handleLaunch}
      />
    );
    expect(screen.getByRole("status").textContent).toMatch(/No AI coding tools were found/);
    const launchBtn = screen.getByTestId("launch-and-build-btn") as HTMLButtonElement;
    expect(launchBtn.disabled).toBe(true);
    fireEvent.click(launchBtn);
    expect(handleLaunch).not.toHaveBeenCalled();
  });
});
