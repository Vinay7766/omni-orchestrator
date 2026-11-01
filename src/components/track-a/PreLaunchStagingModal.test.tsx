import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreLaunchStagingModal } from "./PreLaunchStagingModal";
import { InstalledTool, Skill } from "../../lib/types";

describe("PreLaunchStagingModal Component", () => {
  const mockTools: InstalledTool[] = [
    {
      id: "cursor",
      name: "Cursor AI Editor",
      executablePath: "C:\\Program Files\\cursor.exe",
      installed: true,
      configDirectory: ".cursor/skills/",
      commandSnippet: "cursor .",
    },
    {
      id: "antigravity",
      name: "Google Antigravity",
      executablePath: "C:\\bin\\agy.cmd",
      installed: true,
      configDirectory: ".gemini/skills/",
      commandSnippet: "agy .",
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

    expect(screen.getByText("Cursor AI Editor")).toBeDefined();
    expect(screen.getByText("Google Antigravity")).toBeDefined();
    expect(screen.getByText("Spec-Driven Development")).toBeDefined();

    const launchBtn = screen.getByTestId("launch-and-build-btn");
    fireEvent.click(launchBtn);

    expect(handleLaunch).toHaveBeenCalledWith("cursor", expect.any(Array), expect.any(String));
  });
});
